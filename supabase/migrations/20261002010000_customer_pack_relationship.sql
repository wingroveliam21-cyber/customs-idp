-- Allow packs to exist without a persistent customer.
alter table public.document_packs
  alter column customer drop not null;

-- Optional persistent relationship to a customer.
-- NULL means this pack is not associated with a persistent customer.
alter table public.document_packs
  add column if not exists customer_id uuid
  references public.customers(id)
  on delete set null;

create index if not exists document_packs_customer_id_idx
  on public.document_packs(customer_id);
