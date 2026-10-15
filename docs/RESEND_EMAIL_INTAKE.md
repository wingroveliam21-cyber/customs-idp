# Resend inbound email intake

The configured inbound address is `test@fenauonto.resend.app`. Resend sends an
`email.received` webhook to the application. The application verifies the Svix
signature and durably inserts an intake job before acknowledging the webhook.
The webhook schedules an immediate worker after the job is committed. A
scheduled worker also claims overdue retries, retrieves messages and
attachments, and invokes the shared email processing pipeline.

## Deployment configuration

Set these server-only environment variables in Vercel (and in local `.env` when
testing):

```text
RESEND_INBOUND_ADDRESS=test@fenauonto.resend.app
RESEND_API_KEY=re_...
RESEND_WEBHOOK_SECRET=whsec_...
CRON_SECRET=...
# Required when more than one organisation receives Resend email:
RESEND_INBOUND_ROUTING_JSON={"test@fenauonto.resend.app":{"organisationId":"demo-organisation"}}
```

The API key and webhook secret are credentials. Do not commit them or include
them in issue reports/chat messages.

## Resend dashboard

1. Open Receiving Emails and confirm `test@fenauonto.resend.app` is active.
2. Create a webhook pointing to
   `https://<deployment>/api/resend/webhook`.
3. Subscribe to `email.received` and copy the generated signing secret into
   `RESEND_WEBHOOK_SECRET`.
4. Send a test email with a commercial invoice attachment.

Apply `supabase/migrations/20261009090000_email_ingest_jobs.sql` and
`supabase/migrations/20261011090000_email_job_attempt_ownership.sql` before
enabling the webhook. Claims receive a unique attempt token; completion and
failure updates require that token, so an expired worker cannot overwrite a
newer attempt.

`vercel.json` invokes `/api/email-jobs/process` daily at 03:15 UTC as a
Hobby-plan recovery sweep. Normal messages are still processed immediately by
the webhook. If retry latency below 24 hours is required, use Vercel Pro or a
trusted external scheduler to call this endpoint more frequently with the
`CRON_SECRET` bearer token.

Managers can inspect and retry failed intake jobs from Settings. A webhook is
only acknowledged after its job exists; if queue persistence fails, the endpoint
returns an error so Resend can retry delivery.

Resend may retry webhook delivery. The existing email-ingest idempotency claim
uses the Resend message ID/ticket, so retries do not create a second pack.
If ingestion fails after the pack is created, the failed job retains that pack
ID and retries processing the existing pack instead of uploading attachments
again. Permanent 4xx input failures are moved directly to terminal failure;
transient failures retain bounded exponential backoff.
