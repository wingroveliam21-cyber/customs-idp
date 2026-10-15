import { requireAuth } from "./authGuard.js";
import { createClient } from "@supabase/supabase-js";

const BUCKET="CUSTOMS-DOCUMENTS";
const SIGNED_URL_TTL_SECONDS=10*60;
const MAX_FILE_SIZE=25*1024*1024;
const ALLOWED_TYPES=new Set([
  "application/pdf","image/png","image/jpeg","image/webp","text/csv","application/csv",
  "application/vnd.ms-excel","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/msword","application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "message/rfc822","application/vnd.ms-outlook"
]);
const ALLOWED_EXTENSIONS=new Set([".pdf",".png",".jpg",".jpeg",".webp",".csv",".xls",".xlsx",".doc",".docx",".eml",".msg"]);

export function isSupportedUpload(name,type){
  const contentType=String(type||"").trim().toLowerCase();
  if(ALLOWED_TYPES.has(contentType))return true;
  if(contentType&&contentType!=="application/octet-stream")return false;
  const filename=String(name||"").toLowerCase();
  return [...ALLOWED_EXTENSIONS].some(extension=>filename.endsWith(extension));
}

function getClient(){
  const url=process.env.SUPABASE_URL;
  const key=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!url||!key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are not configured in Vercel.");
  return createClient(url,key,{auth:{autoRefreshToken:false,persistSession:false}});
}

function cleanSegment(value){
  return String(value||"").replace(/[^a-zA-Z0-9._-]+/g,"-").replace(/^-+|-+$/g,"")||"document";
}

async function supabaseFetch(path,options={}){
  const url=process.env.SUPABASE_URL, key=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!url||!key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are not configured in Vercel.");
  const response=await fetch(`${url}/rest/v1/${path}`,{
    ...options,
    headers:{
      apikey:key,
      Authorization:`Bearer ${key}`,
      "Content-Type":"application/json",
      ...(options.headers||{})
    }
  });
  if(!response.ok) throw new Error(await response.text());
  const text=await response.text();
  return text?JSON.parse(text):[];
}

async function loadOwnedPack(organisationId,packId){
  const rows=await supabaseFetch(`document_packs?id=eq.${encodeURIComponent(packId)}&organisation_id=eq.${encodeURIComponent(organisationId)}&select=id,pack_uuid,organisation_id,extracted_data&limit=1`);
  return rows?.[0]||null;
}

function sourceFiles(row){
  const files=row?.extracted_data?._manager?.uploadedFiles;
  return Array.isArray(files)?files:[];
}

export default async function handler(req,res){
  const auth=requireAuth(req,res);
  if(!auth)return;
  try{
    if(req.method==="POST"){
      const {action,packId,fileId}=req.body||{};

      if(action==="upload-url"){
        if(!packId||!fileId) return res.status(400).json({error:"packId and fileId are required"});
        const row=await loadOwnedPack(auth.organisationId,String(packId));
        if(!row)return res.status(404).json({error:"Pack not found or access denied"});
        const file=sourceFiles(row).find(item=>String(item?.id)===String(fileId));
        if(!file)return res.status(404).json({error:"Source file not found or access denied"});
        const size=Number(file.size)||0;
        const contentType=String(file.type||"application/octet-stream").toLowerCase();
        if(size<=0||size>MAX_FILE_SIZE)return res.status(422).json({error:"File size is invalid or exceeds 25 MB."});
        if(!isSupportedUpload(file.name,contentType))return res.status(422).json({error:"File type is not supported."});
        const supabase=getClient();
        const safeName=cleanSegment(file.name);
        const storagePath=`organisations/${cleanSegment(auth.organisationId)}/packs/${cleanSegment(row.pack_uuid||row.id)}/${cleanSegment(file.id)}-${safeName}`;
        const {data,error}=await supabase.storage.from(BUCKET).createSignedUploadUrl(storagePath,{upsert:false});
        if(error) return res.status(500).json({error:error.message});
        return res.status(200).json({
          bucket:BUCKET,
          path:storagePath,
          signedUrl:data.signedUrl,
        });
      }

      if(action==="signed-url"){
        if(!packId||!fileId)return res.status(400).json({error:"packId and fileId are required"});
        const row=await loadOwnedPack(auth.organisationId,String(packId));
        if(!row)return res.status(404).json({error:"Pack not found or access denied"});
        const file=sourceFiles(row).find(item=>String(item?.id)===String(fileId));
        const path=String(file?.storagePath||"");
        if(!file||!path)return res.status(404).json({error:"Source file not found or access denied"});
        const canonicalPrefix=`organisations/${cleanSegment(auth.organisationId)}/packs/${cleanSegment(row.pack_uuid||row.id)}/`;
        const legacyPrefix=cleanSegment(row.id)+"/";
        if(!path.startsWith(canonicalPrefix)&&!path.startsWith(legacyPrefix))return res.status(403).json({error:"Source file is outside the pack storage namespace"});
        const supabase=getClient();
        const {data,error}=await supabase.storage.from(BUCKET).createSignedUrl(path,SIGNED_URL_TTL_SECONDS);
        if(error) return res.status(404).json({error:error.message});
        return res.status(200).json({
          bucket:BUCKET,
          path,
          signedUrl:data.signedUrl,
          accessUrl:data.signedUrl,
          accessUrlExpiresAt:new Date(Date.now()+SIGNED_URL_TTL_SECONDS*1000).toISOString()
        });
      }
      if(action==="list-pack"){
        if(!packId) return res.status(400).json({error:"packId is required"});
        const row=await loadOwnedPack(auth.organisationId,String(packId));
        if(!row)return res.status(404).json({error:"Pack not found or access denied"});
        return res.status(200).json({bucket:BUCKET,packId:row.id,files:sourceFiles(row).map(file=>({...file,accessUrl:undefined,accessUrlExpiresAt:undefined}))});
      }


      return res.status(400).json({error:"Unknown storage action"});
    }

    if(req.method==="GET"){
      return res.status(405).json({error:"Use POST with packId and fileId."});
    }

    return res.status(405).json({error:"Method not allowed"});
  }catch(error){
    return res.status(500).json({error:error.message||"Storage operation failed"});
  }
}
