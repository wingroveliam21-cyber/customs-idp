-- Read-only checks for a NEW TEST Supabase database after all migrations.
-- Run in Supabase SQL Editor; raises an exception if a required piece is absent.
do $$
declare
  required_table text;
begin
  foreach required_table in array array[
    'document_packs','outlook_connections','organisations',
    'organisation_members','teams','customers','customer_strategies',
    'mailboxes','pack_history','email_ingest_claims',
    'outlook_sync_runs','outlook_webhook_events','customer_memory',
    'email_ingest_jobs'
  ] loop
    if to_regclass('public.' || required_table) is null then
      raise exception 'Missing table: public.%', required_table;
    end if;
  end loop;

  if not exists (select 1 from public.organisations where id='demo-organisation') then
    raise exception 'Demo organisation seed missing';
  end if;
  if not exists (select 1 from storage.buckets where id='CUSTOMS-DOCUMENTS' and public=false) then
    raise exception 'Private CUSTOMS-DOCUMENTS storage bucket missing';
  end if;
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='claim_email_ingest'
  ) then
    raise exception 'claim_email_ingest function missing';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='email_ingest_jobs'
      and column_name='attempt_token'
  ) then
    raise exception 'email_ingest_jobs.attempt_token missing';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='document_packs'
      and column_name='processing_token'
  ) then
    raise exception 'document_packs.processing_token missing';
  end if;
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='claim_document_pack_processing'
  ) then
    raise exception 'claim_document_pack_processing function missing';
  end if;
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='claim_outlook_webhook_events'
  ) then
    raise exception 'claim_outlook_webhook_events function missing';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='document_packs'
      and column_name='organisation_id'
  ) then
    raise exception 'document_packs.organisation_id missing';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='outlook_connections'
      and column_name='organisation_id'
  ) then
    raise exception 'outlook_connections.organisation_id missing';
  end if;
  raise notice 'Customs IDP fresh database structural smoke checks passed';
end $$;
