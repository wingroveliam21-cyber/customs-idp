-- Harden email ingestion against duplicate Outlook syncs.
-- Backfill email packs into the demo organisation, keep the most useful
-- copy of each email-backed pack, then enforce uniqueness on ticket.

update public.document_packs
set organisation_id='demo-organisation'
where organisation_id is null
  and extracted_data->'_tenant'->>'organisationId'='demo-organisation';

update public.document_packs
set organisation_id='demo-organisation'
where organisation_id is null
  and extracted_data->'email'->>'messageId' is not null;

with ranked as (
  select
    id,
    row_number() over (
      partition by nullif(extracted_data->'email'->>'messageId','')
      order by
        coalesce(docs,0) desc,
        coalesce(confidence,0) desc,
        updated_at desc,
        created_at desc,
        id desc
    ) as rn
  from public.document_packs
  where nullif(extracted_data->'email'->>'messageId','') is not null
)
delete from public.document_packs p
using ranked r
where p.id=r.id
  and r.rn>1;

with ranked as (
  select
    id,
    row_number() over (
      partition by ticket
      order by
        coalesce(docs,0) desc,
        coalesce(confidence,0) desc,
        updated_at desc,
        created_at desc,
        id desc
    ) as rn
  from public.document_packs
  where ticket is not null
    and ticket <> ''
)
delete from public.document_packs p
using ranked r
where p.id=r.id
  and r.rn>1;

create unique index if not exists document_packs_ticket_unique_idx
on public.document_packs(ticket)
where ticket is not null and ticket <> '';

select
  count(*) as email_packs,
  count(distinct extracted_data->'email'->>'messageId') as unique_email_messages
from public.document_packs
where extracted_data->'email'->>'messageId' is not null;
