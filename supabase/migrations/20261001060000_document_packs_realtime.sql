-- Enable Supabase Realtime delivery for document pack lifecycle changes.
-- The browser must only receive rows permitted by Supabase Auth/RLS.
-- Customs IDP currently uses custom application authentication, so the
-- frontend keeps using its server-mediated refresh until Supabase Auth/JWT
-- tenant claims are enabled. This migration only versions the database
-- publication requirement and does not weaken RLS.

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname='supabase_realtime'
      and schemaname='public'
      and tablename='document_packs'
  ) then
    execute 'alter publication supabase_realtime add table public.document_packs';
  end if;
end $$;
