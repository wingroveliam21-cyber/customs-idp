import handler from "../../../../src/server/api/process-pack.js";
import { runLegacyHandler } from "../../../../src/server/nextLegacyAdapter.js";

export const runtime="nodejs";
export const maxDuration=300;

export async function POST(request){
  const body=await request.json().catch(()=>({}));
  return runLegacyHandler(handler,{method:request.method,headers:Object.fromEntries(request.headers.entries()),body});
}

export async function GET(){return Response.json({error:"Method not allowed"},{status:405});}
export async function PUT(){return Response.json({error:"Method not allowed"},{status:405});}
export async function PATCH(){return Response.json({error:"Method not allowed"},{status:405});}
export async function DELETE(){return Response.json({error:"Method not allowed"},{status:405});}
