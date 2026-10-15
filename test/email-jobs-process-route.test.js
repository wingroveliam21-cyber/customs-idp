import assert from "node:assert/strict";
import test from "node:test";
import { POST } from "../app/api/email-jobs/process/route.js";

test("email job worker reports missing cron configuration",async()=>{
  const original=process.env.CRON_SECRET;
  delete process.env.CRON_SECRET;
  try{
    const response=await POST(new globalThis.Request("http://localhost/api/email-jobs/process",{method:"POST"}));
    assert.equal(response.status,503);
    assert.deepEqual(await response.json(),{error:"CRON_SECRET is not configured."});
  }finally{
    if(original===undefined)delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET=original;
  }
});

test("email job worker rejects an invalid cron secret",async()=>{
  const original=process.env.CRON_SECRET;
  process.env.CRON_SECRET="expected-secret";
  try{
    const response=await POST(new globalThis.Request("http://localhost/api/email-jobs/process",{
      method:"POST",
      headers:{Authorization:"Bearer wrong-secret"}
    }));
    assert.equal(response.status,401);
    assert.deepEqual(await response.json(),{error:"Unauthorized"});
  }finally{
    if(original===undefined)delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET=original;
  }
});
