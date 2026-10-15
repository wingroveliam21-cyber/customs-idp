import crypto from "node:crypto";
import { processQueuedResendJobs } from "../../../../src/server/api/resend-webhook.js";

export const runtime="nodejs";
export const maxDuration=300;

export async function GET(request){return handleProcessRequest(request);}
export async function POST(request){return handleProcessRequest(request);}

async function handleProcessRequest(request){
  const expected=String(process.env.CRON_SECRET||"").trim();
  const supplied=String(request.headers.get("authorization")||"").replace(/^Bearer\s+/i,"").trim();
  if(!expected)return Response.json({error:"CRON_SECRET is not configured."},{status:503});
  if(supplied.length!==expected.length||!crypto.timingSafeEqual(Buffer.from(supplied),Buffer.from(expected))){
    return Response.json({error:"Unauthorized"},{status:401});
  }
  try{return Response.json({ok:true,...await processQueuedResendJobs({limit:5})});}
  catch(error){return Response.json({ok:false,error:error?.message||"Email job worker failed."},{status:500});}
}
