alter table public.document_packs
  add column if not exists processing_token uuid,
  add column if not exists processing_lease_until timestamptz;

create index if not exists document_packs_processing_lease_idx
  on public.document_packs(processing_lease_until)
  where processing_token is not null;

create or replace function public.claim_document_pack_processing(
  p_organisation_id text,
  p_pack_id text
)
returns setof public.document_packs
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  update public.document_packs p
  set processing_token=gen_random_uuid(),
      processing_lease_until=now()+interval '10 minutes',
      updated_at=now()
  where p.organisation_id=p_organisation_id
    and p.id=p_pack_id
    and (p.processing_token is null or p.processing_lease_until < now())
  returning p.*;
end;
$$;

revoke all on function public.claim_document_pack_processing(text,text) from public;
grant execute on function public.claim_document_pack_processing(text,text) to service_role;

create or replace function public.claim_email_ingest_jobs(p_limit integer default 5)
returns setof public.email_ingest_jobs
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.email_ingest_jobs
  set status='failed',
      stage='lease-expired',
      attempt_token=null,
      locked_until=null,
      last_error='Processing lease expired after the maximum number of attempts.',
      completed_at=now(),
      updated_at=now()
  where status='processing'
    and locked_until < now()
    and attempts >= max_attempts;

  return query
  with candidates as (
    select id
    from public.email_ingest_jobs
    where (status in ('pending','retry') or (status='processing' and locked_until < now()))
      and attempts < max_attempts
      and available_at <= now()
      and (locked_until is null or locked_until < now())
    order by created_at
    for update skip locked
    limit greatest(1, least(coalesce(p_limit, 5), 20))
  )
  update public.email_ingest_jobs j
  set status='processing',
      attempts=j.attempts+1,
      attempt_token=gen_random_uuid(),
      locked_until=now()+interval '10 minutes',
      updated_at=now()
  from candidates c
  where j.id=c.id
  returning j.*;
end;
$$;

revoke all on function public.claim_email_ingest_jobs(integer) from public;
grant execute on function public.claim_email_ingest_jobs(integer) to service_role;
