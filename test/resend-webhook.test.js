import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { handleResendWebhook, processQueuedResendJobs, processResendEmail, verifyResendSignature } from "../src/server/api/resend-webhook.js";

function signedHeaders({ secret, rawBody, id = "msg_test", timestamp = Math.floor(Date.now() / 1000) }) {
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const signature = crypto
    .createHmac("sha256", key)
    .update(`${id}.${timestamp}.${rawBody}`)
    .digest("base64");

  return {
    "svix-id": id,
    "svix-timestamp": String(timestamp),
    "svix-signature": `v1,${signature}`
  };
}

async function withResendEnv(callback) {
  const original = {
    RESEND_WEBHOOK_SECRET: process.env.RESEND_WEBHOOK_SECRET,
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    EMAIL_INGEST_SECRET: process.env.EMAIL_INGEST_SECRET,
    RESEND_INBOUND_ADDRESS: process.env.RESEND_INBOUND_ADDRESS
  };
  const secret = `whsec_${Buffer.from("resend-test-secret").toString("base64")}`;

  process.env.RESEND_WEBHOOK_SECRET = secret;
  process.env.RESEND_API_KEY = "re_test";
  process.env.EMAIL_INGEST_SECRET = "email-ingest-test";
  process.env.RESEND_INBOUND_ADDRESS = "test@example.resend.app";

  try {
    const jobs=[];
    const jobStore={
      enqueue:async input=>{const job={id:"job_1",organisation_id:input.organisationId,provider_email_id:input.emailId,payload:input.payload,status:"pending",attempts:1,max_attempts:5};jobs.push(job);return job;},
      claim:async()=>jobs.splice(0),
      complete:async job=>({...job,status:"completed"}),
      fail:async job=>({...job,status:"retry"})
    };
    return await callback({ secret,jobStore });
  } finally {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("verifyResendSignature accepts a valid Svix-style signature", () => {
  const secret = `whsec_${Buffer.from("resend-test-secret").toString("base64")}`;
  const rawBody = JSON.stringify({ type: "email.received", data: { email_id: "email_123" } });
  const timestamp = Math.floor(Date.now() / 1000);

  const result = verifyResendSignature({
    headers: signedHeaders({ secret, rawBody, timestamp }),
    rawBody,
    secret,
    now: timestamp * 1000
  });

  assert.deepEqual(result, { ok: true });
});

test("verifyResendSignature rejects a modified body", () => {
  const secret = `whsec_${Buffer.from("resend-test-secret").toString("base64")}`;
  const rawBody = JSON.stringify({ type: "email.received", data: { email_id: "email_123" } });
  const headers = signedHeaders({ secret, rawBody });

  const result = verifyResendSignature({
    headers,
    rawBody: rawBody + " ",
    secret
  });

  assert.equal(result.ok, false);
  assert.match(result.error, /Invalid Resend webhook signature/);
});

test("handleResendWebhook reports missing configuration before processing", async () => {
  const original = {
    RESEND_WEBHOOK_SECRET: process.env.RESEND_WEBHOOK_SECRET,
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    EMAIL_INGEST_SECRET: process.env.EMAIL_INGEST_SECRET
  };

  delete process.env.RESEND_WEBHOOK_SECRET;
  delete process.env.RESEND_API_KEY;
  delete process.env.EMAIL_INGEST_SECRET;

  try {
    const response = await handleResendWebhook({
      rawBody: JSON.stringify({ type: "email.received", data: { email_id: "email_123" } })
    });
    const body = await response.json();

    assert.equal(response.status, 500);
    assert.equal(body.stage, "config");
    assert.match(body.error, /RESEND_WEBHOOK_SECRET/);
    assert.match(body.error, /RESEND_API_KEY/);
    assert.match(body.error, /EMAIL_INGEST_SECRET/);
  } finally {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("handleResendWebhook acknowledges only after durably queuing a valid email", async () => {
  await withResendEnv(async ({ secret,jobStore }) => {
    const rawBody = JSON.stringify({
      type: "email.received",
      data: {
        email_id: "email_123",
        to: ["test@example.resend.app"],
        from: "sender@example.com",
        subject: "Customs documents"
      }
    });
    let deferred;
    let fetchCalls = 0;

    const response = await handleResendWebhook({
      headers: signedHeaders({ secret, rawBody }),
      rawBody,
      fetchImpl: async () => {
        fetchCalls += 1;
        throw new Error("Deferred work should not start before acknowledgement.");
      },
      defer: callback => {
        deferred = callback;
      },
      jobStore
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.accepted, true);
    assert.equal(body.emailId, "email_123");
    assert.equal(fetchCalls, 0);
    assert.equal(typeof deferred, "function");
  });
});

test("deferred Resend processing retrieves the email and attachment then invokes email ingest", async () => {
  await withResendEnv(async ({ secret,jobStore }) => {
    const rawBody = JSON.stringify({
      created_at: "2026-10-06T06:37:46.000Z",
      type: "email.received",
      data: {
        email_id: "email_123",
        message_id: "<message@example.com>",
        created_at: "2026-10-06T06:37:59.095Z",
        to: ["test@example.resend.app"],
        from: "sender@example.com",
        subject: "Customs documents",
        attachments: [{ filename: "invoice.pdf", content_type: "application/pdf" }]
      }
    });
    const requests = [];
    let ingestRequest;
    let deferred;

    const response = await handleResendWebhook({
      headers: signedHeaders({ secret, rawBody }),
      rawBody,
      fetchImpl: async url => {
        requests.push(String(url));
        if (String(url).endsWith("/emails/receiving/email_123")) {
          return Response.json({
            data: {
              from: "sender@example.com",
              subject: "Customs documents",
              text: "Please process the attached invoice."
            }
          });
        }
        if (String(url).endsWith("/emails/receiving/email_123/attachments")) {
          return Response.json({
            data: [{
              filename: "invoice.pdf",
              content_type: "application/pdf",
              content_base64: "JVBERg==",
              size: 123
            }]
          });
        }
        throw new Error("Unexpected fetch: " + url);
      },
      emailIngestHandler: async (req, res) => {
        ingestRequest = req;
        return res.status(200).json({ ok: true, packId: "PK-EMAIL-1", status: "Processing" });
      },
      defer: callback => {
        deferred = callback;
      },
      jobStore
    });

    assert.equal(response.status, 200);
    assert.equal(typeof deferred, "function");

    await deferred();

    assert.equal(requests.length, 2);
    assert.equal(ingestRequest.method, "POST");
    assert.equal(ingestRequest.headers["x-email-ingest-secret"], "email-ingest-test");
    assert.equal(ingestRequest.body.ticket, "RESEND:email_123");
    assert.equal(ingestRequest.body.messageId, "<message@example.com>");
    assert.equal(ingestRequest.body.text, "Please process the attached invoice.");
    assert.equal(ingestRequest.body.attachments.length, 1);
    assert.equal(ingestRequest.body.attachments[0].filename, "invoice.pdf");
    assert.equal(ingestRequest.body.attachments[0].contentBase64, "JVBERg==");
  });
});

test("invalid webhook signatures are rejected without scheduling deferred work", async () => {
  await withResendEnv(async () => {
    let deferred = false;
    const rawBody = JSON.stringify({ type: "email.received", data: { email_id: "email_123" } });

    const response = await handleResendWebhook({
      headers: {
        "svix-id": "msg_test",
        "svix-timestamp": String(Math.floor(Date.now() / 1000)),
        "svix-signature": "v1,not-valid"
      },
      rawBody,
      defer: () => {
        deferred = true;
      }
    });

    assert.equal(response.status, 401);
    assert.equal(deferred, false);
  });
});

test("non-email events return immediately without scheduling deferred work", async () => {
  await withResendEnv(async ({ secret }) => {
    let deferred = false;
    const rawBody = JSON.stringify({ type: "email.sent", data: { email_id: "email_123" } });

    const response = await handleResendWebhook({
      headers: signedHeaders({ secret, rawBody }),
      rawBody,
      defer: () => {
        deferred = true;
      }
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.ignored, true);
    assert.equal(deferred, false);
  });
});

test("webhook returns an error when the durable job cannot be stored",async()=>{
  await withResendEnv(async({secret})=>{
    const rawBody=JSON.stringify({type:"email.received",data:{email_id:"email_123",to:["test@example.resend.app"]}});
    let deferred=false;
    const response=await handleResendWebhook({
      headers:signedHeaders({secret,rawBody}),rawBody,
      jobStore:{enqueue:async()=>{throw new Error("Database unavailable");}},
      defer:()=>{deferred=true;}
    });
    assert.equal(response.status,503);
    assert.equal(deferred,false);
    assert.equal((await response.json()).stage,"queue");
  });
});

test("failed deferred work is persisted for retry",async()=>{
  await withResendEnv(async({secret})=>{
    const rawBody=JSON.stringify({type:"email.received",data:{email_id:"email_123",to:["test@example.resend.app"]}});
    let deferred,failed;
    const job={id:"job-1",organisation_id:"demo-organisation",provider_email_id:"email_123",payload:JSON.parse(rawBody),status:"pending",attempts:1,max_attempts:5};
    const jobStore={
      enqueue:async()=>job,
      claim:async()=>[job],
      complete:async()=>{throw new Error("must not complete");},
      fail:async(_job,error,options)=>{failed={error,options};return {...job,status:"retry"};}
    };
    const response=await handleResendWebhook({headers:signedHeaders({secret,rawBody}),rawBody,jobStore,fetchImpl:async()=>{throw new Error("Resend unavailable");},defer:callback=>{deferred=callback;}});
    assert.equal(response.status,200);
    await deferred();
    assert.match(failed.error.message,/Resend unavailable/);
    assert.equal(failed.options.stage,"retrieve-email");
  });
});

test("permanent email-ingest errors preserve the pack id and stop retrying",async()=>{
  await withResendEnv(async()=>{
    const response=await processResendEmail({
      event:{data:{email_id:"email_123",to:["test@example.resend.app"],attachments:[]}},
      emailId:"email_123",
      fetchImpl:async url=>String(url).endsWith("/attachments")?Response.json({data:[]}):Response.json({data:{subject:"Unsupported input"}}),
      emailIngestHandler:async(_req,res)=>res.status(422).json({error:"Unsupported attachment.",packId:"PK-EMAIL-1"})
    });
    const body=await response.json();
    assert.equal(response.status,422);
    assert.equal(body.packId,"PK-EMAIL-1");
    assert.equal(body.retryable,false);
  });
});

test("temporary attachment-listing failures remain retryable when webhook metadata has no content",async()=>{
  await withResendEnv(async()=>{
    const response=await processResendEmail({
      event:{data:{email_id:"email_123",to:["test@example.resend.app"],attachments:[{filename:"invoice.pdf",content_type:"application/pdf"}]}},
      emailId:"email_123",
      fetchImpl:async url=>{
        if(String(url).endsWith("/attachments"))return new Response("temporarily unavailable",{status:503});
        return Response.json({data:{subject:"Documents"}});
      }
    });
    const body=await response.json();
    assert.equal(response.status,502);
    assert.equal(body.stage,"retrieve-attachments");
    assert.equal(body.retryable,true);
  });
});

test("an expired worker cannot count completion after losing attempt ownership",async()=>{
  await withResendEnv(async()=>{
    const job={id:"job-1",attempt_token:"attempt-old",organisation_id:"demo-organisation",provider_email_id:"email_123",payload:{data:{email_id:"email_123",to:["test@example.resend.app"],attachments:[]}},attempts:1,max_attempts:5};
    const summary=await processQueuedResendJobs({
      jobStore:{claim:async()=>[job],complete:async()=>null,fail:async()=>{throw new Error("must not fail");}},
      fetchImpl:async url=>String(url).endsWith("/attachments")?Response.json({data:[]}):Response.json({data:{subject:"Documents"}}),
      emailIngestHandler:async(_req,res)=>res.status(200).json({ok:true,packId:"PK-EMAIL-1",status:"Ready"})
    });
    assert.deepEqual(summary,{claimed:1,completed:0,retrying:0,failed:0,superseded:1});
  });
});

test("queued retries process packs directly when every source is persisted",async()=>{
  await withResendEnv(async()=>{
    const job={id:"job-1",pack_id:"PK-EMAIL-1",organisation_id:"org-1",provider_email_id:"email_123",payload:{},attempts:2};
    let processed=false,completed;
    const summary=await processQueuedResendJobs({
      jobStore:{claim:async()=>[job],complete:async(_job,result)=>{completed=result;return {...job,status:"completed"};},fail:async()=>{throw new Error("must not fail");}},
      packLoader:async()=>({id:"PK-EMAIL-1",uploadedFiles:[{id:"file-1",storagePath:"organisations/org-1/packs/uuid/file.pdf"}]}),
      packProcessor:async()=>{processed=true;return {status:"Needs review"};},
      fetchImpl:async()=>{throw new Error("Resend must not be called");}
    });
    assert.equal(processed,true);
    assert.equal(completed.packId,"PK-EMAIL-1");
    assert.equal(summary.completed,1);
  });
});

test("queued retries rerun repair ingestion when an existing source is missing",async()=>{
  await withResendEnv(async()=>{
    const job={id:"job-1",pack_id:"PK-EMAIL-1",organisation_id:"org-1",provider_email_id:"email_123",payload:{data:{attachments:[{filename:"invoice.pdf",content_type:"application/pdf"}]}},attempts:2};
    let ingestRequest,processed=false;
    const summary=await processQueuedResendJobs({
      jobStore:{claim:async()=>[job],complete:async current=>({...current,status:"completed"}),fail:async()=>{throw new Error("must not fail");}},
      packLoader:async()=>({id:"PK-EMAIL-1",uploadedFiles:[{id:"file-1",storagePath:null}]}),
      packProcessor:async()=>{processed=true;return {status:"Needs review"};},
      fetchImpl:async url=>String(url).endsWith("/attachments")
        ? Response.json({data:[{filename:"invoice.pdf",content_type:"application/pdf",content_base64:"JVBERg==",size:123}]})
        : Response.json({data:{subject:"Documents"}}),
      emailIngestHandler:async(req,res)=>{ingestRequest=req;return res.status(200).json({ok:true,packId:"PK-EMAIL-1",status:"Needs review"});}
    });
    assert.equal(processed,false);
    assert.equal(ingestRequest.body.repair,true);
    assert.equal(ingestRequest.body.attachments[0].contentBase64,"JVBERg==");
    assert.equal(summary.completed,1);
  });
});
