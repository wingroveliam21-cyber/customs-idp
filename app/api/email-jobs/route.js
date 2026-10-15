import handler from "../../../src/server/api/email-jobs.js";
import { runLegacyHandler } from "../../../src/server/nextLegacyAdapter.js";

export const runtime="nodejs";

function requestFor(request,body={}){return {method:request.method,headers:Object.fromEntries(request.headers.entries()),body};}
export async function GET(request){return runLegacyHandler(handler,requestFor(request));}
export async function POST(request){return runLegacyHandler(handler,requestFor(request,await request.json().catch(()=>({}))));}

