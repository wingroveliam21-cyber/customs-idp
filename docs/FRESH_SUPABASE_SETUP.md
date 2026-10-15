# Fresh Supabase development database

**Scope:** a new Supabase project in your own account using synthetic data. This
migration sequence is NOT an automatic history upgrade for Liam's existing
project.

## What the bootstrap changes

- Adds an initial migration for `document_packs` (from `database/schema.sql`)
  and `outlook_connections` (reconstructed from current application queries).
- Renames 10 pre-existing incremental SQL files to Supabase-compatible
  14-digit migration timestamps, preserving their SQL contents.
- Retains the existing `20261004220000_create_customer_memory.sql` unchanged.
- Adds the private `CUSTOMS-DOCUMENTS` storage bucket.
- Adds a read-only structural smoke test.

These historical migration renames are safe to test against a new database, but
**must not be merged or deployed to the existing Supabase project without
reconciling its `supabase_migrations.schema_migrations` records first**.
Renaming previously deployed migrations can cause drift or repeated execution.

## Initialise YOUR fresh project

1. Create a new empty Supabase project under your own account.
2. Checkout the branch `feat/fresh-supabase-bootstrap-20261010`.
3. Use a current Supabase CLI (run `npx supabase --version`).
4. Run `npx supabase login` then
   `npx supabase link --project-ref YOUR_TEST_PROJECT_REF`.
5. Check the project ref carefully: **it must be your new test project**, never
   Liam's existing project.
6. Run `npx supabase migration list` and
   `npx supabase db push --dry-run`. Review every pending migration.
7. Run `npx supabase db push` **only against the test project**.
8. In Supabase SQL Editor, run `supabase/tests/bootstrap_smoke.sql`.
9. Verify the Storage bucket is private and demo organisation exists.

Alternatively, configure the Supabase GitHub integration to deploy the
repository's `main` branch to your new test project. Confirm the project ref
before enabling it; never point this migration sequence at another project's
database merely to clear a preview check.

## Connect the app

Set these in a local `.env.local` (never commit credentials):
```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_TEST_REF.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=YOUR_TEST_PUBLISHABLE_KEY
SUPABASE_URL=https://YOUR_TEST_REF.supabase.co
SUPABASE_PUBLISHABLE_KEY=YOUR_TEST_PUBLISHABLE_KEY
SUPABASE_SERVICE_ROLE_KEY=YOUR_TEST_LEGACY_SERVICE_ROLE_KEY
IDP_AUTH_SECRET=USE_A_UNIQUE_LONG_RANDOM_VALUE
```

The current backend expects the legacy JWT-style service role key in a Bearer
header; verify compatibility before using newer `sb_secret_...` keys.
The frontend currently has a fallback to an existing Supabase project URL/key:
ALWAYS set `NEXT_PUBLIC_SUPABASE_URL` and
`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` explicitly for testing.

Create an actual Supabase Auth test user, then assign membership in your new
test database only, substituting its real auth.users.id:
```sql
insert into public.organisation_members (organisation_id, user_id, role)
values ('demo-organisation', 'YOUR_TEST_AUTH_USER_UUID', 'manager')
on conflict (organisation_id, user_id) do update set role=excluded.role;
```

For file processing you will additionally need test-only AI provider credentials,
an inbound Resend test address and webhook, and any cron/worker secrets used by
the specific application revision. Do not point existing production webhooks at
this test instance.

## Important boundaries

- The baseline `outlook_connections` table is inferred rather than copied from
  an authoritative production migration. Schema differences may remain.
- The durable Resend queue, attempt ownership, private storage bucket and tenant
  policies are included, but must still be exercised against an isolated test
  database before using real customer data.
- Run `supabase/tests/bootstrap_smoke.sql` after every fresh deployment and test
  duplicate delivery, retry and terminal-failure behavior end to end.
