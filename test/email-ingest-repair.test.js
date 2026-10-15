import assert from "node:assert/strict";
import test from "node:test";
import { mergeInboundAttachments } from "../src/server/api/email-ingest.js";

test("repair ingestion preserves successful uploads and leaves only missing sources retryable",()=>{
  const files=mergeInboundAttachments("PK-EMAIL-1",[
    {filename:"invoice.pdf",size:100,mimeType:"application/pdf"},
    {filename:"packing-list.pdf",size:200,mimeType:"application/pdf"}
  ],[
    {id:"PK-EMAIL-1-0",name:"invoice.pdf",size:100,type:"application/pdf",storagePath:"organisations/org-1/packs/uuid/invoice.pdf"},
    {id:"PK-EMAIL-1-1",name:"packing-list.pdf",size:200,type:"application/pdf",storagePath:null,storageError:"Temporary outage"}
  ]);

  assert.equal(files[0].storagePath,"organisations/org-1/packs/uuid/invoice.pdf");
  assert.equal(files[0].storageError,undefined);
  assert.equal(files[1].storagePath,null);
  assert.equal(files[1].storageError,"Temporary outage");
});
