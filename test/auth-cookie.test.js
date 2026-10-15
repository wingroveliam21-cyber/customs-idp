import assert from "node:assert/strict";
import test from "node:test";
import { createAuthCookie, getAuthContext } from "../src/server/api/authGuard.js";

test("auth bridge cookie remains valid through the one-hour Supabase refresh window",()=>{
  const originalSecret=process.env.IDP_AUTH_SECRET;
  const originalNow=Date.now;
  process.env.IDP_AUTH_SECRET="auth-cookie-test-secret";
  try{
    const issuedAt=Date.parse("2026-10-13T10:00:00.000Z");
    Date.now=()=>issuedAt;
    const cookie=createAuthCookie({organisationId:"org-1",userId:"user-1"},{secure:false}).split(";")[0];
    Date.now=()=>issuedAt+59*60*1000;
    assert.equal(getAuthContext({headers:{cookie}})?.userId,"user-1");
    Date.now=()=>issuedAt+61*60*1000;
    assert.equal(getAuthContext({headers:{cookie}}),null);
  }finally{
    Date.now=originalNow;
    if(originalSecret===undefined)delete process.env.IDP_AUTH_SECRET;else process.env.IDP_AUTH_SECRET=originalSecret;
  }
});
