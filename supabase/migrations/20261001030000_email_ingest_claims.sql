-- Atomic email-ingest idempotency claim.
-- Prevents Outlook webhook + fallback polling races from starting two AI runs
-- for the same email.

create table if not exists public.email_ingest_claims (
  email_key text primary key,
  pack_id text not null,
  created_at timestamptz not null default now()
);

create or replace function public.claim_email_ingest(p_email_key text, p_pack_id text)
returns table(claimed boolean, pack_id text)
language plpgsql
security definer
set search_path = public
as $$
begin
  if nullif(trim(p_email_key), '') is null then
    raise exception 'email key is required';
  end if;

  insert into public.email_ingest_claims(email_key, pack_id)
  values (p_email_key, p_pack_id)
  on conflict (email_key) do nothing;

  return query
  select (c.pack_id = p_pack_id) as claimed, c.pack_id
  from public.email_ingest_claims c
  where c.email_key = p_email_key;
end;
$$;

revoke all on function public.claim_email_ingest(text,text) from public;
grant execute on function public.claim_email_ingest(text,text) to service_role;
