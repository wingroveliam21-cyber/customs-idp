create table if not exists public.pack_history (
  id uuid primary key default gen_random_uuid(),
  organisation_id text not null,
  pack_id text not null,
  user_id text,
  actor_name text not null default 'Customs IDP System',
  actor_type text not null default 'system',
  action text not null,
  description text not null,
  before_data jsonb,
  after_data jsonb,
  metadata jsonb,
  created_at timestamptz not null default now()
);

create index if not exists pack_history_pack_idx on public.pack_history (organisation_id, pack_id, created_at desc);

alter table public.pack_history enable row level security;

drop policy if exists pack_history_member_read on public.pack_history;
create policy pack_history_member_read on public.pack_history
for select using (
  exists (
    select 1 from public.organisation_members m
    where m.organisation_id=pack_history.organisation_id
      and m.user_id=auth.uid()::text
  )
);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname='pack_history_pack_id_fkey'
  ) then
    alter table public.pack_history
      add constraint pack_history_pack_id_fkey
      foreign key (pack_id) references public.document_packs(id) on delete cascade;
  end if;
end $$;