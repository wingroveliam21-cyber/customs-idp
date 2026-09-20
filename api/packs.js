export default async function handler(req,res){
  if(req.method==="GET"){
    try{
      const rows=await supabaseFetch("document_packs?select=*&order=created_at.desc");
      return res.status(200).json({packs:rows.map(normalizePack)});
    }catch(error){return res.status(503).json({error:error.message});}
  }
  if(req.method==="POST"){
    try{
      const pack=req.body||{};
      if(!pack.id) return res.status(400).json({error:"Pack id is required"});
      const extractedData=pack.extractedData?{...pack.extractedData}:{};
      const managerMeta={processingStartedAt:pack.processingStartedAt||null,processingCompletedAt:pack.processingCompletedAt||null,uploadedFiles:Array.isArray(pack.uploadedFiles)?pack.uploadedFiles:[]};
      if(managerMeta.processingStartedAt||managerMeta.processingCompletedAt||managerMeta.uploadedFiles.length) extractedData._manager=managerMeta;
      const row={id:pack.id,customer:pack.customer||"Unassigned customer",docs:Number(pack.docs)||0,status:pack.status||"Processing",confidence:Number(pack.confidence)||0,received:pack.received||new Date().toISOString(),ticket:pack.ticket||null,assigned_to:pack.assignedTo||"Unassigned",extracted_data:Object.keys(extractedData).length?extractedData:null,processing_error:pack.processingError||null,updated_at:new Date().toISOString()};
      await supabaseFetch("document_packs",{method:"POST",body:JSON.stringify(row),headers:{"Prefer":"resolution=merge-duplicates,return=minimal"}});
      return res.status(200).json({pack:normalizePack(row)});
    }catch(error){return res.status(503).json({error:error.message});}
  }
  if(req.method==="DELETE"){
    try{
      const role=String(req.headers?.["x-user-role"]||"").toLowerCase();
      if(!["manager","admin"].includes(role)) return res.status(403).json({error:"Only managers can delete packs"});
      const id=String(req.query?.id||"").trim();
      if(!id) return res.status(400).json({error:"Pack id is required"});
      await supabaseFetch(`document_packs?id=eq.${encodeURIComponent(id)}`,{method:"DELETE",headers:{"Prefer":"return=minimal"}});
      return res.status(200).json({deleted:id});
    }catch(error){return res.status(503).json({error:error.message});}
  }
  return res.status(405).json({error:"Method not allowed"});
}
async function supabaseFetch(path,options={}){
  const url=process.env.SUPABASE_URL, key=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!url||!key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are not configured in Vercel.");
  const response=await fetch(`${url}/rest/v1/${path}`,{...options,headers:{"apikey":key,"Authorization":`Bearer ${key}`,"Content-Type":"application/json",...(options.headers||{})}});
  if(!response.ok) throw new Error(await response.text());
  const text=await response.text(); return text?JSON.parse(text):[];
}
function normalizePack(row){
  const data=row.extracted_data||null;
  const meta=data?._manager||{};
  let extractedData=data;
  if(data){const rest={...data};delete rest._manager;extractedData=Object.keys(rest).length?rest:undefined;}
  return {...row,assignedTo:row.assigned_to||"Unassigned",extractedData,uploadedFiles:Array.isArray(meta.uploadedFiles)?meta.uploadedFiles:undefined,processingStartedAt:meta.processingStartedAt||undefined,processingCompletedAt:meta.processingCompletedAt||undefined,processingError:row.processing_error||undefined};
}
