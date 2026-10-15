-- Create the private storage bucket expected by src/server/api/storage.js
-- and the processing pipeline. No browser RLS policies are granted: document
-- access must be authorised by the application server (service role).
insert into storage.buckets (id, name, public)
values ('CUSTOMS-DOCUMENTS', 'CUSTOMS-DOCUMENTS', false)
on conflict (id) do nothing;
