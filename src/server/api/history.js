import { requireAuth } from "./authGuard.js";

async function supabaseFetch(path,options={}){
  const url=process.env.SUPABASE_URL, key=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!url||!key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are not configured in Vercel.");
  const response=await fetch(url+"/rest/v1/"+path,{
    ...options,
    headers:{
      apikey:key,
      Authorization:"Bearer "+key,
      "Content-Type":"application/json",
      ...(options.headers||{})
    }
  });
  if(!response.ok) throw new Error(await response.text());
  const body=await response.text();
  return body?JSON.parse(body):[];
}

export default async function handler(req,res){
  const auth=requireAuth(req,res);
  if(!auth)return;

  if(req.method==="GET"){
    const packId=String(req.query?.packId||"").trim();
    if(!packId)return res.status(400).json({error:"Pack id is required"});
    try{
      const rows=await supabaseFetch(
        "pack_history?organisation_id=eq."+encodeURIComponent(auth.organisationId)+"&pack_id=eq."+encodeURIComponent(packId)+"&select=*&order=created_at.desc"
      );
      return res.status(200).json({history:rows});
    }catch(error){return res.status(503).json({error:error.message});}
  }

  if(req.method==="POST"){
    try{
      const body=req.body||{};
      const packId=String(body.packId||"").trim();
      const action=String(body.action||"").trim();
      if(!packId||!action)return res.status(400).json({error:"Pack id and action are required"});
      const packs=await supabaseFetch("document_packs?organisation_id=eq."+encodeURIComponent(auth.organisationId)+"&id=eq."+encodeURIComponent(packId)+"&select=id&limit=1");
      if(!packs?.[0])return res.status(404).json({error:"Pack not found or access denied"});

      const row={
        organisation_id:auth.organisationId,
        pack_id:packId,
        user_id:auth.userId||null,
        actor_name:String(auth.name||auth.email||"Customs IDP User"),
        actor_type:"user",
        action,
        description:String(body.description||action),
        before_data:body.beforeData??null,
        after_data:body.afterData??null,
        metadata:body.metadata??null
      };

      await supabaseFetch("pack_history",{
        method:"POST",
        headers:{"Prefer":"return=minimal"},
        body:JSON.stringify(row)
      });
      return res.status(201).json({history:row});
    }catch(error){return res.status(503).json({error:error.message});}
  }

  return res.status(405).json({error:"Method not allowed"});
}
