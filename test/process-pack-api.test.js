import test from "node:test";
import assert from "node:assert/strict";
import { createAuthCookie } from "../src/server/api/authGuard.js";
import { createProcessPackHandler } from "../src/server/api/process-pack.js";

process.env.IDP_AUTH_SECRET="process-pack-api-test-secret";

function response(){return {statusCode:200,body:null,status(code){this.statusCode=code;return this;},json(value){this.body=value;return this;}};}

test("process endpoint derives tenant and actor rather than trusting request input",async()=>{
  let input;
  const handler=createProcessPackHandler(async value=>{input=value;return {id:value.packId,status:"Ready"};});
  const cookie=createAuthCookie({organisationId:"org-safe",userId:"user-1",name:"Operator"},{secure:false}).split(";")[0];
  const res=response();
  await handler({method:"POST",headers:{cookie},body:{packId:"PK-1",reason:"initial",organisationId:"org-evil",dependencies:{savePack:"evil"}}},res);
  assert.equal(res.statusCode,200);
  assert.equal(input.organisationId,"org-safe");
  assert.equal(input.actor.userId,"user-1");
  assert.equal(input.actor.type,"user");
  assert.equal(input.dependencies,undefined);
});

test("process endpoint rejects invalid reasons before invoking the processor",async()=>{
  let called=false;
  const handler=createProcessPackHandler(async()=>{called=true;});
  const cookie=createAuthCookie({organisationId:"org-safe"},{secure:false}).split(";")[0];
  const res=response();
  await handler({method:"POST",headers:{cookie},body:{packId:"PK-1",reason:"delete"}},res);
  assert.equal(res.statusCode,400);
  assert.equal(called,false);
});
