-- Multi-tenant foundation: organisations, memberships and pack ownership.
-- Safe to run against the existing Customs IDP Supabase database.
-- Existing document_packs rows are assigned to the demo organisation.

create table if not exists public.organisations (
  id text primary key,
  name text not null,
  slug text not null unique,
  status text not null default 'active',
  created_at timestamptz not null default now()
);

create table if not exists public.organisation_members (
  id uuid primary key default gen_random_uuid(),
  organisation_id text not null references public.organisations(id) on delete cascade,
  user_id text not null,
  role text not null default 'member',
  created_at timestamptz not null default now(),
  unique (organisation_id, user_id)
);

insert into public.organisations (id,name,slug)
values ('demo-organisation','Customs IDP Demo Organisation','demo-organisation')
on conflict (id) do nothing;

alter table public.document_packs
  add column if not exists organisation_id text;

update public.document_packs
set organisation_id='demo-organisation'
where organisation_id is null;

alter table public.document_packs
  alter column organisation_id set default 'demo-organisation';

create index if not exists document_packs_organisation_id_idx
  on public.document_packs (organisation_id);

create index if not exists organisation_members_user_id_idx
  on public.organisation_members (user_id);

alter table public.organisations enable row level security;
alter table public.organisation_members enable row level security;
alter table public.document_packs enable row level security;

-- Direct Supabase client access is denied by default.
-- The current server API uses the service role and performs tenant scoping itself.
-- These policies become the second security boundary when user authentication
-- is moved to Supabase Auth / JWT organisation claims.

drop policy if exists "organisations_member_read" on public.organisations;
create policy "organisations_member_read"
on public.organisations
for select
to authenticated
using (
  exists (
    select 1
    from public.organisation_members m
    where m.organisation_id=organisations.id
      and m.user_id=auth.uid()::text
  )
);

drop policy if exists "organisation_members_self_read" on public.organisation_members;
create policy "organisation_members_self_read"
on public.organisation_members
for select
to authenticated
using (user_id=auth.uid()::text);

drop policy if exists "document_packs_member_read" on public.document_packs;
create policy "document_packs_member_read"
on public.document_packs
for select
to authenticated
using (
  exists (
    select 1
    from public.organisation_members m
    where m.organisation_id=document_packs.organisation_id
      and m.user_id=auth.uid()::text
  )
);
