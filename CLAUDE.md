# CLAUDE.md — FSOS Engineering Contract for Claude Code

> **This file is the single authoritative build contract for FSOS (Financial Services Operating System).**
> Read it fully at the start of every session, before writing any code. Everything here is binding.
> It supersedes any stale instruction found elsewhere (older project briefs, chat memory, prior scaffolds).
> Companion specs live in `/docs`: `sitemap.md`, `routes.md`, `middleware-auth.md`, `build-order.md`,
> `archetypes.md`, `data-guardrails.md`, `rbac-matrix.md`, `design-system.md`, and the as-built `DESIGN.md`.
> Standard: **Fortune 500 fintech quality across the entire stack — not visual polish alone (§11).**

---

## 0. What FSOS is (one paragraph)

FSOS is a private, internal operating system for a **Farmers Financial Services Agent (FSA)** in McKinney, TX. The FSA is a life- and securities-licensed specialist who **partners with Farmers agency owners** to bring life insurance (Farmers New World Life / FNWL) and financial/investment products (through Farmers Financial Solutions, LLC / FFS) to those agencies' existing clients. It is a **B2B2C referral/wholesale model**. The **aggregate root of the entire data model is the Agency-Owner Partnership**, NOT a generic contact or deal. Do not implement FSOS as a generic contact-and-deal CRM.

---

## 1. Authority precedence (read this before resolving any conflict)

When two sources disagree, follow this order. Do not silently average conflicting instructions.

1. **This `CLAUDE.md`** and the `/docs` companion specs it names.
2. **The live repository** (`tailwind.config.ts`, `globals.css`, `src/**`, migrations) — the as-built truth.
3. **The installed project skills** in `.claude/skills/` (§5) for *how* to execute.
4. Everything else (older project briefs, prior chat context, assistant memory) is **non-authoritative background** and is overridden by 1–3.

**Resolved conflicts — treat as settled, do not re-litigate:**
- **NIGO is OUT OF SCOPE** (§4). It is a separate project. Application tracking lives in Case Management OS.
- **Make.com is OUT.** Automation is Vercel Cron + GHL-native workflows + direct webhook endpoints. No non-version-controlled automation layer.
- **Styling is Tailwind + shadcn/ui** for all new UI. Legacy inline-style command-center screens stay inline unless a task explicitly asks to migrate them.
- **Aggregate root is the Agency Partnership**, not `customers`/`contacts`. Older audit docs use legacy table names (`customers`, `scores`, `commission_cases`); the current schema uses the aggregate-root names in §8. New code uses §8 names.

---

## 2. Fixed technology stack — do not substitute

- **Next.js 14** (App Router) + **TypeScript** (strict mode)
- **Supabase** (Postgres, Auth, Row-Level Security, Storage, Edge Functions, `pg_cron`)
- **Vercel** (hosting) + **Vercel Cron** (scheduled jobs)
- **Tailwind CSS** + **shadcn/ui** (component layer) — tokens resolved through `tailwind.config.ts` / `globals.css`
- **Twilio** (SMS) via approved config; **Resend** for transactional email
- **Google Calendar** integration for scheduling
- **Durable, event-driven background jobs** (§9). Do NOT rely on an open chat/agent session for any agent work.
- **Model-agnostic AI gateway** (Claude-first; OpenAI + Gemini as configured fallbacks). All AI calls route through the gateway — never call a provider SDK directly from a route or component.

### 2.1 Non-negotiable code conventions (match the existing codebase)

1. **Supabase access:** always use `getDb()` from `@/lib/supabase/client`. **Never** instantiate a Supabase client at module level.
2. **Every API route** exports:
   ```ts
   export const dynamic = 'force-dynamic'
   export const runtime = 'nodejs'
   ```
3. **Public routes stay auth-guard-free:** `/[slug]` (agency referral), `/upload/[slug]`, `/forms/[formId]`, and the P-0 public surface in `docs/sitemap.md`. Everything else is session-guarded (§7, `docs/middleware-auth.md`).
4. **Read before write:** open and read the existing file before creating or editing. Never recreate a file that already exists — extend or fix it.
5. **Build discipline:** after any change, run `npm run build` and fix **every** error before stopping. `npm run typecheck` and `npm run lint` must also pass. Never weaken a type, guardrail test, or lint rule to force a green build.
6. **Styling:** Tailwind + shadcn/ui for all new UI. Never hardcode a color, spacing, or font — resolve through a design token (see `DESIGN.md`).
7. **Validation:** every form and every API input is validated with **Zod**; derive TS types via `z.infer`. No unvalidated writes reach the database.
8. **Thin route handlers:** business logic lives in `src/lib/services/*` (or `src/server/*`), not in route files or components. Routes parse → authorize → call a service → shape a typed response.

---

## 3. THE THREE NON-NEGOTIABLE GUARDRAILS

Enforced in code, not just documented. Enforcement layer: `docs/data-guardrails.md`. Guardrail tests are mandatory (§11.13) and may never be deleted or weakened to pass a build.

### 3.1 Securities Firewall
FSOS is **NOT a broker-dealer system** and is **NOT** the system of record for any securities activity.
- FSOS may **track that** a securities opportunity/case exists — stage, engagement model, referring agency, expected/actual commission — for the FSA's own production tracking.
- FSOS may store only a **non-substantive reference pointer** (`ffs_case_ref`) to the FFS-supervised system.
- FSOS may **NOT** store: securities account numbers, order details, suitability determinations, or securities-related client communications.
- Any record flagged `is_security = true` is **excluded** from the automated SMS/email engine and routed to human/FFS handling.
- Implement `is_security` as a **hard gate** checked in the communications dispatcher **and** the AI action validator. UI marks it with the purple firewall marker.

### 3.2 AI Green-Zone / Red-Line
The autonomous AI **MAY** (green zone): identify, educate, invite, schedule, remind, follow up, run consented/approved campaigns, draft internal materials, assemble data, and log.
The autonomous AI **MAY NEVER** (red line): make an individualized **product, policy, investment, replacement, allocation, or transaction recommendation**, make a **suitability/best-interest determination**, or issue anything that constitutes a securities "call to action."
- Every AI-generated client-facing message passes the **Compliance Guardrail** validator before dispatch. A message that fails (recommendation language, out-of-hours, unconsented, DNC, securities-flagged) is **hard-blocked** and escalated to the human FSA — never sent.
- **Escalate to the human FSA when:** a client requests advice/recommendation; a securities discussion needs an FFS-approved channel; consent is unclear; a compliance rule triggers; a replacement/suitability/best-interest/supervision issue arises; a case has conflicting/incomplete info; or a high-value/urgent opportunity needs personal intervention.
- All FNA / educational outputs carry the mandatory footer:
  > *"For educational and informational purposes only. Not a product recommendation or suitability determination. Requires licensed FSA review per FINRA Reg BI."*

### 3.3 No Invented Farmers Data
Commission splits, FNWL term-conversion windows, product availability, carrier rules, and Farmers/FFS API availability are **NOT publicly documented**. Ship them as **clearly-labeled, editable configuration defaults** — never as hard-coded facts.
- Every such value carries `is_assumption = true` and renders a **gold "config default — verify"** badge (archetype A10).
- Do NOT invent an integration or API that has not been verified. Where none exists, implement the configured **manual / CSV-import / secure-reference-field** fallback, explicitly labeled as a placeholder.

---

## 4. Scope exclusions (do not build)

- **NIGO** ("Not In Good Order" defect-prevention) is a **separate project, OUT OF SCOPE.** Create no NIGO module, agent, report, category, import, score, or cross-link. The legitimate application-tracking work lives in **Case Management OS** (`/app/cases`): applications, submission tracking, underwriting, carrier requirements, documents, status/issue tracking, service requests, case timelines — with **no** NIGO functionality.
- **Billing/subscription** (`/super/billing`) is a P3 placeholder only — build nothing unless FSOS is later commercialized as multi-tenant SaaS.

---

## 5. Skill orchestration standard (all 26 installed skills)

Skills in `.claude/skills/` encode how this codebase must be built. **They are mandatory, not optional.** Never begin coding from the task description alone — inspect the implementation first via the Superpowers analysis skills.

### 5.1 Canonical execution order (the default loop for any non-trivial task)

```
ANALYZE            → PLAN              → BUILD (TDD)       → VERIFY & POLISH
using-superpowers    brainstorming       test-driven-        verification-before-completion
supabase*            writing-plans       development          impeccable (UI polish)
domain skill*        subagent-driven-    executing-plans      requesting-code-review
                     development         frontend-design      receiving-code-review
                     dispatching-        systematic-          finishing-a-development-branch
                     parallel-agents      debugging
```
`*` load the relevant domain/DB skill during ANALYZE based on the surface being touched.

**Superpower first** — understand the system before changing it: read docs, inspect the existing implementation, trace data flows and user journeys, identify dependencies and downstream effects, choose the correct architectural layer, then plan in phases. **Frontend Design** shapes every user-facing surface. **Impeccable** runs *after* implementation as the final product-quality gate. Do not stop when a feature merely works — continue until it is coherent, refined, tested, and production-ready (§14 Definition of Done).

### 5.2 Skill matrix — invoke when

**Engineering workflow (Superpowers set)**
| Skill | Invoke when |
|---|---|
| `using-superpowers` | Start of any task — entry point to find/sequence the right skills. |
| `brainstorming` | Requirements or approach are ambiguous; explore intent before building. |
| `writing-plans` | Any multi-step change; author the phased implementation plan. |
| `executing-plans` | Execute a written plan with checkpoints and verification gates. |
| `subagent-driven-development` | Run a plan through subagents within a session. |
| `dispatching-parallel-agents` | Fan out genuinely independent workstreams. |
| `test-driven-development` | Before implementing logic — write the failing test first. |
| `systematic-debugging` | Any bug/regression — structured investigation, no guess-patching. |
| `verification-before-completion` | Before claiming any task done — prove it against §14. |
| `requesting-code-review` / `receiving-code-review` | Before/after merge — request review; handle feedback rigorously. |
| `finishing-a-development-branch` | Merge/PR/cleanup once verified. |
| `using-git-worktrees` | Isolated worktree for parallel or risky work. |

**Data & database**
| Skill | Invoke when |
|---|---|
| `supabase` | Any Supabase DB/Auth/Edge/Realtime/Storage work. |
| `supabase-postgres-best-practices` | Schema design, indexing, RLS, query performance, migration safety. |

**Design / UI**
| Skill | Invoke when |
|---|---|
| `frontend-design` | Every user-facing surface — IA, navigation, hierarchy, forms, data presentation, responsive, trust signals. |
| `impeccable` | Final polish/QA and design audits — visual consistency, states, a11y, microcopy, production readiness. |

**FSOS domain skills**
| Skill | Invoke when |
|---|---|
| `fsos-crm-workflows` | CRM spine, agents, GHL/Cron automations, pipeline logic. |
| `fsos-nigo-intelligence` | **Separate NIGO project only** — never inside FSOS scope (§4). |
| `fsos-security-audit` | RLS, guardrails, PII, audit-log security review — run on any data-touching change. |
| `farmers-brand-website` | Public marketing surface / Farmers branding work (§12). |
| `finra-rule-ingestion` | Ingesting authority-tagged rule docs into the corpus. |
| `rightbridge-pdf-analysis` | Parsing/analyzing RightBRIDGE suitability PDFs. |
| `twilio-a2p-compliance` | Outbound SMS, A2P 10DLC, TCPA, quiet-hours, consent (§10). |

**Meta (skill authoring)**
| Skill | Invoke when |
|---|---|
| `skill-creator` / `writing-skills` | Creating, editing, optimizing, or verifying a project skill. |

> Note: `fsos-nigo-intelligence` exists in the repo for the *separate* NIGO project. It must never be used to introduce NIGO functionality into FSOS. Presence of the skill is not authorization to violate §4.

---

## 6. Execution methodology (how a task actually runs)

1. **Frame** — restate the objective, the affected portals/routes, the data touched, and the guardrails in play (§3).
2. **Inspect** — read `CLAUDE.md` + the relevant `/docs` specs + the actual files. Trace the data flow end-to-end. Identify duplication risk and downstream effects.
3. **Plan** (`writing-plans`) — break into safe, independently verifiable phases. State assumptions explicitly. For Farmers-config values, mark assumptions (§3.3).
4. **Test-first** (`test-driven-development`) — write failing tests for logic, authorization, RLS, guardrails, and state transitions before implementing.
5. **Build** — thin routes, Zod at the edge, services for logic, tokens for styling, archetype shells for pages. Preserve the existing architecture; do not introduce a new pattern when one exists.
6. **Debug** (`systematic-debugging`) — reproduce, isolate, form a hypothesis, prove it, fix the root cause. No speculative patches.
7. **Polish** (`frontend-design` → `impeccable`) — states, responsiveness, a11y, microcopy, consistency.
8. **Verify** (`verification-before-completion`) — run the full §14 Definition of Done. `npm run build` clean, tests green.
9. **Review & finish** (`requesting-code-review` → `finishing-a-development-branch`) — request review, address feedback, then merge/cleanup.
10. **Report** — list every changed file, assumptions made, guardrails touched, and known limitations.

---

## 7. Portals (six + public surface)

See `docs/sitemap.md` (every page), `docs/routes.md` (file-path map), `docs/rbac-matrix.md` (permissions), `docs/middleware-auth.md` (session guards). One backend, one design system, one permission model.

| Portal | Route group | Users |
|---|---|---|
| FSA Portal | `(fsa)` → `/app/*` | The FSA + delegated licensed staff |
| Admin / Back-Office | `(admin)` → `/admin/*` | Assistants, case managers, ops, sysadmin |
| Compliance & Supervisory | `(compliance)` → `/compliance/*` | Compliance reviewers/supervisors (supplemental to FFS systems, never a replacement) |
| Agency-Owner | `(partner)` → `/partner/*` | Farmers agency owners |
| Client-Facing | `(client)` → `/client/*` | End clients (non-securities, non-advice content only) |
| Super Admin | `(super)` → `/super/*` | Platform owner (may be a role inside Admin) |
| Public | `(public)` → `/*` | Unauthenticated |

Authorization is enforced **server-side** for every non-public route (session guard + role/scope check + RLS). The frontend never enforces permissions on its own. Forbidden deep links return 403 via `ForbiddenState`.

---

## 8. Aggregate-root data model (build order matters)

Dependency spine: **Agency Partnership → Referral → Household → (Financial) Review → Opportunity → Case → Commission.** Build in that order (`docs/build-order.md`). The **Financial Review** layer is first-class — where policy/coverage/term-conversion/retirement/annual reviews happen and where opportunities originate.

Core tables (DDL + RLS in `docs/data-guardrails.md`): `agency_partnerships` (root), `agency_owners`, `districts`, `regions`, `referrals`, `households`, `household_members`, `policies`, `coverages`, `carriers`, `products`, `reviews`, `opportunities`, `cases`, `case_requirements`, `commissions`, `commission_splits`, `campaigns`, `consents`, `documents`, `activities`, `tasks`, `appointments`, `ai_agents`, `agent_runs`, `agent_actions`, `compliance_events`, `audit_log`.

Every table holding client/agency data:
- carries an owner/tenant key with **Row-Level Security** keyed to the authenticated user's role + scope;
- encrypts PII at rest (Supabase default; add `pgcrypto` column encryption for DOB and equivalent sensitive fields);
- writes to the **append-only `audit_log`** on create/update/delete, via a DB role that **cannot** UPDATE/DELETE the log.

Migrations are forward-only, reviewed for RLS coverage, index coverage, N+1 risk, locking, transaction scope, backward compatibility, and rollback risk (`supabase-postgres-best-practices`). Never add a field or table without understanding ownership, lifecycle, permissions, and downstream use.

---

## 9. AI agents & background jobs

- Agents run as **durable, event-driven background jobs** (Vercel Cron + a queue/event table), **not** open chat sessions. A job persists state and can suspend/resume across a human-approval pause.
- Every agent run writes `agent_runs` (inputs, model used, tokens, cost, confidence); every action writes `agent_actions` (tool, target, outcome, audit link).
- Every client-facing action passes the **Compliance Guardrail** validator (§3.2) before dispatch.
- **AI system standard:** route through the approved gateway; record model + inputs/outputs (as permitted) + tokens/cost/confidence/outcome; validate structured outputs with Zod; apply guardrails and the securities firewall; respect consent/channel rules; support human escalation; fail safely; never fabricate a rule, integration, citation, or product fact; never bypass a deterministic business rule. AI output must never directly mutate sensitive business data or trigger a regulated client-facing action without the required validation and approval controls.
- **Agent roster** (all green-zone; no NIGO agent): Executive Intelligence, Agency Growth, Agency Activation, Referral Triage, Referral Follow-Up, Pipeline, Cross-Sell, Term Conversion, Case Management, Document Intelligence, Commission Reconciliation, Marketing Automation, Compliance Guardrail (the hard-block layer), Data Quality.
- **Kill switch:** every agent and the whole gateway carry an enable/disable flag (`/super/ai/policies`) checked at run start.

---

## 10. Communications compliance (enforced in the dispatcher)

Before ANY automated SMS/email sends, the dispatcher checks, in order, and blocks on the first failure:
1. valid consent on that channel (`consents`);
2. within permitted quiet hours (recipient-local; enforce **9am–8pm** as the conservative floor);
3. not on internal or applicable external DNC;
4. approved template **or** approved AI policy;
5. not an individualized securities recommendation;
6. not `is_security`-flagged;
7. not otherwise blocked by FFS/Farmers/carrier/state/federal rule.

Additional binding rules (`twilio-a2p-compliance`):
- **TCPA:** written prior express consent required before any automated SMS.
- **TRAIGA 2026 (Texas):** AI disclosure required in all automated messages.
- **A2P 10DLC** registration/brand/campaign must be in place before production SMS traffic.
- **Human sign-off before go-live:** confirm with **Ryan Anderson, FFS Compliance TX — (253) 242-0597** before any automated outreach activates.

Blocked sends are logged and escalated — never silently dropped.

---

## 11. Fortune 500 fintech quality standard (whole stack)

FSOS must be designed, implemented, tested, and maintained to the standard of a modern Fortune 500 financial-services platform. This applies to the **entire** product — public site, auth, portals, frontend, backend, APIs, database, security, compliance, AI, jobs, integrations, observability, testing, docs, deployment. "Fortune 500 fintech quality" is not visual polish alone: the product must be **credible, secure, reliable, consistent, scalable, auditable, and professionally engineered end to end.** Exhaustive checklists live in `/docs`; the binding clauses below are the floor.

**11.1 Frontend.** Every surface feels deliberately designed for a regulated environment: clear information hierarchy, consistent titles/breadcrumbs, predictable navigation, responsive desktop/tablet/mobile, semantic markup, **WCAG 2.2 AA**, keyboard navigation, visible focus, proper labels, clear primary/secondary actions, confirmation before destructive actions, and full **loading / skeleton / empty (with next action) / error (with recovery) / success** states. Avoid generic templates, placeholder content, decorative excess, and consumer-app styling that weakens credibility.

**11.2 Dashboards.** Support operational decisions: clear priorities, actionable summaries, role-appropriate data, consistent tables (search, filter, sort, pagination, saved views where useful), statuses, ownership, dates/deadlines, escalation visibility, quick actions, activity history, meaningful drill-downs. Never present data without helping the user see what needs attention next.

**11.3 Forms.** Treated as workflows: clear purpose, logical grouping, correct field types, persistent labels, help text, required indicators, inline validation, accessible error summaries, loading protection, **duplicate-submission prevention**, success confirmation, recovery from failed submissions with entered data preserved, and consent/disclosure language where applicable.

**11.4 Backend architecture.** Fits the existing architecture; clean separation of concerns; reuse established services/utilities; no duplicate subsystems; business logic outside presentation; thin route handlers; centralized domain logic; API compatibility preserved unless change is authorized; designed for testability **and for failure**.

**11.5 API.** Every endpoint: authentication where required; authorization + ownership/scope validation; **Zod** input validation; consistent response contracts; correct status codes; safe error responses (no stack traces/secrets); structured server logging; audit events where required; rate limiting where risk warrants; idempotency where duplicate execution is possible; timeout handling for external services. The backend **never** relies on the frontend to enforce permissions or business rules.

**11.6 Data integrity.** Every write protects referential integrity, tenant/owner scope, required relationships, valid state transitions, duplicate prevention, concurrency safety, transaction consistency, auditability, PII handling, the securities firewall, AI red-line restrictions, and consent requirements — using DB constraints + RLS + validation + service-layer enforcement together (layered, not single-point).

**11.7 Database.** Reviewed for schema relationships, RLS coverage, index coverage, query efficiency, migration safety, backward compatibility, rollback risk, N+1 patterns, locking, transaction scope, retention, encryption, and audit logging.

**11.8 Security.** Designed into every layer; enforced server-side even when equivalent frontend controls exist. Review every change for broken auth/authz, privilege escalation, IDOR, injection, XSS, CSRF, SSRF, open redirects, unsafe uploads, sensitive-data exposure, secret leakage, insecure logging, weak sessions, missing rate limits, unsafe integrations, weak tenant isolation, improper PII handling, and dependency vulnerabilities. Run `fsos-security-audit` on any data-touching change. Never weaken auth, authz, RLS, validation, audit logging, or compliance guardrails for convenience.

**11.9 Compliance & auditability.** Every relevant operation is authorized, validated, traceable, reproducible, auditable, attributable (user/service/agent), timestamped, and linked to the affected record. Compliance-sensitive actions preserve: who, what, when, which record, automated-vs-human, which rule/control applied, pass/fail, and why blocked/escalated. Never silently bypass, suppress, or downgrade a compliance control.

**11.10 Integrations.** Isolated behind adapters/service layers (GHL, Twilio, Resend, Google Calendar, AI gateway). Each handles auth, secret management, timeouts, retries, backoff, rate limits, duplicate callbacks, idempotency, partial failure, provider outages, invalid responses, schema changes, logging, auditability, and recovery. Do not spread provider-specific logic through the app. Do not claim an integration exists unless verified (§3.3).

**11.11 Background jobs.** Durable, retry-safe, idempotent where practical, observable, auditable, recoverable, protected from duplicate execution, able to record partial progress and fail without corrupting data. Long-running work never depends on an active session; it belongs in the job system, not a request handler.

**11.12 Performance & reliability.** Review for query efficiency, N+1, excessive requests, duplicate computation, bundle size, render cost, caching, pagination, memory, large-file/large-dataset behavior, and concurrency. Optimize on evidence, not premature micro-optimization. Design for failure: invalid input, missing data, unauthorized access, network/integration/DB failure, partial completion, duplicate execution, timeout, retry exhaustion, concurrent/stale changes, and interruption. Failures are visible, logged, recoverable where practical, and never silently corrupt data.

**11.13 Observability & testing.** Structured logs + audit logs + error tracking + job-run/integration status + correlation IDs; never log passwords, tokens, sensitive PII, full financial account data, or secrets. Testing reflects risk: unit, service, API, integration, **authorization, RLS, guardrail, state-transition**, form-validation, a11y, responsive, e2e journeys, background-job, retry/idempotency, failure-path, and regression. Test more than the happy path. **Never** delete, weaken, skip, or rewrite a legitimate guardrail test to make a build pass.

**11.14 Documentation.** Kept in sync with implementation. Update affected docs when changing architecture, routes, APIs, data models, permissions, workflows, env vars, integrations, jobs, compliance controls, AI behavior, user journeys, or build/deploy procedures. No undocumented architectural decisions hidden only in code.

---

## 12. Farmers brand & enterprise design standard

FSOS is the private OS **and** public website for an authorized Farmers Financial Services Agent. It must present Fortune-500 financial-institution credibility while remaining consistent with Farmers Insurance branding. The goal is **not** to imitate the public consumer site — build a premium enterprise platform on the official Farmers visual identity. Full token/component reference: **`DESIGN.md`**. Branding work uses `farmers-brand-website` + `frontend-design` + `impeccable`.

### 12.1 Approved brand assets (trademark-safe handling)
The Farmers logo and brand assets are **trademarked**. As an authorized agent, use the **approved assets stored in the repo** — never download, recreate, redraw, recolor, or substitute them.
- Drop approved assets at: `public/brand/farmers-logo.svg` (primary color lockup), `public/brand/farmers-logo-alt.svg`, and raster fallbacks `farmers-logo.png` / `.jpeg`. (Staged approved copies are provided alongside this contract.)
- **Never** stretch, distort, crop, rotate, recolor, redraw, or recreate the logo; never use unofficial variations, placeholders, or low-resolution images; preserve official proportions and clear space.
- The sidebar `IdentityLockup` `BrandMark` is the **FSA's own monogram, not the Farmers trademark.** The official logo is added only by dropping the approved asset at the path above. Do not conflate the two.
- If an approved asset is missing, **document the gap** — do not substitute an unofficial version (§3.3 discipline applies to brand assets too).

### 12.2 Official Farmers palette (source of truth) — extracted from the approved asset
| Role | Official value | Reconciliation |
|---|---|---|
| Farmers Blue | `#1C428B` (≈ `hsl(220 66% 33%)`) | Basis for `--shell` navy and `--primary` blue; implemented as accessibility-tuned tokens in `DESIGN.md`. |
| Farmers Red | `#E11631` (≈ `hsl(352 82% 48%)`) | Basis for `--destructive`; the as-built `350 78% 43%` is a faithful AA-tuned rendering. **Reserved for destructive/critical only.** |
| Light-blue accent | `#A6C3E9` (≈ `hsl(212 62% 78%)`) | Supporting accent / soft washes. |
| Deep red | `#A20F30` (≈ `hsl(346 83% 35%)`) | Pressed/gradient floor for red. |
| Neutral gray | `#666666` | Neutral ink/dividers only. |
| White | `#FFFFFF` | Canvas / card. |

**Rule:** the official palette above is the *source of truth*; the `DESIGN.md` HSL tokens are the *implementation*. Any divergence exists solely to meet WCAG 2.2 AA contrast and must be documented in `DESIGN.md`. Never hardcode a hex — resolve through a token.

### 12.3 Consistency & quality
The visual identity is consistent across homepage, public pages, login, forgot-password, dashboards, navigation, headers, footers, forms, emails, PDFs, reports, loading screens, empty states, error pages, favicon, and app icons. Every screen must communicate trust, security, professionalism, financial expertise, stability, reliability, simplicity, and confidence — and unmistakably read as the same product. When frontend work is done, audit the affected scope (logos, colors, typography, icons, buttons, nav, forms, cards, tables, widgets, charts, email templates, PDFs, and mobile/tablet/desktop layouts) and replace any placeholder branding with approved branding.

---

## 13. Current build reality (as of last audit)

FSOS is a **high-fidelity shell missing its spine**: the legacy command center renders from mock arrays, not Supabase; there is no URL routing on legacy screens; and **authentication is not yet in place** — a blocking regulatory gap for a system holding client PII. Treat the following as the standing priority order until closed, ahead of net-new pages:
1. **Authentication + session guard** on every non-public route (Supabase Auth) — regulatory blocker.
2. **Data layer** — wire real Supabase reads/writes; retire mock arrays.
3. **URL routing** — real routes/deep links replacing `useState`-based navigation.
4. **Household/Customer 360 + Book of Business** — the missing window into the data.
5. **Consent & opt-out ledger** — TCPA defense record.
6. Move any browser-side AI calls **server-side** (`/api/forms/fna`); never expose keys.

Do not add new feature pages while a P0 blocker above is open, unless a task explicitly directs otherwise.

---

## 14. Definition of Done (every page and every task inherits this)

A page/task is **not** done because the screen renders or the code compiles. Before completing anything, verify:

- Implementation matches the request; existing architecture preserved; no duplicate subsystem created.
- Wired real data (no placeholders/mock arrays); Zod-validated inputs; enforced permissions (403 via `ForbiddenState` on forbidden deep links).
- Full states: loading (skeleton, never a bare spinner) / empty (with next action) / error (isolated, retryable) / success.
- Responsive desktop→tablet→mobile; **WCAG 2.2 AA** (labels, keyboard, aria, AA contrast on both shell and canvas).
- Backend enforces security + business rules server-side; APIs validated; errors safe; structured logs + audit events written.
- Data integrity + RLS + guardrails intact; gold assumption badge on every config default; purple firewall marker on every `is_security` row.
- Triggered notifications/automations wired; communications compliance (§10) enforced.
- Tests pass (incl. authz/RLS/guardrail/state-transition/failure-path); **no legitimate guardrail test weakened or skipped.**
- `npm run build`, `typecheck`, and `lint` all clean.
- No dead-end pages (completion screens always offer a next action); no placeholders left in scope.
- Documentation updated where required; all changed files listed; assumptions and known limitations disclosed.

The result must be demonstrably more secure, usable, reliable, maintainable, and professionally engineered than what existed before the task began.

---

## 15. Session protocol (how to start and finish)

**On start:** read this file → the relevant `/docs` specs → the actual files in scope. Confirm which portal(s), routes, and tables you touch and which guardrails apply. Load the domain + DB + design skills for the surface.

**During:** build in dependency order (Foundation → P0 → P1 → P2 → P3, `docs/build-order.md`); apply the three guardrails (§3) and communications compliance (§10) everywhere they touch; keep routes thin, validate at the edge, resolve styling through tokens, compose pages from archetype shells.

**On finish:** run the full §14 Definition of Done; `npm run build` clean; verify with `verification-before-completion`; request review; then report every changed file, assumptions made, guardrails touched, and known limitations.

---

## Appendix A — FFS key contacts
- **Ryan Anderson**, Compliance TX — **(253) 242-0597** (required sign-off before any automated outreach goes live)
- **Matt Anderson**, FSD Central — (818) 584-0264
- **Sales Desk** — (866) 888-9739, Option 3 → 3, Mon–Fri 7AM–5PM PT

## Appendix B — GDC payout tiers *(config defaults — `is_assumption = true`, verify before relying on them)*
- **Tier 1:** under $15k rolling-12-mo GDC → **40%** FSA payout
- **Tier 2:** $15k–$54,999 → **60%**
- **Tier 3:** $55k+ → **80%**

## Appendix C — Companion docs
`docs/sitemap.md` · `docs/routes.md` · `docs/middleware-auth.md` · `docs/rbac-matrix.md` · `docs/build-order.md` · `docs/archetypes.md` · `docs/data-guardrails.md` · `docs/design-system.md` · `DESIGN.md` · `docs/comms-ai-compliance.md` · `docs/review-conversion-crosssell.md`
