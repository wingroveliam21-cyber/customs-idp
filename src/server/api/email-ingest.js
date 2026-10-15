import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";
import { DEFAULT_ORGANISATION } from "../../tenant.js";
import { resolveCustomerMatch, normaliseCustomerName } from "../../domain/customerMatching.js";
import { processPack } from "../services/processPack.js";

const DEFAULT_STRATEGIES = {
  "Acme Components Ltd": { emailFields: [] },
  "Northstar Manufacturing": { emailFields: [] },
  "Bancale Trading": { emailFields: [] },
  "Raven Industrial": { emailFields: [] }
};

export function mergeInboundAttachments(packId,attachments,existingFiles=[]){
  return attachments.map((attachment,index)=>{
    const fileId=packId+"-"+index;
    const persisted=existingFiles.find(file=>String(file?.id)===fileId);
    return {
      id:fileId,
      name:String(attachment.filename||attachment.name||("attachment-"+(index+1))),
      size:Number(attachment.size)||0,
      type:String(attachment.mimeType||attachment.contentType||"application/octet-stream"),
      storagePath:persisted?.storagePath||null,
      ...(persisted?.storagePath?{}:(persisted?.storageError?{storageError:persisted.storageError}:{}))
    };
  });
}

export default async function handler(req,res){
  if(req.method!=="POST") return res.status(405).json({error:"Method not allowed"});

  const secret=process.env.EMAIL_INGEST_SECRET;
  if(!secret) return res.status(500).json({error:"EMAIL_INGEST_SECRET is not configured in Vercel."});
  const supplied=String(req.headers["x-email-ingest-secret"]||"");
  if(!supplied || !safeEqual(supplied,secret)) return res.status(401).json({error:"Invalid email ingestion secret."});

  let activePackId=null;
  try{
    const body=req.body||{};
    const organisationId=String(req.trustedOrganisationId||DEFAULT_ORGANISATION.id);
    const organisationName=organisationId===DEFAULT_ORGANISATION.id?DEFAULT_ORGANISATION.name:organisationId;
    const to=String(body.to||"").trim().toLowerCase();
    const from=String(body.from||"").trim();
    const subject=String(body.subject||"").trim();
    const text=String(body.text||body.body||"");
    const html=String(body.html||"");
    const messageId=String(body.messageId||body.message_id||"").trim()||null;
    const ingestTicket=String(body.ticket||"").trim()||null;
    const receivedAt=body.receivedAt||body.received_at||new Date().toISOString();
    const attachments=Array.isArray(body.attachments)?body.attachments:[];
    const repair=Boolean(body.repair);

    if(!to) return res.status(400).json({error:"to is required."});

    const routing=readJson(process.env.CUSTOMER_EMAIL_ROUTING_JSON,{});
    const routedCustomerName=String(routing[to]?.customer||"").trim();
    const requestedCustomerName=String(body.customer||"").trim();

    let customerContext=await resolveCustomerContext({
      organisationId,
      to,
      routedCustomerName,
      requestedCustomerName
    });

    let customer=customerContext.customerName;
    let customerId=customerContext.customerId;

    const legacyStrategies=readJson(process.env.CUSTOMER_EMAIL_STRATEGIES_JSON,{});
    const configured=customerId
      ? (customerContext.strategy||legacyStrategies[customer]||DEFAULT_STRATEGIES[customer]||{emailFields:[]})
      : {instructions:"",requiredFields:[],weightHandling:"ask_user",emailFields:[]};

    const emailFields=Array.isArray(configured.emailFields)
      ? configured.emailFields.filter(Boolean)
      : [];

    const ticket=ingestTicket||messageId||("EMAIL-"+Date.now().toString().slice(-6));
    let id="PK-EMAIL-"+crypto.randomUUID().toUpperCase();
    let packUuid=crypto.randomUUID();
    const existingByTicket=await supabaseFetch("document_packs?organisation_id=eq."+encodeURIComponent(organisationId)+"&ticket=eq."+encodeURIComponent(ticket)+"&select=id,pack_uuid,customer,status,docs,extracted_data&limit=1");
    const existingByMessage=messageId
      ? await supabaseFetch("document_packs?organisation_id=eq."+encodeURIComponent(organisationId)+"&extracted_data->email->>messageId=eq."+encodeURIComponent(messageId)+"&select=id,pack_uuid,customer,status,docs,extracted_data&limit=1").catch(()=>[])
      : [];
    const existing=existingByTicket[0]||existingByMessage[0];
    if(existing){
      if(!repair){
        // Backfill the atomic claim for older packs so webhook and polling
        // cannot create another pack for this message.
        if(messageId||ticket) await claimEmailIngest(organisationId+":"+(messageId ? "MESSAGE:"+messageId : "TICKET:"+ticket), String(existing.id));
        return res.status(200).json({ok:true,duplicate:true,packId:existing.id,customer:existing.customer,status:existing.status,message:"Email already ingested."});
      }
      id=existing.id;
      activePackId=id;
    }else if(!repair){
      // The webhook and fallback poller can reach this route concurrently.
      // Claim the email before any OpenAI/document processing starts.
      const emailKey=organisationId+":"+(messageId ? "MESSAGE:"+messageId : "TICKET:"+ticket);
      const claim=await claimEmailIngest(emailKey,id);
      if(!claim.claimed){
        return res.status(200).json({ok:true,duplicate:true,packId:claim.packId,customer,status:"Processing",message:"Email already claimed by another intake worker."});
      }
    }
    if(existing?.pack_uuid) packUuid=existing.pack_uuid;
    let emailExtraction={fields:[],warnings:[]};
    if(emailFields.length){
      try{
        emailExtraction=await extractConfiguredEmailFields({subject,text,html,emailFields});
      }catch(error){
        emailExtraction={fields:[],warnings:["Configured email-field extraction failed: "+formatExtractionError(error)]};
      }
    }

    const existingFiles=Array.isArray(existing?.extracted_data?._manager?.uploadedFiles)?existing.extracted_data._manager.uploadedFiles:[];
    const pack={
      organisationId,
      organisationName,
      id,
      packUuid,
      customer,
      customerId,
      docs:attachments.length,
      status:"Processing",
      confidence:0,
      received:receivedAt,
      ticket,
      assignedTo:"Unassigned",
      uploadedFiles:mergeInboundAttachments(id,attachments,existingFiles),
      email:{
        messageId,
        from,
        to,
        subject,
        text,
        html,
        receivedAt,
        extraction:emailExtraction,
        configuredFields:emailFields
      }
    };

    // Persist the pack immediately so the inbox can observe the webhook intake
    // while attachment storage/extraction is still running.
    await supabaseFetch("document_packs",{
      method:"POST",
      body:JSON.stringify({
        id:pack.id,
        pack_uuid:pack.packUuid,
        organisation_id:organisationId,
        customer:pack.customer,
        customer_id:pack.customerId||null,
        docs:pack.docs,
        status:"Processing",
        confidence:0,
        received:pack.received,
        ticket:pack.ticket,
        assigned_to:pack.assignedTo,
        extracted_data:{
          _tenant:{organisationId,organisationName},
          documentType:"email",
          email:pack.email,
          documents:[],
          documentCount:0,
          sourceDocuments:[],
          emailFields:emailExtraction.fields,
          warnings:emailExtraction.warnings||[],
          agentMessages:[],
          _manager:{processingStartedAt:new Date().toISOString(),processingCompletedAt:null,uploadedFiles:pack.uploadedFiles}
        },
        processing_error:emailExtraction.warnings?.length?emailExtraction.warnings.join(" | "):null,
        updated_at:new Date().toISOString()
      }),
      headers:{"Prefer":"resolution=merge-duplicates,return=minimal"}
    });
    activePackId=pack.id;

    const storedFiles=[];
    for(let index=0;index<attachments.length;index++){
      const attachment=attachments[index];
      const persisted=pack.uploadedFiles[index];
      const filename=String(attachment.filename||attachment.name||"attachment");
      const mimeType=String(attachment.mimeType||attachment.contentType||"application/octet-stream");
      if(persisted?.storagePath){
        storedFiles.push({...persisted,name:filename,size:Number(attachment.size)||persisted.size||0,type:mimeType});
        continue;
      }
      const fileData=normaliseAttachmentData(attachment);
      let storagePath=null,storageError=null;
      if(!fileData)storageError="Attachment content was not supplied by the email connector.";
      else try{storagePath=await storeAttachment({organisationId,packUuid,filename,mimeType,fileData});}catch(error){storageError=formatExtractionError(error);}
      storedFiles.push({id:id+"-"+index,name:filename,size:Number(attachment.size)||0,type:mimeType,storagePath,...(storageError?{storageError}:{})});
    }
    const storageWarnings=storedFiles.filter(file=>file.storageError).map(file=>file.name+": "+file.storageError);
    await supabaseFetch("document_packs?id=eq."+encodeURIComponent(pack.id),{method:"PATCH",body:JSON.stringify({
      extracted_data:{
        _tenant:{organisationId,organisationName},
        documentType:"email",email:pack.email,documents:[],documentCount:0,sourceDocuments:[],emailFields:emailExtraction.fields,
        warnings:[...(emailExtraction.warnings||[]),...storageWarnings],agentMessages:[],
        _manager:{processingStartedAt:new Date().toISOString(),processingCompletedAt:null,uploadedFiles:storedFiles}
      },
      processing_error:storageWarnings.length?storageWarnings.join(" | "):null,
      updated_at:new Date().toISOString()
    }),headers:{Prefer:"return=minimal"}});

    const completed=await processPack({organisationId,packId:id,reason:repair?"reprocess":"initial",actor:{type:"system",name:"Email Ingestion"}});
    const extractedAttachmentCount=completed.extractedData?.documents?.filter(document=>document.extraction).length||0;

    return res.status(200).json({
      ok:true,
      packId:id,
      packUuid,
      customer:completed.customer,
      status:completed.status,
      attachmentCount:storedFiles.length,
      extractedAttachmentCount,
      emailExtraction,
      message:completed.status==="Processing"?"Email accepted but remains locked in Processing until automated review completes.":"Email processing and automated review completed."
    });
  }catch(error){
    return res.status(500).json({error:error.message||"Email ingestion failed.",packId:activePackId});
  }
}

async function resolveCustomerContext({organisationId,to,routedCustomerName,requestedCustomerName,exporterName="",importerName=""}){
  const candidateNames=[routedCustomerName,requestedCustomerName].filter(Boolean);

  let customers=[];
  try{
    customers=await supabaseFetch(
      "customers?organisation_id=eq."+encodeURIComponent(organisationId)+"&select=id,name,status,team_id&order=name.asc"
    );
  }catch{
    customers=[];
  }

  const normalise=normaliseCustomerName;

  let customer=null;

  // Prefer an explicit routed/customer name when it matches an existing
  // persistent customer. Do not create a customer when there is no match.
  for(const candidate of candidateNames){
    const match=customers.find(item=>
      normalise(item.name)===normalise(candidate) &&
      String(item.status||"active").toLowerCase()==="active"
    );
    if(match){
      customer=match;
      break;
    }
  }

  // If the incoming mailbox already belongs to a persistent customer,
  // use that relationship as a secondary matching mechanism.
  if(!customer&&to){
    try{
      const mailboxes=await supabaseFetch(
        "mailboxes?organisation_id=eq."+encodeURIComponent(organisationId)+
        "&address=eq."+encodeURIComponent(to)+
        "&select=customer_id,status&limit=1"
      );
      const mailbox=mailboxes?.[0];
      if(mailbox?.customer_id){
        customer=customers.find(item=>
          String(item.id)===String(mailbox.customer_id) &&
          String(item.status||"active").toLowerCase()==="active"
        )||null;
        if(customer)customer.__matchedBy="mailbox";
      }
    }catch{}
  }

  // If no mailbox/routing relationship identified the customer, use a confirmed memory/exact match first, then a cautious fuzzy match.
  if(!customer){
    try{
      const memories=await supabaseFetch("customer_memory?organisation_id=eq."+encodeURIComponent(organisationId)+"&memory_type=eq.customer_alias&select=customer_id,source_value");
      const memoryByCustomerId={};
      for(const memory of memories){if(!memoryByCustomerId[memory.customer_id])memoryByCustomerId[memory.customer_id]=[];memoryByCustomerId[memory.customer_id].push(memory.source_value);}
      customers=customers.map(item=>({...item,memoryAliases:memoryByCustomerId[item.id]||[]}));
    }catch{}
    const result=resolveCustomerMatch(customers,exporterName,importerName);
    if(result.type==="possible")return {customerId:null,customerName:null,strategy:null,matched:false,ambiguous:false,possibleMatch:true,candidates:result.candidates,matchedBy:result.sourceType,sourceValue:result.sourceValue};
    if(result.type==="match"){customer=customers.find(item=>String(item.id)===String(result.customer.id))||result.customer;customer.__matchedBy=result.matchedBy;}
  }

  if(!customer){
    return {
      customerId:null,
      customerName:null,
      strategy:null,
      matched:false,
      ambiguous:false,
      possibleMatch:false,
      candidates:[]
    };
  }

  let strategy=null;
  try{
    const strategies=await supabaseFetch(
      "customer_strategies?organisation_id=eq."+encodeURIComponent(organisationId)+
      "&customer_id=eq."+encodeURIComponent(customer.id)+
      "&status=eq.active&select=id,customer_id,version,status,config,updated_at&order=version.desc&limit=1"
    );
    strategy=strategies?.[0]||null;
  }catch{}

  return {
    customerId:customer.id,
    customerName:customer.name,
    strategy:strategy?.config||null,
    matched:true,
    ambiguous:false,
    candidates:[],
    matchedBy:customer.__matchedBy||null
  };
}

async function storeAttachment({organisationId,packUuid,filename,mimeType,fileData}){
  const url=process.env.SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!url||!key)throw new Error("Supabase storage configuration is missing.");
  const supabase=createClient(url,key,{auth:{autoRefreshToken:false,persistSession:false}});
  const raw=String(fileData||"");
  const base64=raw.includes(",")?raw.slice(raw.indexOf(",")+1):raw;
  const buffer=Buffer.from(base64,"base64");
  const safeOrganisation=String(organisationId).replace(/[^a-zA-Z0-9._-]+/g,"-");
  const safePack=String(packUuid).replace(/[^a-zA-Z0-9._-]+/g,"-");
  const safeName=String(filename).replace(/[^a-zA-Z0-9._-]+/g,"-").replace(/^-+|-+$/g,"")||"document";
  const path="organisations/"+safeOrganisation+"/packs/"+safePack+"/"+crypto.randomUUID()+"-"+safeName;
  const {error}=await supabase.storage.from("CUSTOMS-DOCUMENTS").upload(path,buffer,{contentType:mimeType,upsert:false});
  if(error)throw new Error(error.message);
  return path;
}
async function extractConfiguredEmailFields({subject,text,html,emailFields}){
  if(!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not configured in Vercel.");

  const source=[subject?("SUBJECT:\n"+subject):"",text?("BODY:\n"+text):html?("HTML BODY:\n"+html):""].filter(Boolean).join("\n\n");
  const response=await fetch("https://api.openai.com/v1/responses",{
    method:"POST",
    headers:{
      "Content-Type":"application/json",
      Authorization:"Bearer "+process.env.OPENAI_API_KEY
    },
    body:JSON.stringify({
      model:"gpt-5.6-luna",
      input:[{
        role:"user",
        content:[{
          type:"input_text",
          text:"You are the email source extraction component for a UK customs IDP platform. Extract ONLY the explicitly configured fields listed below from the supplied email subject/body. Do not answer unrelated questions. Do not infer, guess, transform or apply customer rules. If a configured field is not explicitly supported by the email, return null. Preserve evidence showing whether the value came from the subject or body. Configured fields: "+JSON.stringify(emailFields)+"\n\nEmail source:\n"+source
        }]
      }],
      text:{
        format:{
          type:"json_schema",
          name:"customs_email_field_extraction_v1",
          strict:true,
          schema:{
            type:"object",
            additionalProperties:false,
            properties:{
              fields:{
                type:"array",
                items:{
                  type:"object",
                  additionalProperties:false,
                  properties:{
                    field:{type:"string"},
                    value:{type:["string","number","null"]},
                    sourceType:{type:"string",enum:["email_subject","email_body","null"]},
                    sourceText:{type:["string","null"]},
                    confidence:{type:"number"}
                  },
                  required:["field","value","sourceType","sourceText","confidence"]
                }
              },
              warnings:{type:"array",items:{type:"string"}}
            },
            required:["fields","warnings"]
          }
        }
      }
    })
  });

  const data=await response.json();
  if(!response.ok) throw new Error(data?.error?.message||"Email field extraction failed.");
  const output=data.output_text||data.output?.flatMap(item=>item.content||[]).find(item=>item.type==="output_text")?.text;
  if(!output) throw new Error("No structured email extraction was returned.");
  return JSON.parse(output);
}

function normaliseAttachmentData(attachment){
  const raw=attachment.dataUrl||attachment.fileData||attachment.contentBase64||attachment.base64||attachment.content;
  if(!raw)return null;
  const value=String(raw);
  if(value.startsWith("data:"))return value;
  if(attachment.encoding==="base64"||attachment.contentBase64||attachment.base64||attachment.fileData)return "data:"+String(attachment.mimeType||attachment.contentType||"application/octet-stream")+";base64,"+value;
  return value.startsWith("http")?value:null;
}

function formatExtractionError(error){if(error==null)return "Unknown extraction error.";if(typeof error==="string")return error;if(error instanceof Error&&error.message)return error.message;if(typeof error==="object"){if(typeof error.message==="string")return error.message;if(error.error?.message)return String(error.error.message);try{return JSON.stringify(error);}catch{return String(error);}}try{return String(error);}catch{return "Unknown extraction error.";}}
function readJson(value,fallback){
  if(!value)return fallback;
  try{return JSON.parse(value);}catch{return fallback;}
}

function safeEqual(a,b){
  const aa=Buffer.from(String(a));
  const bb=Buffer.from(String(b));
  return aa.length===bb.length && crypto.timingSafeEqual(aa,bb);
}

async function claimEmailIngest(emailKey,packId){
  let rows=await supabaseFetch("rpc/claim_email_ingest",{
    method:"POST",
    body:JSON.stringify({p_email_key:emailKey,p_pack_id:packId})
  });
  let row=Array.isArray(rows)?rows[0]:null;
  if(row&&!row.claimed){
    rows=await supabaseFetch("rpc/recover_stale_email_ingest_claim",{method:"POST",body:JSON.stringify({p_email_key:emailKey,p_pack_id:packId})});
    row=Array.isArray(rows)?rows[0]:row;
  }
  if(!row)throw new Error("Email idempotency claim returned no result.");
  return {claimed:Boolean(row.claimed),packId:String(row.pack_id||packId)};
}

async function supabaseFetch(path,options={}){
  const url=process.env.SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!url||!key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are not configured in Vercel.");
  const response=await fetch(url+"/rest/v1/"+path,{
    ...options,
    headers:{
      apikey:key,
      Authorization:"Bearer "+key,
      "Content-Type":"application/json",
      ...(options.headers||{})
    }
  });
  if(!response.ok) throw new Error(await response.text());
  const responseText=await response.text();
  return responseText?JSON.parse(responseText):[];
}
