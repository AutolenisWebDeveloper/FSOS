# CLAUDE.md — FSOS Implementation Guide for Claude Code

> This file is the authoritative build contract for FSOS (Financial Services Operating System).
> Read it fully before writing any code. Everything here is binding.
> Companion specs live in `/docs`: `sitemap.md`, `routes.md`, `middleware-auth.md`, `build-order.md`, `archetypes.md`, `data-guardrails.md`.

---

## 0. What FSOS is (one paragraph)

FSOS is a private, internal operating system for a **Farmers Financial Services Agent (FSA)** in McKinney, TX. The FSA is a life- and securities-licensed specialist who **partners with Farmers agency owners** to bring life insurance (Farmers New World Life / FNWL) and financial/investment products (through Farmers Financial Solutions, LLC / FFS) to those agencies' existing clients. It is a **B2B2C referral/wholesale model**. The **aggregate root of the entire data model is the Agency-Owner Partnership**, NOT a generic contact or deal. Do not implement FSOS as a generic contact-and-deal CRM.

---

## 1. Fixed technology stack — do not substitute

- **Next.js 14** (App Router) + **TypeScript** (strict mode)
- **Supabase** (Postgres, Auth, Row-Level Security, Storage, Edge Functions)
- **Vercel** (hosting) + **Vercel Cron** (scheduled jobs)
- **Tailwind CSS** + **shadcn/ui** (component layer)
- **Twilio** (SMS) via approved config; **approved email provider** (Resend) for transactional email
- **Google Calendar** integration for scheduling
- **Durable background jobs** (event-driven; see §6). Do NOT rely on an open chatbot session for any agent work.
- **Model-agnostic AI gateway** (Claude-first; OpenAI + Gemini as configured fallbacks). All AI calls go through the gateway — never call a provider SDK directly from a route or component.

### Non-negotiable code conventions (match the existing FSOS codebase)
1. **Supabase access:** always use `getDb()` from `@/lib/supabase/client`. NEVER instantiate a Supabase client at module level.
2. **Every API route** exports:
   ```ts
   export const dynamic = 'force-dynamic'
   export const runtime = 'nodejs'
   ```
3. **Public routes** must remain auth-guard-free: `/[slug]` (agency referral), `/upload/[slug]`, `/forms/[formId]`, and everything under the P-0 public surface listed in `docs/sitemap.md`.
4. **Read before write:** before creating or editing any file, read the existing file. Never recreate a file that already exists — extend or fix it.
5. **Build discipline:** after any code change, run `npm run build` and fix EVERY error before stopping.
6. **Styling:** use Tailwind + shadcn/ui for all new UI. (Legacy command-center screens that use inline styles stay inline; do not convert them unless asked.)
7. **Validation:** every form and every API input is validated with **Zod**; derive TS types via `z.infer`. No unvalidated writes.

---

## 2. THE THREE NON-NEGOTIABLE GUARDRAILS

These are enforced in code, not just documented. See `docs/data-guardrails.md` for the enforcement layer.

### 2.1 Securities Firewall
FSOS is **NOT a broker-dealer system** and is **NOT** the system of record for any securities activity.
- FSOS may **track that** a securities opportunity/case exists, its stage, engagement model, referring agency, and expected/actual commission for the FSA's own production tracking.
- FSOS may store only a **non-substantive reference pointer** (`ffs_case_ref`) to the FFS-supervised system.
- FSOS may **NOT** store: securities account numbers, order details, suitability determinations, or securities-related client communications.
- Any record flagged `is_security = true` is **excluded** from the automated SMS/email engine and routed to human/FFS handling.
- Implement `is_security` as a hard gate checked in the communications dispatcher and in the AI action validator.
- **Authorized exception — Compliance Intelligence module (§3).** The owner-authorized Compliance Intelligence / NIGO-resolution module (`/app/compliance/intelligence`, `/api/compliance/{ingest,analyze,rightbridge,note,checklist,history,stats}`) is an **internal drafting and analysis aid for the FSA's own production and supervision workflow — NOT a broker-dealer system of record.** It is still bound by this firewall: it does **not** store securities account numbers, order details, or client-facing securities communications, and it makes **no** individualized recommendation (§2.2 red line). It stores the FSA's own NIGO correspondence, authority-tagged governing documents, and the FSA's own draft suitability/case notes for *self-review* — never a supervisory suitability determination of record, which remains in the FFS-supervised system referenced by `ffs_case_ref`. Every conclusion it emits is grounded in and cited to an uploaded library passage; it never invents a rule, citation, or fact (§2.3).

### 2.2 AI Green-Zone / Red-Line
The autonomous AI **may** (green zone): identify, educate, invite, schedule, remind, follow up, run consented/approved campaigns, draft internal materials, assemble data, and log.
The autonomous AI **may NEVER** (red line): make an individualized **product, policy, investment, replacement, allocation, or transaction recommendation**, or anything that constitutes a securities "call to action."
- Every AI-generated client-facing message passes through the **Compliance Guardrail** validator before dispatch. A message that fails (recommendation language, out-of-hours, unconsented, DNC, securities-flagged) is **hard-blocked** and escalated to the human FSA — never sent.
- Escalate to the human FSA when: a client requests advice/recommendation; a securities discussion needs an FFS-approved channel; consent is unclear; a compliance rule triggers; a replacement/suitability/best-interest/supervision issue arises; a case has conflicting/incomplete info; or a high-value/urgent opportunity needs personal intervention.

### 2.3 No Invented Farmers Data
Commission splits, FNWL term-conversion windows, product availability, carrier rules, and Farmers/FFS API availability are **NOT publicly documented**. Ship them as **clearly-labeled, editable configuration defaults** — never as hard-coded facts.
- Every such value carries an `is_assumption = true` flag and renders a **"config default — verify"** badge in the UI (archetype A10).
- Do NOT invent an integration or API that has not been verified. Where none exists, implement the configured **manual / CSV-import / secure-reference-field** fallback, labeled as a placeholder.

---

## 3. Scope exclusions (do not build)

- **NIGO defect-prevention automation across the general FSOS book is OUT OF SCOPE.** Do not add NIGO scoring, defect categories, imports, or cross-links onto the aggregate-root spine (`agency_partnerships → … → cases`). Case Management OS (`/app/cases`) stays NIGO-free: applications, submission tracking, underwriting, carrier requirements, documents, status/issue tracking, service requests, and case timelines — with NO NIGO functionality wired into it.
- **AUTHORIZED (owner sign-off, 2026-07-19): the standalone Compliance Intelligence module.** This is the "separate project" the exclusion above referred to, now approved to live inside the FSOS repo as an **isolated** subsystem: its own tables (`knowledge_documents`/`knowledge_chunks` for authority-tagged governing docs, `nigo_cases`, `nigo_issues`, `rightbridge_reports`), its own routes under `/api/compliance/*`, and its own page at `/app/compliance/intelligence`. It is a **retrieval-grounded drafting/analysis aid** — see the §2.1 authorized-exception note for the firewall constraints it remains bound by. It must **not** cross-link into or mutate the aggregate-root case spine; `nigo_cases` is a self-contained work log keyed by a free-text `work_item`/`client_ref`, not a FK to `cases`. Build spec: `docs/compliance/`.
- **Billing/subscription** (`/super/billing`) is a P3 placeholder only — build nothing here unless FSOS is later commercialized as multi-tenant SaaS.

---

## 4. Portals (six + public surface)

See `docs/sitemap.md` for every page and `docs/routes.md` for the file-path map. Portals share one backend, one design system, one permission model.

| Portal | Route group | Users |
|---|---|---|
| FSA Portal | `(fsa)` → `/app/*` | The FSA + delegated licensed staff |
| Admin / Back-Office | `(admin)` → `/admin/*` | Assistants, case managers, ops, sysadmin |
| Compliance & Supervisory | `(compliance)` → `/compliance/*` | Compliance reviewers/supervisors (supplemental to FFS systems, never a replacement) |
| Agency-Owner | `(partner)` → `/partner/*` | Farmers agency owners |
| Client-Facing | `(client)` → `/client/*` | End clients (non-securities, non-advice content only) |
| Super Admin | `(super)` → `/super/*` | Platform owner (may be a role inside Admin) |
| Public | `(public)` → `/*` | Unauthenticated |

---

## 5. Aggregate-root data model (build order matters)

The dependency spine is: **Agency Partnership → Referral → Household → (Financial) Review → Opportunity → Case → Commission.** Build entities in that order (see `docs/build-order.md`). The **Financial Review** layer is first-class: it is where policy/coverage/term-conversion/retirement/annual reviews happen and where opportunities originate.

Core tables (see `docs/data-guardrails.md` for the DDL and RLS): `agency_partnerships` (root), `agency_owners`, `districts`, `regions`, `referrals`, `households`, `household_members`, `policies`, `coverages`, `carriers`, `products`, `reviews`, `opportunities`, `cases`, `case_requirements`, `commissions`, `commission_splits`, `campaigns`, `consents`, `documents`, `activities`, `tasks`, `appointments`, `ai_agents`, `agent_runs`, `agent_actions`, `compliance_events`, `audit_log`.

Every table with client/agency data:
- carries an owner/tenant key and **Row-Level Security** keyed to the authenticated user's role + scope;
- encrypts PII at rest (Supabase default; add `pgcrypto` column encryption for DOB);
- writes to the **append-only `audit_log`** on create/update/delete (a DB role that cannot UPDATE/DELETE the log).

---

## 6. AI agents & background jobs

- Agents run as **durable, event-driven background jobs** (Vercel Cron + a queue/event table), NOT as open chat sessions. A job persists state and can suspend/resume across a human-approval pause.
- Every agent run writes `agent_runs` (inputs, model used, tokens, cost, confidence) and every action writes `agent_actions` (tool, target, outcome, audit link).
- Every client-facing action passes the **Compliance Guardrail** validator (§2.2) before dispatch.
- Agent roster (all green-zone; no NIGO agent): Executive Intelligence, Agency Growth, Agency Activation, Referral Triage, Referral Follow-Up, Pipeline, Cross-Sell, Term Conversion, Case Management, Document Intelligence, Commission Reconciliation, Marketing Automation, Compliance Guardrail (the hard-block layer), Data Quality.
- **Kill switch:** every agent and the whole gateway have an enable/disable flag (`/super/ai/policies`) checked at run start.

---

## 7. Communications compliance (enforced in the dispatcher)

Before ANY automated SMS/email sends, the dispatcher checks, in order, and blocks on any failure:
1. valid consent on that channel (`consents`), 2. within permitted quiet hours (recipient-local; enforce 9am–8pm as the conservative floor), 3. not on internal or applicable external DNC, 4. approved template or approved AI policy, 5. not an individualized securities recommendation, 6. not `is_security`-flagged, 7. not otherwise blocked by FFS/Farmers/carrier/state/federal rule.
Blocked sends are logged and escalated, never silently dropped.

---

## 8. Definition of Done (per page)

A page is NOT done because the screen renders. Per `docs/archetypes.md`, each page must have: wired real data (no placeholders), validation on every input, enforced permissions (403 on forbidden deep links), empty/loading/error/success states, archived/deleted behavior, responsive desktop/tablet/mobile, accessibility (labels, keyboard, aria), triggered notifications/automations wired, audit events written, and its acceptance criteria met. No dead-end pages except intentional completion screens (which always offer a next action).

---

## 9. How to work through this build

1. Start with `docs/build-order.md` — build in dependency order (Foundation → P0 → P1 → P2 → P3).
2. For each page, open `docs/routes.md` (where the file goes) + `docs/sitemap.md` (its priority/archetype) + `docs/archetypes.md` (its inherited standard).
3. Enforce `docs/middleware-auth.md` for every portal.
4. Apply the three guardrails (§2) and communications compliance (§7) everywhere they touch.
5. Run `npm run build`, fix all errors, verify the page's Definition of Done (§8) before moving on.
