-- Supabase Auth integration for Customs IDP.
-- organisation_members.user_id stores auth.users.id as text so existing tenant
-- relationships remain compatible with the current application schema.

grant usage on schema public to authenticated;
grant select on public.document_packs to authenticated;
grant select on public.organisation_members to authenticated;
grant select on public.organisations to authenticated;

-- Realtime evaluates the subscriber's authenticated JWT against the table RLS
-- policy, so the same organisation boundary applies to browser change events.
