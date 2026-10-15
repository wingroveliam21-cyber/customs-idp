import { createClient } from "@supabase/supabase-js";
import { extractDocument } from "../../document-extraction.js";
import { buildWorkingCustomsRecord } from "../../domain/workingRecord.js";
import { buildValidatedPack } from "../../domain/packValidation.js";
import { normaliseCustomerName, resolveCustomerMatch } from "../../domain/customerMatching.js";
import { runReviewAgent } from "../api/agent.js";
import {
  claimPackProcessing,
  insertHistory,
  listCustomers,
  loadCustomerStrategy,
  loadPack,
  PackProcessingConflictError,
  savePack
} from "./packRepository.js";

const DEFAULT_STRATEGY={instructions:"",requiredFields:[],weightHandling:"ask_user",emailFields:[],autoApplyWeightApportionment:false};
const AUDIT_MESSAGE="[AUTOMATED EMAIL AUDIT] Review the associated email against the extracted document data and the combined working customs record before the user opens the pack. Identify clear customs-relevant information present in the email but missing from the extracted/combined data, including any HS/commodity-code information. Do not change the pack; return suggestions requiring human confirmation. If there is no clear additional information, return no suggestions.";

export class ProcessPackError extends Error{
  constructor(message,status=500,pack=null){super(message);this.name="ProcessPackError";this.status=status;this.pack=pack;}
}

function cleanSegment(value){
  return String(value||"").replace(/[^a-zA-Z0-9._-]+/g,"-").replace(/^-+|-+$/g,"")||"document";
}

export function sourcePathBelongsToPack(storagePath,{organisationId="",packId="",packUuid=""}={}){
  const path=String(storagePath||"");
  if(!path)return false;
  const legacyPrefix=cleanSegment(packId)+"/";
  const canonicalPrefix=`organisations/${cleanSegment(organisationId)}/packs/${cleanSegment(packUuid||packId)}/`;
  return path.startsWith(legacyPrefix)||path.startsWith(canonicalPrefix);
}

async function loadStoredSource(file,context){
  const storagePath=String(file?.storagePath||"");
  if(!storagePath)throw new Error("Source document has no persisted storage path.");
  if(!sourcePathBelongsToPack(storagePath,context))throw new Error("Source document storage path does not belong to this pack.");
  const url=process.env.SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!url||!key)throw new Error("Supabase storage configuration is missing.");
  const supabase=createClient(url,key,{auth:{autoRefreshToken:false,persistSession:false}});
  const {data,error}=await supabase.storage.from("CUSTOMS-DOCUMENTS").download(storagePath);
  if(error)throw new Error(error.message);
  const mimeType=file.type||data.type||"application/octet-stream";
  const buffer=Buffer.from(await data.arrayBuffer());
  return {fileData:"data:"+mimeType+";base64,"+buffer.toString("base64"),mimeType};
}

const productionDependencies={
  claimPackProcessing,
  loadPack,
  savePack,
  listCustomers,
  loadCustomerStrategy,
  loadSource:loadStoredSource,
  extractDocument,
  buildWorkingRecord:buildWorkingCustomsRecord,
  validatePack:buildValidatedPack,
  runAudit:runReviewAgent,
  insertHistory,
  now:()=>new Date().toISOString(),
  logError:(message,error)=>console.error(message,error)
};

function identifyCustomer(customers,extraction){
  const active=(customers||[]).filter(customer=>String(customer.status||"active").toLowerCase()==="active");
  const exporterName=extraction?.exporter||extraction?.exporterName||"";
  const importerName=extraction?.consignee||extraction?.importer||extraction?.importerName||"";
  const matches=(source,matchedBy)=>active.flatMap(customer=>[customer.name,...(customer.memoryAliases||[])]
    .filter(name=>normaliseCustomerName(name)===normaliseCustomerName(source))
    .map(name=>({customer,matchedBy:name===customer.name?matchedBy:"memory"})));
  const exporter=matches(exporterName,"exporter")[0]||null;
  const importer=matches(importerName,"importer")[0]||null;
  if(exporter&&importer&&String(exporter.customer.id)!==String(importer.customer.id)){
    return {customer:null,identification:{exporterName:exporterName||null,importerName:importerName||null,matched:false,matchedBy:null,ambiguous:true,possibleMatch:false,candidates:[{id:exporter.customer.id,name:exporter.customer.name,matchedBy:"exporter"},{id:importer.customer.id,name:importer.customer.name,matchedBy:"importer"}],customerId:null,customerName:null,method:"automatic"}};
  }
  const exact=exporter||importer;
  const resolved=exact?{type:"match",customer:exact.customer,matchedBy:exact.matchedBy}:resolveCustomerMatch(active,exporterName,importerName);
  if(resolved.type==="possible"){
    return {customer:null,identification:{exporterName:exporterName||null,importerName:importerName||null,matched:false,matchedBy:resolved.sourceType||null,ambiguous:false,possibleMatch:true,candidates:resolved.candidates||[],customerId:null,customerName:null,method:"automatic"}};
  }
  const customer=resolved.type==="match"?resolved.customer:null;
  return {customer,identification:{exporterName:exporterName||null,importerName:importerName||null,matched:Boolean(customer),matchedBy:resolved.matchedBy||null,ambiguous:false,possibleMatch:false,candidates:[],customerId:customer?.id||null,customerName:customer?.name||null,method:"automatic"}};
}

function resetForReprocess(pack){
  const retained={};
  for(const key of ["emailFields","configuredFields"]){
    if(pack.extractedData?.[key]!==undefined)retained[key]=pack.extractedData[key];
  }
  if(Array.isArray(pack.extractedData?.warnings))retained.warnings=pack.extractedData.warnings.filter(warning=>String(warning).startsWith("Configured email-field"));
  return {...pack,extractedData:Object.keys(retained).length?retained:undefined,workingRecord:undefined,validationStatus:undefined,validationChecks:undefined,validationSummary:undefined,processingCompletedAt:undefined,processingError:undefined};
}

function historyEvents({pack,reason,documentCount,customerKnown,strategyApplied}){
  const events=[{action:"extracted",description:"Document Extraction Agent completed extraction",afterData:{documentCount}}];
  if(pack.customerIdentification)events.push({action:"customer_identified",description:pack.customerIdentification.ambiguous?"Customer identification requires confirmation":pack.customerId?"Customer identified: "+pack.customer:"No customer identified — standard strategy used",afterData:pack.customerIdentification});
  if(strategyApplied)events.push({action:"strategy_applied",description:"Applied customer strategy for "+pack.customer,afterData:{customer:pack.customer,customerId:pack.customerId}});
  events.push({action:"validated",description:pack.validationStatus==="Validated"?"Pack validated successfully":"Pack validation completed with issues",afterData:{status:pack.status,validationStatus:pack.validationStatus,checks:pack.validationChecks}});
  events.push({action:reason==="reprocess"?"reprocessed":"processed",description:reason==="reprocess"?"Pack reprocessed and processing completed":"Pack processing completed",afterData:{status:pack.status,documentCount,customerKnown}});
  return events;
}

export async function processPack({organisationId,packId,reason,actor,dependencies={}}){
  if(!organisationId)throw new ProcessPackError("Organisation id is required.",400);
  if(!packId)throw new ProcessPackError("Pack id is required.",400);
  if(!["initial","reprocess"].includes(reason))throw new ProcessPackError("Reason must be initial or reprocess.",400);
  const deps={...productionDependencies,...dependencies};
  const existing=await deps.loadPack(organisationId,packId);
  if(!existing)throw new ProcessPackError("Pack was not found.",404);
  if(String(existing.organisationId)!==String(organisationId))throw new ProcessPackError("Pack does not belong to the active organisation.",403);
  let pack=await deps.claimPackProcessing(organisationId,packId);
  if(!pack)throw new ProcessPackError("This pack is already being processed. Wait for the current attempt to finish.",409);
  const processingToken=pack.processingToken||pack.processing_token;
  if(!processingToken)throw new ProcessPackError("Pack processing did not return an ownership token.",500);
  const save=(candidate,releaseProcessing=false)=>deps.savePack(candidate,{processingToken,releaseProcessing});
  try{
  if(reason==="reprocess")pack=resetForReprocess(pack);
  const startedAt=deps.now();
  pack=await save({...pack,status:"Processing",processingStartedAt:startedAt,processingCompletedAt:undefined,processingError:undefined});
  const files=Array.isArray(pack.uploadedFiles)?pack.uploadedFiles:[];
  if(!files.length){
    const failed=await save({...pack,status:"Needs review",processingCompletedAt:deps.now(),processingError:"No persisted source documents are available."},true);
    try{await deps.insertHistory({organisationId,packId,actor,action:"processing_error",description:"Pack processing could not start",afterData:{error:failed.processingError}});}catch(error){deps.logError("Unable to record pack processing history",error);}
    throw new ProcessPackError("No persisted source documents are available.",422,failed);
  }
  const sourceContext={organisationId,packId,packUuid:pack.packUuid||packId};
  const invalidPath=files.find(file=>!sourcePathBelongsToPack(file?.storagePath,sourceContext));
  if(invalidPath){
    const message="Source document storage path does not belong to this pack.";
    const failed=await save({...pack,status:"Needs review",processingCompletedAt:deps.now(),processingError:message},true);
    try{await deps.insertHistory({organisationId,packId,actor,action:"processing_error",description:"Pack source validation failed",afterData:{error:message,filename:invalidPath.name}});}catch(error){deps.logError("Unable to record pack processing history",error);}
    throw new ProcessPackError(message,422,failed);
  }

  const customers=await deps.listCustomers(organisationId);
  let customer=pack.customerId?(customers||[]).find(item=>String(item.id)===String(pack.customerId)&&String(item.status||"active").toLowerCase()==="active"):null;
  let strategy=customer?await deps.loadCustomerStrategy(organisationId,customer.id):null;
  if(customer&&!pack.customerIdentification){
    pack={...pack,customer:customer.name,customerIdentification:{exporterName:null,importerName:null,matched:true,matchedBy:"associated",ambiguous:false,possibleMatch:false,candidates:[],customerId:customer.id,customerName:customer.name,method:"existing"}};
  }
  const extractionStrategy={...DEFAULT_STRATEGY,...(strategy||{})};
  const documents=[];
  for(const file of files){
    const document={id:file.id||file.storagePath,filename:file.name||"document",mimeType:file.type||"application/octet-stream",storagePath:file.storagePath||null};
    try{
      const source=await deps.loadSource(file,sourceContext);
      const result=await deps.extractDocument({fileData:source.fileData,filename:document.filename,mimeType:source.mimeType||document.mimeType,customerStrategy:extractionStrategy});
      if(!result?.extraction)throw new Error("No extraction result was returned.");
      document.mimeType=source.mimeType||document.mimeType;
      document.extraction=result.extraction;
    }catch(error){
      document.error=error?.message||"Document extraction failed.";
    }
    documents.push(document);
  }

  const successful=documents.filter(document=>document.extraction);
  const primary=successful.find(document=>document.extraction?.documentType==="commercial_invoice")||successful[0]||null;
  const existingWarnings=Array.isArray(pack.extractedData?.warnings)?pack.extractedData.warnings:[];
  const documentWarnings=documents.filter(document=>document.error).map(document=>document.filename+": "+document.error);
  const warnings=[...existingWarnings,...documentWarnings];
  let customerIdentification=pack.customerIdentification||null;
  if(!customer){
    const identified=identifyCustomer(customers,primary?.extraction);
    customer=identified.customer;
    customerIdentification=identified.identification;
    if(customer){
      pack={...pack,customer:customer.name,customerId:customer.id};
      strategy=await deps.loadCustomerStrategy(organisationId,customer.id);
    }else{
      pack={...pack,customer:null,customerId:null};
    }
  }

  const extractedData={
    ...(pack.extractedData||{}),
    ...(primary?.extraction||{}),
    documents,
    documentCount:documents.length,
    sourceDocuments:documents.map(document=>({id:document.id,name:document.filename,mimeType:document.mimeType,storagePath:document.storagePath,documentType:document.extraction?.documentType||"unknown",confidence:document.extraction?.confidence||0,error:document.error||null})),
    warnings,
    agentMessages:[]
  };
  delete extractedData.agentAuditCompleted;
  pack={...pack,docs:files.length,confidence:successful.length?Math.round(successful.reduce((sum,document)=>sum+Number(document.extraction?.confidence||0),0)/successful.length):0,extractedData,customerIdentification};
  pack.workingRecord=deps.buildWorkingRecord(pack,strategy||DEFAULT_STRATEGY);
  pack=deps.validatePack(pack,strategy||DEFAULT_STRATEGY);

  let auditFailed=false;
  if(pack.email){
    try{
      const audit=await deps.runAudit({message:AUDIT_MESSAGE,pack:{...pack,customerStrategy:strategy||DEFAULT_STRATEGY,conversation:[],extractedData:{...pack.extractedData,agentMessages:undefined}}});
      const suggestions=audit?.action==="suggest_field_updates"&&Array.isArray(audit.suggestions)?audit.suggestions:[];
      pack.extractedData={...pack.extractedData,agentAuditCompleted:true,agentMessages:suggestions.length?[{type:"fieldSuggestion",text:audit.reply||"Additional customs information was found in the email. Review the suggestions below.",suggestions,handled:null,persist:true}]:[]};
    }catch(error){
      auditFailed=true;
      pack={...pack,status:"Processing",processingError:error?.message||"Automated Review Agent did not complete."};
    }
  }

  const hasSuggestions=Array.isArray(pack.extractedData?.agentMessages)&&pack.extractedData.agentMessages.some(message=>message?.type==="fieldSuggestion"&&!message.handled);
  const ambiguous=Boolean(pack.customerIdentification?.ambiguous);
  const possibleMatch=Boolean(pack.customerIdentification?.possibleMatch);
  const validationFailed=pack.validationStatus!=="Validated";
  if(!auditFailed){
    const needsReview=!successful.length||documentWarnings.length>0||existingWarnings.length>0||ambiguous||possibleMatch||validationFailed||hasSuggestions;
    pack={...pack,status:needsReview?"Needs review":"Ready",processingCompletedAt:deps.now(),processingError:warnings.length?warnings.join(" | "):undefined};
  }

  const saved=await save(pack,true);
  const events=auditFailed
    ? [{action:"processing_error",description:"Automated email audit did not complete",afterData:{error:saved.processingError}}]
    : historyEvents({pack:saved,reason,documentCount:successful.length,customerKnown:Boolean(customer),strategyApplied:Boolean(strategy)});
  for(const event of events){
    try{
      await deps.insertHistory({organisationId,packId,actor,...event});
    }catch(error){
      deps.logError("Unable to record pack processing history",error);
    }
  }
  return saved;
  }catch(error){
    if(error instanceof ProcessPackError)throw error;
    if(error instanceof PackProcessingConflictError)throw new ProcessPackError(error.message,409);
    const message=error?.message||"Pack processing failed.";
    let failed=pack;
    try{
      failed=await save({...pack,status:pack.email?"Processing":"Needs review",processingCompletedAt:pack.email?undefined:deps.now(),processingError:message},true);
      try{await deps.insertHistory({organisationId,packId,actor,action:"processing_error",description:"Pack processing failed",afterData:{error:message}});}catch(historyError){deps.logError("Unable to record pack processing history",historyError);}
    }catch(saveError){deps.logError("Unable to persist pack processing failure",saveError);}
    throw new ProcessPackError(message,500,failed);
  }
}
