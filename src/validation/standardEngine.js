import { normalizeCountryCode } from "../utils/countryCodes.js";
const ISO2=/^[A-Z]{2}$/;
const CURRENCY=/^[A-Z]{3}$/;
const HS=/^\d{6,11}$/;
const IM_PROCEDURE=/^\d{10}$/;

const hasValue=value=>value!==undefined&&value!==null&&String(value).trim()!=="";
const text=value=>String(value??"").trim();
const numberValue=value=>{
  if(value===undefined||value===null||value==="") return null;
  const n=Number(String(value).replace(/,/g,""));
  return Number.isFinite(n)?n:null;
};

const result=(check,field,status,value,expected,detail,extra={})=>({
  check,field,status,value:value??"",expected:expected??"",detail,...extra
});

function findSourceLine(doc,line){
  const sourceLines=Array.isArray(doc?.extraction?.lines)?doc.extraction.lines:[];
  const key=value=>String(value??"").trim().toLowerCase();
  const hs=key(line?.hsCode);
  const description=key(line?.description);
  return sourceLines.find(x=>key(x?.hsCode)===hs&&key(x?.description)===description)
    ||sourceLines.find(x=>key(x?.description)===description)
    ||null;
}

function getWorkingLines(data){
  const invoiceLines=Array.isArray(data?.lines)?data.lines:[];
  const selected=data?.weightSourceDecision?.source;
  const docs=Array.isArray(data?.documents)?data.documents:[];
  const packing=docs.find(d=>/packing/i.test(d?.filename||""))||docs.find(d=>d?.extraction?.documentType==="packing_list");
  return invoiceLines.map((line,index)=>{
    const sourceLine=selected==="packing_list"&&packing?findSourceLine(packing,line):null;
    return {
      ...line,
      _lineNumber:line?.lineNo||index+1,
      _netMass:sourceLine?.netMassKg??line?.netMassKg??line?.weightKg,
      _grossMass:sourceLine?.grossMassKg??line?.grossMassKg??line?.weightKg,
      _weightSource:sourceLine?"Packing List":"Commercial Invoice"
    };
  });
}

export function validateStandardCustomsRecord(data={}){
  const checks=[];
  const fail=(...args)=>checks.push(result(...args));
  const pass=(...args)=>checks.push(result(...args));
  const review=(...args)=>checks.push(result(...args));
  (Array.isArray(data.customerStrategyExceptions)?data.customerStrategyExceptions:[]).forEach((exception,index)=>{
    review("Customer strategy exception",exception.field||exception.ruleType||"customerStrategy","review","",exception.expected||"",exception.message||"A customer strategy rule raised an exception.",{strategyCategory:exception.category||"customerStrategy",strategyRuleType:exception.ruleType||null,strategyExceptionIndex:index});
  });

  const countryExport=normalizeCountryCode(data.countryOfExport||data.exporterCountryIso);
  const destination=normalizeCountryCode(data.sourceCountryOfDestination||data.countryOfDestination);
  const currency=text(data.currency).toUpperCase();
  const invoiceNumber=text(data.invoiceNumber);
  const exporter=text(data.exporterName||data.exporter);
  const consignee=text(data.consigneeName||data.consignee);
  const totalAmount=numberValue(data.totalInvoicedAmount??data.totalAmountInvoiced??data.totalInvoiceValue);
  const selectedWeightSource=data?.weightSourceDecision?.source;
  const docs=Array.isArray(data?.documents)?data.documents:[];
  const packingDoc=docs.find(d=>/packing/i.test(d?.filename||""))||docs.find(d=>d?.extraction?.documentType==="packing_list");
  const totalGross=numberValue(selectedWeightSource==="packing_list"?packingDoc?.extraction?.totalGrossWeight:data.totalGrossWeight);
  const totalNet=numberValue(selectedWeightSource==="packing_list"?packingDoc?.extraction?.totalNetWeight:data.totalNetWeight);
  const totalPackages=numberValue(data.totalPackages);

  const requiredHeader=[
    ["Invoice number","invoiceNumber",invoiceNumber,"non-empty invoice/reference number"],
    ["Exporter","exporterName",exporter,"non-empty exporter"],
    ["Consignee","consigneeName",consignee,"non-empty consignee"],
    ["Country of export","countryOfExport",countryExport,"ISO 3166-1 alpha-2 code"],
    ["Country of destination","sourceCountryOfDestination",destination,"ISO 3166-1 alpha-2 code"],
    ["Invoice currency","currency",currency,"3-letter ISO currency code"],
    ["Total amount invoiced","totalInvoicedAmount",totalAmount,"numeric non-negative amount"]
  ];

  requiredHeader.forEach(([label,field,value,expected])=>{
    if(!hasValue(value)){
      fail(label,field,"fail",value,expected,"Required customs header value is missing from the working record.");
    }else if(["countryOfExport","sourceCountryOfDestination"].includes(field)&&!ISO2.test(String(value).toUpperCase())){
      fail(label,field,"fail",value,expected,"Country code must be a two-letter ISO 3166-1 alpha-2 value.");
    }else if(field==="currency"&&!CURRENCY.test(String(value).toUpperCase())){
      fail(label,field,"fail",value,expected,"Currency must be a three-letter ISO code.");
    }else if(["totalInvoicedAmount","totalGrossWeight"].includes(field)&&numberValue(value)===null){
      fail(label,field,"fail",value,expected,"Value must be numeric.");
    }else if(["totalInvoicedAmount","totalGrossWeight"].includes(field)&&numberValue(value)<0){
      fail(label,field,"fail",value,expected,"Value cannot be negative.");
    }else{
      pass(label,field,"pass",value,expected,"Working customs value is present and valid.");
    }
  });

  const exporterCountry=normalizeCountryCode(data.exporterCountryIso);
  const consigneeCountry=normalizeCountryCode(data.consigneeCountryIso);
  [["Exporter country ISO","exporterCountryIso",exporterCountry],["Consignee country ISO","consigneeCountryIso",consigneeCountry]].forEach(([label,field,value])=>{
    if(!hasValue(value)) review(label,field,"review",value,"two-letter ISO code","Country ISO was not extracted; confirm the source document before posting.");
    else if(!ISO2.test(value)) fail(label,field,"fail",value,"two-letter ISO code","Country ISO must contain exactly two letters.");
    else pass(label,field,"pass",value,"two-letter ISO code","Country ISO format is valid.");
  });

  const exporterAddress=text(data.exporterAddress);
  const exporterAddressLine1=text(data.exporterAddressLine1);
  const exporterPostcode=text(data.exporterPostcode);
  const exporterCity=text(data.exporterCity);
  const exporterAddressCountry=normalizeCountryCode(data.exporterCountryIso);

  // Use only components that can be identified directly from the visible address.
  // Do not infer a city from a street/business name.
  const addressPostcodeFallback=(exporterPostcode||exporterAddress.match(/\\b[A-Z]{1,2}\\d[A-Z\\d]?\\s*\\d[A-Z]{2}\\b/i)?.[0]||"").trim();
  const addressCountryFallback=exporterAddressCountry||(/(?:^|[,\\n])\\s*(?:United Kingdom|UK|GB)\\s*$/i.test(exporterAddress)?"GB":"");
  const addressLineFallback=exporterAddress
    ? exporterAddress.split(/,|\\n/).map(x=>x.trim()).filter(Boolean).filter(x=>!/^([A-Z]{1,2}\\d[A-Z\\d]?\\s*\\d[A-Z]{2})$/i.test(x)&&!/(?:United Kingdom|UK|GB)$/i.test(x)).join(", ")
    : "";

  const addressChecks=[
    ["Exporter address line 1","exporterAddressLine1",exporterAddressLine1||addressLineFallback],
    ["Exporter postcode/ZIP","exporterPostcode",addressPostcodeFallback],
    ["Exporter city","exporterCity",exporterCity],
    ["Exporter country ISO","exporterCountryIso",addressCountryFallback]
  ];
  addressChecks.forEach(([label,field,value])=>{
    if(!hasValue(value)) fail(label,field,"fail",value,"extracted address component","This specific exporter address component is missing from the structured working record.");
    else pass(label,field,"pass",value,"extracted address component","Exporter address component is present in the working record.");
  });


  const isGBExporter=countryExport==="GB"||exporterAddressCountry==="GB";
  const exporterEori=text(data.exporterEoriNo);
  if(isGBExporter){
    if(!exporterEori) fail("GB exporter EORI","exporterEoriNo","fail",exporterEori,"GB EORI number","GB exporter detected but no EORI was extracted.");
    else if(!/^GB\d{9,15}$/i.test(exporterEori.replace(/\s+/g,""))) fail("GB exporter EORI","exporterEoriNo","fail",exporterEori,"GB followed by 9-15 digits","GB EORI format is invalid.");
    else pass("GB exporter EORI","exporterEoriNo","pass",exporterEori,"GB followed by 9-15 digits","GB EORI format is valid.");
  }else{
    review("GB exporter EORI","exporterEoriNo","not_applicable",exporterEori,"only required for GB exporter","Exporter is not identified as GB.");
  }

  if(totalPackages!==null){
    if(totalPackages<0||!Number.isInteger(totalPackages)) fail("Total packages","totalPackages", "fail",totalPackages,"non-negative whole number","Total packages must be a non-negative whole number.");
    else pass("Total packages","totalPackages","pass",totalPackages,"non-negative whole number","Total packages value is valid.");
  }

  const lines=getWorkingLines(data);
  if(!lines.length){
    fail("Goods lines","lines","fail",0,"at least one goods line","No goods lines are available in the working customs record.");
  }

  const seen=new Set();
  let lineNet=0;
  let lineGross=0;
  let lineValue=0;
  let allLineValuesNumeric=true;

  lines.forEach((line,index)=>{
    const lineNo=numberValue(line._lineNumber);
    const prefix="Line "+(index+1);
    const description=text(line.description);
    const hs=text(line.hsCode).replace(/[.\s-]/g,"");
    const origin=normalizeCountryCode(line.sourceCountryCode||line.countryOfOrigin);
    const quantity=numberValue(line.quantity);
    const amount=numberValue(line.totalValue??line.lineValue??line.unitValue);
    const lineCurrency=text(line.currency||currency).toUpperCase();
    const net=numberValue(line._netMass);
    const gross=numberValue(line._grossMass);

    if(lineNo===null||!Number.isInteger(lineNo)||lineNo<1) fail(prefix+" number","lineNo","fail",line._lineNumber,"positive whole number","Goods line number must be a positive whole number.",{lineNumber:index+1});
    else if(seen.has(lineNo)) fail(prefix+" number","lineNo","fail",lineNo,"unique sequential line number","Goods line number is duplicated.",{lineNumber:index+1});
    else {seen.add(lineNo); pass(prefix+" number","lineNo","pass",lineNo,"unique positive line number","Goods line number is valid.",{lineNumber:index+1});}

    if(!description) fail(prefix+" description","description","fail",description,"non-empty description","Goods description is missing.",{lineNumber:index+1});
    else pass(prefix+" description","description","pass",description,"non-empty description","Goods description is present.",{lineNumber:index+1});

    if(!hs) fail(prefix+" HS code","hsCode","fail",hs,"HS/commodity code","HS code is missing.",{lineNumber:index+1});
    else if(!HS.test(hs)) fail(prefix+" HS code","hsCode","fail",hs,"6-11 numeric digits","HS code must contain 6-11 digits after removing visual separators.",{lineNumber:index+1});
    else pass(prefix+" HS code","hsCode","pass",hs,"4-10 numeric digits","HS code format is valid.",{lineNumber:index+1});

    if(!origin) fail(prefix+" country of origin","sourceCountryCode","fail",origin,"two-letter ISO code","Country of origin is missing.",{lineNumber:index+1});
    else if(!ISO2.test(origin)) fail(prefix+" country of origin","sourceCountryCode","fail",origin,"two-letter ISO code","Country of origin must be a two-letter ISO code.",{lineNumber:index+1});
    else pass(prefix+" country of origin","sourceCountryCode","pass",origin,"two-letter ISO code","Country of origin format is valid.",{lineNumber:index+1});

    if(quantity===null||quantity<0) fail(prefix+" quantity","quantity","fail",line.quantity,"non-negative number","Quantity is missing or invalid.",{lineNumber:index+1});
    else pass(prefix+" quantity","quantity","pass",quantity,"non-negative number","Quantity is valid.",{lineNumber:index+1});

    if(amount===null){
      allLineValuesNumeric=false;
      fail(prefix+" item amount","itemPrice_SAD42","fail",line.totalValue??line.lineValue??line.unitValue,"numeric line amount","Line monetary value is missing. A line amount is required for the working customs record.",{lineNumber:index+1});
    }else if(amount<0){
      allLineValuesNumeric=false;
      fail(prefix+" item amount","itemPrice_SAD42","fail",amount,"non-negative line amount","Line monetary value cannot be negative.",{lineNumber:index+1});
    }else{
      lineValue+=amount;
      pass(prefix+" item amount","itemPrice_SAD42","pass",amount,"numeric line amount","Line monetary value is present and valid.",{lineNumber:index+1});
    }

    if(!lineCurrency) fail(prefix+" item currency","itemPrice_SAD42Currency","fail",line.currency,"3-letter ISO currency code","Line currency is missing.",{lineNumber:index+1});
    else if(!CURRENCY.test(lineCurrency)) fail(prefix+" item currency","itemPrice_SAD42Currency","fail",lineCurrency,"3-letter ISO currency code","Line currency must be a three-letter ISO code.",{lineNumber:index+1});
    else if(currency&&lineCurrency!==currency) fail(prefix+" item currency","itemPrice_SAD42Currency","fail",lineCurrency,currency,"Line currency does not match the header invoice currency.",{lineNumber:index+1});
    else pass(prefix+" item currency","itemPrice_SAD42Currency","pass",lineCurrency,"3-letter ISO currency code","Line currency is valid.",{lineNumber:index+1});

    if(net===null) fail(prefix+" net weight","netMass_SAD38","fail",line._netMass,"non-negative kg value","Working net weight is missing.",{lineNumber:index+1});
    else if(net<0) fail(prefix+" net weight","netMass_SAD38","fail",net,"non-negative kg value","Working net mass cannot be negative.",{lineNumber:index+1});
    else {lineNet+=net;pass(prefix+" net weight","netMass_SAD38","pass",net,"non-negative kg value","Working net weight is valid.",{lineNumber:index+1});}

    if(gross===null) fail(prefix+" gross weight","grossMass_SAD35","fail",line._grossMass,"non-negative kg value","Working gross weight is missing.",{lineNumber:index+1});
    else if(gross<0) fail(prefix+" gross weight","grossMass_SAD35","fail",gross,"non-negative kg value","Working gross mass cannot be negative.",{lineNumber:index+1});
    else {lineGross+=gross;pass(prefix+" gross weight","grossMass_SAD35","pass",gross,"non-negative kg value","Working gross weight is valid.",{lineNumber:index+1});}

    if(net!==null&&gross!==null&&net>gross) fail(prefix+" weight relationship","netMass_SAD38/grossMass_SAD35","fail",`${net}/${gross}`,"net weight <= gross weight","Net weight cannot exceed gross weight.",{lineNumber:index+1});
    else if(net!==null&&gross!==null) pass(prefix+" weight relationship","netMass_SAD38/grossMass_SAD35","pass",`${net}/${gross}`,"net weight <= gross weight","Net/gross relationship is valid.",{lineNumber:index+1});
  });

  if(lines.length&&lines.every((line,index)=>numberValue(line._lineNumber)===index+1)){
    pass("Goods line sequence","sequentialNo_SAD32","pass",lines.map(x=>x._lineNumber).join(", "),"1..n sequential numbering","Goods lines are sequential.");
  }

  const weightConflicts=[];
  if(packingDoc&&lines.length){
    lines.forEach((line,index)=>{
      const pl=findSourceLine(packingDoc,line);
      if(!pl)return;
      const invNet=numberValue(line.netMassKg);
      const invGross=numberValue(line.grossMassKg);
      const plNet=numberValue(pl.netMassKg);
      const plGross=numberValue(pl.grossMassKg);
      if((invNet!==null&&plNet!==null&&Math.abs(invNet-plNet)>0.0001)||(invGross!==null&&plGross!==null&&Math.abs(invGross-plGross)>0.0001)) weightConflicts.push(index+1);
    });
    if(weightConflicts.length&&!selectedWeightSource) review("Weight source decision","weightSourceDecision","review","", "Commercial Invoice or Packing List","Line-level weights differ between the Commercial Invoice and Packing List. Select the source to use before posting.",{lineNumbers:weightConflicts});
    else if(weightConflicts.length&&selectedWeightSource) pass("Weight source decision","weightSourceDecision", "pass", selectedWeightSource, "Commercial Invoice or Packing List","Weight discrepancy has been resolved by selecting a working source.");
    else pass("Weight source decision","weightSourceDecision","pass",selectedWeightSource||"No discrepancy","No unresolved weight discrepancy","No conflicting line-level weights were found between the available documents.");
  }

  if(lines.length&&totalNet!==null){
    const missingNetLines=lines.map((line,index)=>numberValue(line._netMass)===null?index+1:null).filter(Boolean);
    if(missingNetLines.length){
      review("Net weight line discrepancy","netMass_SAD38","review",missingNetLines.join(", "),"Every item line has net weight when a total net weight exists","Total net weight ("+totalNet+" kg) exists, but net weight is missing from item line(s): "+missingNetLines.join(", ")+". Confirm the source document before posting.",{lineNumbers:missingNetLines,expected:totalNet});
    }else{
      const difference=Math.abs(lineNet-totalNet);
      if(difference>0.01) fail("Net weight total reconciliation","totalNetWeight","fail",`${lineNet} vs ${totalNet}`,"line net total matches header total","Working line net weight total does not reconcile to the header net weight.",{expected:totalNet});
      else pass("Net weight total reconciliation","totalNetWeight","pass",lineNet,"line net total matches header total","Working line net weight total reconciles to the header net weight.");
    }
  }

  if(lines.length&&totalGross!==null){
    const missingGrossLines=lines.map((line,index)=>numberValue(line._grossMass)===null?index+1:null).filter(Boolean);
    if(missingGrossLines.length){
      review("Gross weight line discrepancy","grossMass_SAD35","review",missingGrossLines.join(", "),"Every item line has gross weight when a total gross weight exists","Total gross weight ("+totalGross+" kg) exists, but gross weight is missing from item line(s): "+missingGrossLines.join(", ")+". Confirm the source document before posting.",{lineNumbers:missingGrossLines,expected:totalGross});
    }else{
      const difference=Math.abs(lineGross-totalGross);
      if(difference>0.01) fail("Gross weight total reconciliation","totalGrossWeight","fail",`${lineGross} vs ${totalGross}`,"line gross total matches header total","Working line gross weight total does not reconcile to the header gross weight.",{expected:totalGross});
      else pass("Gross weight total reconciliation","totalGrossWeight","pass",lineGross,"line gross total matches header total","Working line gross weight total reconciles to the header gross weight.");
    }
  }

  const invoiceTotal=numberValue(data.totalInvoicedAmount??data.totalAmountInvoiced??data.totalInvoiceValue);
  const freightAmount=numberValue(data.freightAmount);
  const freightCurrency=text(data.freightCurrency||currency).toUpperCase();

  if(invoiceTotal!==null&&allLineValuesNumeric){
    const freightSameCurrency=freightAmount!==null&&freightCurrency&&currency&&freightCurrency===currency;
    const freightIncluded=freightSameCurrency?freightAmount:0;
    const expectedInvoiceTotal=lineValue+freightIncluded;
    const difference=Math.abs(expectedInvoiceTotal-invoiceTotal);

    if(difference>0.01){
      const detail=freightAmount!==null&&freightCurrency!==currency
        ? "Goods line total ("+lineValue+") does not reconcile to invoice total ("+invoiceTotal+"). Freight of "+freightAmount+" "+freightCurrency+" has been excluded because it is in a different currency from the invoice ("+currency+")."
        : freightSameCurrency
          ? "Goods line total ("+lineValue+") + freight ("+freightAmount+" "+freightCurrency+") does not reconcile to invoice total ("+invoiceTotal+")."
          : "Goods line total ("+lineValue+") does not reconcile to invoice total ("+invoiceTotal+"), and no same-currency freight charge was included.";
      fail("Invoice amount reconciliation","totalInvoicedAmount","fail",expectedInvoiceTotal+" vs "+invoiceTotal,"goods lines + same-currency freight reconcile to invoice total",detail,{expected:invoiceTotal,lineTotal:lineValue,freightAmount:freightIncluded,freightIgnored:freightAmount!==null&&!freightSameCurrency});
    }else{
      pass("Invoice amount reconciliation","totalInvoicedAmount","pass",expectedInvoiceTotal,"goods lines + same-currency freight reconcile to invoice total",
        freightSameCurrency
          ? "Goods line total ("+lineValue+") + same-currency freight ("+freightAmount+" "+freightCurrency+") reconciles to invoice total ("+invoiceTotal+")."
          : freightAmount!==null&&freightCurrency!==currency
            ? "Goods line total ("+lineValue+") reconciles to invoice total ("+invoiceTotal+"). Freight is in "+freightCurrency+" and has been excluded from the invoice-total reconciliation because the invoice is "+currency+"."
            : "Goods line total ("+lineValue+") reconciles to invoice total ("+invoiceTotal+"); no separate same-currency freight charge is present.");
    }
  }

  return {
    checks,
    summary:{
      total:checks.length,
      pass:checks.filter(x=>x.status==="pass").length,
      fail:checks.filter(x=>x.status==="fail").length,
      review:checks.filter(x=>x.status==="review").length,
      notApplicable:checks.filter(x=>x.status==="not_applicable").length
    }
  };
}

export default validateStandardCustomsRecord;
