import crypto from "crypto";
import emailIngest from "./email-ingest.js";
import { runLegacyHandler } from "../nextLegacyAdapter.js";
import { DEFAULT_ORGANISATION } from "../../tenant.js";
import { processPack } from "../services/processPack.js";
import { loadPack } from "../services/packRepository.js";
import { claimEmailJobs, completeEmailJob, enqueueEmailJob, failEmailJob } from "../services/emailIngestJobs.js";

const RESEND_API = "https://api.resend.com";
const MAX_TIMESTAMP_AGE_MS = 5 * 60 * 1000;
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
const MAX_ATTACHMENTS = 20;

/** Handle Resend's email.received webhook and adapt it to email-ingest. */
export async function handleResendWebhook({
  method = "POST",
  headers = {},
  rawBody = "",
  fetchImpl = fetch,
  defer = null,
  emailIngestHandler = emailIngest,
  jobStore = productionJobStore
} = {}) {
  if (method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405 });

  const missing = requiredConfiguration();
  if (missing.length) {
    return Response.json(
      { error: `Missing Resend inbound configuration: ${missing.join(", ")}`, stage: "config" },
      { status: 500 }
    );
  }

  const verification = verifyResendSignature({
    headers,
    rawBody,
    secret: process.env.RESEND_WEBHOOK_SECRET
  });
  if (!verification.ok) {
    return Response.json(
      { error: verification.error, stage: "verify" },
      { status: svixStatus(verification.error) }
    );
  }

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return Response.json({ error: "Invalid JSON webhook payload.", stage: "parse" }, { status: 400 });
  }

  if (event?.type !== "email.received") {
    return Response.json({ ok: true, ignored: true, type: event?.type || null });
  }

  const emailId = String(event?.data?.email_id || "").trim();
  if (!emailId) {
    return Response.json(
      { error: "email.received is missing data.email_id.", stage: "parse" },
      { status: 400 }
    );
  }

  let job;
  try {
    const organisationId = resolveInboundOrganisation(event);
    const eventId = String(headerValue(headers, "svix-id") || emailId);
    job = await jobStore.enqueue({ organisationId, provider: "resend", eventId, emailId, payload: event });
  } catch (error) {
    return Response.json({ error: error?.message || "Unable to persist inbound email job.", stage: "queue" }, { status: 503 });
  }

  if (job.status === "completed") {
    return Response.json({ ok: true, accepted: true, duplicate: true, emailId, jobId: job.id });
  }

  const processReceivedEmail = () => processQueuedResendJobs({ limit: 5, fetchImpl, emailIngestHandler, jobStore });

  if (typeof defer === "function") {
    defer(async () => {
      try {
        await processReceivedEmail();
      } catch (error) {
        console.error("Deferred Resend inbound processing crashed", {
          emailId,
          error: error?.message || String(error)
        });
      }
    });

    return Response.json(
      { ok: true, accepted: true, emailId, jobId: job.id },
      { status: 200 }
    );
  }

  await processReceivedEmail();
  return Response.json({ ok: true, accepted: true, emailId, jobId: job.id });
}

export async function processResendEmail({ event, emailId, organisationId = DEFAULT_ORGANISATION.id, repair = false, fetchImpl = fetch, emailIngestHandler = emailIngest }) {
  let email;
  try {
    email = await getReceivedEmail(emailId, fetchImpl);
  } catch (error) {
    return integrationError("retrieve-email", error);
  }

  let attachments;
  try {
    attachments = await getReceivedAttachments(emailId, event?.data?.attachments || [], fetchImpl);
  } catch (error) {
    return integrationError("retrieve-attachments", error);
  }

  const body = {...toEmailIngestPayload(event, email, attachments),repair};

  try {
    const response = await runLegacyHandler(emailIngestHandler, {
      method: "POST",
      headers: { "x-email-ingest-secret": process.env.EMAIL_INGEST_SECRET },
      body,
      trustedOrganisationId:organisationId
    });

    if (!response.ok) {
      const upstreamBody = await response.clone().text().catch(() => "");
      let upstream={};
      try{upstream=JSON.parse(upstreamBody||"{}");}catch{}
      console.error("Resend email-ingest rejected inbound message", {
        emailId,
        status: response.status,
        body: upstreamBody
      });
      return Response.json(
        {
          error: upstream.error || "Email ingestion rejected the Resend message.",
          stage: "email-ingest",
          upstreamStatus: response.status,
          upstreamBody: upstreamBody.slice(0, 1000),
          packId: upstream.packId || null,
          retryable: isRetryableHttpStatus(response.status)
        },
        { status: response.status }
      );
    }

    return response;
  } catch (error) {
    return integrationError("email-ingest", error);
  }
}

export async function processQueuedResendJobs({ limit = 5, fetchImpl = fetch, emailIngestHandler = emailIngest, jobStore = productionJobStore, packLoader = loadPack, packProcessor = processPack } = {}) {
  const jobs = await jobStore.claim(limit);
  const summary = { claimed: jobs.length, completed: 0, retrying: 0, failed: 0, superseded: 0 };

  for (const job of jobs) {
    try {
      let packId = job.pack_id || null;
      if (packId) {
        const existingPack=await packLoader(job.organisation_id,packId);
        const sources=Array.isArray(existingPack?.uploadedFiles)?existingPack.uploadedFiles:[];
        const sourcesPersisted=Boolean(existingPack)&&sources.every(file=>Boolean(String(file?.storagePath||"").trim()));
        if(sourcesPersisted){
          const pack = await packProcessor({
            organisationId: job.organisation_id,
            packId,
            reason: "reprocess",
            actor: { type: "system", name: "Email Retry Worker" }
          });
          if (pack.status === "Processing") {
            throw processingError(pack.processingError || "Email audit is still incomplete.", packId, "audit");
          }
        }else{
          const response=await processResendEmail({
            event:job.payload||{},emailId:job.provider_email_id,organisationId:job.organisation_id,
            repair:true,fetchImpl,emailIngestHandler
          });
          const body=await response.clone().json().catch(()=>({}));
          if(!response.ok)throw processingError(body.error||`Email ingestion returned HTTP ${response.status}`,body.packId||packId,body.stage||"email-ingest",body.retryable!==false);
          packId=body.packId||packId;
          if(body.status==="Processing")throw processingError("Email processing remains incomplete.",packId,"processing");
        }
      } else {
        const response = await processResendEmail({
          event: job.payload || {},
          emailId: job.provider_email_id,
          organisationId:job.organisation_id,
          repair:Number(job.attempts)>1,
          fetchImpl,
          emailIngestHandler
        });
        const body = await response.clone().json().catch(() => ({}));
        if (!response.ok) {
          throw processingError(body.error || `Email ingestion returned HTTP ${response.status}`, body.packId || null, body.stage || "email-ingest", body.retryable !== false);
        }
        packId = body.packId || null;
        if (body.status === "Processing") {
          throw processingError("Email processing remains incomplete.", packId, "processing");
        }
      }

      const completed=await jobStore.complete(job, { packId });
      if(completed)summary.completed += 1;
      else summary.superseded += 1;
    } catch (error) {
      const failed = await jobStore.fail(job, error, {
        stage: error.stage || "processing",
        packId: error.packId || job.pack_id || null,
        retryable: error.retryable !== false
      });
      if(!failed)summary.superseded += 1;
      else if (failed.status === "failed") summary.failed += 1;
      else summary.retrying += 1;
    }
  }

  return summary;
}

export function verifyResendSignature({ headers = {}, rawBody = "", secret, now = Date.now() } = {}) {
  const get = name => {
    if (typeof headers?.get === "function") return headers.get(name) || "";
    return headers[name] || headers[name.toLowerCase()] || "";
  };

  const id = String(get("svix-id")).trim();
  const timestamp = String(get("svix-timestamp")).trim();
  const signature = String(get("svix-signature")).trim();

  if (!id || !timestamp || !signature) {
    return { ok: false, error: "Missing Resend webhook signature headers." };
  }

  const seconds = Number(timestamp);
  if (!Number.isFinite(seconds) || Math.abs(now - seconds * 1000) > MAX_TIMESTAMP_AGE_MS) {
    return { ok: false, error: "Expired Resend webhook signature." };
  }

  const encodedSecret = String(secret || "").replace(/^whsec_/, "");
  if (!encodedSecret) return { ok: false, error: "Invalid Resend webhook secret." };

  const key = Buffer.from(encodedSecret, "base64");
  if (!key.length) return { ok: false, error: "Invalid Resend webhook secret." };

  const expected = crypto
    .createHmac("sha256", key)
    .update(`${id}.${timestamp}.${rawBody}`)
    .digest("base64");

  const valid = signature.split(" ").some(value => {
    const [version, supplied] = value.split(",", 2);
    if (version !== "v1" || !supplied) return false;
    const expectedBuffer = Buffer.from(expected);
    const suppliedBuffer = Buffer.from(supplied);
    return expectedBuffer.length === suppliedBuffer.length
      && crypto.timingSafeEqual(expectedBuffer, suppliedBuffer);
  });

  return valid ? { ok: true } : { ok: false, error: "Invalid Resend webhook signature." };
}

async function getReceivedEmail(emailId, fetchImpl) {
  const result = await resendGet(`/emails/receiving/${encodeURIComponent(emailId)}`, fetchImpl);
  return result?.data || result;
}

async function getReceivedAttachments(emailId, eventAttachments, fetchImpl) {
  let listingError=null;
  const listed = await resendGet(
    `/emails/receiving/${encodeURIComponent(emailId)}/attachments`,
    fetchImpl
  ).catch(error => {
    listingError=error;
    console.warn("Resend attachment listing failed; falling back to webhook metadata", {
      emailId,
      error: error?.message || String(error)
    });
    return { data: eventAttachments };
  });

  const items = Array.isArray(listed?.data)
    ? listed.data
    : (Array.isArray(listed) ? listed : eventAttachments);

  if(items.length>MAX_ATTACHMENTS)throw permanentError(`Inbound email exceeds the ${MAX_ATTACHMENTS}-attachment limit.`);

  return Promise.all(items.map(async item => {
    const downloadUrl = item.download_url || item.downloadUrl;
    let contentBase64 = item.content_base64 || item.contentBase64 || item.base64 || null;
    if(Number(item.size)>MAX_ATTACHMENT_BYTES)throw permanentError(`Attachment "${item.filename||"attachment"}" exceeds 25 MB.`);

    if (!contentBase64 && downloadUrl) {
      const response = await fetchImpl(downloadUrl);
      if (!response.ok) {
        const error=new Error(`Unable to download Resend attachment (${response.status}).`);
        error.retryable=isRetryableHttpStatus(response.status);
        throw error;
      }
      const declared=Number(response.headers.get("content-length"))||0;
      if(declared>MAX_ATTACHMENT_BYTES)throw permanentError(`Attachment "${item.filename||"attachment"}" exceeds 25 MB.`);
      const buffer=Buffer.from(await response.arrayBuffer());
      if(buffer.length>MAX_ATTACHMENT_BYTES)throw permanentError(`Attachment "${item.filename||"attachment"}" exceeds 25 MB.`);
      contentBase64 = buffer.toString("base64");
    }

    if(contentBase64&&Buffer.byteLength(contentBase64,"base64")>MAX_ATTACHMENT_BYTES)throw permanentError(`Attachment "${item.filename||"attachment"}" exceeds 25 MB.`);

    if (!contentBase64) {
      const error=new Error(`Resend attachment "${item.filename || item.name || "attachment"}" has no downloadable content.`);
      error.retryable=listingError?listingError.retryable!==false:false;
      throw error;
    }

    return {
      filename: item.filename || item.name || "attachment",
      mimeType: item.content_type || item.contentType || "application/octet-stream",
      contentBase64,
      size: Number(item.size) || 0
    };
  }));
}

async function resendGet(path, fetchImpl) {
  const response = await fetchImpl(RESEND_API + path, {
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` }
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    const error=new Error(
      `Resend API request failed (${response.status})${detail ? `: ${detail.slice(0, 500)}` : ""}`
    );
    error.retryable=isRetryableHttpStatus(response.status);
    throw error;
  }

  return response.json();
}

function toEmailIngestPayload(event, email, attachments) {
  const data = event.data || {};
  return {
    to: first(data.to) || process.env.RESEND_INBOUND_ADDRESS || "",
    from: data.from || email?.from || "",
    subject: data.subject || email?.subject || "",
    text: email?.text || email?.text_body || data.text || "",
    html: email?.html || email?.html_body || data.html || "",
    messageId: data.message_id || email?.message_id || data.email_id,
    ticket: `RESEND:${data.email_id}`,
    receivedAt: data.created_at || event.created_at || new Date().toISOString(),
    attachments
  };
}

function requiredConfiguration() {
  return [
    "RESEND_WEBHOOK_SECRET",
    "RESEND_API_KEY",
    "EMAIL_INGEST_SECRET"
  ].filter(name => !String(process.env[name] || "").trim());
}

function integrationError(stage, error) {
  console.error(`Resend inbound email failed at ${stage}`, error);
  return Response.json(
    {
      error: error?.message || "Resend inbound email processing failed.",
      stage,
      retryable: error?.retryable !== false
    },
    { status: 502 }
  );
}

function first(value) {
  return Array.isArray(value) ? value[0] : value;
}

function svixStatus(error) {
  return /expired/i.test(error) ? 400 : 401;
}

function headerValue(headers, name) {
  return typeof headers?.get === "function"
    ? headers.get(name)
    : (headers?.[name] || headers?.[name.toLowerCase()] || "");
}

function resolveInboundOrganisation(event) {
  const recipients = (Array.isArray(event?.data?.to) ? event.data.to : [event?.data?.to])
    .filter(Boolean)
    .map(value => String(value).trim().toLowerCase());
  let routing = {};
  try { routing = JSON.parse(process.env.RESEND_INBOUND_ROUTING_JSON || "{}"); }
  catch { throw new Error("RESEND_INBOUND_ROUTING_JSON is invalid."); }

  for (const recipient of recipients) {
    const organisationId = String(routing?.[recipient]?.organisationId || routing?.[recipient] || "").trim();
    if (organisationId) return organisationId;
  }

  const configured = String(process.env.RESEND_INBOUND_ADDRESS || "").trim().toLowerCase();
  if (configured && recipients.includes(configured)) return DEFAULT_ORGANISATION.id;
  throw new Error("Inbound recipient is not mapped to an organisation.");
}

function processingError(message, packId, stage, retryable=true) {
  const error = new Error(message);
  error.packId = packId;
  error.stage = stage;
  error.retryable = retryable;
  return error;
}

function permanentError(message){
  const error=new Error(message);
  error.retryable=false;
  return error;
}

function isRetryableHttpStatus(status){
  const code=Number(status)||0;
  return code<400||code>=500||[408,409,425,429].includes(code);
}

const productionJobStore = {
  enqueue: enqueueEmailJob,
  claim: claimEmailJobs,
  complete: completeEmailJob,
  fail: failEmailJob
};
