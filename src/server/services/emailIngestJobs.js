import { supabaseFetch } from "./packRepository.js";

export async function enqueueEmailJob({organisationId,provider,eventId,emailId,payload}){
  const rows=await supabaseFetch("email_ingest_jobs?on_conflict=provider,provider_event_id",{
    method:"POST",
    headers:{Prefer:"resolution=ignore-duplicates,return=representation"},
    body:JSON.stringify({organisation_id:organisationId,provider,provider_event_id:eventId,provider_email_id:emailId,payload,status:"pending",stage:"queued"})
  });
  if(rows?.[0])return rows[0];
  const existing=await supabaseFetch(`email_ingest_jobs?provider=eq.${encodeURIComponent(provider)}&provider_event_id=eq.${encodeURIComponent(eventId)}&select=*&limit=1`);
  if(!existing?.[0])throw new Error("Email job could not be persisted.");
  return existing[0];
}

export async function claimEmailJobs(limit=5){
  return supabaseFetch("rpc/claim_email_ingest_jobs",{method:"POST",body:JSON.stringify({p_limit:limit})});
}

export async function completeEmailJob(job,{packId=null}={}){
  return updateClaimed(job,{status:"completed",stage:"completed",pack_id:packId||job.pack_id||null,attempt_token:null,locked_until:null,last_error:null,completed_at:new Date().toISOString()});
}

export async function failEmailJob(job,error,{stage="processing",packId=null,retryable=true}={}){
  const terminal=!retryable||Number(job.attempts)>=Number(job.max_attempts||5);
  const delayMinutes=Math.min(60,2**Math.max(0,Number(job.attempts)||1));
  return updateClaimed(job,{
    status:terminal?"failed":"retry",
    stage,
    pack_id:packId||job.pack_id||null,
    attempt_token:null,
    locked_until:null,
    available_at:new Date(Date.now()+delayMinutes*60*1000).toISOString(),
    last_error:error?.message||String(error||"Email processing failed."),
    completed_at:terminal?new Date().toISOString():null
  });
}

export async function listEmailJobs(organisationId){
  return supabaseFetch(`email_ingest_jobs?organisation_id=eq.${encodeURIComponent(organisationId)}&select=id,provider,provider_email_id,status,stage,attempts,max_attempts,last_error,pack_id,created_at,updated_at,completed_at&order=created_at.desc&limit=100`);
}

export async function retryEmailJob(organisationId,id){
  const rows=await supabaseFetch(`email_ingest_jobs?id=eq.${encodeURIComponent(id)}&organisation_id=eq.${encodeURIComponent(organisationId)}&status=in.(failed,retry)&select=id`,{
    method:"PATCH",
    headers:{Prefer:"return=representation"},
    body:JSON.stringify({status:"retry",stage:"queued",attempts:0,attempt_token:null,available_at:new Date().toISOString(),locked_until:null,last_error:null,completed_at:null,updated_at:new Date().toISOString()})
  });
  return rows?.[0]||null;
}

async function updateClaimed(job,values){
  const token=String(job?.attempt_token||"").trim();
  if(!token)throw new Error("Claimed email job has no attempt token.");
  const rows=await supabaseFetch(`email_ingest_jobs?id=eq.${encodeURIComponent(job.id)}&status=eq.processing&attempt_token=eq.${encodeURIComponent(token)}`,{method:"PATCH",headers:{Prefer:"return=representation"},body:JSON.stringify({...values,updated_at:new Date().toISOString()})});
  return rows?.[0]||null;
}
