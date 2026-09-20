# Customs IDP

A standalone React/Vite prototype for the Customs Intelligent Data Processing platform.

## Current scope

- Operations dashboard with pack and invoice metrics
- Document inbox and pack queue
- Pack review workspace
- Extracted invoice positions and confidence
- Customer-specific extraction strategy view
- AI extraction/validation agent interface
- Middleware JSON preview using the Customs IDP field contract
- Processing settings
- Responsive UI

## Run locally

```bash
npm install
npm run dev
```

`npm run dev` now includes a local adapter for the extraction and pack endpoints in
`api/`, so it can use your `.env` without a Vercel project. If you want to test the
functions through Vercel's own runtime instead, use:

```bash
npm run dev:vercel
```

Add `OPENAI_API_KEY=...` to `.env` before starting Vercel Dev. The extraction flow
posts the selected document as base64 to `/api/extract`; that function sends the file
to the OpenAI Responses API with a structured JSON schema, then the UI saves the
result through `/api/packs`. Supabase variables are only needed for persistent pack
storage; without them the UI keeps its local browser fallback.

Pack deletion is currently restricted to the manager/admin test role in the UI and
API. This is a prototype guard only; production deletion must use server-validated
authentication before the endpoint is exposed publicly.

## Build

```bash
npm run build
```

## Next implementation phase

Connect the UI to production services for document ingestion, OCR/ML extraction, customer rule persistence, authentication, mailbox ingestion and middleware delivery. The current sample data is intentionally local so the interface can be developed independently of Base44.


## Deployment

GitHub pushes to `main` are configured to trigger the connected Vercel deployment automatically.

<!-- Vercel auto-deploy connection test -->
