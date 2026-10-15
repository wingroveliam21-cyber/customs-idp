-- Customs IDP organisation structure
-- Organisation -> teams -> customers -> strategies -> mailboxes

create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(),
  organisation_id text not null references public.organisations(id) on delete cascade,
  name text not null,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  unique (organisation_id, name)
);

create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  organisation_id text not null references public.organisations(id) on delete cascade,
  team_id uuid references public.teams(id) on delete set null,
  name text not null,
  code text not null,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  unique (organisation_id, code)
);

create table if not exists public.customer_strategies (
  id uuid primary key default gen_random_uuid(),
  organisation_id text not null references public.organisations(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  version integer not null default 1,
  status text not null default 'active',
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (customer_id, version)
);

create table if not exists public.mailboxes (
  id uuid primary key default gen_random_uuid(),
  organisation_id text not null references public.organisations(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete set null,
  team_id uuid references public.teams(id) on delete set null,
  provider text not null default 'microsoft_graph',
  address text not null,
  status text not null default 'active',
  routing_config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (organisation_id, address)
);

create index if not exists teams_organisation_id_idx on public.teams(organisation_id);
create index if not exists customers_organisation_id_idx on public.customers(organisation_id);
create index if not exists customers_team_id_idx on public.customers(team_id);
create index if not exists customer_strategies_organisation_id_idx on public.customer_strategies(organisation_id);
create index if not exists customer_strategies_customer_id_idx on public.customer_strategies(customer_id);
create index if not exists mailboxes_organisation_id_idx on public.mailboxes(organisation_id);
create index if not exists mailboxes_customer_id_idx on public.mailboxes(customer_id);

alter table public.teams enable row level security;
alter table public.customers enable row level security;
alter table public.customer_strategies enable row level security;
alter table public.mailboxes enable row level security;

drop policy if exists "teams_member_read" on public.teams;
create policy "teams_member_read" on public.teams for select to authenticated
using (exists (select 1 from public.organisation_members m where m.organisation_id=teams.organisation_id and m.user_id=auth.uid()::text));

drop policy if exists "customers_member_read" on public.customers;
create policy "customers_member_read" on public.customers for select to authenticated
using (exists (select 1 from public.organisation_members m where m.organisation_id=customers.organisation_id and m.user_id=auth.uid()::text));

drop policy if exists "customer_strategies_member_read" on public.customer_strategies;
create policy "customer_strategies_member_read" on public.customer_strategies for select to authenticated
using (exists (select 1 from public.organisation_members m where m.organisation_id=customer_strategies.organisation_id and m.user_id=auth.uid()::text));

drop policy if exists "mailboxes_member_read" on public.mailboxes;
create policy "mailboxes_member_read" on public.mailboxes for select to authenticated
using (exists (select 1 from public.organisation_members m where m.organisation_id=mailboxes.organisation_id and m.user_id=auth.uid()::text));

-- Seed a team and the four existing prototype customers for the demo organisation.
insert into public.teams (organisation_id,name)
values ('demo-organisation','Demo Customs Team')
on conflict (organisation_id,name) do nothing;

insert into public.customers (organisation_id,team_id,name,code)
select 'demo-organisation',t.id,v.name,v.code
from public.teams t
cross join (values
  ('Acme Components Ltd','ACME-001'),
  ('Northstar Manufacturing','NSTM-014'),
  ('Bancale Trading','BANC-007'),
  ('Raven Industrial','RAVN-021')
) as v(name,code)
where t.organisation_id='demo-organisation' and t.name='Demo Customs Team'
on conflict (organisation_id,code) do nothing;

insert into public.customer_strategies (organisation_id,customer_id,config)
select c.organisation_id,c.id,'{"autoApplyWeightApportionment":false,"emailFields":[]}'::jsonb
from public.customers c
where c.organisation_id='demo-organisation'
on conflict (customer_id,version) do nothing;

select o.id as organisation_id,o.name,
       (select count(*) from public.teams t where t.organisation_id=o.id) as teams,
       (select count(*) from public.customers c where c.organisation_id=o.id) as customers,
       (select count(*) from public.customer_strategies s where s.organisation_id=o.id) as strategies
from public.organisations o
where o.id='demo-organisation';
