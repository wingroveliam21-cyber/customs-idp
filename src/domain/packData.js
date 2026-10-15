import { DEFAULT_ORGANISATION } from "../tenant.js";

export const packs = [
  { organisationId:DEFAULT_ORGANISATION.id, organisationName:DEFAULT_ORGANISATION.name, id:"PK-10482", packUuid:"11111111-1111-4111-8111-111111111111", customer:"Acme Components Ltd", docs:4, status:"Needs review", confidence:91, received:"16 Sep 2026, 15:42", ticket:"TK-88421" },
  { organisationId:DEFAULT_ORGANISATION.id, organisationName:DEFAULT_ORGANISATION.name, id:"PK-10481", packUuid:"22222222-2222-4222-8222-222222222222", customer:"Northstar Manufacturing", docs:7, status:"Processing", confidence:96, received:"16 Sep 2026, 15:38", ticket:"TK-88420" },
  { organisationId:DEFAULT_ORGANISATION.id, organisationName:DEFAULT_ORGANISATION.name, id:"PK-10480", packUuid:"33333333-3333-4333-8333-333333333333", customer:"Bancale Trading", docs:3, status:"Validated", confidence:98, received:"16 Sep 2026, 15:31", ticket:"TK-88419" },
  { organisationId:DEFAULT_ORGANISATION.id, organisationName:DEFAULT_ORGANISATION.name, id:"PK-10479", packUuid:"44444444-4444-4444-8444-444444444444", customer:"Raven Industrial", docs:5, status:"Needs review", confidence:88, received:"16 Sep 2026, 15:12", ticket:"TK-88418" }
];

export const customerStrategies = {
  "Acme Components Ltd": { instructions:"", requiredFields:[], weightHandling:"ask_user", autoApplyWeightApportionment:false, emailFields:[] },
  "Northstar Manufacturing": { instructions:"", requiredFields:[], weightHandling:"ask_user", autoApplyWeightApportionment:false, emailFields:[] },
  "Bancale Trading": { instructions:"", requiredFields:[], weightHandling:"ask_user", autoApplyWeightApportionment:false, emailFields:[] },
  "Raven Industrial": { instructions:"", requiredFields:[], weightHandling:"ask_user", autoApplyWeightApportionment:false, emailFields:[] }
};

export const customerStrategyStore = { ...customerStrategies };

export const getCustomerStrategy = customer =>
  customerStrategyStore[customer] || { instructions:"", requiredFields:[], weightHandling:"ask_user", autoApplyWeightApportionment:false, emailFields:[] };

// Older rows may not have received the pack_uuid migration yet. Derive a
// stable UUID-shaped value from the legacy id so those rows never produce an
// undefined route; migrated/new rows still use their stored UUID.
export function ensurePackUuid(pack){
  if(pack?.packUuid||pack?.pack_uuid)return pack.packUuid||pack.pack_uuid;
  const seed=String(pack?.id||pack?.ticket||"pack");
  let hash=2166136261;
  for(const character of seed){hash^=character.charCodeAt(0);hash=Math.imul(hash,16777619);}
  const hex=Array.from({length:8},(_,index)=>{
    hash^=hash<<13; hash^=hash>>>17; hash^=hash<<5;
    return (hash>>>0).toString(16).padStart(8,"0").slice(index%4,index%4+4);
  }).join("").slice(0,32);
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-5${hex.slice(13,16)}-8${hex.slice(17,20)}-${hex.slice(20,32)}`;
}

export const customers = [
  {name:"Acme Components Ltd", code:"ACME-001", mailbox:"customs.acme@inbox.example", rules:12, processed:"2,481"},
  {name:"Northstar Manufacturing", code:"NSTM-014", mailbox:"customs.northstar@inbox.example", rules:8, processed:"1,972"},
  {name:"Bancale Trading", code:"BANC-007", mailbox:"customs.bancale@inbox.example", rules:15, processed:"3,108"},
  {name:"Raven Industrial", code:"RAVN-021", mailbox:"customs.raven@inbox.example", rules:6, processed:"1,406"}
];

export const DEFAULT_INBOX_COLUMN_KEYS=["pack","customer","owner","documents","status","received"];
export const DEFAULT_INBOX_COLUMNS=[{key:"pack",label:"File name"},{key:"customer",label:"Customer"},{key:"owner",label:"Owner"},{key:"documents",label:"Documents"},{key:"status",label:"Status"},{key:"invoiceNumber",label:"Invoice number"},{key:"export",label:"Export"},{key:"destination",label:"Destination"},{key:"invoiceValue",label:"Invoice value"},{key:"currency",label:"Currency"},{key:"deliveryTerm",label:"Delivery term"},{key:"received",label:"Received"},{key:"validation",label:"Validation"}];
export function normaliseInboxColumnSelection(value){
  const available=new Set(DEFAULT_INBOX_COLUMNS.map(column=>column.key));
  if(Array.isArray(value)){
    const valid=[...new Set(value.filter(key=>available.has(key)))];
    if(valid.length)return valid;
  }
  return [...DEFAULT_INBOX_COLUMN_KEYS];
}

export const sampleLines = [
  {line:1,description:"Oak wooden packaging boxes",hs:"4415 10 00",origin:"HU",qty:24,net:"10.080",gross:"11.420",value:"384.00",confidence:97},
  {line:2,description:"Bancale Legno pallets",hs:"4415 20 90",origin:"IT",qty:6,net:"0.000",gross:"3.180",value:"120.00",confidence:93},
  {line:3,description:"Protective timber spacers",hs:"4415 10 90",origin:"HU",qty:18,net:"7.560",gross:"8.410",value:"216.00",confidence:94}
];


export function normaliseDatabasePack(row){
  const data=row?.extracted_data||null;
  const meta=data?._manager||{};
  const validation=data?._validation||{};
  const customerIdentification=row?.customerIdentification||data?.customerIdentification||null;
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
    organisationId:row?.organisation_id||data?._tenant?.organisationId||DEFAULT_ORGANISATION.id,
    organisationName:data?._tenant?.organisationName||DEFAULT_ORGANISATION.name,
    assignedTo:row?.assigned_to||"Unassigned",
    extractedData:rest&&Object.keys(rest).length?rest:undefined,
    customerIdentification,
    workingRecord:data?._workingRecord,
    email:data?.email||null,
    validationStatus:validation.validationStatus||undefined,
    validationChecks:Array.isArray(validation.validationChecks)?validation.validationChecks:undefined,
    validationSummary:validation.validationSummary||undefined,
    uploadedFiles:Array.isArray(meta.uploadedFiles)?meta.uploadedFiles:undefined,
    processingStartedAt:meta.processingStartedAt||undefined,
    processingCompletedAt:meta.processingCompletedAt||undefined,
    processingError:row?.processing_error||undefined
  };
}

export const normalizeCountryCode=value=>{
  const raw=String(value??"").trim();
  const upper=raw.toUpperCase();
  const map={"UNITED KINGDOM":"GB","GREAT BRITAIN":"GB","UK":"GB","ENGLAND":"GB","SCOTLAND":"GB","WALES":"GB","NORTHERN IRELAND":"GB"};
  return map[upper]||upper;
};
