import assert from "node:assert/strict";
import test from "node:test";
import { persistManualUploadSources } from "../src/services/manualUploadPersistence.js";

test("manual upload carries each returned database version through the full persistence sequence", async () => {
  const initialPack={
    id:"PK-1",
    organisationId:"org-live",
    status:"Processing",
    uploadedFiles:[{id:"file-1",name:"invoice.pdf",type:"application/pdf",size:123,storagePath:null}]
  };
  const sourceFile={name:"invoice.pdf"};
  const saves=[];
  const uploads=[];

  const result=await persistManualUploadSources({
    initialPack,
    sourceFiles:[sourceFile],
    persistPack:async pack=>{
      saves.push(JSON.parse(JSON.stringify(pack)));
      return {...pack,updated_at:saves.length===1?"version-1":"version-2"};
    },
    createUploadTarget:async(metadata,pack)=>{
      assert.equal(pack.updated_at,"version-1");
      return {signedUrl:"https://storage.example/upload",path:`organisations/org-live/packs/uuid/${metadata.id}-invoice.pdf`};
    },
    uploadSource:async(file,metadata,target)=>uploads.push({file,metadata,target})
  });

  assert.equal(saves.length,2);
  assert.equal(saves[1].updated_at,"version-1");
  assert.equal(saves[1].uploadedFiles[0].storagePath,"organisations/org-live/packs/uuid/file-1-invoice.pdf");
  assert.equal(result.updated_at,"version-2");
  assert.equal(uploads.length,1);
});
