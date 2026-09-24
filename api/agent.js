export default async function handler(req,res){
  if(req.method!=="POST")return res.status(405).json({error:"Method not allowed"});
  if(!process.env.OPENAI_API_KEY)return res.status(500).json({error:"OPENAI_API_KEY is not configured in Vercel."});
  try{
    const {message,pack}=req.body||{};
    if(!message||!pack)return res.status(400).json({error:"message and pack are required"});
    const context={
      packId:pack.id,customer:pack.customer,ticket:pack.ticket,
      extractedData:pack.extractedData||{},
      uploadedFiles:pack.uploadedFiles||[],
      assignedTo:pack.assignedTo||"Unassigned"
    };
    const prompt=[
      "You are the Customs IDP review agent.",
      "Use ONLY the supplied pack context. Do not invent document values, pages, rules, or corrections.",
      "The extraction data contains source documents and fieldEvidence. When answering source questions, name the document and page when available.",
      "If documents disagree, explicitly state the conflicting source values and do not silently choose one.",
      "If the user explicitly instructs you to change a field to a specific value, treat that as a direct correction instruction. The new value does NOT need to already exist in the supplied documents. Return an update_field action targeting the existing matching field. Record the user instruction as the reason; sourceDocumentId/sourcePage may be null when the new value comes from the user rather than a document.",
      "For a correction, action must be update_field and target must identify a top-level primary extraction field or a line field. Map natural-language requests to the closest existing extracted field (for example, gross weight -> totalGrossWeight). Keep the old value and explain that the new value came from the user's instruction when applicable.",
      "Do not apply customer-specific rules unless they are present in the supplied context.",
      "Return concise, operational answers.",
      "USER MESSAGE:\\n"+message,
      "PACK CONTEXT:\\n"+JSON.stringify(context)
    ].join("\\n\\n");
    const schema={
      type:"object",additionalProperties:false,
      properties:{
        reply:{type:"string"},
        action:{type:"string",enum:["none","update_field"]},
        target:{type:["object","null"],additionalProperties:false,properties:{
          scope:{type:"string",enum:["primary","line"]},
          field:{type:"string"},
          lineIndex:{type:["integer","null"]},
          value:{type:["string","number","boolean","null"]},
          sourceDocumentId:{type:["string","null"]},
          sourcePage:{type:["integer","null"]}
        },required:["scope","field","lineIndex","value","sourceDocumentId","sourcePage"]}
      },
      required:["reply","action","target"]
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
    if(!response.ok)return res.status(response.status).json({error:data?.error?.message||"Agent request failed"});
    const text=data.output_text||data.output?.flatMap(x=>x.content||[]).find(x=>x.type==="output_text")?.text;
    if(!text)throw new Error("Agent returned no response");
    return res.status(200).json(JSON.parse(text));
  }catch(error){
    const message=error?.name==="AbortError"?"The review agent timed out after 30 seconds.":(error.message||"Agent failed");
    return res.status(500).json({error:message});
  }
}