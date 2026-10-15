import { requireAuth } from "./authGuard.js";
import { normalizePack, packToRow, supabaseFetch } from "../services/packRepository.js";
import { createClient } from "@supabase/supabase-js";

export default async function handler(req,res){
  const auth=requireAuth(req,res);
  if(!auth)return;

  const organisationId=auth.organisationId;

  if(req.method==="GET"){
    try{
      const rows=await supabaseFetch(
        `document_packs?organisation_id=eq.${encodeURIComponent(organisationId)}&select=*&order=created_at.desc`
      );
      return res.status(200).json({packs:rows.map(normalizePack)});
    }catch(error){return res.status(503).json({error:error.message});}
  }

  if(req.method==="POST"){
    try{
      const pack=req.body||{};
      if(!pack.id) return res.status(400).json({error:"Pack id is required"});

      const requestedOrganisationId=String(pack.organisationId||organisationId).trim()||organisationId;
      if(requestedOrganisationId!==organisationId){
        return res.status(403).json({error:"Pack organisation does not match the active organisation."});
      }

      const organisation=await getOrganisation(organisationId);
      if(!organisation){
        return res.status(403).json({error:"Organisation is not configured."});
      }

      const existing=await supabaseFetch(`document_packs?id=eq.${encodeURIComponent(pack.id)}&select=id,pack_uuid,organisation_id,extracted_data,updated_at,processing_token,processing_lease_until&limit=1`);
      if(existing?.[0]&&String(existing[0].organisation_id)!==String(organisationId)){
        return res.status(409).json({error:"Pack id is already in use."});
      }

      const sourceError=validateSourceMetadata(pack,existing?.[0],organisationId);
      if(sourceError)return res.status(422).json({error:sourceError});
      if(existing?.[0]?.pack_uuid)pack.packUuid=existing[0].pack_uuid;
      if(existing?.[0]?.processing_token&&new Date(existing[0].processing_lease_until||0).getTime()>Date.now()){
        return res.status(409).json({error:"This pack is currently being processed. Wait for processing to finish before editing it."});
      }

      const row=packToRow({...pack,organisationId:organisation.id,organisationName:organisation.name});
      if(existing?.[0]){
        const expectedUpdatedAt=String(pack.updated_at||"").trim();
        if(!expectedUpdatedAt||expectedUpdatedAt!==String(existing[0].updated_at||"")){
          return res.status(409).json({error:"This pack changed while you were editing it. Reload it before saving again."});
        }
        const updated=await supabaseFetch(`document_packs?id=eq.${encodeURIComponent(pack.id)}&organisation_id=eq.${encodeURIComponent(organisationId)}&updated_at=eq.${encodeURIComponent(expectedUpdatedAt)}`,{
          method:"PATCH",
          body:JSON.stringify(row),
          headers:{Prefer:"return=representation"}
        });
        if(!updated?.[0])return res.status(409).json({error:"This pack changed while you were editing it. Reload it before saving again."});
        return res.status(200).json({pack:normalizePack(updated[0])});
      }

      const created=await supabaseFetch("document_packs",{method:"POST",body:JSON.stringify(row),headers:{Prefer:"return=representation"}});
      if(!created?.[0])throw new Error("The created pack could not be reloaded.");
      return res.status(200).json({pack:normalizePack(created[0])});
    }catch(error){return res.status(503).json({error:error.message});}
  }

  if(req.method==="DELETE"){
    try{
      const role=String(auth.role||"").toLowerCase();
      if(!["manager","admin"].includes(role)) return res.status(403).json({error:"Only managers can delete packs"});

      const id=String(req.query?.id||"").trim();
      if(!id) return res.status(400).json({error:"Pack id is required"});

      const rows=await supabaseFetch(`document_packs?id=eq.${encodeURIComponent(id)}&organisation_id=eq.${encodeURIComponent(organisationId)}&select=id,extracted_data&limit=1`);
      const pack=rows?.[0];
      if(!pack)return res.status(404).json({error:"Pack not found"});
      const files=Array.isArray(pack.extracted_data?._manager?.uploadedFiles)?pack.extracted_data._manager.uploadedFiles:[];
      const canonicalPrefix=`organisations/${cleanSegment(organisationId)}/packs/`;
      const legacyPrefix=cleanSegment(id)+"/";
      const paths=files.map(file=>String(file?.storagePath||"")).filter(path=>path.startsWith(canonicalPrefix)||path.startsWith(legacyPrefix));
      if(paths.length){
        const url=process.env.SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;
        if(!url||!key)throw new Error("Supabase storage configuration is missing.");
        const client=createClient(url,key,{auth:{autoRefreshToken:false,persistSession:false}});
        const {error}=await client.storage.from("CUSTOMS-DOCUMENTS").remove(paths);
        if(error)throw new Error("Source documents could not be deleted: "+error.message);
      }

      await supabaseFetch(
        `document_packs?id=eq.${encodeURIComponent(id)}&organisation_id=eq.${encodeURIComponent(organisationId)}`,
        {method:"DELETE",headers:{"Prefer":"return=minimal"}}
      );

      return res.status(200).json({deleted:id,organisationId});
    }catch(error){return res.status(503).json({error:error.message});}
  }

  return res.status(405).json({error:"Method not allowed"});
}

function validateSourceMetadata(pack,existing,organisationId){
  const incoming=Array.isArray(pack.uploadedFiles)?pack.uploadedFiles:[];
  if(incoming.length>20)return "A pack cannot contain more than 20 source documents.";
  if(new Set(incoming.map(file=>String(file?.id||""))).size!==incoming.length||incoming.some(file=>!file?.id))return "Each source document must have a unique id.";
  const persisted=Array.isArray(existing?.extracted_data?._manager?.uploadedFiles)?existing.extracted_data._manager.uploadedFiles:[];
  if(!existing&&incoming.some(file=>file?.storagePath))return "New packs must be created before source documents are uploaded.";
  const byId=new Map(persisted.map(file=>[String(file?.id),file]));
  for(const file of incoming){
    const previous=byId.get(String(file?.id));
    if(existing&&!previous)return "Source document metadata cannot be added through the pack update endpoint.";
    if(previous&&(file.name!==previous.name||Number(file.size)!==Number(previous.size)||file.type!==previous.type))return "Source document metadata is immutable.";
    if(previous?.storagePath&&file.storagePath!==previous.storagePath)return "Source document storage paths are immutable.";
    if(previous&&!previous.storagePath&&file.storagePath){
      const prefix=`organisations/${cleanSegment(organisationId)}/packs/${cleanSegment(existing.pack_uuid||existing.id)}/${cleanSegment(file.id)}-`;
      if(!String(file.storagePath).startsWith(prefix))return "Source document storage path is outside the pack namespace.";
    }
  }
  return null;
}

function cleanSegment(value){return String(value||"").replace(/[^a-zA-Z0-9._-]+/g,"-").replace(/^-+|-+$/g,"")||"document";}

async function getOrganisation(id){
  const rows=await supabaseFetch(
    `organisations?id=eq.${encodeURIComponent(id)}&select=id,name,status&limit=1`
  );
  const organisation=rows?.[0];
  if(!organisation||organisation.status!=="active")return null;
  return organisation;
}
