const DEFAULT_ORGANISATION_ID="demo-organisation";
const DEFAULT_ORGANISATION_NAME="Customs IDP Demo Organisation";

export async function supabaseFetch(path,options={}){
  const url=process.env.SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!url||!key)throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are not configured in Vercel.");
  const response=await fetch(url+"/rest/v1/"+path,{
    ...options,
    headers:{apikey:key,Authorization:"Bearer "+key,"Content-Type":"application/json",...(options.headers||{})}
  });
  if(!response.ok)throw new Error(await response.text());
  const body=await response.text();
  return body?JSON.parse(body):[];
}

export function normalizePack(row){
  const data=row?.extracted_data||null;
  const manager=data?._manager||{};
  const validation=data?._validation||{};
  const tenant=data?._tenant||{};
  const rest=data?{...data}:null;
  if(rest){
    delete rest._manager;
    delete rest._validation;
    delete rest._workingRecord;
    delete rest._tenant;
    delete rest.customerIdentification;
  }
  return {
    ...row,
    packUuid:row?.pack_uuid||row?.packUuid,
    organisationId:row?.organisation_id||tenant.organisationId||DEFAULT_ORGANISATION_ID,
    organisationName:tenant.organisationName||DEFAULT_ORGANISATION_NAME,
    customerId:row?.customer_id||row?.customerId||null,
    assignedTo:row?.assigned_to||"Unassigned",
    extractedData:rest&&Object.keys(rest).length?rest:undefined,
    customerIdentification:data?.customerIdentification||null,
    workingRecord:data?._workingRecord,
    email:data?.email||null,
    validationStatus:validation.validationStatus||undefined,
    validationChecks:Array.isArray(validation.validationChecks)?validation.validationChecks:undefined,
    validationSummary:validation.validationSummary||undefined,
    uploadedFiles:Array.isArray(manager.uploadedFiles)?manager.uploadedFiles:[],
    processingStartedAt:manager.processingStartedAt||undefined,
    processingCompletedAt:manager.processingCompletedAt||undefined,
    processingError:row?.processing_error||undefined,
    processingToken:row?.processing_token||undefined,
    processingLeaseUntil:row?.processing_lease_until||undefined
  };
}

export function packToRow(pack){
  const extractedData=pack.extractedData?{...pack.extractedData}:{};
  extractedData.customerIdentification=pack.customerIdentification||extractedData.customerIdentification||null;
  extractedData._tenant={organisationId:pack.organisationId,organisationName:pack.organisationName||DEFAULT_ORGANISATION_NAME};
  extractedData._manager={
    processingStartedAt:pack.processingStartedAt||null,
    processingCompletedAt:pack.processingCompletedAt||null,
    uploadedFiles:Array.isArray(pack.uploadedFiles)?pack.uploadedFiles.map(file=>{
      const clean={...file};
      delete clean.accessUrl;
      delete clean.accessUrlExpiresAt;
      return clean;
    }):[]
  };
  if(pack.validationStatus||pack.validationChecks||pack.validationSummary){
    extractedData._validation={
      validationStatus:pack.validationStatus||null,
      validationChecks:Array.isArray(pack.validationChecks)?pack.validationChecks:null,
      validationSummary:pack.validationSummary||null
    };
  }
  if(pack.workingRecord)extractedData._workingRecord=pack.workingRecord;
  if(pack.email)extractedData.email=pack.email;

  return {
    id:pack.id,
    ...(pack.packUuid||pack.pack_uuid?{pack_uuid:pack.packUuid||pack.pack_uuid}:{}),
    organisation_id:pack.organisationId,
    customer:pack.customer||null,
    customer_id:pack.customerId||pack.customer_id||null,
    docs:Number(pack.docs)||0,
    status:pack.status||"Processing",
    confidence:Number(pack.confidence)||0,
    received:pack.received||new Date().toISOString(),
    ticket:pack.ticket||null,
    assigned_to:pack.assignedTo||"Unassigned",
    extracted_data:extractedData,
    processing_error:pack.processingError||null,
    updated_at:new Date().toISOString()
  };
}

export async function loadPack(organisationId,packId){
  const rows=await supabaseFetch(
    "document_packs?organisation_id=eq."+encodeURIComponent(organisationId)+"&id=eq."+encodeURIComponent(packId)+"&select=*&limit=1"
  );
  return rows[0]?normalizePack(rows[0]):null;
}

export async function claimPackProcessing(organisationId,packId){
  const rows=await supabaseFetch("rpc/claim_document_pack_processing",{
    method:"POST",
    body:JSON.stringify({p_organisation_id:organisationId,p_pack_id:packId})
  });
  return rows?.[0]?normalizePack(rows[0]):null;
}

export class PackProcessingConflictError extends Error{
  constructor(message="Pack processing ownership was lost."){super(message);this.name="PackProcessingConflictError";}
}

export async function savePack(pack,{processingToken=null,releaseProcessing=false}={}){
  const row=packToRow(pack);
  if(processingToken){
    row.processing_token=releaseProcessing?null:processingToken;
    if(releaseProcessing)row.processing_lease_until=null;
    const rows=await supabaseFetch(
      "document_packs?id=eq."+encodeURIComponent(pack.id)+
      "&organisation_id=eq."+encodeURIComponent(pack.organisationId)+
      "&processing_token=eq."+encodeURIComponent(processingToken),
      {method:"PATCH",body:JSON.stringify(row),headers:{Prefer:"return=representation"}}
    );
    if(!rows?.[0])throw new PackProcessingConflictError();
    return normalizePack(rows[0]);
  }
  await supabaseFetch("document_packs",{
    method:"POST",
    body:JSON.stringify(row),
    headers:{Prefer:"resolution=merge-duplicates,return=minimal"}
  });
  return normalizePack(row);
}

export async function listCustomers(organisationId){
  const customers=await supabaseFetch(
    "customers?organisation_id=eq."+encodeURIComponent(organisationId)+"&select=id,name,status&order=name.asc"
  );
  if(!Array.isArray(customers))return [];
  try{
    const memories=await supabaseFetch(
      "customer_memory?organisation_id=eq."+encodeURIComponent(organisationId)+"&memory_type=eq.customer_alias&select=customer_id,source_value"
    );
    const aliases=new Map();
    for(const memory of memories||[]){
      const values=aliases.get(String(memory.customer_id))||[];
      values.push(memory.source_value);
      aliases.set(String(memory.customer_id),values);
    }
    return customers.map(customer=>({...customer,memoryAliases:aliases.get(String(customer.id))||[]}));
  }catch{
    return customers;
  }
}

export async function loadCustomerStrategy(organisationId,customerId){
  if(!customerId)return null;
  const rows=await supabaseFetch(
    "customer_strategies?organisation_id=eq."+encodeURIComponent(organisationId)+
    "&customer_id=eq."+encodeURIComponent(customerId)+
    "&status=eq.active&select=config&order=version.desc&limit=1"
  );
  return rows?.[0]?.config||null;
}

export async function insertHistory({organisationId,packId,actor,action,description,afterData=null,metadata=null}){
  const row={
    organisation_id:organisationId,
    pack_id:packId,
    user_id:actor?.userId||null,
    actor_name:actor?.name||"Customs IDP System",
    actor_type:actor?.type||"system",
    action,
    description,
    before_data:null,
    after_data:afterData,
    metadata
  };
  await supabaseFetch("pack_history",{method:"POST",headers:{Prefer:"return=minimal"},body:JSON.stringify(row)});
  return row;
}
