function formatReceivedDateTime(value){
  if(!value)return "—";
  const date=new Date(value);
  if(Number.isNaN(date.getTime()))return value;
  const pad=n=>String(n).padStart(2,"0");
  return `${pad(date.getDate())}/${pad(date.getMonth()+1)}/${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function getPackCustomerLabel(pack){
  if(pack?.customer && pack.customer!=="Unassigned customer") return pack.customer;
  const data=pack?.workingRecord||pack?.extractedData||{};
  const exporter=data?.exporter||data?.exporterName||data?.exporterCompany||data?.exporterCompanyName;
  if(exporter) return String(exporter);
  const primary=Array.isArray(data?.documents)?data.documents.find(d=>d?.extraction?.exporter)||data.documents[0]:null;
  const documentExporter=primary?.extraction?.exporter||primary?.extraction?.exporterName||primary?.extraction?.exporterCompany||primary?.extraction?.exporterCompanyName;
  return documentExporter ? String(documentExporter) : "Unassigned customer";
}
function getPackDisplayName(pack){
  const data=pack?.extractedData||{};
  const extractedDocuments=Array.isArray(data.documents)?data.documents:[];
  const sourceDocuments=Array.isArray(data.sourceDocuments)?data.sourceDocuments:[];
  return pack?.uploadedFiles?.[0]?.name
    ||extractedDocuments[0]?.filename
    ||extractedDocuments[0]?.name
    ||sourceDocuments[0]?.name
    ||pack?.title
    ||pack?.email?.subject
    ||"Document pack";
}
function canOpenPack(pack){
  if(!pack)return false;
  return pack.status!=="Processing"||Boolean(String(pack.processingError||"").trim());
}
function getPackColumnValue(pack,key){const data=pack?.workingRecord||pack?.extractedData||{},docs=Array.isArray(data.documents)?data.documents:[],invoice=docs.find(d=>d?.extraction?.documentType==="commercial_invoice")?.extraction||data;if(key==="pack")return getPackDisplayName(pack);if(key==="customer")return getPackCustomerLabel(pack);if(key==="owner")return pack.assignedTo||"Unassigned";if(key==="documents")return (Number(pack.docs)||0)+" document"+(Number(pack.docs)===1?"":"s");if(key==="status")return pack.status||"—";if(key==="invoiceNumber")return invoice.invoiceNumber||"—";if(key==="export")return invoice.countryOfExport||invoice.exporterCountryIso||"—";if(key==="destination")return invoice.sourceCountryOfDestination||invoice.consigneeCountryIso||"—";if(key==="invoiceValue")return invoice.totalInvoiceValue||"—";if(key==="currency")return invoice.currency||"—";if(key==="deliveryTerm")return invoice.deliveryTerm||"—";if(key==="received")return formatReceivedDateTime(pack.received);if(key==="validation")return pack.validationStatus==="Validated"?"Passed":pack.validationStatus||"—";return "—"}


function reconcilePackDocuments(pack){
  const docs=Array.isArray(pack?.extractedData?.documents)?pack.extractedData.documents:[];
  if(docs.length<2) return {status:"not_ready",summary:"At least two extracted documents are required.",checks:[],conflicts:[]};
  const norm=v=>String(v??"").trim().toLowerCase().replace(/\\s+/g," ");
  const checks=[]; const conflicts=[];
  const compare=(label,key)=>{
    const found=docs.map(d=>({name:d.filename,value:d.extraction?.[key]})).filter(x=>x.value!=null&&x.value!=="");
    const unique=[...new Set(found.map(x=>norm(x.value)))];
    if(found.length<2){checks.push({label,status:"not_applicable",detail:"Not enough documents contain this field."});return;}
    if(unique.length===1) checks.push({label,status:"pass",detail:found.map(x=>x.name+": "+x.value).join(" · ")});
    else {checks.push({label,status:"conflict",detail:found.map(x=>x.name+": "+x.value).join(" · ")});conflicts.push({label,values:found});}
  };
  compare("Invoice number","invoiceNumber"); compare("Country of export","countryOfExport"); compare("Destination","sourceCountryOfDestination");
  compare("Total packages","totalPackages"); compare("Total net weight","totalNetWeight"); compare("Total gross weight","totalGrossWeight"); compare("Currency","currency");
  const lineCounts=docs.map(d=>({name:d.filename,count:Array.isArray(d.extraction?.lines)?d.extraction.lines.length:0})).filter(x=>x.count>0);
  if(lineCounts.length>=2){const unique=[...new Set(lineCounts.map(x=>x.count))]; if(unique.length===1) checks.push({label:"Goods line count",status:"pass",detail:lineCounts.map(x=>x.name+": "+x.count).join(" · ")}); else {checks.push({label:"Goods line count",status:"conflict",detail:lineCounts.map(x=>x.name+": "+x.count).join(" · ")});conflicts.push({label:"Goods line count",values:lineCounts});}}
  return {status:conflicts.length?"conflict":"pass",summary:conflicts.length?(conflicts.length+" cross-document conflict"+(conflicts.length===1?"":"s")+" found."):"Extracted document values reconcile with no conflicts detected.",checks,conflicts,documentCount:docs.length};
}


export { canOpenPack, formatReceivedDateTime, getPackCustomerLabel, getPackColumnValue, getPackDisplayName, reconcilePackDocuments };
