# FSOS — Farmers FSA Operating System

**Private internal tool. Not for public distribution.**

A full-stack command center for **Markist**, a licensed Farmers Financial Services Agent in McKinney, TX. Integrates GoHighLevel CRM, Supabase database, Anthropic AI, Resend email, and Make.com automations into a single operational interface.

---

## Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 14 (App Router, TypeScript strict) |
| Database | Supabase (PostgreSQL + RLS + pg_cron) |
| Deployment | Vercel (`iad1` region) |
| CRM | GoHighLevel (pipelines, AI agents, webhooks) |
| AI | Anthropic Claude API (`claude-sonnet-4-20250514`) |
| Email | Resend |
| SMS | Twilio via GHL |
| Automation | Make.com |

---

## Command Center — 16 Pages

| # | Page | Description |
|---|------|-------------|
| 1 | ☀️ Daily Briefing | Morning snapshot — urgent actions, priority scores, OPRA/conversion alerts |
| 2 | 🏠 Dashboard | Real-time KPIs, GDC YTD, pipeline totals, activity feed |
| 3 | 🎯 Opportunities | Scored lead list — all pipelines ranked by priority |
| 4 | 🏢 Agency Owners | 4 agency partners — referral tracking, last contact, needs-attention flags |
| 5 | ⏰ Conversions | Term policies with conversion deadlines — urgency-sorted |
| 6 | 🔄 OPRA Center | Open Policy Rate Adjustment cases — contacted/pending status |
| 7 | 📅 Calendar | Appointment view — pre-meeting form status per client |
| 8 | 🤖 AI Control Center | GHL AI agent status — Receptionist, Appt Setter, Conversion, Follow-Up |
| 9 | 🎓 Workshops | Event registrations, attendee management |
| 10 | 💰 GDC & Commission | Tier-aware GDC calculator (40%/60%/80%), YTD tracking, pipeline value |
| 11 | 📝 Review Prep | Pre-meeting checklist — form status, FNA readiness per appointment |
| 12 | 🗺 Needs Map | Age-cohort product matrix from FFS guide |
| 13 | 📐 Sales Calculator | 10-3-1 activity model — calls → appointments → cases |
| 14 | 📞 FFS Contacts | Matt Anderson, Ryan Anderson, Sales Desk — quick-dial panel |
| 15 | 📋 Client Forms | Send/track 7 intake forms — Customer Questionnaire through FNA |
| 16 | ✦ FNA Generator | AI-generated Financial Needs Analysis — Claude API, FINRA Reg BI compliant |

---

## Project Structure

```
fsos/
├── src/
│   ├── app/
│   │   ├── page.tsx                      # Root → CommandCenter
│   │   ├── [slug]/page.tsx               # Agency referral landing (public)
│   │   ├── upload/[slug]/page.tsx         # Agency document upload (public)
│   │   ├── forms/[formId]/page.tsx        # Client intake portal (public)
│   │   └── api/
│   │       ├── agencies/
│   │       │   ├── referral/route.ts      # POST referral, GET by agency
│   │       │   └── upload/route.ts        # POST document upload
│   │       ├── forms/
│   │       │   ├── submit/route.ts        # POST submit, GET status by token
│   │       │   ├── send/route.ts          # POST send form via email/SMS/link
│   │       │   └── fna/route.ts           # POST generate FNA, GET retrieve
│   │       ├── webhooks/
│   │       │   └── ghl/route.ts           # POST GHL events (appointments, pipeline, opt-outs)
│   │       └── dashboard/route.ts         # GET all dashboard data
│   ├── components/
│   │   └── pages/
│   │       ├── CommandCenter.tsx          # Dynamic import wrapper (SSR disabled)
│   │       ├── ClientFormPortal.tsx       # Public client-facing form UI
│   │       └── fsos_command_center.jsx    # 3,446-line command center (16 pages)
│   └── lib/
│       ├── supabase/
│       │   └── client.ts                  # Lazy getDb() — never module-level
│       └── types/
│           └── database.ts                # TypeScript types for all 17 tables
└── supabase/
    └── migrations/
        └── 001_initial_schema.sql         # 935-line schema — run once in SQL Editor
```

---

## Database — 17 Tables

| Table | Purpose |
|-------|---------|
| `agencies` | 4 agency partners — slugs, referral dates, attention flags |
| `customers` | Full book of business — all clients |
| `policies` | Term/life policies with conversion deadlines |
| `scores` | Priority scores per customer per pipeline |
| `commission_cases` | Cases from submission through paid |
| `commission_rates` | Carrier/product rate matrix |
| `opra_cases` | OPRA opportunity tracking |
| `agency_referrals` | Referral submissions from `/[slug]` |
| `agency_uploads` | Document uploads from `/upload/[slug]` |
| `form_submissions` | All sent/opened/completed forms with tokens |
| `form_sends` | Delivery log per channel (email/SMS) |
| `activity` | All client interaction history |
| `consent_ledger` | TCPA consent audit trail — append-only |
| `workshops` | Workshop events |
| `workshop_registrations` | Attendee registrations |
| `daily_briefings` | Nightly-generated briefing snapshots |
| `customer_profiles` | Extended profile data |

RLS is enabled on all tables. All API routes use the service role key — bypasses RLS. Client-side uses anon key.

pg_cron runs `run_nightly_scoring()` at 2AM CT (8AM UTC) to score all customers across 5 pipelines.

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
| `GHL_API_KEY` | GHL → Settings → API | ✅ GHL webhook |
| `GHL_LOCATION_ID` | GHL → Settings → Business Info | ✅ GHL webhook |
| `GHL_WEBHOOK_SECRET` | Any 32-char random string | ✅ GHL webhook |

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

Creates 17 tables, all indexes, scoring functions, RLS policies, nightly pg_cron job, and 4 seed agencies (Steven Johnson / Sarah Brown / Carlos Vega Sr. / Jack Taylor).

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

### `POST /api/agencies/referral`
Receives referral form submissions from `/[slug]`. Creates customer + referral record, logs activity, auto-generates questionnaire token.

### `GET /api/agencies/referral?agency_id=ag1`
Returns referrals for a given agency.

### `POST /api/agencies/upload`
Handles document uploads from `/upload/[slug]`. Writes to Supabase Storage `documents` bucket.

### `POST /api/forms/send`
Sends a form link via email (Resend) and/or SMS (GHL API). Creates `form_submissions` record with expiring token.

### `POST /api/forms/submit`
Saves form response by token. Marks submission complete. Triggers async FNA generation if form is `financial-needs-analysis`.

### `GET /api/forms/submit?token=...`
Returns form status — used by client portal to check state and mark `opened`.

### `POST /api/forms/fna`
Generates FNA report via Anthropic Claude API for a completed submission. Stores result in `fna_report` JSONB column.

### `GET /api/forms/fna?submission_id=...`
Retrieves a previously generated FNA report.

### `POST /api/webhooks/ghl`
Receives GoHighLevel webhook events. Handles: `AppointmentBooked`, `OpportunityStageChanged`, `ContactDNDUpdated`, `ContactCreated`. HMAC-SHA256 signature verified.

### `GET /api/dashboard`
Returns all data for Daily Briefing and Dashboard pages in a single parallel-query response.

---

## Public Routes

These three routes require no authentication — they are externally accessible by clients and agency partners:

| Route | Audience | Purpose |
|-------|----------|---------|
| `/[slug]` | Agency partners | Submit client referrals (e.g. `/steven-johnson`) |
| `/upload/[slug]` | Agency partners | Upload client documents |
| `/forms/[formId]` | Clients | Complete intake forms via token link |

---

## GHL Webhook Events

Configure in GHL → Settings → Integrations → Webhooks → `POST https://your-domain.vercel.app/api/webhooks/ghl`

Subscribe to:
- `AppointmentBooked` — creates/updates customer, auto-sends forms if consent on file
- `OpportunityStageChanged` — auto-creates commission case on "Application Submitted"
- `ContactDNDUpdated` — records opt-out in consent ledger, updates customer flags
- `ContactCreated` — creates customer record from GHL data

---

## GDC Payout Tiers

| Tier | Rolling 12-mo GDC | FSA Payout |
|------|-------------------|------------|
| 1 | Under $15,000 | 40% |
| 2 | $15,000 – $54,999 | 60% |
| 3 | $55,000+ | 80% |

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

The schema seeds 4 agency partners on first run:

| Agency | Owner | City | Slug |
|--------|-------|------|------|
| Johnson Agency | Steven Johnson | Corpus Christi, TX | `steven-johnson` |
| Brown Agency | Sarah Brown | McKinney, TX | `sarah-brown` |
| Vega Insurance Group | Carlos Vega Sr. | San Antonio, TX | `carlos-vega-sr` |
| Taylor Agency | Jack Taylor | Plano, TX | `jack-taylor` |

Agency referral URLs: `https://your-domain.vercel.app/steven-johnson`

---

*Private repository. Internal use only. Not affiliated with or endorsed by Farmers Insurance Group.*
