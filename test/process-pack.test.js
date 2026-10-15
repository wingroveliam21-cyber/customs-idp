import test from "node:test";
import assert from "node:assert/strict";
import { ProcessPackError, processPack, sourcePathBelongsToPack } from "../src/server/services/processPack.js";

const clone=value=>JSON.parse(JSON.stringify(value));

function fixture(overrides={}){
  const saved=[];
  const history=[];
  const strategies=[];
  const basePack={
    id:"PK-1",
    organisationId:"org-1",
    organisationName:"Test Organisation",
    customer:null,
    customerId:null,
    status:"Processing",
    uploadedFiles:[{id:"PK-1-0",name:"invoice.pdf",type:"application/pdf",storagePath:"PK-1/invoice.pdf"}],
    ...overrides.pack
  };
  const dependencies={
    loadPack:async()=>clone(basePack),
    claimPackProcessing:async()=>({...clone(basePack),processingToken:"attempt-1"}),
    savePack:async pack=>{const copy=clone(pack);saved.push(copy);return copy;},
    listCustomers:async()=>[],
    loadCustomerStrategy:async(_organisationId,customerId)=>{strategies.push(customerId);return null;},
    loadSource:async file=>({fileData:"data:"+file.type+";base64,AA==",mimeType:file.type}),
    extractDocument:async({filename})=>({extraction:{documentType:"commercial_invoice",confidence:90,exporter:"Unknown Exporter",invoiceNumber:filename,lines:[]}}),
    buildWorkingRecord:pack=>({...pack.extractedData,workingRecordSource:"test"}),
    validatePack:pack=>({...pack,status:"Ready",validationStatus:"Validated",validationChecks:[],validationSummary:{passed:1}}),
    runAudit:async()=>({action:"none",suggestions:[]}),
    insertHistory:async event=>{history.push(event);},
    now:(()=>{let tick=0;return()=>`2026-10-05T10:00:0${tick++}.000Z`;})(),
    logError:()=>{},
    ...overrides.dependencies
  };
  return {dependencies,saved,history,strategies};
}

test("processPack rejects a concurrent worker when the pack lease is already owned",async()=>{
  let extracted=false;
  const setup=fixture({dependencies:{
    claimPackProcessing:async()=>null,
    extractDocument:async()=>{extracted=true;return {extraction:{lines:[]}};}
  }});
  await assert.rejects(
    processPack({organisationId:"org-1",packId:"PK-1",reason:"initial",actor:{type:"system"},dependencies:setup.dependencies}),
    error=>error instanceof ProcessPackError&&error.status===409
  );
  assert.equal(extracted,false);
  assert.equal(setup.saved.length,0);
});

test("processPack processes persisted sources and records ordered history",async()=>{
  const setup=fixture({
    pack:{customer:"Acme",customerId:"customer-1"},
    dependencies:{
      listCustomers:async()=>[{id:"customer-1",name:"Acme",status:"active"}],
      loadCustomerStrategy:async()=>({instructions:"Acme rules",weightHandling:"invoice"})
    }
  });
  const result=await processPack({organisationId:"org-1",packId:"PK-1",reason:"initial",actor:{type:"user",name:"Tester"},dependencies:setup.dependencies});
  assert.equal(result.status,"Ready");
  assert.equal(result.extractedData.documents[0].filename,"invoice.pdf");
  assert.equal(result.workingRecord.workingRecordSource,"test");
  assert.deepEqual(setup.history.map(event=>event.action),["extracted","customer_identified","strategy_applied","validated","processed"]);
  assert.equal(setup.saved[0].status,"Processing");
  assert.equal(setup.saved.at(-1).status,"Ready");
});

test("processPack identifies an unknown customer after default-strategy extraction",async()=>{
  let extractionStrategy,workingStrategy;
  const setup=fixture({dependencies:{
    listCustomers:async()=>[{id:"customer-2",name:"Matched Exporter",status:"active"}],
    loadCustomerStrategy:async()=>({instructions:"Matched strategy",weightHandling:"packing_list"}),
    extractDocument:async input=>{extractionStrategy=input.customerStrategy;return {extraction:{documentType:"commercial_invoice",confidence:95,exporter:"Matched Exporter",lines:[]}};},
    buildWorkingRecord:(pack,strategy)=>{workingStrategy=strategy;return pack.extractedData;}
  }});
  const result=await processPack({organisationId:"org-1",packId:"PK-1",reason:"initial",actor:{type:"system"},dependencies:setup.dependencies});
  assert.equal(extractionStrategy.instructions,"");
  assert.equal(workingStrategy.instructions,"Matched strategy");
  assert.equal(result.customerId,"customer-2");
  assert.equal(result.customerIdentification.matchedBy,"exporter");
  assert.ok(setup.history.some(event=>event.action==="customer_identified"));
});

test("processPack retains successful documents when another extraction fails",async()=>{
  const setup=fixture({
    pack:{uploadedFiles:[
      {id:"PK-1-0",name:"invoice.pdf",type:"application/pdf",storagePath:"PK-1/invoice.pdf"},
      {id:"PK-1-1",name:"packing.pdf",type:"application/pdf",storagePath:"PK-1/packing.pdf"}
    ]},
    dependencies:{extractDocument:async({filename})=>{
      if(filename==="packing.pdf")throw new Error("Unreadable file");
      return {extraction:{documentType:"commercial_invoice",confidence:88,lines:[]}};
    }}
  });
  const result=await processPack({organisationId:"org-1",packId:"PK-1",reason:"initial",actor:{type:"user"},dependencies:setup.dependencies});
  assert.equal(result.status,"Needs review");
  assert.equal(result.extractedData.documents.filter(document=>document.extraction).length,1);
  assert.match(result.extractedData.documents[1].error,/Unreadable file/);
  assert.match(result.processingError,/packing\.pdf: Unreadable file/);
});

test("processPack leaves an email pack Processing when its mandatory audit fails",async()=>{
  const setup=fixture({pack:{email:{subject:"Documents"}},dependencies:{runAudit:async()=>{throw new Error("Audit unavailable");}}});
  const result=await processPack({organisationId:"org-1",packId:"PK-1",reason:"initial",actor:{type:"system"},dependencies:setup.dependencies});
  assert.equal(result.status,"Processing");
  assert.equal(result.processingCompletedAt,undefined);
  assert.equal(result.processingError,"Audit unavailable");
  assert.deepEqual(setup.history.map(event=>event.action),["processing_error"]);
});

test("history insertion failures never change a successfully persisted pack",async()=>{
  const logged=[];
  const setup=fixture({dependencies:{insertHistory:async()=>{throw new Error("History unavailable");},logError:(message,error)=>logged.push([message,error.message])}});
  const result=await processPack({organisationId:"org-1",packId:"PK-1",reason:"reprocess",actor:{type:"user"},dependencies:setup.dependencies});
  assert.equal(result.status,"Ready");
  assert.equal(setup.saved.at(-1).status,"Ready");
  assert.ok(logged.length>=3);
});

test("processPack rejects packs without persisted source metadata after recording failure state",async()=>{
  const setup=fixture({pack:{uploadedFiles:[]}});
  await assert.rejects(
    processPack({organisationId:"org-1",packId:"PK-1",reason:"initial",actor:{type:"user"},dependencies:setup.dependencies}),
    error=>error instanceof ProcessPackError&&error.status===422
  );
  assert.equal(setup.saved.at(-1).status,"Needs review");
  assert.match(setup.saved.at(-1).processingError,/No persisted source documents/);
  assert.deepEqual(setup.history.map(event=>event.action),["processing_error"]);
});

test("processPack rejects a source path belonging to another pack",async()=>{
  let sourceLoaded=false;
  const setup=fixture({pack:{uploadedFiles:[{id:"PK-1-0",name:"invoice.pdf",type:"application/pdf",storagePath:"PK-OTHER/invoice.pdf"}]},dependencies:{loadSource:async()=>{sourceLoaded=true;}}});
  await assert.rejects(
    processPack({organisationId:"org-1",packId:"PK-1",reason:"initial",actor:{type:"user"},dependencies:setup.dependencies}),
    error=>error instanceof ProcessPackError&&error.status===422
  );
  assert.equal(sourceLoaded,false);
  assert.match(setup.saved.at(-1).processingError,/does not belong/);
});

test("organisation-scoped storage paths belong to their pack UUID",()=>{
  const context={organisationId:"org-1",packId:"PK-1",packUuid:"pack-uuid"};
  assert.equal(sourcePathBelongsToPack("organisations/org-1/packs/pack-uuid/invoice.pdf",context),true);
  assert.equal(sourcePathBelongsToPack("organisations/org-1/packs/other-pack/invoice.pdf",context),false);
  assert.equal(sourcePathBelongsToPack("organisations/other-org/packs/pack-uuid/invoice.pdf",context),false);
});

test("processPack does not write completion history when final persistence fails",async()=>{
  let saves=0;
  const setup=fixture({dependencies:{savePack:async pack=>{saves++;if(saves===2)throw new Error("Database unavailable");return clone(pack);}}});
  await assert.rejects(
    processPack({organisationId:"org-1",packId:"PK-1",reason:"initial",actor:{type:"user"},dependencies:setup.dependencies}),
    /Database unavailable/
  );
  assert.equal(setup.history.some(event=>["processed","reprocessed"].includes(event.action)),false);
});

test("unexpected processing failures become visible and recoverable",async()=>{
  const setup=fixture({dependencies:{listCustomers:async()=>{throw new Error("Customer service unavailable");}}});
  await assert.rejects(
    processPack({organisationId:"org-1",packId:"PK-1",reason:"initial",actor:{type:"user"},dependencies:setup.dependencies}),
    error=>error instanceof ProcessPackError&&error.message==="Customer service unavailable"
  );
  assert.equal(setup.saved.at(-1).status,"Needs review");
  assert.equal(setup.saved.at(-1).processingError,"Customer service unavailable");
  assert.equal(setup.history.at(-1).action,"processing_error");
});
