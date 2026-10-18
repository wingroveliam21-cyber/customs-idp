import { requireAuth } from "./authGuard.js";
export async function runReviewAgent({message,pack}){
  if(!process.env.OPENAI_API_KEY)throw new Error("OPENAI_API_KEY is not configured in Vercel.");
  if(!message||!pack)throw new Error("message and pack are required");
  try{
    const outOfScopePatterns=[
      /\b(recipe|recipes|cook|cooking|soup|meal|dinner|lunch|breakfast)\b/i,
      /\b(weather|forecast|temperature|football|soccer|sport|sports|betting|odds)\b/i,
      /\b(movie|movies|film|films|music|song|songs|game|games|gaming)\b/i,
      /\b(joke|jokes|poem|poetry|story|stories|dating|relationship)\b/i,
      /\b(homework|essay|school|university|maths|mathematics)\b/i
    ];
    if(outOfScopePatterns.some(pattern=>pattern.test(message))){
      return {
        reply:"I’m the Customs IDP Review Agent. I can only help with the current document pack, customs data, source evidence, validation, customer strategy, discrepancies and review decisions.",
        action:"none",
        target:null,
        suggestions:[],
        strategyProposal:null
      };
    }
    const strategyRequest=pack?.type==="customer_strategy" || /\b(customer\s+strategy|customer\s+rule|for\s+this\s+customer|customer-specific|customer specific|record\s+(this|the)\s+strategy|save\s+(this|the)\s+strategy|create\s+(the\s+)?customer|from\s+now\s+on|always\s+(use|apply|take|treat|set))\b/i.test(String(message||""));
    const context={
      packId:pack.id,customer:pack.customer,ticket:pack.ticket,
      customerId:pack.customerId||null,
      customerContext:pack.customerContext||null,
      extractedData:pack.extractedData||{},
      workingRecord:pack.workingRecord||pack.extractedData?._workingRecord||null,
      uploadedFiles:pack.uploadedFiles||[],
      email:pack.email||null,
      assignedTo:pack.assignedTo||"Unassigned",
      customerStrategy:pack.customerStrategy||null,
      conversation:Array.isArray(pack.conversation)?pack.conversation.slice(-12):[]
    };
    const prompt=[
      "You are the Customs IDP Review Agent for this Customs IDP application. You are NOT a general-purpose assistant.",
      "STRICT SCOPE: You may ONLY discuss or act on the current document pack, customs extraction, source evidence, document discrepancies, validation results, customer strategy, field corrections explicitly requested by the user, weight reconciliation/apportionment, freight reconciliation, EORI/address information, and other customs-processing workflow decisions represented in the supplied pack context.",
      "If the user asks for anything unrelated to the current Customs IDP workflow — including recipes, cooking, general knowledge, weather, sports, entertainment, coding help, homework, personal advice, or unrelated research — DO NOT answer that request. Politely state that you are restricted to Customs IDP work and ask them to ask a question about the current pack instead.",
      "Do not browse for, retrieve, generate, or substitute outside information to answer an out-of-scope request.",
      "Use ONLY the supplied pack context. Do not invent document values, pages, rules, or corrections.",
      "The supplied pack context may include an email object containing subject, sender, recipient, body text, received time, and configured email extraction results. You ARE allowed to answer explicit questions about the email itself. If the user asks for a value from the email (for example invoice number, gross weight, net weight, customer reference, shipment reference, dates, names, addresses, or other information), read the email subject/body and return the value exactly as supported by the email. Do not claim the value came from an attachment when it came from the email.",
      "If the user explicitly asks to extract a field from the email, do not say that email field extraction is unavailable merely because no configured emailFields exist. Configured emailFields control automatic structured intake; they do not prevent the Review Agent from answering an explicit question using the retained email source.",
      "When answering an email-source question, keep the response concise: give the requested value, identify that it came from the email subject/body, and mention if the email does not contain the requested information. Do not reproduce the entire email unless the user asks for it.",
      "When the user asks you to check the email for information that is missing from the extracted documents, compare the email against the complete extracted and combined working customs record. Identify customs-relevant facts explicitly present in the email but absent from the documents. Return action suggest_field_updates with a human-reviewable suggestion for each supported missing value. Do not silently write or apply any value.",
      "This is a gap-analysis task, not a classification task. If the email supplies an HS/commodity code that is absent from the documents, surface it because it is missing document information; do not decide that it is correct, invent a classification, or automatically assign it to every line. Likewise, identify missing EORI, references, invoice numbers, origins, weights, quantities, Incoterms, freight, currency, addresses or other clearly identifiable customs-relevant information.",
      "Only recommend information that is actually stated or clearly identifiable in the email. Do not infer values from context or manufacture missing information. If the email value clearly maps to a particular invoice line, use that zero-based lineIndex; otherwise use scope primary and lineIndex null and explain the uncertainty.",
      "A suggestion is not a correction. Never return update_field merely because an email contains a value that is absent from the documents when the user only asked you to check the email. The correct action is suggest_field_updates so the human can confirm.",
      "When USER MESSAGE begins with [AUTOMATED EMAIL AUDIT], perform the same email-versus-document gap analysis proactively before the user opens the pack. Compare the email with the extracted data AND the combined working record. Look for customs-relevant information present in the email but missing from the combined data. This includes, but is not limited to, HS/commodity codes, invoice number, customer/shipment reference, EORI, freight, net/gross weights, quantities, country of origin, Incoterms, currency and addresses. Return suggest_field_updates for supported missing information and no suggestions when the email adds no relevant information. Never replace a populated document value and never silently apply a recommendation.",
      "The extraction data contains source documents and fieldEvidence. When answering source questions, name the document and page when available.",
      "If documents disagree, explicitly state the conflicting source values and do not silently choose one.",
      "If the user explicitly instructs you to change a field to a specific value, treat that as a direct correction instruction. The new value does NOT need to already exist in the supplied documents. Return an update_field action targeting the existing matching field. Record the user instruction as the reason; sourceDocumentId/sourcePage may be null when the new value comes from the user rather than a document.",
      "For a correction, action must be update_field and target must identify a top-level primary extraction field or a line field. For line-level corrections, use grossMassKg for gross weight and netMassKg for net weight. If the user names a line number, use the zero-based lineIndex for that line. For a top-level gross-weight correction, use totalGrossWeight. Keep the old value and explain that the new value came from the user's instruction when applicable.",
      "Do not apply customer-specific rules unless they are present in the supplied context.",
      "When a customer context is supplied, treat it as the complete customer context available to you for this request. Use the supplied customer profile and current strategy; do not invent customer facts.",
      strategyRequest?"This is a CUSTOMER STRATEGY request. Interpret the requested change using the supplied customer context and conversation. Return action strategy_proposal when the user is defining or confirming a strategy proposal. If the user explicitly asks to create the customer, return action create_customer and include the proposed customer name in target.customerName. If the user explicitly asks to record/save the confirmed strategy, return action save_customer_strategy and include a complete resultingStrategy plus target.customerName. The frontend will perform the database write and will only tell the user it was saved after the API confirms it. Return a complete resultingStrategy object. Preserve existing legacy keys unchanged. weightHandling must be ask_user, invoice or packing_list. When the user explicitly requires automatic weight apportionment, set autoApplyWeightApportionment=true. When the user explicitly says line currency always equals header currency, set lineCurrencyFromHeader=true. When the user explicitly says total invoice amount is the sum of item-line amounts, set totalInvoiceFromLines=true. When explicit exporter/importer address rules are given, store them in exporterAddress/importerAddress. Never claim that a strategy or customer has been created or saved unless the action is create_customer or save_customer_strategy. If clarification is needed, return action strategy_clarification and strategyProposal null.":"",
      "For document-level total weights with missing line-level weights, ask the user whether they want the configured apportionment method applied unless the supplied customer strategy explicitly enables automatic weight apportionment.",
      "If the recent conversation shows that you already asked the user to approve weight apportionment and the user responds with a clear approval such as \"yes\", \"yes apply\", \"apply it\", or \"do it\", return action approve_weight_apportionment. Also return approve_weight_apportionment when the user directly instructs you to apportion the document-level weights using the configured method. Do not require the user to repeat the method if it has already been established in the conversation. The configured method is: allocate total net weight by line value, then allocate total gross weight by the resulting net-weight ratio, with final values rounded to a maximum of 3 decimal places while preserving the document totals.",
      "CUSTOMER STRATEGY RULE: If the user gives a durable rule intended to apply to this customer on future packs (for example says 'always', 'from now on', 'for this customer', or describes a repeatable extraction, field-mapping, validation, email, weight or address rule), treat it as a customer strategy request, not just a one-pack correction. Return strategy_proposal with a complete resultingStrategy that preserves all existing strategy keys and adds the new rule in instructions, extractionRules, validationRules or fieldRules as appropriate. Do not claim it is saved yet. If the user clearly asks to save/apply/remember the rule, return save_customer_strategy with the complete resultingStrategy. If the customer is not yet created or cannot be resolved, explain that and ask for the missing customer association rather than silently dropping the rule.",
      "Return concise, operational answers.",
      "USER MESSAGE:\\n"+message,
      "PACK CONTEXT:\\n"+JSON.stringify(context)
    ].join("\\n\\n");
    const schema={
      type:"object",additionalProperties:false,
      properties:{
        reply:{type:"string"},
        action:{type:"string",enum:["none","update_field","approve_weight_apportionment","suggest_field_updates","strategy_proposal","strategy_clarification","create_customer","save_customer_strategy"]},
        suggestions:{type:"array",items:{type:"object",additionalProperties:false,properties:{
          scope:{type:"string",enum:["line","primary"]},
          field:{type:"string"},
          lineIndex:{type:["integer","null"]},
          value:{type:"string"},
          sourceDocumentId:{type:["string","null"]},
          sourcePage:{type:["integer","null"]},
          sourceLabel:{type:"string"},
          reason:{type:"string"}
        },required:["scope","field","lineIndex","value","sourceDocumentId","sourcePage","sourceLabel","reason"]}},
        strategyProposal:{type:["object","null"],additionalProperties:false,properties:{
          changes:{type:"array",items:{type:"object",additionalProperties:false,properties:{before:{type:"string"},after:{type:"string"}},required:["before","after"]}},
          resultingStrategy:{type:["object","null"],additionalProperties:false,properties:{
            instructions:{type:"string"},
            requiredFields:{type:"array",items:{type:"string"}},
            weightHandling:{type:"string",enum:["ask_user","invoice","packing_list"]},
            extractionRules:{type:"array",items:{type:"string"}},
            validationRules:{type:"array",items:{type:"string"}},
            fieldRules:{type:"array",items:{type:"string"}},
            customValidations:{type:"array",items:{type:"string"}},
            emailFields:{type:"array",items:{type:"string"}},
            autoApplyWeightApportionment:{type:"boolean"},
            lineCurrencyFromHeader:{type:"boolean"},
            totalInvoiceFromLines:{type:"boolean"},
            exporterAddress:{type:"string"},
            importerAddress:{type:"string"}
          },required:["instructions","requiredFields","weightHandling","extractionRules","validationRules","fieldRules","customValidations","emailFields","autoApplyWeightApportionment","lineCurrencyFromHeader","totalInvoiceFromLines","exporterAddress","importerAddress"]}
        },required:["changes","resultingStrategy"]},
        target:{type:["object","null"],additionalProperties:false,properties:{
          scope:{type:"string",enum:["primary","line"]},
          field:{type:"string"},
          lineIndex:{type:["integer","null"]},
          value:{type:["string","number","boolean","null"]},
          sourceDocumentId:{type:["string","null"]},
          sourcePage:{type:["integer","null"]},
          customerName:{type:["string","null"]}
        },required:["scope","field","lineIndex","value","sourceDocumentId","sourcePage","customerName"]}
      },
      required:["reply","action","target","suggestions","strategyProposal"]
    };
    const controller=new AbortController();
    const timeout=setTimeout(()=>controller.abort(),30000);
    let response;
    try{
      response=await fetch("https://api.openai.com/v1/responses",{method:"POST",headers:{"Content-Type":"application/json","Authorization":"Bearer "+process.env.OPENAI_API_KEY},signal:controller.signal,body:JSON.stringify({
      model:"gpt-5.6-luna",
      input:[{role:"user",content:[{type:"input_text",text:prompt}]}],
      text:{format:{type:"json_schema",name:"customs_agent_response",strict:true,schema}}
      })});
    } finally { clearTimeout(timeout); }
    const data=await response.json();
    if(!response.ok)throw new Error(data?.error?.message||"Agent request failed");
    const text=data.output_text||data.output?.flatMap(x=>x.content||[]).find(x=>x.type==="output_text")?.text;
    if(!text)throw new Error("Agent returned no response");
    return JSON.parse(text);
  }catch(error){
    const message=error?.name==="AbortError"?"The review agent timed out after 30 seconds.":(error.message||"Agent failed");
    throw new Error(message);
  }
}

export default async function handler(req,res){
  if(!requireAuth(req,res))return;
  if(req.method!=="POST")return res.status(405).json({error:"Method not allowed"});
  const {message,pack}=req.body||{};
  if(!message||!pack)return res.status(400).json({error:"message and pack are required"});
  try{
    return res.status(200).json(await runReviewAgent({message,pack}));
  }catch(error){
    return res.status(500).json({error:error?.message||"Agent failed"});
  }
}
