import assert from "node:assert/strict";
import test from "node:test";
import { replacePersistedPack, savePackRequest } from "../src/services/packPersistence.js";

test("savePackRequest returns the server version used for the next optimistic update", async () => {
  const submitted = { id: "PK-1", status: "Processing" };
  const saved = { ...submitted, updated_at: "2026-10-11T09:10:03.317Z" };
  let request;

  const result = await savePackRequest(submitted, async (url, options) => {
    request = { url, options };
    return new Response(JSON.stringify({ pack: saved }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  });

  assert.deepEqual(result, saved);
  assert.equal(request.url, "/api/packs");
  assert.deepEqual(JSON.parse(request.options.body), submitted);
});

test("savePackRequest rejects a successful response without a persisted pack", async () => {
  await assert.rejects(
    savePackRequest({ id: "PK-1" }, async () => new Response("{}", {
      status: 200,
      headers: { "Content-Type": "application/json" }
    })),
    /did not return the persisted pack/
  );
});

test("replacePersistedPack retains the database version in workspace state", () => {
  const stale = { id: "PK-1", updated_at: "v1", status: "Processing" };
  const saved = { id: "PK-1", updated_at: "v2", status: "Needs review" };
  const other = { id: "PK-2", updated_at: "v1" };

  assert.deepEqual(replacePersistedPack([stale, other], saved), [saved, other]);
});
