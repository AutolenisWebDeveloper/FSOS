# CLAUDE.md — FSOS Engineering Contract for Claude Code

> **This file is the authoritative build contract for FSOS (Farmers FSA Operating System).**
> Read it fully before writing any code. Everything here is binding.
> Companion specs live in `/docs`: `sitemap.md`, `routes.md`, `middleware-auth.md`, `build-order.md`, `archetypes.md`, `data-guardrails.md`, `rbac-matrix.md`, `comms-ai-compliance.md`, `cases-commission.md`, `review-conversion-crosssell.md`, `portals-admin.md`, `workflows-core-spine.md`, `workflows-ops-compliance.md`, `acceptance-checklist.md`.
> Project skills live in `.claude/skills/` (26 skills — see §9). Use them; do not work from memory when a skill governs the task.

---

## How to read this file

1. **§0–§7** are the *system contract* (what FSOS is and the invariants that can never be violated). Preserve them.
2. **§8** is the *Fortune 500 fintech quality standard* — the engineering bar for every change, frontend and backend.
3. **§9** is the *skill orchestration matrix* — which of the 26 installed skills to invoke, when, and in what order.
4. **§10** is the *Farmers brand standard*.
5. **§11–§13** are the *Definition of Done*, the *working lifecycle*, and the *reference appendix*.

### Conflict-resolution rule (read this once, apply always)

Sources in this project have drifted over time. When two instructions conflict, resolve in this precedence order and state the resolution in your plan:

1. **This CLAUDE.md** (highest authority) and the `/docs` companion specs it references.
2. **The installed `.claude/skills/`** governing the specific task.
3. Older scaffolding notes, the `fsos-dev` global skill, and prior chat framing (lowest).

Three drift points are resolved authoritatively here so you never re-litigate them:

- **Styling:** New UI uses **Tailwind + shadcn/ui**. Legacy command-center screens that use inline styles stay inline — do not convert them unless explicitly asked. (Ignore any older "inline styles only" instruction for *new* work.)
- **Automation layer:** **Make.com is removed from the stack.** All scheduled/automation work uses **Vercel Cron + durable event-driven jobs** (§6). Do not add Make.com scenarios or a non-version-controlled automation layer.
- **NIGO:** The **core FSOS operating system contains no NIGO functionality and no NIGO agent** (§3). NIGO / submission-quality intelligence is a **separate module** governed exclusively by the `fsos-nigo-intelligence` skill, kept architecturally isolated from the partnership spine. Do not weave NIGO into core CRM entities, agents, or dashboards.

---

## 0. What FSOS is (one paragraph)

FSOS is a private, internal operating system for a **Farmers Financial Services Agent (FSA)** in McKinney, TX — a life- and securities-licensed specialist who **partners with Farmers agency owners** to bring life insurance (Farmers New World Life / FNWL) and financial/investment products (through Farmers Financial Solutions, LLC / FFS) to those agencies' existing clients. It is a **B2B2C referral/wholesale model**. The **aggregate root of the entire data model is the Agency-Owner Partnership**, not a generic contact or deal. Do not implement FSOS as a generic contact-and-deal CRM.

---

## 1. Fixed technology stack — do not substitute

- **Next.js 14** (App Router) + **TypeScript** (strict mode)
- **Supabase** (Postgres, Auth, Row-Level Security, Storage, Edge Functions, `pg_cron`)
- **Vercel** (hosting) + **Vercel Cron** (scheduled jobs)
- **Tailwind CSS** + **shadcn/ui** (component layer)
- **Twilio** (SMS, via approved config) + **Resend** (transactional email)
- **Google Calendar** integration for scheduling
- **Durable background jobs** (event-driven; §6). Never rely on an open chat session for agent work.
- **Model-agnostic AI gateway** (Claude-first; OpenAI + Gemini as configured fallbacks). All AI calls go through `lib/ai/gateway.ts` — never call a provider SDK directly from a route or component.

### Non-negotiable code conventions (match the existing codebase)

1. **Supabase access:** always use `getDb()` from `@/lib/supabase/client`. **Never** instantiate a Supabase client at module level — Next.js evaluates module-level code at build time, env vars are absent, and `npm run build` breaks.
   ```ts
   // ✅ inside the handler
   import { getDb } from '@/lib/supabase/client'
   export async function POST(req: Request) { const db = getDb(); /* ... */ }
   // ❌ module-level — breaks the build
   const supabase = createClient(process.env.SUPABASE_URL!, ...)
   ```
2. **Every API route** exports:
   ```ts
   export const dynamic = 'force-dynamic'
   export const runtime  = 'nodejs'
   ```
3. **Public routes** stay auth-guard-free: `/[slug]`, `/upload/[slug]`, `/forms/[formId]`, and the entire P-0 public surface in `docs/sitemap.md`. Adding an auth guard here breaks onboarding.
4. **Read before write.** Read the existing file before creating or editing. Never recreate a file that already exists — extend or fix it. The scaffold already contains route groups, guardrail libs, Zod schemas, types, and page shells.
5. **Build discipline.** After any code change: `npm run build` → fix **every** error before stopping. A task with a red build is not done.
6. **Styling.** Tailwind + shadcn/ui for new UI; legacy inline command-center stays inline (see conflict rule above).
7. **Validation.** Every form and every API input is validated with **Zod**; derive TS types via `z.infer`. No unvalidated writes. Zod schemas in `lib/validation/` are the source of truth for types.

---

## 2. THE THREE NON-NEGOTIABLE GUARDRAILS

Enforced in code, not just documented. Enforcement layer: `lib/compliance/firewall.ts`, `lib/compliance/guardrail.ts`, `lib/comms/dispatcher.ts`, `lib/audit/log.ts`. See `docs/data-guardrails.md` and `docs/comms-ai-compliance.md`. **These four libs exist and are enforced before any agent or any send is built.**

### 2.1 Securities Firewall

FSOS is **NOT a broker-dealer system** and is **NOT** the system of record for any securities activity.

- FSOS may **track that** a securities opportunity/case exists — stage, engagement model, referring agency, expected/actual commission — for the FSA's own production tracking.
- FSOS may store only a **non-substantive reference pointer** (`ffs_case_ref`) to the FFS-supervised system.
- FSOS may **NOT** store: securities account numbers, order details, suitability determinations, or securities-related client communications.
- Any record flagged `is_security = true` is **excluded** from the automated SMS/email engine and routed to human/FFS handling.
- Implement `is_security` as a hard gate checked in the communications dispatcher **and** the AI action validator. Every block writes a firewall event to `audit_log`.

### 2.2 AI Green-Zone / Red-Line

The autonomous AI **may** (green zone): identify, educate, invite, schedule, remind, follow up, run consented/approved campaigns, draft internal materials, assemble data, and log.

The autonomous AI **may NEVER** (red line): make an individualized **product, policy, investment, replacement, allocation, or transaction recommendation**, make a **suitability/best-interest determination**, or issue anything that constitutes a securities "call to action."

- Every AI-generated client-facing message passes the **Compliance Guardrail** validator (`lib/compliance/guardrail.ts`) before dispatch. A message that fails (recommendation language, out-of-hours, unconsented, DNC, securities-flagged) is **hard-blocked** and escalated to the human FSA — never sent.
- **Escalate to the human FSA when:** a client requests advice/recommendation; a securities discussion needs an FFS-approved channel; consent is unclear; a compliance rule triggers; a replacement/suitability/best-interest/supervision issue arises; a case has conflicting/incomplete info; or a high-value/urgent opportunity needs personal intervention.

### 2.3 No Invented Farmers Data

Commission splits, FNWL term-conversion windows, product availability, carrier rules, and Farmers/FFS API availability are **not publicly documented**. Ship them as **clearly-labeled, editable configuration defaults** — never as hard-coded facts.

- Every such value carries `is_assumption = true` and renders a **"config default — verify"** badge in the UI (archetype A10).
- Do **not** invent an integration or API that has not been verified. Where none exists, implement the configured **manual / CSV-import / secure-reference-field** fallback, labeled as a placeholder.

---

## 3. Scope exclusions (do not build into core FSOS)

- **NIGO ("Not In Good Order" defect-prevention) is a separate, isolated module.** The **core FSOS OS** contains no NIGO module, agent, report, category, import, score, or cross-link. All NIGO / submission-quality work is governed exclusively by the **`fsos-nigo-intelligence`** skill and must remain architecturally separate from the partnership spine (its own tables/namespace; no foreign keys pulling NIGO state into core CRM entities). The legitimate application-tracking work that *does* live in core is **Case Management OS** (`/app/cases`): applications, submission tracking, underwriting, carrier requirements, documents, status/issue tracking, service requests, case timelines — with **no** NIGO functionality.
- **Billing/subscription** (`/super/billing`) is a **P3 placeholder only.** Build nothing here unless FSOS is later commercialized as multi-tenant SaaS.

---

## 4. Portals & route groups (six portals + public surface)

One backend, one design system, one permission model. Coarse portal gate in `src/middleware.ts`; fine-grained checks in `lib/auth/rbac.ts` + RLS. Full map in `docs/routes.md`; RBAC source of truth in `docs/rbac-matrix.md`.

| Portal | Route group | URL prefix | Users / role gate |
|---|---|---|---|
| Public | `(public)` | `/` | none (unauthenticated) |
| FSA | `(fsa)` | `/app` | `fsa`, `licensed_staff` |
| Admin / Back-Office | `(admin)` | `/admin` | `admin`, `ops`, `case_manager` |
| Compliance & Supervisory | `(compliance)` | `/compliance` | `compliance`, `supervisor` (supplemental to FFS, never a replacement) |
| Agency-Owner | `(partner)` | `/partner` | `agency_owner` (scoped to own agency) |
| Client-Facing | `(client)` | `/client` | `client` (scoped to own household; non-securities, non-advice only) |
| Super Admin | `(super)` | `/super` | `super_admin` (**MFA mandatory**) |

**Roles:** `super_admin · fsa · licensed_staff · admin · ops · case_manager · compliance · supervisor · agency_owner · client`.

**Override gates evaluated BEFORE the base RBAC grid** (see `rbac-matrix.md` §2):
1. **Securities scope gate** — actions on `is_security=true` require active securities registration on the actor; securities *communication* is never sendable from FSOS by anyone (routes to FFS); every block writes a firewall event.
2. **Comp-disclosure gate** — `agency_owner` sees attributed commissions only where `agency.comp_disclosure=true`.
3. **Consent gate** — any communicate (**M**) action requires valid channel consent + quiet-hours + not-DNC at send time, regardless of role.
4. **Client/partner column allowlist** — client & agency_owner reads are column-filtered; securities/advice/other-party fields are never returned.
5. **Kill switch** — AI-initiated actions additionally require the per-agent + global switch ON.

---

## 5. Aggregate-root data model (build order matters)

The dependency spine is:

**Agency Partnership → Referral → Household → (Financial) Review → Opportunity → Case → Commission.**

Build entities in that order (`docs/build-order.md`). The **Financial Review** layer is first-class — it is where policy/coverage/term-conversion/retirement/annual reviews happen and where opportunities originate.

Core tables (DDL + RLS in `docs/data-guardrails.md`): `agency_partnerships` (root), `agency_owners`, `districts`, `regions`, `referrals`, `households`, `household_members`, `policies`, `coverages`, `carriers`, `products`, `reviews`, `opportunities`, `cases`, `case_requirements`, `commissions`, `commission_splits`, `campaigns`, `consents`, `documents`, `activities`, `tasks`, `appointments`, `ai_agents`, `agent_runs`, `agent_actions`, `compliance_events`, `audit_log`.

Every table carrying client/agency data:
- carries an owner/tenant key with **RLS** keyed to the authenticated user's role + scope;
- encrypts PII at rest (Supabase default; add `pgcrypto` column encryption for `dob`);
- writes to the **append-only `audit_log`** on create/update/delete (a DB role that cannot UPDATE/DELETE the log).

---

## 6. AI agents & durable background jobs

- Agents run as **durable, event-driven background jobs** (Vercel Cron + a queue/event table via `jobs/agent-runner.ts`), **not** open chat sessions. A job persists state and can suspend/resume across a human-approval pause.
- Every agent run writes `agent_runs` (inputs, model used, tokens, cost, confidence); every action writes `agent_actions` (tool, target, outcome, audit link).
- Every client-facing action passes the **Compliance Guardrail** (§2.2) before dispatch.
- **Agent roster** (all green-zone; **no NIGO agent**): Executive Intelligence, Agency Growth, Agency Activation, Referral Triage, Referral Follow-Up, Pipeline, Cross-Sell, Term Conversion, Case Management, Document Intelligence, Commission Reconciliation, Marketing Automation, **Compliance Guardrail** (the hard-block layer), Data Quality.
- **Kill switch:** every agent and the whole gateway have an enable/disable flag (`/super/ai/policies`) checked at run start. Jobs must be idempotent and retry-safe.

---

## 7. Communications compliance (enforced in the dispatcher)

Before ANY automated SMS/email sends, `lib/comms/dispatcher.ts` checks, in order, and **blocks on any failure**:

1. valid **consent** on that channel (`consents`);
2. within permitted **quiet hours** (recipient-local; enforce **9am–8pm** as the conservative floor);
3. not on internal or applicable external **DNC**;
4. **approved template** or approved AI policy;
5. **not an individualized securities recommendation**;
6. **not `is_security`-flagged**;
7. not otherwise blocked by FFS / Farmers / carrier / state / federal rule.

Blocked sends are **logged and escalated, never silently dropped.**

**Regulatory anchors (must be honored, not just cited):**
- **TCPA** — written prior express consent required before any automated SMS.
- **TRAIGA 2026 (Texas)** — AI disclosure required in every automated message.
- **FINRA Reg BI** — no product recommendation or suitability determination from FSOS or its AI.
- **Live-outreach human gate** — before any automated outreach goes live, obtain sign-off from **Ryan Anderson, Compliance TX: (253) 242-0597**. Do not enable a live send path without it.

---

## 8. Fortune 500 Fintech Quality Standard

FSOS must be designed, implemented, tested, and maintained to the standard of a modern Fortune 500 financial-services platform — across the **entire** stack, not visual polish alone. Every change must leave the system **more secure, usable, reliable, maintainable, and auditable** than before. "It compiles / it renders" is never Done.

### 8.0 Required skill execution order (per non-trivial task)

Map every substantive task onto this lifecycle, using the installed skills (§9):

1. **Understand before changing** — `using-superpowers` → `brainstorming`: read the relevant `/docs`, inspect the existing implementation, trace affected data flows and user journeys, identify dependencies and downstream effects, choose the correct architectural layer. **Never begin coding from the task description alone.**
2. **Plan** — `writing-plans`: author a phased, verifiable implementation plan; split complex work into safe checkpoints.
3. **Test-first where practical** — `test-driven-development`: write the failing test (guardrail, RLS, state-transition, API contract) before the implementation.
4. **Execute** — `executing-plans` (+ `subagent-driven-development` / `dispatching-parallel-agents` for large or independent workstreams; `using-git-worktrees` for isolation).
5. **Design the surface** — `frontend-design` for every user-facing surface (information architecture, hierarchy, trust signals, accessibility, responsive behavior).
6. **Debug systematically** — `systematic-debugging` when anything fails; isolate the layer before changing code.
7. **Polish to production** — `impeccable` as the final UX/product-quality pass (visual consistency, states, focus, microcopy, CTA clarity).
8. **Verify & review** — `verification-before-completion` → `requesting-code-review` → `receiving-code-review`.
9. **Finish cleanly** — `finishing-a-development-branch`.

Do not stop when a feature merely works. Continue until it is coherent, refined, tested, and production-ready.

### 8.1 Frontend standard (enterprise product experience)

Every surface must feel deliberately designed for a regulated financial environment — communicating trust, security, stability, competence, clarity, and operational control. **Avoid** generic dashboard templates, inconsistent page structures, placeholder content, decorative gradients/animations/glassmorphism, oversized typography, unexplained icons, and hidden/ambiguous actions.

Every frontend feature includes, where applicable:
- clear information hierarchy; consistent titles + breadcrumbs; predictable navigation;
- responsive desktop/tablet/mobile; accessible semantic markup; **WCAG 2.2 AA**; keyboard nav; visible focus; proper labels/instructions;
- clear primary/secondary actions; **confirmation before destructive actions**;
- **loading, skeleton, empty (with next action), error (with recovery), and success states**;
- inline validation near the affected field; accessible error summaries; duplicate-submission prevention; preservation of entered data after recoverable errors;
- correct data formatting; clear status indicators; audit/activity visibility where relevant.

**Dashboards** must drive decisions: clear priorities, actionable summaries, role-appropriate info, consistent tables (search/filter/sort/pagination, saved views), statuses, ownership, dates/deadlines, escalation visibility, quick actions, activity history, meaningful drill-downs. Never present data without showing what needs attention next.

**Forms are operational workflows,** not input collections: clear purpose, logical grouping, correct field types, persistent labels, required-field indicators, inline validation, loading protection, success confirmation, failure recovery, and consent/disclosure language where applicable.

### 8.2 Backend & API standard

The backend enforces data integrity, permissions, compliance rules, and business behavior **independently of the client** — never rely on the frontend to enforce anything.

- Fit the existing architecture; preserve separation of concerns; reuse established services/utilities; keep route handlers thin; centralize domain logic; no duplicate subsystems; no new pattern where a project pattern already solves it.
- Every endpoint: authentication + authorization + **ownership/scope validation**, **Zod** input validation, consistent response contracts, correct HTTP status codes, safe error responses (no secrets/stack traces), structured server-side logging, **audit events** where required, rate limiting where risk warrants, **idempotency** where duplicate execution is possible, timeout handling for external services.

### 8.3 Data integrity & database standard

Every write protects: referential integrity, tenant/owner scope, required relationships, valid state transitions, duplicate prevention, concurrency safety, transaction consistency, auditability, PII handling, **securities-firewall restrictions**, **AI red-line restrictions**, consent requirements. Use **DB constraints + RLS + validation + service-layer enforcement together** — never one control where layered controls apply.

Review DB work for: correct relationships, RLS coverage, index coverage, query efficiency, migration safety, backward compatibility, rollback risk, N+1 patterns, locking, transaction scope, retention, encryption, audit logging. Never add a field/table without understanding ownership, lifecycle, permissions, and downstream use. (See `supabase` + `supabase-postgres-best-practices` skills.)

### 8.4 Security standard

Design security into every layer; enforce server-side even when a frontend control exists. Review every change for: broken auth/authorization, privilege escalation, IDOR, injection, XSS, CSRF, SSRF, open redirects, unsafe uploads, sensitive-data exposure, secret leakage, insecure logging, weak sessions, missing rate limits, unsafe integrations, inadequate tenant isolation, improper PII handling, dependency vulnerabilities. **Never** weaken auth, RLS, validation, audit logging, or compliance guardrails for convenience. (Run the `fsos-security-audit` skill on any change touching RLS, guardrails, PII, or the audit log.)

### 8.5 Compliance & auditability standard

Every compliance-sensitive operation is authorized, validated, traceable, reproducible, auditable, attributable, timestamped, and linked to the affected record. Audit records must preserve: **who, what, when, which record, automated-vs-human, which rule/control was applied, pass/fail, and why blocked/escalated.** Never silently bypass, suppress, or downgrade a compliance control.

### 8.6 AI subsystem standard

AI is an enterprise subsystem, not an ungoverned feature. Every AI workflow: uses the approved **gateway**; records model, inputs/outputs (as permitted), tokens, cost, confidence, outcome; validates structured outputs; applies compliance guardrails + securities firewall; respects consent/channel rules; supports human escalation; fails safely; never fabricates a rule, integration, citation, or product fact; never bypasses deterministic business rules. AI output must never directly modify sensitive business data or trigger a regulated client-facing action without the required validation and approval.

### 8.7 Integration standard

Isolate third-party integrations (GHL, Twilio, Resend, Google Calendar, Anthropic, Supabase) behind adapters/service layers. Each handles: auth, secret management, timeouts, retries, backoff, rate limits, duplicate callbacks, idempotency, partial failure, provider outage, invalid responses, schema changes, logging, auditability, recovery. Do not spread provider-specific logic through the app. Do not claim an integration exists unless verified (ties to §2.3).

### 8.8 Background-job standard

Jobs are durable, retry-safe, idempotent where practical, observable, auditable, recoverable, protected from duplicate execution, able to record partial progress, and able to fail without corrupting data. Long-running work never depends on an open browser/session and never runs synchronously inside a request handler when it belongs in the job system.

### 8.9 Performance, reliability & observability

- **Performance:** review for query efficiency, N+1, excessive requests, duplicate computation, bundle size, render cost, caching, pagination, memory, large-file/large-dataset behavior, concurrency, load growth. Optimize from evidence, not premature micro-optimization.
- **Reliability:** design for failure — invalid input, missing data, unauthorized access, network/integration/DB failure, partial completion, duplicate execution, timeout, retry exhaustion, concurrent/stale data, user/job interruption. Failures are visible, logged, recoverable, and never silently corrupting.
- **Observability:** structured logs, audit logs, error tracking, job-run status, integration status, correlation IDs, clear failure reasons, admin visibility. **Never** log passwords, tokens, full financial account data, sensitive PII, or secrets. No noisy, value-free logs.

### 8.10 Testing standard

Test to the risk of the affected system: unit, service, API, integration, authorization, **RLS**, **guardrail**, state-transition, form-validation, accessibility, responsive, E2E journey, background-job, retry/idempotency, failure-path, regression. **Do not test only the happy path. Never delete, weaken, skip, or rewrite a legitimate guardrail test to make a build pass.**

### 8.11 Documentation standard

Keep docs synchronized with implementation. Update the affected `/docs` file when changing architecture, routes, APIs, data models, permissions, workflows, env vars, integrations, jobs, compliance controls, AI behavior, user journeys, or build/deploy procedures. No undocumented architectural decisions hidden only in code.

---

## 9. Skill Orchestration Matrix (all 26 installed skills)

Skills live in `.claude/skills/`. When a skill governs a task, **invoke it** — its guidance overrides default behavior. Read the skill before acting. Compose skills in the §8.0 lifecycle order.

### 9.1 FSOS project-specific (domain authority — always consult when the task touches the domain)

| Skill | Invoke when… |
|---|---|
| `fsos-crm-workflows` | Working on the core CRM spine, the agent roster, GHL/webhook wiring, or any partnership→referral→…→commission workflow. |
| `fsos-nigo-intelligence` | **Any** NIGO / submission-quality / rebuttal work. This is the *only* place NIGO logic lives; keep it isolated from core FSOS (§3). |
| `fsos-security-audit` | Any change touching RLS, the four guardrail libs, PII handling, or `audit_log`. Run as a gate before completion on security-relevant changes. |
| `farmers-brand-website` | Any work on the public marketing surface or applying Farmers branding (pair with §10 and the `frontend-design` + `impeccable` skills). |
| `finra-rule-ingestion` | Ingesting authority-tagged rule documents into the compliance corpus. |
| `rightbridge-pdf-analysis` | Parsing/analyzing RightBRIDGE suitability PDFs. |
| `twilio-a2p-compliance` | Any outbound SMS path — A2P 10DLC registration, TCPA consent, TRAIGA disclosure. Consult before enabling any send (ties to §7). |

### 9.2 Database

| Skill | Invoke when… |
|---|---|
| `supabase` | Any Supabase work — schema, Auth, Edge Functions, Realtime, Storage, migrations. |
| `supabase-postgres-best-practices` | Schema design, indexing, query performance, RLS patterns, migration safety. Pair with `supabase` on any DDL. |

### 9.3 Engineering workflow ("superpowers" set — the §8.0 lifecycle)

| Skill | Role in the lifecycle |
|---|---|
| `using-superpowers` | Entry point — discover and route to the right skill for the task. |
| `brainstorming` | Explore intent and options before building. |
| `writing-plans` | Author a multi-step, verifiable implementation plan. |
| `executing-plans` | Execute a written plan with checkpoints. |
| `subagent-driven-development` | Run a plan via in-session subagents for larger scopes. |
| `dispatching-parallel-agents` | Fan out genuinely independent tasks in parallel. |
| `test-driven-development` | Write tests before implementation (§8.10). |
| `systematic-debugging` | Structured, layer-isolating bug investigation. |
| `verification-before-completion` | Verify against Definition of Done before claiming done. |
| `requesting-code-review` | Request review before merge. |
| `receiving-code-review` | Handle review feedback rigorously. |
| `finishing-a-development-branch` | Merge / PR / cleanup. |
| `using-git-worktrees` | Isolated worktree workflow for parallel or risky work. |

### 9.4 Design / UI

| Skill | Invoke when… |
|---|---|
| `frontend-design` | Every user-facing surface — before building UI (§8.1). |
| `impeccable` | Final product-quality pass after implementation — states, consistency, accessibility, polish. |

### 9.5 Meta (skill authoring)

| Skill | Invoke when… |
|---|---|
| `skill-creator` | Creating, editing, or optimizing a skill. |
| `writing-skills` | Authoring and verifying a new skill. |

> **Global vs. project skills:** additional user/global skills (e.g. `docx`, `pptx`, `pdf`, `deep-research`, `learn`) exist outside the repo. The **26 above are the project's installed skills** and take precedence for FSOS work. `.cursor/skills/` mirrors only `impeccable` + `skill-creator` for Cursor.

---

## 10. Farmers Insurance Brand Standard

FSOS is the private operating system **and** the public website for an **authorized** Farmers Financial Services Agent. Every surface must present Fortune 500 financial-institution professionalism while remaining faithful to Farmers branding. Pair this section with `farmers-brand-website`, `frontend-design`, and `impeccable`.

### 10.1 Approved assets & trademark rule

The Farmers logo and marks are **trademarked**. Use the **approved brand assets stored in the repository** (`/public/brand/farmers/` — the vetted SVG/PNG logo pack). **Never** download, scrape, recreate, redraw, stretch, distort, crop, rotate, recolor, or substitute the logo, and never use placeholder or low-resolution marks. Preserve official proportions and required clear space. If an approved asset is missing, **document the gap** — do not substitute an unofficial version.

### 10.2 Brand color palette (from the official approved assets)

| Token | Hex | Use |
|---|---|---|
| **Farmers Blue** (primary) | `#1C428B` | Navigation, primary buttons, headers, links, chart primary, key accents |
| **Farmers Red** | `#E11631` | Primary CTAs, alerts/attention, brand accent |
| **Light Blue** (accent) | `#A6C3E9` | Secondary accents, hovers, subtle fills, chart secondary |
| **Maroon** (deep accent) | `#A20F30` | Emphasis / pressed states / deep accents |
| **Neutral Gray** | `#666666` | Body text, secondary UI, borders |
| **White** | `#FFFFFF` | Surfaces, contrast |

> These values are read from the approved in-repo SVG assets and are the working source of truth. Before public launch, confirm them against the current **official Farmers agent brand kit**; treat the token layer as the single point of change.

Encode the palette once as design tokens (Tailwind theme + CSS variables) and consume tokens everywhere — never hardcode hexes in components. Maintain WCAG 2.2 AA contrast (Farmers Red on white passes for large/bold and UI accents; verify small-text pairings and prefer Farmers Blue or Neutral Gray for body copy).

### 10.3 Consistency & design language

Apply the identity consistently across: homepage, public pages, login, forgot-password, dashboards, navigation, headers, footers, forms, emails, PDFs, reports, loading/empty/error states, favicon, and app icons. Every screen must read as the same professional product.

The goal is **not** to clone the public Farmers marketing site. Build a premium enterprise platform — Farmers identity + Fortune 500 fintech usability, executive dashboards, clean typography, consistent spacing, professional data visualization, high accessibility, trust-focused presentation — comparable in quality to Stripe/Ramp/Mercury/Plaid-class products while unmistakably Farmers.

### 10.4 Branding audit

Whenever frontend work is performed, audit the affected scope (logos, colors, typography, icons, buttons, nav, forms, cards, tables, widgets, charts, email templates, PDFs, and mobile/tablet/desktop layouts) for consistency; replace placeholder branding with approved assets; ensure no inconsistent colors/fonts/logos remain. Run `impeccable` as the closing pass.

---

## 11. Definition of Done

A page/feature/task is **not** done because the screen renders or the build is green. Before completing, verify all of the following (per `docs/archetypes.md` and `docs/acceptance-checklist.md`):

**Page-level**
- [ ] Wired to real data (no placeholders) · every input Zod-validated · permissions enforced (403 on forbidden deep links)
- [ ] Loading / skeleton / empty (with next action) / error (with recovery) / success states present
- [ ] Archived/deleted behavior · responsive desktop/tablet/mobile · accessibility (labels, keyboard, focus, aria, WCAG 2.2 AA)
- [ ] Notifications/automations wired · **audit events written** · no dead-end pages (completion screens always offer a next action)

**Task-level**
- [ ] Implementation matches the request · existing architecture preserved · no duplicate subsystem · no new pattern where one exists
- [ ] Backend enforces security + business rules independently of the client · auth/authorization correct · data integrity protected
- [ ] **Compliance controls intact** (firewall, guardrail, dispatcher, audit) — none weakened or bypassed
- [ ] APIs validated · errors safe · logs/audit sufficient · no secrets/PII logged
- [ ] Tests pass (incl. guardrail/RLS/failure-path) · **no legitimate guardrail test weakened** · `npm run build` clean
- [ ] Branding consistent (§10) · docs updated (§8.11) · **all changed files listed in the final report** · known limitations explicitly disclosed

The result must be demonstrably more secure, usable, reliable, maintainable, and professionally engineered than what existed before.

---

## 12. How to work through this build

1. **Route the task** — `using-superpowers`; read the governing `/docs` and skills; **inspect the existing implementation first** (§8.0). Read `docs/build-order.md` and build in dependency order (Phase 0 Foundation → P0 → P1 → P2 → P3).
2. **For each page** — open `docs/routes.md` (file location) + `docs/sitemap.md` (priority/archetype) + `docs/archetypes.md` (inherited standard). Enforce `docs/middleware-auth.md` + `docs/rbac-matrix.md`.
3. **Plan → test-first → build → design → polish** — follow the §8.0 lifecycle.
4. **Apply the invariants everywhere they touch** — three guardrails (§2), comms gate (§7), Fortune 500 standard (§8), brand standard (§10).
5. **Verify** — `verification-before-completion` against §11; run `npm run build`; run `fsos-security-audit` on security-relevant changes; fix **every** error; then request review and finish the branch.

**Foundation gate (Phase 0):** `npm run build` clean · auth test matrix passes · a deliberately non-compliant test message is correctly **hard-blocked + escalated** · the four guardrail libs + gateway + durable job runner exist and are enforced *before* any agent or send is built.

---

## 13. Reference appendix

### 13.1 FFS key contacts

| Name | Role | Phone |
|---|---|---|
| Ryan Anderson | Compliance TX (live-outreach sign-off) | (253) 242-0597 |
| Matt Anderson | FSD Central | (818) 584-0264 |
| FFS Sales Desk | Sales support (Mon–Fri 7AM–5PM PT) | (866) 888-9739 → Opt 3 → 3 |

### 13.2 GDC payout tiers (config default — verify; `is_assumption=true`)

| Tier | Rolling 12-mo GDC | FSA payout |
|---|---|---|
| 1 | Under $15k | 40% |
| 2 | $15k – $54,999 | 60% |
| 3 | $55k+ | 80% |

### 13.3 Canonical lib entry points (do not bypass)

`lib/supabase/client.ts` → `getDb()` · `lib/ai/gateway.ts` (all AI) · `lib/compliance/firewall.ts` (securities) · `lib/compliance/guardrail.ts` (green/red validator) · `lib/comms/dispatcher.ts` (7-step send gate) · `lib/auth/rbac.ts` · `lib/audit/log.ts` (append-only) · `lib/validation/*` (Zod = type source of truth) · `jobs/agent-runner.ts` (durable jobs).

### 13.4 TypeScript patterns

```ts
// getDb() replaces any module-level supabase reference
const db = getDb(); const { data, error } = await db.from('referrals').select('*').returns<Referral[]>()

// Validate at the boundary — Zod schema is the type source
const body = ReferralCreateSchema.parse(await req.json()) // z.infer<typeof ReferralCreateSchema>

// Unavoidable any (rare)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const payload = raw as any
```

### 13.5 Secrets discipline

Never paste, log, or commit secrets (Supabase keys, GHL PIT, Anthropic/Twilio/Resend keys). Configure via Vercel env vars; reference the pattern in `.env.local.example`. Any credential exposed in chat or a commit is treated as compromised — rotate before reuse.

---

*End of contract. If you found yourself about to violate §2, §7, or §10, stop and escalate instead.*
