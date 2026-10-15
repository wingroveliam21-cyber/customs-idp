alter table public.email_ingest_jobs
  add column if not exists attempt_token uuid;

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
