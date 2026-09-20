import { createClient } from "@supabase/supabase-js";

const BUCKET="CUSTOMS-DOCUMENTS";

function getClient(){
  const url=process.env.SUPABASE_URL;
  const key=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!url||!key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are not configured in Vercel.");
  return createClient(url,key,{auth:{autoRefreshToken:false,persistSession:false}});
}

function cleanSegment(value){
  return String(value||"").replace(/[^a-zA-Z0-9._-]+/g,"-").replace(/^-+|-+$/g,"")||"document";
}

export default async function handler(req,res){
  try{
    const supabase=getClient();

    if(req.method==="POST"){
      const {action,packId,filename,contentType,path}=req.body||{};

      if(action==="upload-url"){
        if(!packId||!filename) return res.status(400).json({error:"packId and filename are required"});
        const safePackId=cleanSegment(packId);
        const safeName=cleanSegment(filename);
        const storagePath=`${safePackId}/${Date.now()}-${safeName}`;
        const {data,error}=await supabase.storage.from(BUCKET).createSignedUploadUrl(storagePath,{upsert:false});
        if(error) return res.status(500).json({error:error.message});
        return res.status(200).json({bucket:BUCKET,path:storagePath,signedUrl:data.signedUrl});
      }

      if(action==="signed-url"){
        if(!path) return res.status(400).json({error:"path is required"});
        const {data,error}=await supabase.storage.from(BUCKET).createSignedUrl(path,3600);
        if(error) return res.status(404).json({error:error.message});
        return res.status(200).json({bucket:BUCKET,path,signedUrl:data.signedUrl});
      }
      if(action==="list-pack"){
        if(!packId) return res.status(400).json({error:"packId is required"});
        const safePackId=cleanSegment(packId);
        const {data,error}=await supabase.storage.from(BUCKET).list(safePackId,{limit:100,offset:0,sortBy:{column:"name",order:"asc"}});
        if(error) return res.status(500).json({error:error.message});
        const files=(data||[]).filter(item=>item?.name).map(item=>({
          id:`${safePackId}/${item.name}`,
          name:item.name.replace(/^\d+-/,""),
          storagePath:`${safePackId}/${item.name}`,
          size:item.metadata?.size||0,
          type:item.metadata?.mimetype||item.metadata?.contentType||"application/octet-stream"
        }));
        return res.status(200).json({bucket:BUCKET,packId:safePackId,files});
      }


      return res.status(400).json({error:"Unknown storage action"});
    }

    if(req.method==="GET"){
      const requestedPath=typeof req.query?.path==="string"?req.query.path:"";
      if(!requestedPath) return res.status(400).json({error:"path is required"});
      const {data,error}=await supabase.storage.from(BUCKET).createSignedUrl(requestedPath,3600);
      if(error) return res.status(404).json({error:error.message});
      return res.status(200).json({bucket:BUCKET,path:requestedPath,signedUrl:data.signedUrl});
    }

    return res.status(405).json({error:"Method not allowed"});
  }catch(error){
    return res.status(500).json({error:error.message||"Storage operation failed"});
  }
}
