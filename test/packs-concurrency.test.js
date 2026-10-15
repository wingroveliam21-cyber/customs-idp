import assert from "node:assert/strict";
import test from "node:test";
import handler from "../src/server/api/packs.js";
import { createAuthCookie } from "../src/server/api/authGuard.js";

process.env.IDP_AUTH_SECRET="packs-concurrency-test-secret";

function response(){return {statusCode:200,body:null,status(code){this.statusCode=code;return this;},json(value){this.body=value;return this;}};}

async function withSupabaseFetch(fetchImpl,callback){
  const original={url:process.env.SUPABASE_URL,key:process.env.SUPABASE_SERVICE_ROLE_KEY,fetch:globalThis.fetch};
  process.env.SUPABASE_URL="https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY="service-role-test";
  globalThis.fetch=fetchImpl;
  try{return await callback();}
  finally{
    globalThis.fetch=original.fetch;
    if(original.url===undefined)delete process.env.SUPABASE_URL;else process.env.SUPABASE_URL=original.url;
    if(original.key===undefined)delete process.env.SUPABASE_SERVICE_ROLE_KEY;else process.env.SUPABASE_SERVICE_ROLE_KEY=original.key;
  }
}

const cookie=createAuthCookie({organisationId:"org-1",userId:"user-1",role:"manager"},{secure:false}).split(";")[0];
const request=updatedAt=>({method:"POST",headers:{cookie},body:{id:"PK-1",packUuid:"11111111-1111-4111-8111-111111111111",organisationId:"org-1",status:"Needs review",updated_at:updatedAt,uploadedFiles:[]}});

test("whole-pack updates reject stale client versions",async()=>{
  let calls=0;
  await withSupabaseFetch(async url=>{
    calls++;
    if(String(url).includes("/organisations?"))return Response.json([{id:"org-1",name:"Org",status:"active"}]);
    if(String(url).includes("/document_packs?"))return Response.json([{id:"PK-1",pack_uuid:"11111111-1111-4111-8111-111111111111",organisation_id:"org-1",updated_at:"2026-10-11T08:00:00.000Z",extracted_data:{_manager:{uploadedFiles:[]}}}]);
    throw new Error("Unexpected request: "+url);
  },async()=>{
    const res=response();
    await handler(request("2026-10-11T07:00:00.000Z"),res);
    assert.equal(res.statusCode,409);
    assert.match(res.body.error,/changed while you were editing/i);
    assert.equal(calls,2);
  });
});

test("whole-pack updates use an atomic updated-at condition",async()=>{
  const urls=[];
  await withSupabaseFetch(async(url,options={})=>{
    urls.push(String(url));
    if(String(url).includes("/organisations?"))return Response.json([{id:"org-1",name:"Org",status:"active"}]);
    if(String(url).includes("/document_packs?")&&options.method!=="PATCH")return Response.json([{id:"PK-1",pack_uuid:"11111111-1111-4111-8111-111111111111",organisation_id:"org-1",updated_at:"2026-10-11T08:00:00.000Z",extracted_data:{_manager:{uploadedFiles:[]}}}]);
    if(options.method==="PATCH")return Response.json([{...JSON.parse(options.body),organisation_id:"org-1"}]);
    throw new Error("Unexpected request: "+url);
  },async()=>{
    const res=response();
    await handler(request("2026-10-11T08:00:00.000Z"),res);
    assert.equal(res.statusCode,200);
    assert.ok(urls.some(url=>url.includes("updated_at=eq.2026-10-11T08%3A00%3A00.000Z")));
  });
});

test("pack creation returns the database timestamp used by the immediate metadata update",async()=>{
  let stored=null;
  const databaseTimestamp="2026-10-13T09:30:00.123+00:00";
  await withSupabaseFetch(async(url,options={})=>{
    const path=String(url);
    if(path.includes("/organisations?"))return Response.json([{id:"org-1",name:"Org",status:"active"}]);
    if(path.includes("/document_packs?")&&options.method!=="PATCH")return Response.json(stored?[stored]:[]);
    if(path.endsWith("/document_packs")&&options.method==="POST"){
      assert.equal(options.headers.Prefer,"return=representation");
      stored={...JSON.parse(options.body),updated_at:databaseTimestamp};
      return Response.json([stored]);
    }
    if(options.method==="PATCH"){
      assert.match(path,/updated_at=eq.2026-10-13T09%3A30%3A00.123%2B00%3A00/);
      stored={...stored,...JSON.parse(options.body)};
      return Response.json([stored]);
    }
    throw new Error("Unexpected request: "+url);
  },async()=>{
    const createRes=response();
    await handler(request(undefined),createRes);
    assert.equal(createRes.statusCode,200);
    assert.equal(createRes.body.pack.updated_at,databaseTimestamp);

    const updateRes=response();
    await handler({...request(databaseTimestamp),body:{...request(databaseTimestamp).body,status:"Processing"}},updateRes);
    assert.equal(updateRes.statusCode,200);
  });
});
