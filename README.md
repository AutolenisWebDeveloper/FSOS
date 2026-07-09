# FSOS — Farmers FSA Operating System

**Private internal tool. Not for public distribution.**

A full-stack command center for **Markist**, a licensed Farmers Financial Services Agent in McKinney, TX. Integrates a Supabase database, Anthropic AI, Resend email, Calendly booking, direct Twilio SMS, and Make.com automations into a single operational interface.

---

## Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 14 (App Router, TypeScript strict) |
| Database | Supabase (PostgreSQL + RLS + pg_cron + private Storage) |
| Deployment | Vercel (`iad1` region) |
| Booking / calendar | Calendly (webhook-driven) |
| AI (text) | Anthropic Claude API (`claude-sonnet-5`) |
| AI voice | Retell AI (config only; not yet wired into routes) |
| Email | Resend |
| SMS | Twilio (direct REST API) |
| Pipelines / workflows | GoHighLevel (LeadConnector v2) |
| Automation | Make.com |

---

## Command Center — 17 Pages

| # | Page | Description |
|---|------|-------------|
| 1 | Daily Briefing | Morning snapshot — urgent actions, priority scores, OPRA/conversion alerts |
| 2 | Dashboard | Real-time KPIs, GDC, pipeline totals, activity feed |
| 3 | Opportunities | Scored lead list — all pipelines ranked by priority |
| 4 | Agency Owners | Agency partners — referral tracking, last contact, needs-attention flags |
| 4a | Contact Upload | CSV → GoHighLevel bulk import — validate, de-dupe, map, tag/stage, retry, batch history |
| 5 | Conversions | Term policies with conversion deadlines — urgency-sorted |
| 6 | OPRA Center | Open Policy Rate Adjustment cases — contacted/pending status |
| 7 | Calendar | Appointment view — pre-meeting form status per client |
| 8 | AI Control Center | Voice-agent status overview (Retell AI) |
| 9 | Workshops | Event registrations, attendee management |
| 10 | GDC & Commission | Tier-aware GDC calculator (40%/60%/80%), rolling-12-mo tracking, pipeline value |
| 11 | Review Prep | Pre-meeting checklist — form status, FNA readiness per appointment |
| 12 | Needs Map | Age-cohort product matrix from FFS guide |
| 13 | Sales Calculator | 10-3-1 activity model — calls → appointments → cases |
| 14 | FFS Contacts | Matt Anderson, Ryan Anderson, Sales Desk — quick-dial panel |
| 15 | Client Forms | Send/track intake forms — Customer Questionnaire through FNA |
| 16 | FNA Generator | AI-generated Financial Needs Analysis — Claude API, FINRA Reg BI compliant |

---

## Project Structure

```
fsos/
├── src/
│   ├── middleware.ts                     # Basic-auth gate for the command center ("/")
│   ├── app/
│   │   ├── layout.tsx                    # Root layout (DM Sans font, noindex)
│   │   ├── page.tsx                      # Root → CommandCenter
│   │   ├── globals.css
│   │   ├── error.tsx                     # Branded error boundary ('use client')
│   │   ├── not-found.tsx                 # Branded 404
│   │   ├── robots.ts                     # Blocks all indexing
│   │   ├── icon.svg                      # Favicon (auto-served by App Router)
│   │   ├── [slug]/page.tsx               # Agency referral landing (public)
│   │   ├── upload/[slug]/page.tsx        # Agency document upload (public)
│   │   ├── forms/[formId]/page.tsx       # Client intake portal (public)
│   │   └── api/
│   │       ├── agencies/
│   │       │   ├── list/route.ts         # GET agencies (internal)
│   │       │   ├── referral/route.ts     # GET/POST referral (public)
│   │       │   └── upload/route.ts       # POST document upload (public)
│   │       ├── customers/
│   │       │   └── upsert/route.ts        # GET health, POST upsert (internal)
│   │       ├── dashboard/route.ts        # GET dashboard data (internal)
│   │       ├── forms/
│   │       │   ├── fna/route.ts          # GET/POST FNA (internal)
│   │       │   ├── responses/route.ts    # GET form responses (internal)
│   │       │   ├── send/route.ts         # POST send form (internal)
│   │       │   └── submit/route.ts       # GET/POST submit by token (public)
│   │       ├── gdc/
│   │       │   └── cases/route.ts        # GET/POST/PATCH commission cases (internal)
│   │       ├── opra/route.ts             # GET/PATCH OPRA cases (internal)
│   │       ├── scores/route.ts           # GET scores (internal)
│   │       ├── ghl/
│   │       │   ├── sync/route.ts         # POST push customer/agency into GHL (internal)
│   │       │   └── contacts/upload/route.ts  # GET/POST CSV bulk contact import → GHL (internal)
│   │       └── webhooks/
│   │           ├── calendly/route.ts     # POST Calendly events (public, signed)
│   │           └── ghl/route.ts          # POST GoHighLevel events (public, signed)
│   ├── components/
│   │   └── pages/
│   │       ├── CommandCenter.tsx         # Dynamic import wrapper (SSR disabled)
│   │       ├── ClientFormPortal.tsx      # Public client-facing form UI
│   │       ├── fsos_command_center.jsx   # Command center (17 pages)
│   │       └── fsos_forms_system.jsx     # Forms UI module
│   └── lib/
│       ├── anthropic.ts                  # Anthropic client + FNA model call
│       ├── compliance.ts                 # Reg BI / TCPA disclosures & guards
│       ├── fna.ts                        # FNA prompt + report shaping
│       ├── forms.ts                      # Form catalog + helpers
│       ├── ghl.ts                        # GHL pipeline/stage ID map + REST client + retry
│       ├── ghlContacts.ts                # CSV → GHL contact field mapping + validation
│       ├── csv.ts                        # Dependency-free RFC-4180 CSV parser
│       ├── http.ts                       # readJson, parseLimit, requireInternalAuth
│       ├── tokens.ts                     # Secure form-token generation/verification
│       ├── supabase/
│       │   └── client.ts                 # Lazy getDb() — never module-level
│       └── types/
│           └── database.ts               # TypeScript types for all tables
├── supabase/
│   └── migrations/
│       ├── 001_initial_schema.sql        # Schema, functions, RLS, pg_cron, `documents` bucket
│       ├── 002_ghl_integration.sql       # GHL contact/opportunity linkage on customers
│       ├── 003_ghl_agency.sql            # GHL owner linkage on agencies (Pipeline B)
│       └── 004_ghl_contact_uploads.sql   # CSV import audit log (batches + rows, RLS on)
├── docs/
│   └── samples/contacts-template.csv     # Ready-to-edit CSV import template
└── tests/
    └── ghlUpload.test.mjs                # CSV parse / mapping / retry unit tests (npm test)
```

---

## Database

RLS is enabled on all tables. All API routes use the service role key — bypasses RLS. Client-side uses the anon key.

pg_cron runs `run_nightly_scoring()` at 2AM CT (8AM UTC) to score all customers across the pipelines.

Core tables include `agencies`, `customers`, `policies`, `scores`, `commission_cases`, `commission_rates`, `opra_cases`, `agency_referrals`, `agency_uploads`, `form_submissions`, `form_sends`, `activity`, `consent_ledger` (append-only TCPA audit trail), `workshops`, `workshop_registrations`, `daily_briefings`, `customer_profiles`, and the GHL
CSV-import audit tables `ghl_upload_batches` + `ghl_upload_rows` (migration `004`, RLS-locked).

The migration also creates a **private Supabase Storage bucket `documents`**. Uploads are written there and served back via short-lived signed URLs — objects are never public.

---

## Environment Variables

Copy `.env.local.example` to `.env.local` and fill in values. Never commit `.env.local`.

| Variable | Source | Required |
|----------|--------|----------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Project Settings → API | ✅ |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → Project Settings → API | ✅ |
| `SUPABASE_SERVICE_KEY` | Supabase → Project Settings → API (service_role) | ✅ |
| `NEXT_PUBLIC_URL` | Your Vercel deployment URL | ✅ |
| `ANTHROPIC_API_KEY` | console.anthropic.com | ✅ FNA feature |
| `RESEND_API_KEY` | resend.com → API Keys | ✅ Email sends |
| `RESEND_FROM_EMAIL` | Verified sender address | ✅ Email sends |
| `CALENDLY_WEBHOOK_SECRET` | Calendly → Webhooks → signing key | ✅ Calendly webhook |
| `NEXT_PUBLIC_CALENDLY_URL` | Your Calendly link (reserved for future embed) | ⬜ |
| `TWILIO_ACCOUNT_SID` | twilio.com → Console → Account Info | ✅ SMS |
| `TWILIO_AUTH_TOKEN` | twilio.com → Console → Account Info | ✅ SMS |
| `TWILIO_PHONE_NUMBER` | Twilio sending number (E.164) | ✅ SMS |
| `RETELL_API_KEY` | retellai.com → API Key | ⬜ Voice (not yet wired) |
| `GHL_API_KEY` | GHL → Settings → Private Integrations | ⬜ GHL sync (writes no-op if unset) |
| `GHL_LOCATION_ID` | GHL sub-account id (default `ATDNO1e5d27nj5t8vId3`) | ⬜ GHL |
| `GHL_WEBHOOK_SECRET` | Shared secret for `x-ghl-signature` | ⬜ GHL webhook |
| `FSOS_ADMIN_USER` | Basic-auth username (default `markist`) | ⬜ Auth gate |
| `FSOS_ADMIN_PASSWORD` | Basic-auth password — set to enable the gate | ⬜ Auth gate |
| `FSOS_API_SECRET` | Bearer token for server-to-server internal API calls | ⬜ Internal API |

---

## Setup

### 1. Install

```bash
npm install
```

### 2. Environment

```bash
cp .env.local.example .env.local
# Fill in all values
```

### 3. Database

In Supabase → SQL Editor → New Query, paste and run:

```
supabase/migrations/001_initial_schema.sql
```

> If the `cron.schedule()` call errors: go to Database → Extensions → enable `pg_cron`, then re-run.

Creates all tables, indexes, scoring functions, RLS policies, the nightly pg_cron job, the private `documents` Storage bucket, and seed agencies.

### 4. Local dev

```bash
npm run dev
# http://localhost:3000
```

### 5. Deploy

Push to GitHub, import in Vercel, set all env vars, deploy. Build command: `npm run build`.

---

## API Routes

All routes export `dynamic = 'force-dynamic'` and `runtime = 'nodejs'`. All Supabase operations use the lazy `getDb()` pattern — never module-level instantiation.

**Internal** routes call `requireInternalAuth()` and require an auth header (see [Security](#security)). **Public** routes are open — they are reached by clients, agency partners, or Calendly.

| Route | Methods | Access | Purpose |
|-------|---------|--------|---------|
| `/api/dashboard` | GET | Internal | All Daily Briefing + Dashboard data in one parallel-query response. Supports `?scope=workshops` and `?scope=calendar`. |
| `/api/scores` | GET | Internal | Priority scores per customer per pipeline. |
| `/api/opra` | GET, PATCH | Internal | OPRA case list; PATCH updates status. |
| `/api/gdc/cases` | GET, POST, PATCH | Internal | Commission cases. POST runs `calculate_case_gdc()` server-side. |
| `/api/agencies/list` | GET | Internal | Agency partner list. |
| `/api/agencies/referral` | GET, POST | Public | Agency referral submissions from `/[slug]`. POST creates customer + referral, logs activity, generates questionnaire token. |
| `/api/agencies/upload` | POST | Public | Document upload from `/upload/[slug]` → private `documents` bucket. |
| `/api/customers/upsert` | GET (health), POST | Internal | Upsert customer/policy (APEX import, etc.). Bad rows return 400, never 500. |
| `/api/forms/send` | POST | Internal | Sends a form link via Resend email and/or Twilio SMS; creates `form_submissions` with an expiring token. |
| `/api/forms/submit` | GET, POST | Public | Token flow. GET returns status and marks `opened`; POST saves the response, marks complete, triggers async FNA when the form is the FNA. |
| `/api/forms/responses` | GET | Internal | Retrieve stored form responses. |
| `/api/forms/fna` | GET, POST | Internal | POST generates the FNA via Anthropic Claude (`claude-sonnet-5`); GET retrieves a stored report. |
| `/api/assistant` | POST | Internal | Compliance-aware in-app AI assistant (Anthropic Claude). Backs the sidebar "AI Assistant" panel. |
| `/api/health` | GET | Public | Setup diagnostics — reports (as booleans, never secret values) whether env vars are present, Supabase is reachable, and the schema has been applied. Returns `200` when healthy, `503` with `hints` otherwise. |
| `/api/webhooks/calendly` | POST | Public | Calendly events, signature-verified (see below). |
| `/api/webhooks/ghl` | POST | Public | GoHighLevel events (opportunity stage moves, contacts, appointments, opt-outs), `x-ghl-signature`-verified. Creates commission cases at *Application Submitted*. See `docs/ghl_integration.md`. |
| `/api/ghl/sync` | POST | Internal | Push a customer into GHL — upsert contact + open/move opportunity at a pipeline stage (bound to the authoritative stage-ID map). |
| `/api/ghl/contacts/upload` | GET, POST | Internal | CSV bulk contact import → GHL. POST validates, de-dupes, maps fields, upserts (no duplicates), tags/stages, retries transient failures, logs the batch. GET returns upload history (`?batch_id=` for rows). See `docs/ghl_integration.md` §5. |

---

## Public Routes (pages)

These pages require no authentication — they are externally accessible by clients and agency partners:

| Route | Audience | Purpose |
|-------|----------|---------|
| `/[slug]` | Agency partners | Submit client referrals (e.g. `/steven-johnson`) |
| `/upload/[slug]` | Agency partners | Upload client documents |
| `/forms/[formId]` | Clients | Complete intake forms via token link |

---

## Calendly Webhook

Configure in Calendly → Integrations & apps → Webhooks →
`POST https://your-domain.vercel.app/api/webhooks/calendly`

Subscribe to:
- `invitee.created` — appointment booked
- `invitee.canceled` — appointment canceled

Calendly signs each request with the header
`Calendly-Webhook-Signature: t=<timestamp>,v1=<hmac>`. Store the webhook's
**signing key** as `CALENDLY_WEBHOOK_SECRET`; the route verifies the signature
before processing.

---

## Security

- **Command-center gate.** `src/middleware.ts` protects the command-center UI at `/` with HTTP Basic auth. It activates only when `FSOS_ADMIN_PASSWORD` is set (username defaults to `markist`, override via `FSOS_ADMIN_USER`). Left unset, the gate is disabled so local/dev deployments keep working.
- **Internal API auth.** Internal API routes call `requireInternalAuth()`, which accepts **either** `Authorization: Bearer <FSOS_API_SECRET>` **or** the Basic admin credentials (which the browser replays automatically on same-origin fetches). Server-to-server callers (Make.com, cron) should send the Bearer token. Public token/webhook routes stay open.
- **Security headers.** `next.config.js` sets `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Strict-Transport-Security`, and `X-Robots-Tag: noindex, nofollow` on every response. `robots.ts` also blocks all crawlers.
- **Private document storage.** Uploads go to the private Supabase `documents` bucket and are served back only via short-lived signed URLs — never public objects.

---

## GDC Payout Tiers

| Tier | Rolling 12-mo GDC | FSA Payout |
|------|-------------------|------------|
| 1 | Under $15,000 | 40% |
| 2 | $15,000 – $54,999 | 60% |
| 3 | $55,000+ | 80% |

The tier is computed from **rolling 12-month GDC** (the trailing 12 months), not a calendar-year total.

---

## Compliance

This system is subject to FINRA Reg BI, TCPA, and TRAIGA 2026 (Texas AI Disclosure Law).

**FNA Reports** — Every AI-generated report must include and does include:
> *For educational and informational purposes only. Not a product recommendation or suitability determination. Requires licensed FSA review per FINRA Reg BI.*

**AI Agent Scope** — AI agents may: educate, qualify, gather info, schedule, remind, route, follow up, escalate. AI agents may **never**: recommend specific products, make suitability determinations, give investment advice.

**Automated SMS** — TCPA requires written prior express consent before any automated outreach. Before enabling live SMS: call **Ryan Anderson (Compliance TX): (253) 242-0597**.

**TRAIGA 2026** — AI disclosure required in all automated messages sent to Texas residents.

---

## Key Contacts

| Name | Role | Phone |
|------|------|-------|
| Ryan Anderson | Compliance TX | (253) 242-0597 |
| Matt Anderson | FSD Central | (818) 584-0264 |
| Sales Desk | FFS Sales | (866) 888-9739 → 3 → 3 |

Sales Desk hours: Mon–Fri 7AM–5PM PT

---

## Seed Data

The schema seeds agency partners on first run, each with a referral slug. Agency referral URLs look like `https://your-domain.vercel.app/steven-johnson`.

---

## Troubleshooting

**"Live data failed to load" banner in the command center.** The internal API can't reach the database. Hit `GET /api/health` on your deployment — it reports (as booleans, no secrets) exactly what's missing:

```
curl https://your-domain.vercel.app/api/health
```

Common causes:
- **Supabase env vars not set** — set `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_KEY` in your Vercel project settings, then redeploy. When these are missing the API now returns a clear `503 "Supabase is not configured …"` (shown in the banner) rather than an opaque 500.
- **Migration not applied** — `schema_present: false` from `/api/health` means the tables don't exist yet. Run `supabase/migrations/001_initial_schema.sql` in the Supabase SQL Editor.
- **Supabase project paused/unreachable** — `supabase_reachable: false` means the URL/key is wrong or the project is paused.

After changing environment variables in Vercel you must **redeploy** for them to take effect.

---

*Private repository. Internal use only. Not affiliated with or endorsed by Farmers Insurance Group.*
