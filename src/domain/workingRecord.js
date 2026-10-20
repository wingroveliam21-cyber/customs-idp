import { getCustomerStrategy, normalizeCountryCode } from "./packData.js";
import { applyCustomerStrategyRules } from "./customerStrategyExecution.js";

export function buildWorkingCustomsRecord(pack, customerStrategy=null){
    const primary={...(pack?.extractedData||{})};
    const docs=Array.isArray(primary.documents)?primary.documents:[];
    const invoiceDoc=docs.find(d=>d?.extraction?.documentType==="commercial_invoice")||docs[0];
    const supportingDocs=docs.filter(d=>d&&d!==invoiceDoc);
    const strategy=customerStrategy||getCustomerStrategy(pack?.customer);
    if(!invoiceDoc){return applyCustomerStrategyRules(primary,strategy).record;}

    const invoice={...primary};
    const isMissing=v=>v===undefined||v===null||v==="";
    ["countryOfExport","sourceCountryOfDestination","exporterCountryIso","consigneeCountryIso"].forEach(field=>{
      if(!isMissing(invoice[field])) invoice[field]=normalizeCountryCode(invoice[field]);
    });

    // The primary document always wins. Supporting documents only fill fields
    // that are genuinely absent from the primary extraction.
    const supportingValues=(key)=>{
      for(const doc of supportingDocs){
        const value=doc?.extraction?.[key];
        if(!isMissing(value))return value;
      }
      return undefined;
    };

    const merged={...invoice};
    const sourcePriority=Array.isArray(strategy?.sourcePriority)?strategy.sourcePriority.map(value=>String(value).toLowerCase()):[];
    const sourcePriorityChanges=[];
    const orderedSources=[...docs].sort((a,b)=>{const rank=doc=>{const type=String(doc?.extraction?.documentType||"").toLowerCase();const index=sourcePriority.indexOf(type);return index<0?Number.MAX_SAFE_INTEGER:index;};return rank(a)-rank(b);});
    const topLevelKeys=new Set();
    supportingDocs.forEach(doc=>{
      Object.keys(doc?.extraction||{}).forEach(key=>{
        if(key!=="lines"&&key!=="documents"&&key!=="sourceDocuments"&&key!=="agentMessages")topLevelKeys.add(key);
      });
    });
    topLevelKeys.forEach(key=>{
      if(sourcePriority.length){
        const chosen=orderedSources.find(doc=>!isMissing(doc?.extraction?.[key]));
        if(chosen){
          const chosenValue=chosen.extraction[key],before=merged[key];
          if(!isMissing(before)&&String(before)!==String(chosenValue))sourcePriorityChanges.push({field:key,before,after:chosenValue,sourceDocumentType:chosen.extraction.documentType||null,sourceDocumentId:chosen.id||null,sourceFilename:chosen.filename||null});
          merged[key]=chosenValue;return;
        }
      }
      if(isMissing(merged[key])){const value=supportingValues(key);if(!isMissing(value))merged[key]=value;}
    });

    // Explicit aliases cover common naming differences between document types.
    const aliases={
      exporterEoriNo:["exporterEoriNo","exporterEori","eori"],
      totalPackages:["totalPackages","packages"],
      totalNetWeight:["totalNetWeight","totalNetMass","netWeight"],
      totalGrossWeight:["totalGrossWeight","totalGrossMass","grossWeight"],
      countryOfExport:["countryOfExport","countryOfOrigin","exportCountry","exporterCountryIso","sourceCountryCode"],
      sourceCountryOfDestination:["sourceCountryOfDestination","countryOfImport","countryOfDestination","consigneeCountryIso"],
      deliveryTerm:["deliveryTerm","terms"]
    };
    Object.entries(aliases).forEach(([target,keys])=>{
      if(!isMissing(merged[target]))return;
      for(const key of keys){
        const value=merged[key]??supportingValues(key);
        if(!isMissing(value)){merged[target]=value;break;}
      }
    });
    const eo=strategy?.customsSummaryExportField||strategy?.customsSummary?.exportField,di=strategy?.customsSummaryDestinationField||strategy?.customsSummary?.destinationField;
    if(eo&&!isMissing(merged[eo]))merged.countryOfExport=normalizeCountryCode(merged[eo]);else if(isMissing(merged.countryOfExport)&&!isMissing(merged.exporterCountryIso))merged.countryOfExport=normalizeCountryCode(merged.exporterCountryIso);
    if(di&&!isMissing(merged[di]))merged.sourceCountryOfDestination=normalizeCountryCode(merged[di]);else if(isMissing(merged.sourceCountryOfDestination)&&!isMissing(merged.consigneeCountryIso))merged.sourceCountryOfDestination=normalizeCountryCode(merged.consigneeCountryIso);

    const invoiceLines=Array.isArray(invoice.lines)?invoice.lines:[];
    const supportingLineSets=supportingDocs
      .map(doc=>({doc,lines:Array.isArray(doc?.extraction?.lines)?doc.extraction.lines:[]}))
      .filter(x=>x.lines.length);
    const norm=v=>String(v??"").trim().toLowerCase().replace(/\\s+/g," ");
    const findMatch=(invLine,sourceLines)=>{
      const hs=String(invLine?.hsCode??"").trim();
      const desc=norm(invLine?.description);
      return sourceLines.find(line=>hs&&String(line?.hsCode??"").trim()===hs&&desc&&norm(line?.description)===desc)
        ||sourceLines.find(line=>desc&&norm(line?.description)===desc)
        ||sourceLines.find(line=>String(line?.lineNo??line?.line??"")===String(invLine?.lineNo??invLine?.line??""));
    };

    const sourceDiscrepancies=[];
    const mergedLines=invoiceLines.map((invLine,lineIndex)=>{
      const mergedLine={...invLine};
      for(const source of supportingLineSets){
        const supportingLine=findMatch(invLine,source.lines);
        if(!supportingLine)continue;
        Object.keys(supportingLine).forEach(key=>{
          if(key==="lineNo"||key==="line"||isMissing(supportingLine[key]))return;
          if(isMissing(mergedLine[key])){
            mergedLine[key]=supportingLine[key];
          }else if(String(mergedLine[key])!==String(supportingLine[key])){
            sourceDiscrepancies.push({
              lineIndex,
              field:key,
              primaryValue:mergedLine[key],
              supportingValue:supportingLine[key],
              supportingDocumentId:source.doc.id,
              supportingDocument:source.doc.filename
            });
          }
        });
      }
      return mergedLine;
    });

    // If only document-level totals are available, derive line weights using
    // the established apportionment rule rather than treating the lines as missing.
    // Prefer line value as the allocation basis; fall back to quantity, then equal split.
    const toNumber=value=>{
      const n=Number(String(value??"").replace(/,/g,"").trim());
      return Number.isFinite(n)?n:null;
    };
    const totalNetForApportion=toNumber(merged.totalNetWeight);
    const totalGrossForApportion=toNumber(merged.totalGrossWeight);
    const allNetMissing=mergedLines.length>0&&mergedLines.every(line=>isMissing(line.netMassKg)&&isMissing(line.netWeight)&&isMissing(line.netMass));
    const allGrossMissing=mergedLines.length>0&&mergedLines.every(line=>isMissing(line.grossMassKg)&&isMissing(line.grossWeight)&&isMissing(line.grossMass));
    const allocationBasis=mergedLines.map(line=>toNumber(line.totalValue??line.lineValue??line.unitValue));
    const quantityBasis=mergedLines.map(line=>toNumber(line.quantity));
    const basis=allocationBasis.every(v=>v!==null&&v>=0)&&allocationBasis.some(v=>v>0)
      ? allocationBasis
      : quantityBasis.every(v=>v!==null&&v>=0)&&quantityBasis.some(v=>v>0)
        ? quantityBasis
        : mergedLines.map(()=>1);
    const basisTotal=basis.reduce((sum,v)=>sum+(v||0),0);

    const weightApportionmentApproved = pack?.extractedData?.weightApportionmentDecision?.status==="approved" || strategy?.autoApplyWeightApportionment===true;
    if(weightApportionmentApproved && ((allNetMissing&&totalNetForApportion!==null&&basisTotal>0)||(allGrossMissing&&totalGrossForApportion!==null&&basisTotal>0))){
      const apportioned=mergedLines.map(line=>({...line}));

      // Net weight is allocated from the document total using line value
      // (or quantity/equal split fallback).
      if(allNetMissing&&totalNetForApportion!==null){
        apportioned.forEach((line,index)=>{
          const share=(basis[index]||0)/basisTotal;
          line.netMassKg=Math.round(totalNetForApportion*share*1000)/1000;
          line._weightApportionment="Derived from document-level total using line-value allocation";
        });
        const roundedBeforeLast=apportioned.slice(0,-1).reduce((sum,line)=>sum+toNumber(line.netMassKg),0);
        apportioned[apportioned.length-1].netMassKg=Math.round((totalNetForApportion-roundedBeforeLast)*1000)/1000;
      }

      // Gross weight follows the established rule: allocate by the derived
      // net-weight ratio, rather than independently using line value.
      if(allGrossMissing&&totalGrossForApportion!==null){
        const netBasis=apportioned.map(line=>toNumber(line.netMassKg));
        const netBasisTotal=netBasis.every(v=>v!==null&&v>=0)&&netBasis.some(v=>v>0)
          ? netBasis.reduce((sum,v)=>sum+(v||0),0)
          : basisTotal;
        apportioned.forEach((line,index)=>{
          const share=netBasisTotal>0
            ? (netBasis[index]||0)/netBasisTotal
            : (basis[index]||0)/basisTotal;
          line.grossMassKg=Math.round(totalGrossForApportion*share*1000)/1000;
          line._weightApportionment=line._weightApportionment||"Derived from document-level total using line-value allocation";
        });
        const roundedBeforeLast=apportioned.slice(0,-1).reduce((sum,line)=>sum+toNumber(line.grossMassKg),0);
        apportioned[apportioned.length-1].grossMassKg=Math.round((totalGrossForApportion-roundedBeforeLast)*1000)/1000;
      }

      mergedLines.splice(0,mergedLines.length,...apportioned);
    }

    merged.lines=mergedLines;

    // Apply the customer's durable invoice-total rule to the working customs record.
    // Keep the extracted document amount separately so the source value remains auditable.
    const strategyInstructions=String(strategy?.instructions||"");
    const totalFromLines= strategy?.totalInvoiceFromLines===true
      || /(?:always\s+use|use|calculate|set|derive)[^.!?]{0,100}(?:sum|total)[^.!?]{0,100}(?:item[- ]line|line[- ]item|goods[- ]line)[^.!?]{0,100}(?:amount|value)|(?:item[- ]line|line[- ]item|goods[- ]line)[^.!?]{0,100}(?:sum|total)[^.!?]{0,100}(?:working\s+)?invoice\s+total/i.test(strategyInstructions);
    if(totalFromLines && mergedLines.length>0){
      const lineAmounts=mergedLines.map(line=>toNumber(line.totalValue??line.lineValue??line.unitValue));
      if(lineAmounts.every(value=>value!==null)){
        const calculatedTotal=Math.round(lineAmounts.reduce((sum,value)=>sum+value,0)*100)/100;
        const sourceInvoiceTotal=merged.totalInvoicedAmount??merged.totalAmountInvoiced??merged.totalInvoiceValue??null;
        merged.sourceInvoiceTotal=sourceInvoiceTotal;
        merged.totalInvoicedAmount=calculatedTotal;
        merged.invoiceTotalRuleApplied={
          rule:"customer_total_invoice_from_lines",
          sourceInvoiceTotal,
          workingInvoiceTotal:calculatedTotal,
          lineCount:mergedLines.length,
          explanation:"Applied the customer strategy: the working invoice total is the sum of item-line amounts. The original document invoice total is retained separately as sourceInvoiceTotal."
        };
      }
    }
    const execution=applyCustomerStrategyRules(merged,strategy);
    const applications=[...(execution.record.customerStrategyApplications||[])];
    if(sourcePriority.length)applications.unshift({
      category:"sourcePriority",
      status:sourcePriorityChanges.length?"applied":"no_change_needed",
      summary:sourcePriorityChanges.length?"Configured source priority selected preferred document values.":"Source priority evaluated; no conflicting top-level values needed replacement.",
      details:sourcePriorityChanges,
      changes:sourcePriorityChanges
    });
    execution.record.customerStrategyApplications=applications;
    execution.record.customerStrategyChanges=[...(execution.record.customerStrategyChanges||[]),...sourcePriorityChanges.map(change=>({...change,category:"sourcePriority",reason:"Configured customer source priority"}))];
    execution.record.workingRecordSource="primary invoice + supporting documents";
    execution.record.sourceDiscrepancies=sourceDiscrepancies;
    return execution.record;
}
