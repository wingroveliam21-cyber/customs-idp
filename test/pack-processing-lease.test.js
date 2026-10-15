import assert from "node:assert/strict";
import test from "node:test";
import { claimPackProcessing, PackProcessingConflictError, savePack } from "../src/server/services/packRepository.js";

async function withRepositoryFetch(fetchImplementation,callback){
  const original={url:process.env.SUPABASE_URL,key:process.env.SUPABASE_SERVICE_ROLE_KEY,fetch:globalThis.fetch};
  process.env.SUPABASE_URL="https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY="service-role-test";
  globalThis.fetch=fetchImplementation;
  try{return await callback();}
  finally{
    globalThis.fetch=original.fetch;
    if(original.url===undefined)delete process.env.SUPABASE_URL;else process.env.SUPABASE_URL=original.url;
    if(original.key===undefined)delete process.env.SUPABASE_SERVICE_ROLE_KEY;else process.env.SUPABASE_SERVICE_ROLE_KEY=original.key;
  }
}

test("processing writes require the current attempt token and release it on completion",async()=>{
  const requests=[];
  await withRepositoryFetch(async(url,options={})=>{
    requests.push({url:String(url),options});
    if(String(url).endsWith("/rest/v1/rpc/claim_document_pack_processing")){
      return Response.json([{id:"PK-1",organisation_id:"org-1",processing_token:"attempt-1",extracted_data:{}}]);
    }
    return Response.json([{...JSON.parse(options.body),id:"PK-1",organisation_id:"org-1"}]);
  },async()=>{
    const claimed=await claimPackProcessing("org-1","PK-1");
    assert.equal(claimed.processingToken,"attempt-1");
    await savePack({...claimed,status:"Ready"},{processingToken:claimed.processingToken,releaseProcessing:true});
  });

  const saveRequest=requests[1];
  assert.match(saveRequest.url,/processing_token=eq\.attempt-1/);
  assert.equal(JSON.parse(saveRequest.options.body).processing_token,null);
  assert.equal(JSON.parse(saveRequest.options.body).processing_lease_until,null);
});

test("a superseded processing attempt cannot overwrite the current pack",async()=>{
  await withRepositoryFetch(async()=>Response.json([]),async()=>{
    await assert.rejects(
      savePack({id:"PK-1",organisationId:"org-1"},{processingToken:"attempt-old"}),
      error=>error instanceof PackProcessingConflictError
    );
  });
});
