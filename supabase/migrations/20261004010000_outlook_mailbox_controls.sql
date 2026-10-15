-- Durable Outlook webhook processing and manual sync state.

alter table public.outlook_connections
  add column if not exists organisation_id text;

update public.outlook_connections
set organisation_id = 'demo-organisation'
where organisation_id is null;

alter table public.outlook_connections
  add column if not exists last_sync_started_at timestamptz,
  add column if not exists last_sync_completed_at timestamptz,
  add column if not exists last_sync_status text,
  add column if not exists last_sync_error text,
  add column if not exists last_sync_checked integer not null default 0,
  add column if not exists last_sync_queued integer not null default 0,
  add column if not exists last_sync_processed integer not null default 0,
  add column if not exists last_sync_duplicates integer not null default 0,
  add column if not exists last_sync_failed integer not null default 0,
  add column if not exists last_renewed_at timestamptz,
  add column if not exists last_renewal_error text;

create index if not exists outlook_connections_organisation_id_idx
  on public.outlook_connections(organisation_id);

create unique index if not exists outlook_connections_one_active_per_org_idx
  on public.outlook_connections(organisation_id)
  where status = 'connected';

create table if not exists public.outlook_sync_runs (
  id uuid primary key default gen_random_uuid(),
  organisation_id text not null,
  connection_id text not null references public.outlook_connections(id) on delete cascade,
  status text not null default 'queued',
  checked integer not null default 0,
  queued integer not null default 0,
  duplicates integer not null default 0,
  processed integer not null default 0,
  failed integer not null default 0,
  error text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists outlook_sync_runs_status_idx
  on public.outlook_sync_runs(status, created_at);

create table if not exists public.outlook_webhook_events (
  id uuid primary key default gen_random_uuid(),
  organisation_id text not null,
  connection_id text not null references public.outlook_connections(id) on delete cascade,
  subscription_id text not null,
  graph_message_id text not null,
  internet_message_id text,
  sync_run_id uuid references public.outlook_sync_runs(id) on delete set null,
  notification jsonb not null default '{}'::jsonb,
  status text not null default 'pending',
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  locked_until timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  processed_at timestamptz,
  unique (connection_id, graph_message_id)
);

create index if not exists outlook_webhook_events_pending_idx
  on public.outlook_webhook_events(status, available_at, created_at);

create index if not exists outlook_webhook_events_sync_run_idx
  on public.outlook_webhook_events(sync_run_id);

-- These tables contain OAuth connection metadata and raw Graph notification
-- payloads. They are server-only: browser clients must not access them through
-- the Supabase Data API.
alter table public.outlook_connections enable row level security;
alter table public.outlook_sync_runs enable row level security;
alter table public.outlook_webhook_events enable row level security;

revoke all on table public.outlook_connections from anon, authenticated;
revoke all on table public.outlook_sync_runs from anon, authenticated;
revoke all on table public.outlook_webhook_events from anon, authenticated;

grant select, insert, update, delete on table public.outlook_connections to service_role;
grant select, insert, update, delete on table public.outlook_sync_runs to service_role;
grant select, insert, update, delete on table public.outlook_webhook_events to service_role;

create or replace function public.claim_outlook_webhook_events(p_limit integer default 10)
returns setof public.outlook_webhook_events
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with candidates as (
    select id
    from public.outlook_webhook_events
    where (
      status = 'pending'
      and available_at <= now()
    ) or (
      status = 'processing'
      and locked_until < now()
    )
    order by created_at
    for update skip locked
    limit greatest(1, least(coalesce(p_limit, 10), 100))
  ), claimed as (
    update public.outlook_webhook_events event
    set status = 'processing',
        attempts = event.attempts + 1,
        locked_until = now() + interval '10 minutes',
        updated_at = now()
    from candidates
    where event.id = candidates.id
    returning event.*
  )
  select * from claimed;
end;
$$;

revoke all on function public.claim_outlook_webhook_events(integer) from public;
revoke all on function public.claim_outlook_webhook_events(integer) from anon, authenticated;
grant execute on function public.claim_outlook_webhook_events(integer) to service_role;
