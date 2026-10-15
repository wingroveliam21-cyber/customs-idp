import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity, AlertCircle, ArrowRight, Bot, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, FileText,
  Inbox, Mail, Menu, MoreHorizontal, Package, Plus, Search, Settings, ShieldCheck, Sparkles, Users, X, Zap
} from "lucide-react";
import { validateStandardCustomsRecord } from "../../validation/standardEngine.js";
import { DEFAULT_ORGANISATION } from "../../tenant.js";
import { supabase } from "../../lib/supabase.js";
import { customerStrategyStore, customers, getCustomerStrategy, normalizeCountryCode, sampleLines } from "../../domain/packData.js";
import { getUploadedDocument } from "../../services/documentStorage.js";
import { NavItem, SpreadsheetPreview, Status } from "../SharedComponents.jsx";
import { Dashboard, ManagerPage } from "./DashboardPages.jsx";
import { InboxPage } from "./InboxPage.jsx";
import { Customers } from "./CustomersPage.jsx";
import { formatReceivedDateTime, getPackColumnValue, getPackCustomerLabel, getPackDisplayName, reconcilePackDocuments } from "../../domain/packView.js";



function Review({pack,currentUserName,back,notify,onAssign,updatePack,validatePack,postToLCA,reprocessPack,persistPack,persistValidatedPack,recordHistory}){
 const [docUrls,setDocUrls]=useState({});
 const [chat,setChat]=useState("");
 const [messages,setMessages]=useState([]);
 const [isSending,setIsSending]=useState(false);
 const chatHistoryRef=useRef(null);
 const [selectedDocumentId,setSelectedDocumentId]=useState(null);
 const [previewPage,setPreviewPage]=useState(1);
 const [showPreview,setShowPreview]=useState(false);
 const autoScrollChatRef=useRef(false);
 const isChatNearBottom=()=>{
   const el=chatHistoryRef.current;
   if(!el)return false;
   return el.scrollHeight-el.scrollTop-el.clientHeight<=80;
 };
 useEffect(()=>{
   const el=chatHistoryRef.current;
   if(!el||!autoScrollChatRef.current)return;
   const frame=requestAnimationFrame(()=>{
     el.scrollTop=el.scrollHeight;
     const lastMessage=messages[messages.length-1];
     if(lastMessage?.type==="agent"&&lastMessage?.text&&lastMessage.text!=="I'm checking the uploaded documents and their source evidence..."){
       autoScrollChatRef.current=false;
     }
   });
   return()=>cancelAnimationFrame(frame);
 },[messages]);
 const [showSummary,setShowSummary]=useState(false);
 const [showEmailSource,setShowEmailSource]=useState(false);
 const [history,setHistory]=useState([]);
 useEffect(()=>{let active=true;(async()=>{try{const r=await fetch("/api/history?packId="+encodeURIComponent(pack.id),{credentials:"include"}),d=await r.json();if(active&&r.ok)setHistory(Array.isArray(d.history)?d.history:[])}catch{}})();return()=>{active=false}},[pack.id,pack.status,pack.assignedTo,pack.validationStatus,pack.postedToLCAAt,pack.extractedData?.reviewOverrides?.length]);

 const [emailDraft,setEmailDraft]=useState(null);
 const [showCreateCustomer,setShowCreateCustomer]=useState(false);
 const [createCustomerForm,setCreateCustomerForm]=useState({name:""});
 const [createCustomerError,setCreateCustomerError]=useState("");
 const [creatingCustomer,setCreatingCustomer]=useState(false);
 const [customerSetupDeclined,setCustomerSetupDeclined]=useState(false);

 useEffect(()=>{
  let active=true;
  (async()=>{
    const entries=await Promise.all((pack.uploadedFiles||[]).map(async f=>{
      try{
        if(f.storagePath){
          const response=await fetch("/api/storage",{
            method:"POST",
            headers:{"Content-Type":"application/json"},
            credentials:"include",
            body:JSON.stringify({action:"signed-url",fileId:f.id,packId:pack.id})
          });
          const data=await response.json();
          if(response.ok&&data.accessUrl){
            return [f.id,data.accessUrl];
          }
        }
        const file=await getUploadedDocument(f.id);
        return file?[f.id,URL.createObjectURL(file)]:null;
      }catch{return null;}
    }));
    if(active)setDocUrls(Object.fromEntries(entries.filter(Boolean)));
  })();
  return()=>{active=false;};
},[pack.id,pack.uploadedFiles]);

 const documentRows=pack.uploadedFiles?.length?pack.uploadedFiles:[
   {id:"sample-1",name:"Commercial Invoice 88421.pdf"},{id:"sample-2",name:"Packing List 88421.pdf"},
   {id:"sample-3",name:"Certificate of Origin.pdf"},{id:"sample-4",name:"Transport Document.pdf"}
 ];
 const extractedDocuments=useMemo(()=>{
   const stored=Array.isArray(pack.extractedData?.documents)?pack.extractedData.documents:[];
   if(stored.length)return stored;
   const primary=pack.extractedData&&Object.keys(pack.extractedData).length?pack.extractedData:null;
   if(!primary)return [];
   const fallbackFile=pack.uploadedFiles?.[0];
   if(!fallbackFile)return [];
   return [{
     id:fallbackFile.id||fallbackFile.name,
     filename:fallbackFile.name,
     mimeType:fallbackFile.type||"application/octet-stream",
     extraction:primary
   }];
 },[pack.id,pack.extractedData,pack.uploadedFiles]);
 const evidenceFor=doc=>{const e=doc?.extraction||{};const all=[...(e.fieldEvidence||[])];(e.lines||[]).forEach(line=>(line.evidence||[]).forEach(x=>all.push(x)));return all;};
 const getEvidence=(doc,fields=[])=>{const ev=evidenceFor(doc);return ev.find(x=>fields.includes(x.field)&&x.page)||ev.find(x=>x.page);};
 const getWeightConflicts=()=>{
   const docs=extractedDocuments;
   const invoiceDoc=docs.find(d=>d.extraction?.documentType==="commercial_invoice")||docs[0];
   // The customs summary is the human-facing working record. Start from the original invoice extraction, then overlay all user/agent corrections from the working pack data.
   const workingData={...(pack.workingRecord||pack.extractedData||{})};
   const primaryAliases={exporterEori:"exporterEoriNo",eori:"exporterEoriNo",exporterEORI:"exporterEoriNo",invoiceTotal:"totalInvoiceValue",invoiceValue:"totalInvoiceValue",countryOfExportCode:"countryOfExport",destinationCountry:"sourceCountryOfDestination"};
   Object.entries(primaryAliases).forEach(([from,to])=>{if((workingData[to]===undefined||workingData[to]===null||workingData[to]==="")&&workingData[from]!==undefined&&workingData[from]!==null&&workingData[from]!=="")workingData[to]=workingData[from];});
   const reviewOverrides=Array.isArray(workingData.reviewOverrides)?workingData.reviewOverrides:[];
   reviewOverrides.filter(o=>o?.scope==="primary"&&o?.field).forEach(o=>{if(o.newValue!==undefined)workingData[o.field]=o.newValue;});
   const invoice={...(invoiceDoc?.extraction||{}),...workingData};
   const packingDoc=docs.find(d=>/packing/i.test(d.filename||""))||docs.find(d=>d.extraction?.documentType==="packing_list");
   if(!invoiceDoc||!packingDoc)return [];
   const invoiceLines=Array.isArray(invoice.lines)?invoice.lines:[];
   const sourceLines=Array.isArray(packingDoc.extraction?.lines)?packingDoc.extraction.lines:[];
   const key=line=>String(line?.hsCode||"")+"|"+String(line?.description||"").trim().toLowerCase();
   return invoiceLines.map(inv=>{
     const line=sourceLines.find(x=>key(x)===key(inv))||sourceLines.find(x=>String(x?.description||"").trim().toLowerCase()===String(inv?.description||"").trim().toLowerCase());
     if(!line)return null;
     const netDifferent=inv?.netMassKg!=null&&line?.netMassKg!=null&&String(inv.netMassKg)!==String(line.netMassKg);
     const grossDifferent=inv?.grossMassKg!=null&&line?.grossMassKg!=null&&String(inv.grossMassKg)!==String(line.grossMassKg);
     return netDifferent||grossDifferent?{doc:packingDoc,line,invoice:inv}:null;
   }).filter(Boolean);
 };
 const sourceButton=(label,docId,page)=><button type="button" className="source-reference" onClick={()=>{setSelectedDocumentId(docId);setPreviewPage(Number(page)||1);setShowPreview(true);}}>{label}</button>;

 const buildSummary=()=>{
   const docs=extractedDocuments;
   const invoiceDoc=docs.find(d=>d.extraction?.documentType==="commercial_invoice")||docs[0];
   const workingData={...(pack.workingRecord||pack.extractedData||{})};
   const hasOwn=(obj,key)=>Object.prototype.hasOwnProperty.call(obj,key);
   const primaryOverrides=Array.isArray(workingData.reviewOverrides)?workingData.reviewOverrides.filter(o=>o?.scope==="primary"&&o?.field):[];
   primaryOverrides.forEach(o=>{if(o.newValue!==undefined)workingData[o.field]=o.newValue;});
   const primaryAliases={exporterEori:"exporterEoriNo",eori:"exporterEoriNo",exporterEORI:"exporterEoriNo",invoiceTotal:"totalInvoiceValue",invoiceValue:"totalInvoiceValue"};
   Object.entries(primaryAliases).forEach(([from,to])=>{if(!hasOwn(workingData,to)&&hasOwn(workingData,from))workingData[to]=workingData[from];});
   const invoice={...(invoiceDoc?.extraction||{}),...workingData};
   const value=v=>v===undefined||v===null||v===""?"":String(v);
   const hasValue=v=>v!==undefined&&v!==null&&v!=="";
   if(!docs.length){
     return [{type:"agent",text:pack.processingError?"I couldn't complete the extraction. "+pack.processingError:"I'm waiting for document extraction to finish."}];
   }

   const supportingDocs=docs.filter(d=>d!==invoiceDoc);
   const packingDoc=supportingDocs.find(d=>/packing/i.test(d.filename||""))||supportingDocs[0];
   const sourceFor=doc=>{
     const ev=evidenceFor(doc);
     return ev.find(x=>x.page)?.page||1;
   };
   const lineKey=line=>String(line?.hsCode||"")+"|"+String(line?.description||"").trim().toLowerCase();
   const lines=Array.isArray(pack.workingRecord?.lines)?pack.workingRecord.lines:(Array.isArray(pack.extractedData?.lines)?pack.extractedData.lines:(Array.isArray(invoice.lines)?invoice.lines:[]));
   const findSourceLine=(doc,invLine)=>{
     const sourceLines=Array.isArray(doc?.extraction?.lines)?doc.extraction.lines:[];
     return sourceLines.find(l=>lineKey(l)===lineKey(invLine))||sourceLines.find(l=>String(l.description||"").trim().toLowerCase()===String(invLine.description||"").trim().toLowerCase());
   };

   const weightApportionmentDecision=pack.extractedData?.weightApportionmentDecision?.status||null;
   const customerStrategy=getCustomerStrategy(pack.customer);
   const hasDocumentLevelWeights=hasValue(invoice.totalNetWeight)||hasValue(invoice.totalGrossWeight);
   const hasMissingLineWeights=lines.length>0&&lines.some(line=>!hasValue(line.netMassKg)&&!hasValue(line.netWeight)&&!hasValue(line.netMass));
   const shouldAskWeightApportionment=hasDocumentLevelWeights&&hasMissingLineWeights&&!weightApportionmentDecision&&!customerStrategy.autoApplyWeightApportionment;
   const selectedWeightSource=pack.extractedData?.weightSourceDecision?.source||null;
   const customsLines=lines.map((line,index)=>{
     const plLine=packingDoc?findSourceLine(packingDoc,line):null;
     const workingNet=selectedWeightSource==="packing_list"?plLine?.netMassKg:(line.netMassKg??line.netWeight??line.netMass);
     const workingGross=selectedWeightSource==="packing_list"?plLine?.grossMassKg:(line.grossMassKg??line.grossWeight??line.grossMass);
     return {
       no:index+1,
       description:value(line.description)||"Unnamed goods line",
       hs:String(line.hsCode??"").replace(/[.\s-]/g,""),
       origin:value(line.sourceCountryCode),
       quantity:value(line.quantity),
       net:value(workingNet),
       gross:value(workingGross),
       itemValue:value(line.totalValue)
     };
   });

   const conflicts=[];
   customsLines.forEach((row,index)=>{
     const invLine=lines[index];
     const plLine=packingDoc?findSourceLine(packingDoc,invLine):null;
     if(!plLine)return;
     const netDifferent=hasValue(invLine?.netMassKg)&&hasValue(plLine?.netMassKg)&&String(invLine.netMassKg)!==String(plLine.netMassKg);
     const grossDifferent=hasValue(invLine?.grossMassKg)&&hasValue(plLine?.grossMassKg)&&String(invLine.grossMassKg)!==String(plLine.grossMassKg);
     if(netDifferent||grossDifferent)conflicts.push({doc:packingDoc,line:plLine,invoice:invLine});
   });

   const checks=[
     {label:"Invoice number",status:hasValue(invoice.invoiceNumber)?"pass":"warning",detail:hasValue(invoice.invoiceNumber)?value(invoice.invoiceNumber):"Not extracted"},
     {label:"Exporter",status:hasValue(invoice.exporter)?"pass":"warning",detail:hasValue(invoice.exporter)?value(invoice.exporter):"Not extracted"},
     {label:"Consignee",status:hasValue(invoice.consignee)?"pass":"warning",detail:hasValue(invoice.consignee)?value(invoice.consignee):"Not extracted"},
     {label:"HS codes",status:lines.every(l=>hasValue(l.hsCode))?"pass":"warning",detail:lines.every(l=>hasValue(l.hsCode))?"All goods lines have HS codes.":"One or more goods lines are missing an HS code."},
     {label:"Country of origin",status:lines.every(l=>hasValue(l.sourceCountryCode))?"pass":"warning",detail:lines.every(l=>hasValue(l.sourceCountryCode))?"All goods lines have an origin code.":"One or more goods lines are missing an origin code."},
     {label:"Weight comparison",status:conflicts.length?(pack.extractedData?.weightSourceDecision?"pass":"warning"):"pass",detail:conflicts.length?(pack.extractedData?.weightSourceDecision?"Source selected: "+(pack.extractedData.weightSourceDecision.source==="packing_list"?"Packing List":"Commercial Invoice")+". Working weights have been updated.":"Line-level weight differences found between the invoice and packing list — a source must be selected."):"No line-level weight discrepancies found."}
   ];

   const exportCountry=value(invoice.countryOfExport).trim().toUpperCase();
   const exporterCountryIso=value(invoice.exporterCountryIso).trim().toUpperCase();
   const exporterAddress=value(invoice.exporterAddress);
   const isGBExporter=exportCountry==="GB"||exporterCountryIso==="GB"||/(?:^|[\\n, ])(?:GB|UK|UNITED KINGDOM)(?:$|[\\n, ])/i.test(exporterAddress);
   const agentIssues=[];
   if(isGBExporter&&!hasValue(invoice.exporterEoriNo)){
     agentIssues.push({
       title:"GB exporter EORI missing",
       detail:"The exporter appears to be in Great Britain, but no EORI number was extracted. Check the commercial invoice for the EORI number. If it is present, tell me where it appears or re-process the document.",
       sourceDocumentId:invoiceDoc?.id||null,
       sourcePage:sourceFor(invoiceDoc)
     });
   }
   const missingExporterAddressFields=[
     !hasValue(invoice.exporterAddressLine1)?"Address line 1":null,
     !hasValue(invoice.exporterPostcode)?"Postcode/ZIP":null,
     !hasValue(invoice.exporterCity)?"City":null,
     !hasValue(invoice.exporterCountryIso)?"Country ISO":null
   ].filter(Boolean);
   if(missingExporterAddressFields.length){
     agentIssues.push({
       title:"Exporter address incomplete",
       detail:"Missing structured field(s): "+missingExporterAddressFields.join(", ")+". The full exporter address is still shown below; check the commercial invoice and correct only the missing component(s) before posting to LCA.",
       sourceDocumentId:invoiceDoc?.id||null,
       sourcePage:sourceFor(invoiceDoc)
     });
   }
   if(conflicts.length&&!pack.extractedData?.weightSourceDecision){
     agentIssues.push({
       title:"Weight discrepancy needs a decision",
       detail:"The commercial invoice and packing list contain different weights. Choose the source to use for the customs entry, or email the customer for confirmation.",
       sourceDocumentId:packingDoc?.id||null,
       sourcePage:sourceFor(packingDoc)
     });
   }

   return [
     {type:"agent",text:"I've combined the document pack into one customs-entry summary. The table shows the working customs weights only; the selected source is recorded separately so the declaration is not carrying duplicate PKL/CIV weight columns.",persist:false},
     ...(agentIssues.length?[{
       type:"agentIssues",
       issues:agentIssues,
       persist:false
     }]:[]),
     {
       type:"customsEntrySummary",
       summary:{
         invoice:value(invoice.invoiceNumber),exporter:value(invoice.exporter),consignee:value(invoice.consignee),
         currency:value(invoice.currency),invoiceValue:value(invoice.totalInvoiceValue),exportCountry:value(invoice.countryOfExport),exporterAddress:value(invoice.exporterAddress),exporterAddressLine1:value(invoice.exporterAddressLine1),exporterPostcode:value(invoice.exporterPostcode),exporterCity:value(invoice.exporterCity),exporterCountryIso:value(invoice.exporterCountryIso),exporterEoriNo:value(invoice.exporterEoriNo),consigneeAddress:value(invoice.consigneeAddress),consigneeAddressLine1:value(invoice.consigneeAddressLine1),consigneePostcode:value(invoice.consigneePostcode),consigneeCity:value(invoice.consigneeCity),consigneeCountryIso:value(invoice.consigneeCountryIso),
         destination:value(invoice.sourceCountryOfDestination),packages:value(invoice.totalPackages),
         gross:value(selectedWeightSource==="packing_list"?(packingDoc?.extraction?.totalGrossWeight??invoice.totalGrossWeight):invoice.totalGrossWeight),
         net:value(selectedWeightSource==="packing_list"?(packingDoc?.extraction?.totalNetWeight??invoice.totalNetWeight):invoice.totalNetWeight),
         freightAmount:value(invoice.freightAmount),
         freightCurrency:value(invoice.freightCurrency||invoice.currency),
         freightExchangeRate:value(invoice.freightToInvoiceExchangeRate),
         deliveryTerm:value(invoice.deliveryTerm),lines:customsLines,
         sourceLabel:invoiceDoc?.filename||"Commercial Invoice",sourceDocumentId:invoiceDoc?.id||null,sourcePage:sourceFor(invoiceDoc),weightSourceDecision:pack.extractedData?.weightSourceDecision?.source||null
       },
       persist:false
     },
     {type:"validationSummary",checks:Array.isArray(pack.validationChecks)?pack.validationChecks:validateStandardCustomsRecord(pack.workingRecord||pack.extractedData||{}).checks,persist:false},
     ...(shouldAskWeightApportionment?[{
       type:"weightApportionmentDecision",
       text:"The document contains total weight information, but line-level weights are missing. I can apportion the total net weight across the goods lines using the configured line-value method, then apportion gross weight using the resulting net-weight ratio. Would you like me to apply this for this pack? If this customer strategy is configured to allow automatic apportionment, I will apply it without asking.",
       persist:false
     }]:[]),
     ...(conflicts.length&&!pack.extractedData?.weightSourceDecision?[{
       type:"weightDecision",
       text:"Weight discrepancy detected. The invoice and packing list contain different line-level weights. No value has been silently chosen.",
       conflicts,
       persist:false
     }]:[])
   ];
 };
 useEffect(()=>{
   const saved=Array.isArray(pack.extractedData?.agentMessages)?pack.extractedData.agentMessages:[];
   const weightResolved=Boolean(pack.extractedData?.weightSourceDecision?.source);
   const cleanedSaved=saved.filter(m=>!(weightResolved&&((m.type==="weightDecision")||/weight discrepancy detected/i.test(String(m.text||"")))));
   setMessages([...buildSummary().filter(message=>message.type!=="customsEntrySummary"),...cleanedSaved.filter(saved=>saved.type!=="customsEntrySummary")]);
 },[pack.id,pack.extractedData,pack.workingRecord,pack.validationStatus,pack.validationChecks,extractedDocuments]);
 useEffect(()=>{if(!documentRows.length){setSelectedDocumentId(null);return;}setSelectedDocumentId(current=>documentRows.some(d=>(d.id||d.name)===current)?current:(documentRows[0].id||documentRows[0].name));},[pack.id,pack.uploadedFiles?.length]);
 const selectedDocument=documentRows.find(d=>(d.id||d.name)===selectedDocumentId)||documentRows[0];
 const selectedDocumentUrl=selectedDocument?docUrls[selectedDocument.id]:null;
 const selectedDocumentIsPdf=/\.pdf$/i.test(selectedDocument?.name||"");
 const selectedDocumentIsImage=/^image\//i.test(selectedDocument?.type||"")||/\.(png|jpe?g|webp|gif)$/i.test(selectedDocument?.name||"");
 const selectedDocumentIsSpreadsheet=/\.(xlsx|xls|xlsm|xlsb|csv)$/i.test(selectedDocument?.name||"")||/spreadsheet|excel|csv/i.test(selectedDocument?.type||"");
 const selectedDocumentFrameUrl=selectedDocumentUrl&&selectedDocumentIsPdf?selectedDocumentUrl+"#page="+previewPage+"&view=FitH&zoom=page-width":selectedDocumentUrl;

 const applyAgentAction=action=>{
   if(!action||action.kind!=="update_field")return null;
   const target=action.target||{}, data=JSON.parse(JSON.stringify(pack.extractedData||{}));
   if(target.scope==="line"&&Number.isInteger(target.lineIndex)&&data.lines?.[target.lineIndex]){
     const line=data.lines[target.lineIndex];
     const oldValue=line[target.field];
     line[target.field]=target.value;
     data.reviewOverrides=[...(data.reviewOverrides||[]),{scope:"line",lineIndex:target.lineIndex,field:target.field,oldValue,newValue:target.value,sourceDocumentId:target.sourceDocumentId||null,sourcePage:target.sourcePage||null,createdAt:new Date().toISOString()}];
   }else if(target.scope==="primary"&&target.field){
     const oldValue=data[target.field];
     data[target.field]=target.value;
     data.reviewOverrides=[...(data.reviewOverrides||[]),{scope:"primary",field:target.field,oldValue,newValue:target.value,sourceDocumentId:target.sourceDocumentId||null,sourcePage:target.sourcePage||null,createdAt:new Date().toISOString()}];
   }else return null;
   updatePack?.({...pack,extractedData:data,status:"Needs review",validationStatus:undefined,validationChecks:undefined,postedToLCAAt:undefined});
   return "I saved that correction to the pack and cleared the previous validation result. The affected data needs to be validated again.";
 };
 const applySuggestedFields=(suggestions,messageIndex)=>{
   const valid=Array.isArray(suggestions)?suggestions.filter(s=>s&&(s.scope==="line"||s.scope==="primary")&&s.field&&s.value!==""):[],
     data=JSON.parse(JSON.stringify(pack.extractedData||{}));
   let applied=0;
   const now=new Date().toISOString();
   valid.forEach(suggestion=>{
     let existing=null;
     if(suggestion.scope==="line"){
       const line=data.lines?.[suggestion.lineIndex];
       if(!line)return;
       existing=line[suggestion.field];
       if(existing!==undefined&&existing!==null&&String(existing).trim()!=="")return;
       line[suggestion.field]=suggestion.value;
     }else{
       existing=data[suggestion.field];
       if(existing!==undefined&&existing!==null&&String(existing).trim()!=="")return;
       data[suggestion.field]=suggestion.value;
     }
     data.reviewOverrides=[...(data.reviewOverrides||[]),{
       scope:suggestion.scope,
       lineIndex:suggestion.scope==="line"?suggestion.lineIndex:null,
       field:suggestion.field,
       oldValue:existing??null,
       newValue:suggestion.value,
       source:"email",
       sourceLabel:suggestion.sourceLabel||"Email body",
       sourceDocumentId:suggestion.sourceDocumentId||null,
       sourcePage:suggestion.sourcePage||null,
       reason:suggestion.reason||"Value confirmed by the user from the email source.",
       createdAt:now
     }];
     applied++;
   });
   const confirmation={type:"agent",text:"Confirmed. I added "+applied+" email-sourced field"+(applied===1?"":"s")+" to the working customs data. The previous validation result was cleared; run Validate data to check the updated pack.",persist:true};
   const updatedMessages=messages.map((m,index)=>index===messageIndex?{...m,handled:"applied"}:m).concat(confirmation);
   data.agentMessages=updatedMessages.filter(m=>m.persist!==false).map(serialiseMessage);
   const next={...pack,extractedData:data,status:"Needs review",validationStatus:undefined,validationChecks:undefined,postedToLCAAt:undefined};
   updatePack?.(next);recordHistory?.(next,"amended","Added user-confirmed email-sourced customs data",null,{suggestions:valid.map(s=>({scope:s.scope,lineIndex:s.lineIndex??null,field:s.field,value:s.value}))},{source:"email"});
   setMessages(updatedMessages);
   notify?.(applied?"Added "+applied+" email-sourced field"+(applied===1?"":"s")+" to the pack":"No new email-sourced fields were added");
 };
 const ignoreSuggestedFields=(messageIndex)=>{
   setMessages(current=>[...current.map((m,index)=>index===messageIndex?{...m,handled:"ignored"}:m),{type:"agent",text:"Understood. I left the extracted document data unchanged and did not add the email values.",persist:true}]);
 };
 const serialiseMessage=m=>({
   type:m.type||"agent",text:m.text||"",sourceDocumentId:m.sourceDocumentId||null,
   sourcePage:Number.isInteger(m.sourcePage)?m.sourcePage:null,sourceLabel:m.sourceLabel||null,
   suggestions:Array.isArray(m.suggestions)?m.suggestions:null,handled:m.handled||null
 });
 const persistConversation=async conversation=>{
   const data=JSON.parse(JSON.stringify(pack.extractedData||{}));
   data.agentMessages=conversation.filter(m=>m.persist!==false).map(serialiseMessage);
   const nextPack={...pack,extractedData:data};
   const saved=await persistPack?.(nextPack);
   if(!saved) notify?.("Chat history could not be saved to the database");
   return saved;
 };
 const sendChat=async()=>{
   const q=chat.trim();if(!q||isSending)return;
   autoScrollChatRef.current=isChatNearBottom();
   const userMessage={type:"user",text:q,persist:true};
   const thinking={type:"agent",text:"I'm checking the uploaded documents and their source evidence...",persist:false};
   const conversationBefore=[...messages,userMessage];
   setIsSending(true);setMessages([...conversationBefore,thinking]);setChat("");
   try{
     const response=await fetch("/api/agent",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({message:q,pack:{...pack,customerStrategy:pack.customerStrategy||pack.extractedData?.customerStrategy||getCustomerStrategy(pack.customerId||pack.customer),conversation:conversationBefore.slice(-12).map(m=>({type:m.type||"agent",text:m.text||""})),extractedData:{...(pack.extractedData||{}),agentMessages:undefined}}})});
     const result=await response.json();
     if(!response.ok)throw new Error(result.error||"Agent request failed");
     let reply=result.reply||"I couldn't produce an answer from the supplied pack.";
     let savedPack=pack;
     if(result.action==="create_customer"){
       const name=String(result.target?.customerName||pack.customer||pack.extractedData?.exporter||pack.extractedData?.exporterName||"").trim();
       if(!name)throw new Error("The agent did not return a customer name.");
       const response=await fetch("/api/organisation",{method:"POST",credentials:"include",headers:{"Content-Type":"application/json"},body:JSON.stringify({name})});
       const data=await response.json().catch(()=>({}));
       if(!response.ok||!data.customer?.id)throw new Error(data.error||"Unable to create customer.");
       const nextData=JSON.parse(JSON.stringify(pack.extractedData||{}));
       nextData.customerIdentification={...(nextData.customerIdentification||{}),matched:true,ambiguous:false,possibleMatch:false,customerId:data.customer.id,customerName:data.customer.name,matchedBy:"agent-created"};
       savedPack={...pack,customer:data.customer.name,customerId:data.customer.id,customerStrategy:data.strategy?.config||{},customerStrategyApplied:false,customerStrategyVersion:data.strategy?.version||null,extractedData:nextData,status:"Needs review",validationStatus:undefined,validationChecks:undefined,postedToLCAAt:undefined};
       {const persisted=await persistPack?.(savedPack);if(!persisted)throw new Error("The customer was created, but the pack update conflicted with another change.");savedPack=persisted;}
       await recordHistory?.(savedPack,"customer_created_and_associated","Customer created by Review Agent and linked to current pack.",null,{customerId:data.customer.id,customerName:data.customer.name},null,"system","Customs IDP Agent");
       reply="Customer "+data.customer.name+" was created and linked to this pack.";
     }
     if(result.action==="save_customer_strategy"){
       const strategy=result.strategyProposal?.resultingStrategy;
       if(!strategy)throw new Error("The agent returned no complete strategy to save.");
       const customerId=pack.customerId||pack.extractedData?.customerIdentification?.customerId;
       const customerName=pack.customer||pack.extractedData?.customerIdentification?.customerName||result.target?.customerName||"";
       const response=await fetch("/api/organisation?action=customers",{credentials:"include"});
       const customerData=await response.json().catch(()=>({}));
       if(!response.ok)throw new Error(customerData.error||"Unable to load customers.");
       let customer=Array.isArray(customerData.customers)&&customerId?customerData.customers.find(item=>String(item.id)===String(customerId)):null;
       if(!customer&&Array.isArray(customerData.customers)&&customerName)customer=customerData.customers.find(item=>String(item.name||"").trim().toLowerCase()===customerName.trim().toLowerCase()&&String(item.status||"active").toLowerCase()==="active");
       if(!customer)throw new Error("I could not resolve the customer UUID required to save this strategy.");
       const saveResponse=await fetch("/api/organisation",{method:"PUT",credentials:"include",headers:{"Content-Type":"application/json"},body:JSON.stringify({customerId:customer.id,strategy})});
       const saveData=await saveResponse.json().catch(()=>({}));
       if(!saveResponse.ok||!saveData.strategy?.id)throw new Error(saveData.error||"Unable to save customer strategy.");
       const nextData=JSON.parse(JSON.stringify(pack.extractedData||{}));
       nextData.customerIdentification={...(nextData.customerIdentification||{}),matched:true,ambiguous:false,possibleMatch:false,customerId:customer.id,customerName:customer.name,matchedBy:nextData.customerIdentification?.matchedBy||"agent"};
       nextData.customerStrategy=saveData.strategy.config||strategy;
       nextData.customerStrategyApplied=true;
       nextData.customerStrategyVersion=saveData.strategy.version||null;
       const confirmation={type:"agent",text:"Customer strategy v"+String(saveData.strategy.version||"")+" was saved to "+customer.name+" and applied to this pack. It will be used automatically for future packs identified for this customer.",persist:true};
       nextData.agentMessages=[...(nextData.agentMessages||[]),confirmation];
       savedPack={...pack,customer:customer.name,customerId:customer.id,customerStrategy:saveData.strategy.config||strategy,customerStrategyApplied:true,customerStrategyVersion:saveData.strategy.version||null,extractedData:nextData,status:"Needs review",validationStatus:undefined,validationChecks:undefined,postedToLCAAt:undefined};
       {const persisted=await persistPack?.(savedPack);if(!persisted)throw new Error("The strategy was saved, but the pack update conflicted with another change.");savedPack=persisted;}
       await recordHistory?.(savedPack,"strategy_applied","Customer strategy saved and applied by Review Agent.",null,{customerId:customer.id,customerName:customer.name,version:saveData.strategy.version||null},null,"system","Customs IDP Agent");
       reply=confirmation.text;
     }
     if(result.action==="suggest_field_updates"&&Array.isArray(result.suggestions)&&result.suggestions.length){
       reply+=(/not changed|confirm/i.test(reply)?"":" I have not changed the extracted data. Please confirm below if you want these email-sourced values added.");
     }
     if(result.action==="approve_weight_apportionment"){
       const data=JSON.parse(JSON.stringify(pack.extractedData||{}));
       data.weightApportionmentDecision={
         status:"approved",
         approvedBy:currentUserName,
         approvedAt:new Date().toISOString(),
         method:"line-value net allocation, then net-ratio gross allocation",
         maxDecimalPlaces:3
       };
       savedPack={...pack,extractedData:data,status:"Needs review",validationStatus:undefined,validationChecks:undefined,postedToLCAAt:undefined};
       savedPack=typeof persistValidatedPack==="function"?await persistValidatedPack(savedPack):savedPack;
       reply+=" I applied the configured weight apportionment method: net weight by line value, then gross weight by the resulting net-weight ratio, rounded to a maximum of 3 decimal places. The derived line weights have been applied and the pack has been revalidated.";
     }
     if(result.action==="update_field"&&result.target){
       const target={...result.target};
       if(target.scope==="line"){
         const aliases={grossWeight:"grossMassKg",grossMass:"grossMassKg",gross_mass:"grossMassKg",netWeight:"netMassKg",netMass:"netMassKg",net_mass:"netMassKg"};
         target.field=aliases[target.field]||target.field;
         const explicitLine=q.match(/\bline\s*(\d+)\b/i);
         if(explicitLine) target.lineIndex=Number(explicitLine[1])-1;
       }
       const data=JSON.parse(JSON.stringify(pack.extractedData||{}));
       if(target.scope==="line"&&Number.isInteger(target.lineIndex)&&data.lines?.[target.lineIndex]) data.lines[target.lineIndex][target.field]=target.value;
       else if(target.scope==="primary"&&target.field) data[target.field]=target.value;
       else throw new Error("The agent returned an invalid correction target.");
       data.reviewOverrides=[...(data.reviewOverrides||[]),{scope:target.scope,field:target.field,lineIndex:target.lineIndex??null,oldValue:target.scope==="line"?pack.extractedData?.lines?.[target.lineIndex]?.[target.field]:pack.extractedData?.[target.field],newValue:target.value,sourceDocumentId:target.sourceDocumentId||null,sourcePage:target.sourcePage||null,createdAt:new Date().toISOString()}];
       savedPack={...pack,extractedData:data,status:"Needs review",validationStatus:undefined,validationChecks:undefined,postedToLCAAt:undefined};
       reply+=" I saved that correction to the pack and cleared the previous validation result. The affected data needs to be validated again.";
     }
     const agentMessage={
       type:result.action==="suggest_field_updates"?"fieldSuggestion":"agent",
       text:reply,
       sourceDocumentId:result.target?.sourceDocumentId||null,
       sourcePage:result.target?.sourcePage||null,
       suggestions:Array.isArray(result.suggestions)?result.suggestions:[],
       handled:null,
       persist:true
     };
     const completed=[...conversationBefore,agentMessage];
     setMessages(completed);
     const data=JSON.parse(JSON.stringify(savedPack.extractedData||{}));
     data.agentMessages=completed.filter(m=>m.persist!==false).map(serialiseMessage);
     const finalPack={...savedPack,extractedData:data};
     await updatePack?.(finalPack);
   }catch(error){
     const failed={type:"agent",text:"I couldn't reach the review agent. "+error.message,persist:true};
     const completed=[...conversationBefore,failed];
     setMessages(completed);
     const data=JSON.parse(JSON.stringify(pack.extractedData||{}));data.agentMessages=completed.filter(m=>m.persist!==false).map(serialiseMessage);
     const finalPack={...pack,extractedData:data};
     updatePack?.(finalPack);
   }finally{setIsSending(false);}
 };
 const decideWeightApportionment=async()=>{
   const data=JSON.parse(JSON.stringify(pack.extractedData||{}));
   data.weightApportionmentDecision={
     status:"approved",
     approvedBy:currentUserName,
     approvedAt:new Date().toISOString(),
     method:"line-value net allocation, then net-ratio gross allocation"
   };
   const next={...pack,extractedData:data,status:"Needs review",validationStatus:undefined,validationChecks:undefined,postedToLCAAt:undefined};
   const saved=await updatePack?.(next);
   if(!saved)return;
   await recordHistory?.(saved,"weight_apportionment","Approved weight apportionment",null,{method:"line-value net allocation, then net-ratio gross allocation"});
   notify?.("Weight apportionment approved — validating the derived line weights");
   if(typeof persistValidatedPack==="function") await persistValidatedPack(saved,true);
   else notify?.("Weight apportionment saved — press Validate data to run the checks");
 };
 const declineWeightApportionment=()=>{
   const data=JSON.parse(JSON.stringify(pack.extractedData||{}));
   data.weightApportionmentDecision={
     status:"declined",
     declinedBy:currentUserName,
     declinedAt:new Date().toISOString()
   };
   const next={...pack,extractedData:data,status:"Needs review",validationStatus:undefined,validationChecks:undefined,postedToLCAAt:undefined};
   updatePack?.(next);
   notify?.("Weight apportionment declined — line weights remain unresolved");
   setMessages(current=>[...current,{type:"agent",text:"Understood. I will not apportion the document-level weights. The pack will remain on review until line-level weights are provided or a different source is selected.",persist:true}]);
 };

 const decideWeights=(source,conflicts)=>{
   const data=JSON.parse(JSON.stringify(pack.extractedData||{}));
   const sourceLabel=source==="packing_list"?"Packing List":"Commercial Invoice";
   let changed=0;
   (data.lines||[]).forEach(inv=>{
     const match=conflicts.find(c=>String(c.invoice.description||"").trim().toLowerCase()===String(inv.description||"").trim().toLowerCase());
     if(!match)return;
     inv.netMassKg=source==="packing_list"?match.line.netMassKg:match.invoice.netMassKg;
     inv.grossMassKg=source==="packing_list"?match.line.grossMassKg:match.invoice.grossMassKg;
     inv.weightSource=source;
     changed++;
   });
   data.weightSourceDecision={source,sourceLabel,selectedAt:new Date().toISOString(),linesChanged:changed};
   data.weightSelectionStatus="resolved";
   const next={...pack,extractedData:data,status:"Needs review",validationStatus:undefined,validationChecks:undefined,postedToLCAAt:undefined};
   updatePack?.(next);recordHistory?.(next,"weight_source_selected",sourceLabel+" weights selected",null,{source,linesChanged:changed});
   notify?.(sourceLabel+" weights selected — "+changed+" line"+(changed===1?"":"s")+" updated");
 };
 const emailCustomerReview=checks=>{
   const currentChecks=Array.isArray(checks)?checks:validateStandardCustomsRecord(pack.extractedData||{}).checks;
   const missing=currentChecks.filter(check=>/missing|not extracted|required.*value/i.test(String(check.detail||check.message||"")));
   const conflicts=pack.extractedData?.weightSourceDecision?.source?[]:getWeightConflicts();
   if(!missing.length&&!conflicts.length)return;
   const displayValue=v=>v===undefined||v===null||v===""?"—":String(v);
   const sections=[];
   if(missing.length){
     sections.push("MISSING INFORMATION\\n\\n"+missing.map(check=>"- "+(check.label||check.check||"Required information")+": "+(check.detail||"Missing from the supplied documents.")).join("\\n"));
   }
   if(conflicts.length){
     sections.push("WEIGHT DISCREPANCY\\n\\nThe Commercial Invoice and Packing List contain different line-level weights. Please confirm which weights should be used for the customs declaration.\\n\\n"+conflicts.map(c=>"- "+(c.invoice.description||"Goods line")+": Commercial Invoice net "+displayValue(c.invoice.netMassKg)+" kg / gross "+displayValue(c.invoice.grossMassKg)+" kg; Packing List net "+displayValue(c.line.netMassKg)+" kg / gross "+displayValue(c.line.grossMassKg)+" kg.").join("\\n"));
   }
   const subject=missing.length&&conflicts.length
     ?"Customs IDP - information and weight confirmation required"
     :missing.length
       ?"Customs IDP - missing information required"
       :"Customs IDP - weight confirmation required";
   const body="Hello,\\n\\nWe are preparing your customs declaration and need the following information/confirmation before we can complete it.\\n\\n"+sections.join("\\n\\n")+"\\n\\nPlease provide the missing information and/or confirm the correct weights so we can complete the customs declaration.\\n\\nRegards\\nCustoms IDP";
   setEmailDraft({to:"",subject,body});
 };
 const renderMessage=(m,i)=>{
   const source=m.sourceDocumentId&&m.sourcePage?sourceButton(m.sourceLabel||("Source — page "+m.sourcePage),m.sourceDocumentId,m.sourcePage):null;
   if(m.type==="fieldSuggestion"&&Array.isArray(m.suggestions)){
     return <div className="chat-message-row agent" key={i}>
       <div className="chat-message-avatar"><Sparkles size={15}/></div>
       <div className="chat-message-content">
         <div className="chat-message-text">{m.text}</div>
         <div className="field-suggestion-card">
           <div className="field-suggestion-title"><b>Suggested changes</b><span>Source: email</span></div>
           <div className="field-suggestion-list">
             {m.suggestions.map((suggestion,index)=><div className="field-suggestion-row" key={index}>
               <div><b>{suggestion.scope==="primary"?"Shipment":"Line "+(Number(suggestion.lineIndex)+1)}</b><span>{suggestion.reason||"Value found in the email source."}</span></div>
               <strong>{suggestion.field==="hsCode"?"HS code":suggestion.field==="invoiceNumber"?"Invoice number":suggestion.field==="exporterEoriNo"?"EORI":suggestion.field}: {suggestion.value}</strong>
             </div>)}
           </div>
           {m.handled==="applied"
             ? <div className="field-suggestion-result success"><CheckCircle2 size={14}/> Added to working customs data</div>
             : m.handled==="ignored"
               ? <div className="field-suggestion-result">No changes made</div>
               : <div className="field-suggestion-actions"><button type="button" className="primary" onClick={()=>applySuggestedFields(m.suggestions,i)}>Add to customs data</button><button type="button" className="secondary" onClick={()=>ignoreSuggestedFields(i)}>Don't add</button></div>}
         </div>
       </div>
     </div>;
   }
   if(m.type==="weightApportionmentDecision"){
     return <div className="chat-message-row agent" key={i}><div className="chat-message-avatar"><Sparkles size={15}/></div><div className="chat-message-content"><div className="chat-message-text">{m.text}</div><div className="weight-decision-actions"><button className="secondary" onClick={decideWeightApportionment}>Apply weight apportionment</button><button className="secondary" onClick={declineWeightApportionment}>Do not apply</button><button className="secondary" onClick={()=>emailCustomerReview()}><Mail size={15}/> Email customer</button></div></div></div>;
   }
   if(m.type==="weightDecision"){
     return <div className="chat-message-row agent" key={i}><div className="chat-message-avatar"><Sparkles size={15}/></div><div className="chat-message-content"><div className="chat-message-text">{m.text.split("\n").map((x,j)=><React.Fragment key={j}>{x}{j<m.text.split("\n").length-1&&<br/>}</React.Fragment>)}</div><div className="weight-decision-actions"><button className="secondary" onClick={()=>decideWeights("invoice",m.conflicts)}>Use Commercial Invoice weights</button><button className="secondary" onClick={()=>decideWeights("packing_list",m.conflicts)}>Use Packing List weights</button><button className="secondary" onClick={()=>emailCustomerReview()}><Mail size={15}/> Email customer</button></div></div></div>;
   }
   if(m.type==="customsEntrySummary"&&m.summary){
     const s=m.summary;
     const addressLines=(structured,fullAddress,fallback)=>{
       const raw=structured||fullAddress||"";
       const lines=String(raw).split(/,|\\n/).map(x=>x.trim()).filter(Boolean);
       return lines.length?lines:[fallback];
     };
     const renderAddress=(structured,fullAddress,fallback)=>{
       const hasStructured=Boolean(String(structured||"").trim());
       const lines=addressLines(structured,fullAddress,fallback);
       return <>{lines.map((line,idx)=><span key={idx}>{line}</span>)}</>;
     };
     return <div className="chat-message-row agent" key={i}>
       <div className="chat-message-avatar"><Sparkles size={15}/></div>
       <div className="chat-message-content">
         <div className="customs-entry-summary-card">
           {s.weightSourceDecision&&<div className="weight-source-selected"><CheckCircle2 size={15}/><span><b>Working weights:</b> {s.weightSourceDecision==="packing_list"?"Packing List":"Commercial Invoice"} selected. The selected values are now used for customs validation and downstream data.</span></div>}
           <div className="customs-party-grid">
             <div className="customs-party-card">
               <span className="customs-party-label">Exporter</span>
               <b>{s.exporter||"—"}</b>
               <div className="customs-address-block">
                 {s.exporterAddressLine1
                   ? <>
                       <span><strong>Address line 1:</strong> {s.exporterAddressLine1}</span>
                       <span><strong>Postcode/ZIP:</strong> {s.exporterPostcode||"—"}</span>
                       <span><strong>City:</strong> {s.exporterCity||"—"}</span>
                       <span><strong>Country:</strong> {s.exporterCountryIso||"—"}</span>
                     </>
                   : renderAddress("",s.exporterAddress,"—")}
                 <span><strong>EORI:</strong> {s.exporterEoriNo||"—"}</span>
               </div>
             </div>
             <div className="customs-party-card">
               <span className="customs-party-label">Importer</span>
               <b>{s.consignee||"—"}</b>
               <div className="customs-address-block">
                 {s.consigneeAddressLine1
                   ? <>
                       <span><strong>Address line 1:</strong> {s.consigneeAddressLine1}</span>
                       <span><strong>Postcode/ZIP:</strong> {s.consigneePostcode||"—"}</span>
                       <span><strong>City:</strong> {s.consigneeCity||"—"}</span>
                       <span><strong>Country:</strong> {s.consigneeCountryIso||"—"}</span>
                     </>
                   : renderAddress("",s.consigneeAddress,"—")}
               </div>
             </div>
           </div>
           <div className="customs-header-table">
             <div><span>Invoice number</span><b>{s.invoice||"—"}</b></div>
             <div><span>Currency</span><b>{s.currency||"—"}</b></div>
             <div><span>Invoice Value</span><b>{s.invoiceValue?((s.currency||"")+" "+s.invoiceValue):"—"}</b></div>
             <div><span>Export</span><b>{s.exportCountry||"—"}</b></div>
             <div><span>Destination</span><b>{s.destination||"—"}</b></div>
             <div><span>Packages</span><b>{s.packages||"—"}</b></div>
             <div><span>Gross Weight</span><b>{s.gross?s.gross+" kg":"—"}</b></div>
             <div><span>Net Weight</span><b>{s.net?s.net+" kg":"—"}</b></div>
             <div><span>Freight Cost</span><b>{s.freightAmount?((s.freightCurrency||s.currency||"")+" "+s.freightAmount):"—"}</b></div>
             <div><span>Freight Currency</span><b>{s.freightCurrency||"—"}</b></div>
             <div><span>Delivery Term</span><b>{s.deliveryTerm||"—"}</b></div>
           </div>
           <div className="customs-summary-section">
             <div className="summary-section-title">Goods lines <span>{s.lines.length}</span></div>
             <div className="customs-line-table-wrap">
               <table className="customs-line-table">
                 <thead><tr><th>Line</th><th>Goods Description</th><th>HS Code</th><th>Origin</th><th>Qty</th><th>Net Weight (kg)</th><th>Gross Weight (kg)</th><th>Value</th></tr></thead>
                 <tbody>{s.lines.map(line=><tr key={line.no}><td>{line.no}</td><td>{line.description}</td><td>{line.hs||"—"}</td><td>{line.origin||"—"}</td><td>{line.quantity||"—"}</td><td>{line.net||"—"}</td><td>{line.gross||"—"}</td><td>{line.itemValue?(s.currency+" "+line.itemValue):"—"}</td></tr>)}</tbody>
               </table>
             </div>
           </div>
           {source&&<div className="summary-source">{source}</div>}
         </div>
       </div>
     </div>;
   }
   if(m.type==="agentIssues"&&Array.isArray(m.issues)){
     return <div className="chat-message-row agent" key={i}><div className="chat-message-avatar"><AlertCircle size={15}/></div><div className="chat-message-content"><div className="validation-summary-card agent-issues-card"><div className="customs-summary-title"><div><span className="summary-kicker">ATTENTION REQUIRED</span><h3>Issues found during document review</h3></div></div><div className="validation-check-list">{m.issues.map((issue,idx)=><div className="validation-check warning" key={idx}><span>!</span><div><b>{issue.title}</b><small>{issue.detail}</small>{issue.sourceDocumentId&&<div className="chat-source">{sourceButton("Open source document",issue.sourceDocumentId,issue.sourcePage||1)}</div>}</div></div>)}</div></div></div></div>;
   }
   if(m.type==="validationSummary"&&Array.isArray(m.checks)){
     const failures=m.checks.filter(check=>check.status==="fail");
     const reviews=m.checks.filter(check=>check.status==="review");
     const passed=m.checks.filter(check=>check.status==="pass");
     const notApplicable=m.checks.filter(check=>check.status==="not_applicable");
     const renderCheck=(check,idx,status)=> <div className={"validation-check "+status} key={status+"-"+idx}><span>{status==="pass"?"✓":status==="not_applicable"?"—":"!"}</span><div><b>{check.label||check.check||"Validation check"}</b><small>{check.detail||check.message||""}</small>{status==="review"&&(check.label||check.check)==="Weight source decision"&&<div className="validation-weight-actions"><button type="button" className="secondary" onClick={()=>decideWeights("invoice",getWeightConflicts())}>Use Commercial Invoice</button><button type="button" className="secondary" onClick={()=>decideWeights("packing_list",getWeightConflicts())}>Use Packing List</button><button type="button" className="secondary" onClick={()=>emailCustomerReview()}><Mail size={13}/> Email customer</button></div>}</div></div>;
     return <div className="chat-message-row agent" key={i}><div className="chat-message-avatar"><ShieldCheck size={15}/></div><div className="chat-message-content"><div className="validation-summary-card">
       <div className="customs-summary-title"><div><span className="summary-kicker">VALIDATION RESULTS</span><h3>Document and customs checks</h3></div></div>
       {failures.length>0&&<div className="validation-group"><div className="validation-group-title">❌ {failures.length} issue{failures.length===1?"":"s"} found</div><div className="validation-check-list">{failures.map((check,idx)=>renderCheck(check,idx,"fail"))}{failures.some(check=>/missing|not extracted|required.*value/i.test(String(check.detail||check.message||"")))&&<div className="validation-missing-actions"><button type="button" className="secondary" onClick={()=>emailCustomerReview(failures)}><Mail size={13}/> Email customer for missing information</button></div>}</div></div>}
       {reviews.length>0&&<div className="validation-group"><div className="validation-group-title">⚠️ {reviews.length} decision{reviews.length===1?"":"s"} required</div><div className="validation-check-list">{reviews.map((check,idx)=>renderCheck(check,idx,"review"))}</div></div>}
       {!failures.length&&!reviews.length&&<div className="validation-success-message">✓ No validation issues found.</div>}
       <details className="validation-details"><summary>Show passed checks ({passed.length}){notApplicable.length?" · "+notApplicable.length+" not applicable":""}</summary><div className="validation-check-list">{passed.map((check,idx)=>renderCheck(check,idx,"pass"))}{notApplicable.map((check,idx)=>renderCheck(check,idx,"not_applicable"))}</div></details>
     </div></div></div>;
   }
   return <div className={"chat-message-row "+(m.type||"agent")} key={i}><div className="chat-message-avatar">{m.type==="user"?"You":<Sparkles size={15}/>}</div><div className="chat-message-content"><div className="chat-message-text">{m.text}</div>{source&&<div className="chat-source">{source}</div>}</div></div>;
 };

 const summaryHeaderData=pack.workingRecord||{};
 const summaryFallbackData=pack.extractedData||{};
 const summaryInvoiceNumber=summaryHeaderData.invoiceNumber||summaryHeaderData.invoiceNo||summaryHeaderData.invoice||summaryFallbackData.invoiceNumber||summaryFallbackData.invoiceNo||summaryFallbackData.invoice||"—";
 const customerIdentification=pack.customerIdentification||{};
 const identificationAmbiguous=customerIdentification.ambiguous===true;
 const identificationMatched=customerIdentification.matched===true;
 const identificationPossible=customerIdentification.possibleMatch===true;
 const identificationStatus=identificationMatched?"Matched":identificationAmbiguous||identificationPossible?"Confirmation required":"Unassigned";
 const identificationCustomer=identificationMatched
   ? customerIdentification.customerName||"Customer identified"
   : identificationAmbiguous
     ? "Customer identification requires confirmation"
     : identificationPossible
       ? "Possible customer match"
       : "No customer identified";
 const identificationNote=identificationMatched
   ? `Customer strategy selected: ${customerIdentification.customerName||"the matched customer"}`
   : identificationAmbiguous
     ? "More than one customer matched the extracted party information. Review the candidates before assigning the pack."
     : identificationPossible
       ? "I found a customer with a very similar name. Confirm the match and I will remember this name variation for future packs."
       : "No active customer matched the extracted party information. The standard strategy is being used.";
 const canConfirmCustomer=identificationPossible&&!identificationMatched&&!identificationAmbiguous&&Array.isArray(customerIdentification.candidates)&&customerIdentification.candidates.length>0;
 const canCreateCustomer=!identificationMatched&&!identificationAmbiguous&&!identificationPossible;
 const suggestedCustomerName=customerIdentification.exporterName||customerIdentification.importerName||"this customer";
 const confirmCustomerMatch=async candidate=>{if(!candidate?.id)return;const sourceValue=candidate.sourceValue||customerIdentification.exporterName||customerIdentification.importerName||"";const sourceType=candidate.matchedBy||"exporter";try{const response=await fetch("/api/organisation",{method:"POST",credentials:"include",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"confirm-customer-memory",customerId:candidate.id,sourceValue,sourceType})});const data=await response.json().catch(()=>({}));if(!response.ok||!data.customer?.id)throw new Error(data.error||"Unable to save customer memory.");const updatedPack={...pack,customer:data.customer.name,customerId:data.customer.id,customerStrategyApplied:false,customerIdentification:{...customerIdentification,matched:true,possibleMatch:false,ambiguous:false,customerId:data.customer.id,customerName:data.customer.name,matchedBy:"memory-confirmed",memoryConfirmed:true}};const persisted=await updatePack?.(updatedPack);if(!persisted)throw new Error("Customer match was saved, but the pack association could not be saved.");await recordHistory?.(persisted,"customer_memory_confirmed","Customer match confirmed and saved to memory.",null,{customerId:data.customer.id,sourceValue,sourceType},null,"user",currentUserName||null);}catch(error){notify?.(error.message||"Unable to confirm customer match.");}};
 const openCreateCustomer=()=>{
   setCreateCustomerForm({name:customerIdentification.exporterName||customerIdentification.importerName||""});
   setCreateCustomerError("");
   setShowCreateCustomer(true);
 };
 const createCustomer=async event=>{
   event.preventDefault();
   const name=createCustomerForm.name.trim();
   if(!name){setCreateCustomerError("Customer name is required.");return;}
   setCreatingCustomer(true);setCreateCustomerError("");
   try{
     const response=await fetch("/api/organisation",{method:"POST",credentials:"include",headers:{"Content-Type":"application/json"},body:JSON.stringify({name})});
     const data=await response.json().catch(()=>({}));
     if(!response.ok||!data.customer?.id)throw new Error(data.error||"Unable to create customer.");
     const createdCustomerId=data.customer.id;
     const createdIdentification={
       ...customerIdentification,
       matched:true,
       ambiguous:false,
       customerId:createdCustomerId,
       customerName:data.customer.name||name,
       method:"created",
       matchedBy:customerIdentification.matchedBy||(customerIdentification.exporterName?"exporter":"importer")
     };
     const updatedPack={...pack,customer:data.customer.name||name,customerId:createdCustomerId,customerStrategyApplied:false,customerIdentification:createdIdentification};
     const persisted=await updatePack?.(updatedPack);
     if(persisted===false)throw new Error("Customer was created, but the pack association could not be saved.");
     await recordHistory?.(persisted,"customer_created_and_associated",`Customer created and associated with pack: ${data.customer.name||name}`,null,{customerId:createdCustomerId,identificationSource:createdIdentification.matchedBy||null},null,"user",currentUserName||null);
     setShowCreateCustomer(false);
   }catch(error){setCreateCustomerError(error.message||"Unable to create customer.");}
   finally{setCreatingCustomer(false);}
 };

 return <section className="review-chat-page">

   <div className="chat-review-panel chat-review-full">
     <div className="chat-review-head"><div className="agent-title"><div className="agent-orb"><Sparkles size={18}/></div><div><b>Extraction Agent</b><span>Source-grounded document review</span></div></div><div className="review-source-actions"><button type="button" className="secondary" onClick={()=>setShowSummary(true)}><FileText size={14}/> Customs summary</button>{pack.email&&<button type="button" className="secondary review-show-email-btn" onClick={()=>setShowEmailSource(true)}><Mail size={14}/> Show email</button>}<button type="button" className="secondary" onClick={()=>{setSelectedDocumentId(selectedDocumentId||(documentRows[0]?.id||documentRows[0]?.name));setPreviewPage(1);setShowPreview(true);}}><FileText size={14}/> Show document</button><details className="review-audit-inline"><summary><ShieldCheck size={14}/> Audit trail</summary><div className="review-audit-inline-panel"><div className="review-audit-inline-head"><div><span className="summary-kicker">AUDIT TRAIL</span><b>Pack history</b></div><span>{history.length} event{history.length===1?"":"s"}</span></div><div className="pack-history-list">{history.length?history.map(x=><div className="pack-history-item" key={x.id}><div className="pack-history-dot"></div><div><b>{x.description}</b><span>{x.actor_name} · {x.actor_type} · {new Date(x.created_at).toLocaleString("en-GB")}</span></div></div>):<div className="pack-history-empty">No history recorded yet.</div>}</div></div></details></div></div>
     <div className="chat-review-intro">I read the complete document pack first. The conversation below is the review record: extracted values stay connected to their source, and discrepancies are surfaced rather than silently resolved.</div>
     <div className="agent-customer-context" style={{flex:"0 0 auto"}}>
       <div className="agent-customer-context-head">
         <div><span className="summary-kicker">CUSTOMER</span><strong>{identificationCustomer}</strong></div>
         <span className="summary-status">{identificationStatus}</span>
       </div>
       <div className="agent-customer-context-details">
         {customerIdentification.exporterName&&<div className="agent-customer-context-detail"><span>Exporter</span><b>{customerIdentification.exporterName}</b></div>}
         {customerIdentification.importerName&&<div className="agent-customer-context-detail"><span>Importer</span><b>{customerIdentification.importerName}</b></div>}
         <div className="agent-customer-context-detail"><span>Method</span><b>{customerIdentification.method==="manual"?"Manual selection":"Automatic identification"}</b></div>
         {customerIdentification.matchedBy&&<div className="agent-customer-context-detail"><span>Matched by</span><b>{customerIdentification.matchedBy}</b></div>}
       </div>
       <div className="customer-identification-note">{identificationNote}</div>
       {Array.isArray(customerIdentification.candidates)&&customerIdentification.candidates.length>0&&<div className="customer-identification-candidates"><b>Possible customers</b>{customerIdentification.candidates.map((candidate,index)=><div key={candidate.id||index}><span>{candidate.name}</span><small>{candidate.matchedBy}</small></div>)}</div>}
     </div>
   {showCreateCustomer&&<div className="modal-backdrop" onMouseDown={()=>{if(!creatingCustomer)setShowCreateCustomer(false);}}><div className="modal-card customer-create-modal" onMouseDown={event=>event.stopPropagation()}><div className="modal-head"><div><div className="eyebrow">Customer identification</div><h2>Create customer</h2><p>Create and associate a customer with this pack.</p></div><button type="button" className="row-btn" onClick={()=>setShowCreateCustomer(false)} disabled={creatingCustomer}><X size={18}/></button></div><form onSubmit={createCustomer}><label className="field"><span>Customer name <strong>*</strong></span><input value={createCustomerForm.name} onChange={event=>setCreateCustomerForm(current=>({...current,name:event.target.value}))} disabled={creatingCustomer}/></label>{createCustomerError&&<div className="password-login-error">{createCustomerError}</div>}<div className="modal-actions"><button type="button" className="secondary" onClick={()=>setShowCreateCustomer(false)} disabled={creatingCustomer}>Cancel</button><button type="submit" className="primary" disabled={creatingCustomer}>{creatingCustomer?"Creating…":"Create customer"}</button></div></form></div></div>}

     {pack.processingError&&<div className="reprocess-error-banner"><div><b>Re-processing failed</b><span>{pack.processingError}</span></div><button type="button" className="secondary" onClick={()=>reprocessPack?.(pack)}>Try again</button></div>}
     <div ref={chatHistoryRef} className="chat-history chat-review-history" onScroll={()=>{if(autoScrollChatRef.current&&!isChatNearBottom())autoScrollChatRef.current=false;}}>
       {canConfirmCustomer&&!customerSetupDeclined&&<div className="chat-message-row agent customer-not-found-prompt" style={{flex:"0 0 auto"}}>
         <div className="chat-message-avatar"><Sparkles size={15}/></div>
         <div className="chat-message-content">
           <div className="chat-message-text"><strong>Possible customer match</strong><br/>I found an existing customer that looks like a match. Is {customerIdentification.candidates[0]?.name||"this customer"} the same customer as {customerIdentification.exporterName||customerIdentification.importerName||"the extracted party"}?</div>
           <div className="customer-not-found-actions">
             <button type="button" className="primary" onClick={()=>confirmCustomerMatch(customerIdentification.candidates[0])}><CheckCircle2 size={14}/> Yes, this is the customer</button>
             <button type="button" className="secondary" onClick={async()=>{setCustomerSetupDeclined(true);await recordHistory?.(pack,"customer_match_declined","Possible customer match declined — pack remains unassigned.",null,{candidate:customerIdentification.candidates[0]||null},{customerId:null,identificationSource:customerIdentification.matchedBy||null},"user",currentUserName||null);}}>No, keep unassigned</button>
           </div>
         </div>
       </div>}
       {messages.map(renderMessage)}
     </div>
     <div className="chat-input chat-review-input"><input value={chat} onChange={e=>setChat(e.target.value)} onKeyDown={e=>e.key==="Enter"&&sendChat()} placeholder="Ask where a value came from, why it was used, or tell the agent what to change..."/><button onClick={sendChat}><ArrowRight size={16}/></button></div>
   </div>
   {showSummary&&<div className="customs-summary-modal-overlay" onClick={()=>setShowSummary(false)}><div className="customs-summary-modal" onClick={e=>e.stopPropagation()}><div className="customs-summary-modal-head"><div><span className="summary-kicker">CUSTOMS ENTRY SUMMARY</span></div><button type="button" className="row-btn" onClick={()=>setShowSummary(false)}><X size={18}/></button></div><div className="customs-summary-modal-body">{buildSummary().find(m=>m.type==="customsEntrySummary") ? renderMessage(buildSummary().find(m=>m.type==="customsEntrySummary"),0) : <div className="review-document-empty"><FileText size={28}/><b>Customs summary not available</b><span>Waiting for document extraction to complete.</span></div>}</div></div></div>}
   {showEmailSource&&pack.email&&<div className="review-source-modal-overlay" onClick={()=>setShowEmailSource(false)}>
     <div className="review-email-modal" onClick={e=>e.stopPropagation()}>
       <div className="review-email-modal-head"><div><span className="summary-kicker">EMAIL SOURCE</span><b>{pack.email.subject||"Customs IDP email"}</b></div><button type="button" className="row-btn" onClick={()=>setShowEmailSource(false)}><X size={18}/></button></div>
       <div className="review-email-modal-meta">
         {pack.email.from&&<div><span>From</span><b>{pack.email.from}</b></div>}
         {pack.email.to&&<div><span>To</span><b>{pack.email.to}</b></div>}
         {pack.email.receivedAt&&<div><span>Received</span><b>{new Date(pack.email.receivedAt).toLocaleString("en-GB")}</b></div>}
       </div>
       {(pack.email.text||pack.email.html)&&<div className="review-email-modal-body"><span>Email body</span><div>{String(pack.email.text||pack.email.html||"").replace(/<[^>]*>/g,"").trim()}</div></div>}
       <div className="review-email-modal-note">Email content is retained as source context. Customs data is extracted from the attached documents unless the Review Agent explicitly identifies email content as supporting context.</div>
     </div>
   </div>}
   {showPreview&&selectedDocumentUrl&&<div className="review-source-modal-overlay" onClick={()=>setShowPreview(false)}>
     <div className="review-source-modal" onClick={e=>e.stopPropagation()}>
       <div className="review-source-modal-head">
         <div><span>{selectedDocumentIsPdf?"DOCUMENT SOURCE · PAGE "+previewPage:selectedDocumentIsSpreadsheet?"DOCUMENT SOURCE · EXCEL PREVIEW":"DOCUMENT SOURCE · IMAGE PREVIEW"}</span><b>{selectedDocument?.name||"Source document"}</b></div>
         <button type="button" className="row-btn" onClick={()=>setShowPreview(false)}><X size={18}/></button>
       </div>
       <div className="review-source-modal-toolbar"><div className="review-document-picker"><FileText size={14}/><select value={selectedDocumentId||""} onChange={e=>{setSelectedDocumentId(e.target.value);setPreviewPage(1);}} aria-label="Select source document">{documentRows.map(doc=><option key={doc.id||doc.name} value={doc.id||doc.name}>{doc.name}</option>)}</select></div>{selectedDocumentIsSpreadsheet&&<span className="spreadsheet-preview-status">Excel preview loading…</span>}{selectedDocumentIsPdf&&<div className="review-viewer-controls"><span>Page {previewPage}</span><button type="button" onClick={()=>setPreviewPage(p=>Math.max(1,p-1))}>−</button><button type="button" onClick={()=>setPreviewPage(p=>p+1)}>+</button></div>}</div>
       <div className={"review-source-modal-body "+(selectedDocumentIsSpreadsheet?"spreadsheet-document":selectedDocumentIsImage?"image-document":"pdf-document")}>{selectedDocumentUrl?(selectedDocumentIsSpreadsheet?<SpreadsheetPreview url={selectedDocumentUrl} sheetIndex={previewPage} setSheetIndex={setPreviewPage}/>:selectedDocumentIsImage?<img src={selectedDocumentUrl} alt={selectedDocument?.name||"Document preview"}/>:<iframe src={selectedDocumentFrameUrl} title={selectedDocument?.name||"Document preview"}/>):<div className="review-document-empty"><FileText size={28}/><b>{selectedDocument?.name||"No document available"}</b><span>The document is not available for preview yet.</span></div>}</div>
     </div>
   </div>}
   {emailDraft&&<div className="email-draft-overlay" onClick={()=>setEmailDraft(null)}><div className="email-draft-modal" onClick={e=>e.stopPropagation()}><div className="email-draft-head"><div><span className="summary-kicker">EMAIL CUSTOMER</span><h3>Weight confirmation request</h3></div><button type="button" className="row-btn" onClick={()=>setEmailDraft(null)}><X size={17}/></button></div><label>To<input value={emailDraft.to} onChange={e=>setEmailDraft({...emailDraft,to:e.target.value})} placeholder="customer@email.com" autoFocus/></label><label>Subject<input value={emailDraft.subject} onChange={e=>setEmailDraft({...emailDraft,subject:e.target.value})}/></label><label>Message<textarea rows="10" value={emailDraft.body} onChange={e=>setEmailDraft({...emailDraft,body:e.target.value})}/></label><div className="email-draft-actions"><button type="button" className="secondary" onClick={()=>{navigator.clipboard?.writeText(emailDraft.body);notify?.("Email message copied to clipboard");}}>Copy message</button><button type="button" className="primary" disabled={!emailDraft.to.trim()} onClick={()=>{window.location.href="mailto:"+encodeURIComponent(emailDraft.to.trim())+"?subject="+encodeURIComponent(emailDraft.subject)+"&body="+encodeURIComponent(emailDraft.body);setEmailDraft(null);}}>Open email</button></div></div></div>}
 </section>
}
function AgentPage(){
 const [selectedAgent,setSelectedAgent]=useState("review");
 const [messages,setMessages]=useState([{role:"agent",text:"I am the Review & Decision Agent. I work with the extracted pack, source evidence, customer strategy and validation results to explain decisions, make user-approved corrections and resolve review exceptions."}]);
 const [input,setInput]=useState("");

 const agents=[
   {
     id:"extract",
     name:"Document Extraction Agent",
     status:"Online",
     model:"GPT-5.6 Luna",
     endpoint:"/api/extract",
     type:"AI agent",
     icon:<FileText size={18}/>,
     role:"Reads the complete document pack and creates the canonical source extraction.",
     tasks:[
       "Classify each document",
       "Extract header and party data",
       "Extract every goods line separately",
       "Capture line-level net and gross weights",
       "Extract freight and invoice totals",
       "Record field evidence and confidence"
     ],
     knowledge:[
       "Commercial invoices",
       "Packing lists",
       "CMR and transport documents",
       "Exporter / importer address structures",
       "UK EORI identification",
       "ISO 3166-1 country codes",
       "Line values, quantities and weights",
       "Freight and invoice totals",
       "Source evidence and page references"
     ]
   },
   {
     id:"review",
     name:"Review & Decision Agent",
     status:"Online",
     model:"GPT-5.6 Luna",
     endpoint:"/api/agent",
     type:"AI agent",
     icon:<Sparkles size={18}/>,
     role:"Works with a live pack to explain extraction, handle corrections, surface discrepancies and guide human decisions.",
     tasks:[
       "Explain where an extracted value came from",
       "Make explicit user-approved corrections",
       "Compare primary and supporting documents",
       "Handle weight-source decisions",
       "Apply approved weight apportionment",
       "Explain validation failures",
       "Use customer strategy when supplied",
       "Keep corrections auditable"
     ],
     knowledge:[
       "Current pack and uploaded documents",
       "Field evidence and source pages",
       "Primary invoice hierarchy",
       "Supporting-document fallback rules",
       "Customer-specific strategy",
       "Middleware field mapping",
       "Standard validation results",
       "Weight reconciliation and apportionment",
       "Freight reconciliation",
       "UK customs / EORI rules"
     ]
   }
 ];

 const supporting=[
   {name:"Standard Validation Engine",type:"Deterministic engine",icon:<ShieldCheck size={17}/>,description:"Runs repeatable customs and middleware checks without relying on an AI judgement.",items:["Required-field checks","ISO country validation","HS / procedure-code validation","Line and header weight reconciliation","Invoice + same-currency freight reconciliation","EORI and address checks"]},
   {name:"Customer Strategy Layer",type:"Rules & configuration",icon:<Settings size={17}/>,description:"Supplies customer-specific rules to the workflow. It is configuration, not a separate AI agent.",items:["Customer extraction rules","Weight apportionment settings","Customer-specific validation","Mailbox / customer context","Future rule versioning and audit trail"]}
 ];

 const selected=agents.find(agent=>agent.id===selectedAgent)||agents[1];

 const send=(textValue=input)=>{
   const q=textValue.trim(); if(!q) return;
   setMessages(m=>[...m,{role:"user",text:q}]); setInput("");
   const l=q.toLowerCase(); let reply;
   const outOfScope=/\b(recipe|recipes|cook|cooking|soup|meal|dinner|lunch|breakfast|weather|forecast|football|soccer|sport|sports|betting|odds|movie|movies|film|films|music|song|songs|game|games|gaming|joke|jokes|poem|poetry|dating|relationship|homework|essay|school|university|maths|mathematics)\b/i.test(q);
   if(outOfScope) reply="I’m restricted to Customs IDP work. I can explain this agent, its supplied knowledge, the current customs workflow, validation, source evidence, customer strategy or document-review decisions.";
   else if(l.includes("knowledge")) reply=selected.name+" has access to "+selected.knowledge.slice(0,5).join(", ")+". Its context is supplied by the platform for the current workflow rather than a generic answer.";
   else if(l.includes("gross")||l.includes("weight")) reply="The Review & Decision Agent can use the pack's document-level and line-level weight evidence, the selected source and the customer strategy. When apportionment is approved, the platform applies the configured method and keeps the resulting values in the working record.";
   else if(l.includes("extract")) reply="The Document Extraction Agent reads the complete uploaded document and returns structured customs data, line items, evidence and confidence. It does not apply customer rules or silently guess missing values.";
   else if(l.includes("validate")) reply="Validation is deliberately separate from the AI agents. The Standard Validation Engine performs deterministic checks, then the Review & Decision Agent can explain the result and help resolve any human decision.";
   else if(l.includes("rule")||l.includes("customer")) reply="Customer strategy is supplied as configuration to the workflow. The Review & Decision Agent can use those supplied rules, but it should not invent or apply a customer-specific rule that is not present in the pack context.";
   else if(l.includes("change")||l.includes("correct")||l.includes("wrong")) reply="The Review & Decision Agent can make an explicit correction when the user specifies the new value. It records the instruction, updates the working data and the platform can re-run validation.";
   else reply="This Agent Control Centre shows which intelligence component is responsible for each stage, the knowledge it is given, and the deterministic controls that sit around it.";
   setTimeout(()=>setMessages(m=>[...m,{role:"agent",text:reply}]),180);
 };

 return <section>
   <div className="page-head">
     <div><div className="eyebrow">Automation & intelligence</div><h1>AI Agents</h1><p>See which agents process customs data, what they do and the operational knowledge supplied to them.</p></div>
     <span className="online-pill"><span></span> 2 AI agents online</span>
   </div>

   <div className="agent-control-hero">
     <div className="agent-control-hero-icon"><Bot size={24}/></div>
     <div className="agent-control-hero-copy">
       <div className="eyebrow">Current AI architecture</div>
       <h2>Customs IDP intelligence layer</h2>
       <p>Two specialised AI agents work around a deterministic validation engine and customer strategy layer. This keeps extraction flexible while keeping critical validation repeatable.</p>
     </div>
     <div className="agent-control-hero-stat"><b>2</b><span>AI agents</span></div>
     <div className="agent-control-hero-stat"><b>1</b><span>Validation engine</span></div>
   </div>

   <div className="agent-directory">
     <div className="agent-directory-head"><div><span className="summary-kicker">AI AGENT DIRECTORY</span><h2>Agents in this platform</h2><p>Select an agent to see its role, tasks and specific knowledge.</p></div></div>
     <div className="agent-directory-grid">
       {agents.map(agent=><button type="button" className={"agent-directory-card "+(selectedAgent===agent.id?"selected":"")} key={agent.id} onClick={()=>setSelectedAgent(agent.id)}>
         <div className="agent-directory-card-top"><div className="agent-directory-icon">{agent.icon}</div><span className="agent-online"><i></i>{agent.status}</span></div>
         <h3>{agent.name}</h3>
         <span className="agent-directory-type">{agent.type} · {agent.model}</span>
         <p>{agent.role}</p>
         <div className="agent-directory-meta"><span>{agent.tasks.length} tasks</span><span>{agent.knowledge.length} knowledge areas</span></div>
       </button>)}
     </div>
   </div>

   <div className="agent-detail-grid">
     <div className="panel agent-detail-panel">
       <div className="panel-head">
         <div><span className="summary-kicker">SELECTED AGENT</span><h2>{selected.name}</h2><p>{selected.endpoint} · {selected.model}</p></div>
         <span className="online-pill"><span></span>{selected.status}</span>
       </div>
       <div className="agent-detail-body">
         <div className="agent-detail-intro"><div className="agent-directory-icon">{selected.icon}</div><div><b>What this agent does</b><p>{selected.role}</p></div></div>
         <div className="agent-detail-section"><h3>Tasks</h3><div className="agent-task-grid">{selected.tasks.map(task=><div className="agent-task" key={task}><CheckCircle2 size={15}/><span>{task}</span></div>)}</div></div>
         <div className="agent-detail-section"><h3>Specific knowledge supplied</h3><p className="agent-knowledge-note">This is the operational knowledge/context the agent is designed to use for this workflow. It is not a generic unrestricted knowledge base.</p><div className="agent-knowledge-grid">{selected.knowledge.map(item=><div className="agent-knowledge-chip" key={item}><Zap size={13}/><span>{item}</span></div>)}</div></div>
       </div>
     </div>

     <div className="panel agent-runtime-panel">
       <div className="panel-head"><div><span className="summary-kicker">SUPPORTING INTELLIGENCE</span><h2>Controls around the agents</h2><p>Components that keep the workflow predictable.</p></div></div>
       <div className="supporting-agent-list">
         {supporting.map(item=><div className="supporting-agent" key={item.name}><div className="supporting-agent-head"><div className="supporting-agent-icon">{item.icon}</div><div><b>{item.name}</b><span>{item.type}</span></div></div><p>{item.description}</p><div className="supporting-agent-items">{item.items.map(x=><span key={x}>{x}</span>)}</div></div>)}
       </div>
       <div className="agent-flow"><span>Documents</span><ArrowRight size={14}/><b>Extraction Agent</b><ArrowRight size={14}/><b>Review Agent</b><ArrowRight size={14}/><b>Validation</b><ArrowRight size={14}/><span>Post to LCA</span></div>
     </div>
   </div>

   <div className="panel chat-large agent-chat-control">
     <div className="agent-title"><div className="agent-orb"><Sparkles size={18}/></div><div><b>{selected.name}</b><span>Operational knowledge and workflow assistant</span></div></div>
     <div className="chat-history">
       {messages.map((m,i)=><div className={"message "+m.role} key={i}>{m.text}</div>)}
       <div className="suggestions">
         <button onClick={()=>send("What knowledge does this agent use?")}>What knowledge does this agent use?</button>
         <button onClick={()=>send("Explain the weight rules")}>Explain the weight rules</button>
         <button onClick={()=>send("What does the extraction agent do?")}>What does the extraction agent do?</button>
         <button onClick={()=>send("How does validation work?")}>How does validation work?</button>
       </div>
     </div>
     <div className="chat-input"><input value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>e.key==="Enter"&&send()} placeholder="Ask about an agent, its tasks or its knowledge..."/><button onClick={()=>send()}><ArrowRight size={16}/></button></div>
   </div>
 </section>
}
function SettingsPage({currentUserRole="member"}){
  const canInviteUsers=currentUserRole==="manager"||currentUserRole==="admin";
  const [outlook,setOutlook]=useState({loading:true,connected:false,connection:null,subscriptionHealth:null});
  const [connecting,setConnecting]=useState(false);
  const [syncing,setSyncing]=useState(false);
  const [renewing,setRenewing]=useState(false);
  const [renewalMessage,setRenewalMessage]=useState("");
  const [syncRun,setSyncRun]=useState(null);
  const [error,setError]=useState("");
  const [invite,setInvite]=useState({name:"",email:"",role:"member"});
  const [inviting,setInviting]=useState(false);
  const [inviteMessage,setInviteMessage]=useState("");
  const [emailJobs,setEmailJobs]=useState([]);
  const [emailJobsError,setEmailJobsError]=useState("");

  const loadOutlook=async()=>{
    const response=await fetch("/api/outlook?action=status",{credentials:"include"});
    const data=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(data.error||"Unable to load Outlook status.");
    setOutlook({loading:false,connected:Boolean(data.connected),connection:data.connection||null,subscriptionHealth:data.subscriptionHealth||null});
  };

  useEffect(()=>{
    let active=true;
    loadOutlook().catch(()=>{if(active)setOutlook({loading:false,connected:false,connection:null,subscriptionHealth:null});});
    return()=>{active=false;};
  },[]);

  const loadEmailJobs=async()=>{
    const response=await fetch("/api/email-jobs",{credentials:"include"});
    const data=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(data.error||"Unable to load email intake status.");
    setEmailJobs(Array.isArray(data.jobs)?data.jobs:[]);
  };

  useEffect(()=>{let active=true;loadEmailJobs().catch(error=>{if(active)setEmailJobsError(error.message||"Unable to load email intake status.");});return()=>{active=false;};},[]);

  const retryEmailJob=async jobId=>{
    setEmailJobsError("");
    try{
      const response=await fetch("/api/email-jobs",{method:"POST",headers:{"Content-Type":"application/json"},credentials:"include",body:JSON.stringify({jobId})});
      const data=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error(data.error||"Unable to retry email intake.");
      await loadEmailJobs();
    }catch(error){setEmailJobsError(error.message||"Unable to retry email intake.");}
  };

  useEffect(()=>{
    if(!syncRun?.id)return;
    let active=true;
    const poll=async()=>{
      try{
        const response=await fetch("/api/outlook?action=sync-status&id="+encodeURIComponent(syncRun.id),{credentials:"include"});
        const data=await response.json().catch(()=>({}));
        if(!response.ok)throw new Error(data.error||"Unable to load sync status.");
        if(!active)return;
        setSyncRun(data.run||null);
        if(["completed","failed"].includes(data.run?.status)){
          setSyncing(false);
          await loadOutlook();
        }
      }catch(e){if(active){setSyncing(false);setError(e.message||"Unable to load sync status.");}}
    };
    void poll();
    const timer=window.setInterval(poll,2000);
    return()=>{active=false;window.clearInterval(timer);};
  },[syncRun?.id]);

  const connectOutlook=async()=>{
    setError("");setConnecting(true);
    try{
      const response=await fetch("/api/outlook?action=connect",{credentials:"include"});
      const data=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error(data.error||"Unable to start Outlook connection.");
      window.location.href=data.authorizationUrl;
    }catch(e){setError(e.message||"Unable to start Outlook connection.");setConnecting(false);}
  };

  const syncOutlook=async()=>{
    setError("");setSyncing(true);setSyncRun(null);
    try{
      const response=await fetch("/api/outlook?action=sync",{method:"POST",credentials:"include"});
      const data=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error(data.error||"Unable to start Outlook sync.");
      setSyncRun({id:data.syncRunId,status:data.status||"queued"});
    }catch(e){setSyncing(false);setError(e.message||"Unable to start Outlook sync.");}
  };

  const renewOutlookSubscription=async()=>{
    setError("");setRenewalMessage("");setRenewing(true);
    try{
      const response=await fetch("/api/outlook?action=renew-subscription",{method:"POST",credentials:"include"});
      const data=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error(data.error||"Unable to renew Outlook subscription.");
      await loadOutlook();
      setRenewalMessage("Subscription renewed. New emails can be received until "+formatReceivedDateTime(data.expiresAt)+".");
    }catch(e){
      setError(e.message||"Unable to renew Outlook subscription.");
      await loadOutlook().catch(()=>{});
    }finally{setRenewing(false);}
  };

  const disconnectOutlook=async()=>{
    if(!window.confirm("Disconnect this Outlook inbox? New messages will stop arriving until another inbox is connected."))return;
    setError("");
    try{
      const response=await fetch("/api/outlook?action=disconnect",{method:"POST",credentials:"include"});
      const data=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error(data.error||"Unable to disconnect Outlook.");
      setSyncRun(null);setSyncing(false);await loadOutlook();
    }catch(e){setError(e.message||"Unable to disconnect Outlook.");}
  };

  const sendInvite=async(e)=>{
    e.preventDefault();
    setError("");setInviteMessage("");setInviting(true);
    try{
      const response=await fetch("/api/team",{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        credentials:"include",
        body:JSON.stringify(invite)
      });
      const data=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error(data.error||"Unable to send invitation.");
      setInviteMessage("Invitation sent to "+invite.email+". They will set their password from the invitation link.");
      setInvite({name:"",email:"",role:"member"});
    }catch(e){setError(e.message||"Unable to send invitation.");}
    finally{setInviting(false);}
  };

  return <section>
    <div className="page-head"><div><div className="eyebrow">Platform</div><h1>Settings</h1><p>Core processing, middleware and integration configuration.</p></div></div>
    <div className="settings-grid">
      {canInviteUsers&&<div className="panel settings-card">
        <h2>Team access</h2>
        <p>Invite a user to this organisation. The invitation creates their Supabase account and organisation membership together.</p>
        <form onSubmit={sendInvite} className="password-login-form">
          <label>Name<input value={invite.name} onChange={e=>setInvite(v=>({...v,name:e.target.value}))} placeholder="Full name"/></label>
          <label>Email<input type="email" value={invite.email} onChange={e=>setInvite(v=>({...v,email:e.target.value}))} placeholder="name@company.com"/></label>
          <label>Role<select value={invite.role} onChange={e=>setInvite(v=>({...v,role:e.target.value}))}><option value="member">Data Processor</option><option value="manager">Manager</option><option value="admin">Admin</option></select></label>
          {inviteMessage&&<div className="password-login-message">{inviteMessage}</div>}
          {error&&<div className="password-login-error">{error}</div>}
          <button className="primary-action" type="submit" disabled={inviting||!invite.email.trim()}>{inviting?"Sending invitation…":"Invite user"}</button>
        </form>
      </div>}

      <div className="panel settings-card">
        <h2>Outlook email intake</h2>
        <p>Connect an Outlook inbox so new customs emails and attachments can enter the IDP pipeline automatically.</p>
        {outlook.loading ? <div className="setting-status">Checking connection…</div> : outlook.connected ? <>
          <div className="setting-status"><b>{!outlook.connection?.subscription_id||!outlook.connection?.subscription_expires_at?"Connected, subscription missing":outlook.subscriptionHealth?.expired?"Connected, subscription expired":outlook.subscriptionHealth?.expiringSoon?"Connected, subscription expiring soon":"Connected"}</b><span>{outlook.connection?.email}</span></div>
          <div className="setting-status"><span>Subscription expires</span><b>{formatReceivedDateTime(outlook.connection?.subscription_expires_at)}</b></div>
          <div className="setting-status"><span>Last sync</span><b>{outlook.connection?.last_sync_completed_at?formatReceivedDateTime(outlook.connection.last_sync_completed_at):"Not run"}</b></div>
          {outlook.connection?.last_sync_status&&<div className="setting-status"><span>Sync result</span><b>{outlook.connection.last_sync_status}{outlook.connection.last_sync_processed!=null?" · "+outlook.connection.last_sync_processed+" processed":""}</b></div>}
          {outlook.connection?.last_sync_error&&<div className="password-login-error">{outlook.connection.last_sync_error}</div>}
          {outlook.connection?.last_renewal_error&&<div className="password-login-error">Subscription renewal: {outlook.connection.last_renewal_error}</div>}
          {renewalMessage&&<div className="password-login-message">{renewalMessage}</div>}
          {syncRun?.status&&<div className={"setting-status "+(syncRun.status==="failed"?"setting-status-error":"")}><span>Manual sync</span><b>{syncRun.status}{syncRun.checked!=null?" · "+syncRun.checked+" checked":""}{syncRun.queued!=null?" · "+syncRun.queued+" queued":""}</b></div>}
          {syncRun?.error&&<div className="password-login-error">{syncRun.error}</div>}
          <div className="settings-actions"><button className="primary-action" onClick={renewOutlookSubscription} disabled={renewing}>{renewing?"Renewing…":"Renew subscription"}</button><button className="secondary-action" onClick={syncOutlook} disabled={syncing}>{syncing?"Scanning…":"Scan existing emails"}</button><button className="secondary-action" onClick={connectOutlook} disabled={connecting}>{connecting?"Opening Microsoft…":"Sign in again"}</button><button className="secondary-action" onClick={disconnectOutlook}>Disconnect</button></div>
        </> : <button className="primary-action" onClick={connectOutlook} disabled={connecting}>{connecting?"Opening Microsoft…":"Connect Outlook"}</button>}
        {error&&<div className="password-login-error">{error}</div>}
        <small>Access is limited to Microsoft Graph Mail.Read. Customs IDP does not request permission to send or modify email.</small>
      </div>

      <div className="panel settings-card">
        <h2>Inbound email processing</h2>
        <p>Durable Resend intake jobs, including retries and terminal failures.</p>
        {emailJobsError&&<div className="password-login-error">{emailJobsError}</div>}
        {!emailJobs.length?<div className="setting-status"><span>No inbound email jobs recorded</span></div>:emailJobs.slice(0,10).map(job=><div className={"setting-status "+(job.status==="failed"?"setting-status-error":"")} key={job.id}><span>{job.provider_email_id}<small>{job.stage}{job.last_error?" · "+job.last_error:""}</small></span><b>{job.status} · {job.attempts}/{job.max_attempts}{canInviteUsers&&["failed","retry"].includes(job.status)?<button className="text-btn" type="button" onClick={()=>retryEmailJob(job.id)}>Retry</button>:null}</b></div>)}
      </div>

      <div className="panel settings-card"><h2>Middleware</h2><p>Configure the output contract used by the downstream customs system.</p><label>Endpoint</label><input value="https://middleware.internal/customs/orders" readOnly/><label>Format</label><select><option>JSON</option></select><label>Destination</label><input value="ASM UK" readOnly/></div>
      <div className="panel settings-card"><h2>Processing defaults</h2><p>Global fallbacks used when a customer has no overriding rule.</p><Toggle label="Automatic validation" on/><Toggle label="Low-confidence review queue" on/><Toggle label="Auto-send validated packs" on/></div>
    </div>
  </section>
}
function Toggle({label,on}){return <div className="toggle-row"><span>{label}</span><div className={"toggle "+(on?"on":"")}><i></i></div></div>}

export { Review, AgentPage, SettingsPage, Toggle };
