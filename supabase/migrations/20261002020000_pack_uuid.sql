-- Keep the legacy text id for internal compatibility, while exposing a stable
-- UUID for canonical pack URLs and route lookup.
alter table public.document_packs
  add column if not exists pack_uuid uuid default gen_random_uuid();

update public.document_packs
set pack_uuid=gen_random_uuid()
where pack_uuid is null;

alter table public.document_packs
  alter column pack_uuid set not null;

create unique index if not exists document_packs_pack_uuid_unique_idx
  on public.document_packs(pack_uuid);
