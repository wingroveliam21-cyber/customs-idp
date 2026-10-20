import { getCustomerStrategy, normalizeCountryCode } from "./packData.js";
import { applyCustomerStrategyRules, customerStrategyRequiresApproval } from "./customerStrategyExecution.js";

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
      if(sourcePriority.length&&!customerStrategyRequiresApproval(strategy,"source_priority",key)){
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
    const strategyApplications=[];
    const strategyChanges=[];
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

    if(["invoice","packing_list"].includes(strategy?.weightHandling)&&!customerStrategyRequiresApproval(strategy,"weight_handling")){
      const preferredType=strategy.weightHandling==="packing_list"?"packing_list":"commercial_invoice";
      const preferredDoc=docs.find(doc=>doc?.extraction?.documentType===preferredType)|| (preferredType==="packing_list"?supportingDocs.find(doc=>/packing/i.test(doc?.filename||"")):invoiceDoc);
      let changed=0;
      if(preferredDoc){
        mergedLines.forEach((line,index)=>{
          const sourceLine=preferredDoc===invoiceDoc?invoiceLines[index]:findMatch(invoiceLines[index]||line,Array.isArray(preferredDoc?.extraction?.lines)?preferredDoc.extraction.lines:[]);
          if(!sourceLine)return;
          for(const [target,keys] of [["netMassKg",["netMassKg","netWeight","netMass"]],["grossMassKg",["grossMassKg","grossWeight","grossMass"]]]){
            const sourceKey=keys.find(key=>!isMissing(sourceLine[key]));
            if(!sourceKey)continue;
            const before=line[target]??keys.map(key=>line[key]).find(value=>!isMissing(value));
            const after=sourceLine[sourceKey];
            if(!isMissing(before)&&String(before)!==String(after))strategyChanges.push({category:"weightHandling",field:target,lineIndex:index,before,after,sourceDocumentType:preferredDoc.extraction?.documentType||null,sourceFilename:preferredDoc.filename||null,reason:"Configured customer weight source"});
            if(isMissing(before)||String(before)!==String(after)){line[target]=after;line._customerStrategyApplied=line._customerStrategyApplied||[];line._customerStrategyApplied.push("weight_source:"+preferredType);changed++;}
          }
        });
        strategyApplications.push({category:"weightHandling",status:changed?"applied":"no_change_needed",summary:changed?"Applied the configured weight source to working goods lines.":"Configured weight source was evaluated; no line weights needed changing.",details:{preferredSource:preferredType,changedValues:changed}});
      }else strategyApplications.push({category:"weightHandling",status:"not_applied",summary:"Configured weight source was not available in this pack.",details:{preferredSource:preferredType}});
    }

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

    const weightApportionmentApproved = pack?.extractedData?.weightApportionmentDecision?.status==="approved" || (strategy?.autoApplyWeightApportionment===true&&!customerStrategyRequiresApproval(strategy,"weight_apportionment"));
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
    if(totalFromLines && mergedLines.length>0&&!customerStrategyRequiresApproval(strategy,"invoice_total")){
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
    if(merged.invoiceTotalRuleApplied)strategyApplications.push({category:"invoiceTotal",status:"applied",summary:"Working invoice total calculated from item-line amounts.",details:{workingTotal:merged.invoiceTotalRuleApplied.workingInvoiceTotal,sourceTotal:merged.invoiceTotalRuleApplied.sourceInvoiceTotal,lineCount:merged.invoiceTotalRuleApplied.lineCount}});
    const apportionedLines=mergedLines.filter(line=>line?._weightApportionment);
    if(apportionedLines.length)strategyApplications.push({category:"weightApportionment",status:"applied",summary:"Document-level weights apportioned across goods lines.",details:{lines:apportionedLines.length,method:"line value, then quantity, then equal allocation"}});
    else if(strategy?.autoApplyWeightApportionment===true)strategyApplications.push({category:"weightApportionment",status:"not_applied",summary:"Automatic weight apportionment is enabled but could not be applied.",details:{reason:"Missing eligible source totals or line allocation basis"}});
    if(customerStrategyRequiresApproval(strategy,"invoice_total")&&totalFromLines)strategyApplications.push({category:"invoiceTotal",status:"pending_approval",summary:"Invoice-total rule is configured but held for customer-specific approval.",details:{required:true}});
    if(customerStrategyRequiresApproval(strategy,"weight_handling")&&["invoice","packing_list"].includes(strategy?.weightHandling))strategyApplications.push({category:"weightHandling",status:"pending_approval",summary:"Weight-source selection is held for customer-specific approval.",details:{configuredSource:strategy.weightHandling}});
    if(customerStrategyRequiresApproval(strategy,"weight_apportionment")&&strategy?.autoApplyWeightApportionment===true)strategyApplications.push({category:"weightApportionment",status:"pending_approval",summary:"Automatic weight apportionment is held for customer-specific approval.",details:{required:true}});
    if(strategy?.lineCurrencyFromHeader===true){
      const headerCurrency=merged.currency||merged.invoiceCurrency||null;
      let filled=0;
      if(headerCurrency&&!customerStrategyRequiresApproval(strategy,"line_currency_from_header")){
        mergedLines.forEach(line=>{if(line&&isMissing(line.currency)&&isMissing(line.lineCurrency)){line.currency=headerCurrency;line._customerStrategyApplied=[...(line._customerStrategyApplied||[]),"line_currency_from_header"];filled++;}});
        strategyApplications.push({category:"lineCurrencyFromHeader",status:filled?"applied":"no_change_needed",summary:filled?"Filled missing line currencies from header currency.":"No missing line currencies needed filling.",details:{headerCurrency,linesChanged:filled}});
      }else strategyApplications.push({category:"lineCurrencyFromHeader",status:headerCurrency?"pending_approval":"not_applied",summary:headerCurrency?"Header currency rule is held for approval.":"Header currency is unavailable; line currency rule could not be applied.",details:{headerCurrency}});
    }
    const execution=applyCustomerStrategyRules(merged,strategy);
    const applications=[...strategyApplications,...(execution.record.customerStrategyApplications||[])];
    if(sourcePriority.length)applications.unshift({
      category:"sourcePriority",
      status:sourcePriorityChanges.length?"applied":"no_change_needed",
      summary:sourcePriorityChanges.length?"Configured source priority selected preferred document values.":"Source priority evaluated; no conflicting top-level values needed replacement.",
      details:sourcePriorityChanges,
      changes:sourcePriorityChanges
    });
    execution.record.customerStrategyApplications=applications;
    execution.record.customerStrategyChanges=[...(execution.record.customerStrategyChanges||[]),...strategyChanges,...sourcePriorityChanges.map(change=>({...change,category:"sourcePriority",reason:"Configured customer source priority"}))];
    execution.record.workingRecordSource="primary invoice + supporting documents";
    execution.record.sourceDiscrepancies=sourceDiscrepancies;
    return execution.record;
}
