create table if not exists public.email_ingest_jobs (
  id uuid primary key default gen_random_uuid(),
  organisation_id text not null references public.organisations(id) on delete cascade,
  provider text not null,
  provider_event_id text not null,
  provider_email_id text not null,
  payload jsonb not null,
  status text not null default 'pending' check (status in ('pending','processing','retry','failed','completed')),
  stage text not null default 'queued',
  attempts integer not null default 0,
  max_attempts integer not null default 5,
  available_at timestamptz not null default now(),
  locked_until timestamptz,
  last_error text,
  pack_id text references public.document_packs(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  unique(provider, provider_event_id)
);

create index if not exists email_ingest_jobs_ready_idx
  on public.email_ingest_jobs(status, available_at, created_at);
create index if not exists email_ingest_jobs_org_idx
  on public.email_ingest_jobs(organisation_id, created_at desc);

alter table public.email_ingest_jobs enable row level security;

create or replace function public.claim_email_ingest_jobs(p_limit integer default 5)
returns setof public.email_ingest_jobs
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with candidates as (
    select id
    from public.email_ingest_jobs
    where (status in ('pending','retry') or (status='processing' and locked_until < now()))
      and available_at <= now()
      and (locked_until is null or locked_until < now())
    order by created_at
    for update skip locked
    limit greatest(1, least(coalesce(p_limit, 5), 20))
  )
  update public.email_ingest_jobs j
  set status='processing',
      attempts=j.attempts+1,
      locked_until=now()+interval '5 minutes',
      updated_at=now()
  from candidates c
  where j.id=c.id
  returning j.*;
end;
$$;

revoke all on function public.claim_email_ingest_jobs(integer) from public;
grant execute on function public.claim_email_ingest_jobs(integer) to service_role;

create or replace function public.recover_stale_email_ingest_claim(p_email_key text, p_pack_id text)
returns table(claimed boolean, pack_id text)
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.email_ingest_claims c
  set pack_id=p_pack_id, created_at=now()
  where c.email_key=p_email_key
    and c.created_at < now()-interval '5 minutes'
    and not exists (select 1 from public.document_packs p where p.id=c.pack_id);

  return query
  select (c.pack_id=p_pack_id), c.pack_id
  from public.email_ingest_claims c
  where c.email_key=p_email_key;
end;
$$;

revoke all on function public.recover_stale_email_ingest_claim(text,text) from public;
grant execute on function public.recover_stale_email_ingest_claim(text,text) to service_role;
