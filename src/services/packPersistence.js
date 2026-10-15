export async function savePackRequest(pack, fetchImplementation = fetch) {
  const response = await fetchImplementation("/api/packs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(pack)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || ("Database save failed (HTTP " + response.status + ")"));
  if (!data.pack) throw new Error("Database save did not return the persisted pack");
  return data.pack;
}

export function replacePersistedPack(packs, savedPack) {
  if (!savedPack?.id) return packs;
  return packs.map(pack => pack.id === savedPack.id ? savedPack : pack);
}
