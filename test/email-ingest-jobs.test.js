import assert from "node:assert/strict";
import test from "node:test";
import { completeEmailJob, failEmailJob } from "../src/server/services/emailIngestJobs.js";

test("job completion is conditional on the claimed attempt token",async()=>{
  const original={url:process.env.SUPABASE_URL,key:process.env.SUPABASE_SERVICE_ROLE_KEY,fetch:globalThis.fetch};
  process.env.SUPABASE_URL="https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY="service-role-test";
  let request;
  globalThis.fetch=async(url,options)=>{request={url:String(url),options};return Response.json([]);};
  try{
    const result=await completeEmailJob({id:"job-1",attempt_token:"attempt-1"},{packId:"PK-1"});
    assert.equal(result,null);
    assert.match(request.url,/id=eq\.job-1/);
    assert.match(request.url,/status=eq\.processing/);
    assert.match(request.url,/attempt_token=eq\.attempt-1/);
    assert.equal(JSON.parse(request.options.body).attempt_token,null);
  }finally{
    globalThis.fetch=original.fetch;
    if(original.url===undefined)delete process.env.SUPABASE_URL;else process.env.SUPABASE_URL=original.url;
    if(original.key===undefined)delete process.env.SUPABASE_SERVICE_ROLE_KEY;else process.env.SUPABASE_SERVICE_ROLE_KEY=original.key;
  }
});

test("claimed job updates reject missing ownership tokens",async()=>{
  await assert.rejects(completeEmailJob({id:"job-1"}),/no attempt token/i);
  await assert.rejects(failEmailJob({id:"job-1",attempts:1,max_attempts:5},new Error("failed")),/no attempt token/i);
});
