import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("email job claim migration terminalizes expired jobs at their retry limit",async()=>{
  const sql=await readFile(new URL("../supabase/migrations/20261011100000_pack_processing_leases.sql",import.meta.url),"utf8");
  assert.match(sql,/attempts\s*<\s*max_attempts/i);
  assert.match(sql,/attempts\s*>=\s*max_attempts/i);
  assert.match(sql,/status\s*=\s*'failed'/i);
});
