import { requireAuth } from "./authGuard.js";
import { listEmailJobs, retryEmailJob } from "../services/emailIngestJobs.js";

export default async function handler(req,res){
  const auth=requireAuth(req,res);
  if(!auth)return;
  if(req.method==="GET"){
    try{return res.status(200).json({jobs:await listEmailJobs(auth.organisationId)});}
    catch(error){return res.status(503).json({error:error.message||"Unable to load email jobs."});}
  }
  if(req.method==="POST"){
    if(!["manager","admin"].includes(String(auth.role||"").toLowerCase()))return res.status(403).json({error:"Only managers can retry failed email intake."});
    const id=String(req.body?.jobId||"").trim();
    if(!id)return res.status(400).json({error:"jobId is required."});
    try{
      const job=await retryEmailJob(auth.organisationId,id);
      if(!job)return res.status(404).json({error:"Failed email job was not found."});
      return res.status(200).json({ok:true,job});
    }catch(error){return res.status(503).json({error:error.message||"Unable to retry email job."});}
  }
  return res.status(405).json({error:"Method not allowed"});
}

