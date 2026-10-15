-- Bootstrap-only legacy tables for an EMPTY Supabase project.
-- Source: database/schema.sql plus columns inferred from the Outlook API.
-- Must run BEFORE the existing incremental migrations.
-- Do not execute manually against Liam's existing project.

create table if not exists public.document_packs (
  id text primary key,
  pack_uuid uuid not null default gen_random_uuid(),
  customer text not null,
  docs integer not null default 0,
  status text not null default 'Processing',
  confidence numeric not null default 0,
  received text,
  ticket text,
  assigned_to text not null default 'Unassigned',
  extracted_data jsonb,
  processing_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists document_packs_pack_uuid_unique_idx
  on public.document_packs (pack_uuid);
create index if not exists document_packs_assigned_to_idx
  on public.document_packs (assigned_to);
create index if not exists document_packs_status_idx
  on public.document_packs (status);
create index if not exists document_packs_customer_idx
  on public.document_packs (customer);

-- Existing Outlook application writes use text IDs prefixed with 'outlook-'.
-- Later migration 20261004010000 adds organisation and sync/recovery columns.
-- IMPORTANT: This table definition was inferred from application code because
-- its historical CREATE TABLE migration is missing. Validate it with Liam before
-- using it in any environment that already contains Outlook connection rows.
create table if not exists public.outlook_connections (
  id text primary key,
  email text not null unique,
  display_name text,
  refresh_token text not null,
  scopes text,
  status text not null default 'disconnected',
  subscription_id text,
  subscription_expires_at timestamptz,
  client_state text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists outlook_connections_status_idx
  on public.outlook_connections (status);

-- OAuth connection data and encrypted tokens must never be readable through
-- the client-side Supabase API. Server APIs use the service role.
alter table public.outlook_connections enable row level security;
revoke all on public.outlook_connections from anon, authenticated;
