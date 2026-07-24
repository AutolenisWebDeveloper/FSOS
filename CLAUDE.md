# CLAUDE.md — FSOS Engineering Contract for Claude Code

> **This file is the single authoritative build contract for FSOS (Financial Services Operating System).**
> Read it fully at the start of every session, before writing any code. Everything here is binding.
> It supersedes any stale instruction found elsewhere (older project briefs, chat memory, prior scaffolds).
> Companion specs live in `/docs`: `sitemap.md`, `routes.md`, `middleware-auth.md`, `build-order.md`,
> `archetypes.md`, `data-guardrails.md`, `rbac-matrix.md`, `design-system.md`, and `adr/` (Architecture
> Decision Records, §19). The **design system of record is `DESIGN.md`**. Standard: **Fortune 500 fintech
> quality across the entire stack — not visual polish alone (§13).**
>
> **Structure is frozen.** The numbered sections below are stable IDs. Add new architectural *rationale*
> as an ADR (§19), not as new prose here; grow `/docs` standards files, not this contract.

---

## 0. What FSOS is (one paragraph)

FSOS is a private, internal operating system for a **Farmers Financial Services Agent (FSA)** in McKinney, TX. The FSA is a life- and securities-licensed specialist who **partners with Farmers agency owners** to bring life insurance (Farmers New World Life / FNWL) and financial/investment products (through Farmers Financial Solutions, LLC / FFS) to those agencies' existing clients. It is a **B2B2C referral/wholesale model**. The **aggregate root of the entire data model is the Agency-Owner Partnership**, NOT a generic contact or deal. Do not implement FSOS as a generic contact-and-deal CRM. (Rationale: `docs/adr/ADR-001-aggregate-root.md`.)

---

## 1. Authority precedence (read this before resolving any conflict)

When two sources disagree, follow this order. Do not silently average conflicting instructions.

1. **This `CLAUDE.md`** and the `/docs` companion specs it names.
2. **`DESIGN.md`** for all design decisions (tokens, color, type, spacing, layout, components, responsive, a11y, motion, branding, interaction) — see §18.
3. **Accepted ADRs** in `docs/adr/` are authoritative for their subject matter (§19). Do not change an accepted architecture without updating its ADR.
4. **The live repository** (`tailwind.config.ts`, `globals.css`, `src/**`, migrations) — the as-built truth.
5. **The installed project skills** in `.claude/skills/` (§7) for *how* to execute.
6. Everything else (older project briefs, prior chat context, assistant memory) is **non-authoritative background**, overridden by 1–5.

**Resolved conflicts — treat as settled, do not re-litigate:**
- **NIGO is OUT OF SCOPE** (§5). It is a separate project. Application tracking lives in Case Management OS.
- **Make.com is OUT.** Automation is Vercel Cron + GHL-native workflows + direct webhook endpoints. No non-version-controlled automation layer.
- **Styling is Tailwind + shadcn/ui** for all new UI. Legacy inline-style command-center screens stay inline unless a task explicitly asks to migrate them.
- **Aggregate root is the Agency Partnership**, not `customers`/`contacts`. Older audit docs use legacy table names (`customers`, `scores`, `commission_cases`); the current schema uses the aggregate-root names in §10. New code uses §10 names.

---

## 2. Principal Engineer mindset (how to approach every task)

Approach FSOS as a principal engineer accountable for a regulated production system, not a task-taker closing a ticket.

- **Think beyond the immediate request.** Understand the intent behind it and the system it lands in before writing code.
- **Evaluate architectural impact.** Trace downstream effects across data, permissions, compliance, jobs, and UX before committing to an approach.
- **Weigh every dimension on every change:** maintainability, scalability, security, compliance, performance, UX, accessibility, testing, observability, and documentation.
- **Improve existing systems over building parallel ones.** Prefer extending a service to cloning one (§6).
- **Leave code better than you found it.** Reduce technical debt in code you touch, within the scope of the change — no drive-by rewrites, no debt added.
- **Surface risk and better options.** If the literal request is unsafe, non-compliant, or architecturally wrong, say so and propose the correct path rather than executing it blindly.
- **A task is not done when it works** (§21). Quality, safety, and maintainability are part of "done."

---

## 3. Fixed technology stack — do not substitute

- **Next.js 14** (App Router) + **TypeScript** (strict mode)
- **Supabase** (Postgres, Auth, Row-Level Security, Storage, Edge Functions, `pg_cron`)
- **Vercel** (hosting) + **Vercel Cron** (scheduled jobs)
- **Tailwind CSS** + **shadcn/ui** — tokens resolved through `tailwind.config.ts` / `globals.css` (see `DESIGN.md`)
- **Twilio** (SMS) via approved config; **Resend** for transactional email
- **Google Calendar** integration for scheduling
- **Durable, event-driven background jobs** (§11). Do NOT rely on an open chat/agent session for any agent work.
- **Model-agnostic AI gateway** (Claude-first; OpenAI + Gemini as configured fallbacks). All AI calls route through the gateway — never call a provider SDK directly from a route or component.

### 3.1 Non-negotiable code conventions (match the existing codebase)

1. **Supabase access:** always use `getDb()` from `@/lib/supabase/client`. **Never** instantiate a Supabase client at module level.
2. **Every API route** exports:
   ```ts
   export const dynamic = 'force-dynamic'
   export const runtime = 'nodejs'
   ```
3. **Public routes stay auth-guard-free:** `/[slug]` (agency referral), `/upload/[slug]`, `/forms/[formId]`, and the P-0 public surface in `docs/sitemap.md`. Everything else is session-guarded (§9, `docs/middleware-auth.md`).
4. **Read before write:** open and read the existing file before creating or editing. Never recreate a file that already exists — extend or fix it.
5. **Build discipline:** after any change, run `npm run build` and fix **every** error before stopping. `npm run type-check` and `npm run lint` must also pass. Never weaken a type, guardrail test, or lint rule to force a green build.
6. **Styling:** Tailwind + shadcn/ui for all new UI. Never hardcode a color, spacing, or font — resolve through a token (`DESIGN.md`).
7. **Validation:** every form and every API input is validated with **Zod**; derive TS types via `z.infer`. No unvalidated writes reach the database.
8. **Thin route handlers:** business logic lives in `src/lib/services/*` (or `src/server/*`), not in route files or components. Routes parse → authorize → call a service → shape a typed response.

---

## 4. THE THREE NON-NEGOTIABLE GUARDRAILS

Enforced in code, not just documented. Enforcement layer: `docs/data-guardrails.md`. Guardrail tests are mandatory (§13.13) and may never be deleted or weakened to pass a build. Rationale: `docs/adr/ADR-004-securities-firewall.md`.

### 4.1 Securities Firewall
FSOS is **NOT a broker-dealer system** and is **NOT** the system of record for any securities activity.
- FSOS may **track that** a securities opportunity/case exists — stage, engagement model, referring agency, expected/actual commission — for the FSA's own production tracking.
- FSOS may store only a **non-substantive reference pointer** (`ffs_case_ref`) to the FFS-supervised system.
- FSOS may **NOT** store: securities account numbers, order details, suitability determinations, or securities-related client communications.
- Any record flagged `is_security = true` is **excluded** from the automated SMS/email engine and routed to human/FFS handling.
- Implement `is_security` as a **hard gate** checked in the communications dispatcher **and** the AI action validator. UI marks it with the purple firewall marker.

### 4.2 AI Green-Zone / Red-Line
The autonomous AI **MAY** (green zone): identify, educate, invite, schedule, remind, follow up, run consented/approved campaigns, draft internal materials, assemble data, and log.
The autonomous AI **MAY NEVER** (red line): make an individualized **product, policy, investment, replacement, allocation, or transaction recommendation**, make a **suitability/best-interest determination**, or issue anything that constitutes a securities "call to action."
- Every AI-generated client-facing message passes the **Compliance Guardrail** validator before dispatch. A message that fails (recommendation language, out-of-hours, unconsented, DNC, securities-flagged) is **hard-blocked** and escalated to the human FSA — never sent.
- **Escalate to the human FSA when:** a client requests advice/recommendation; a securities discussion needs an FFS-approved channel; consent is unclear; a compliance rule triggers; a replacement/suitability/best-interest/supervision issue arises; a case has conflicting/incomplete info; or a high-value/urgent opportunity needs personal intervention.
- All FNA / educational outputs carry the mandatory footer:
  > *"For educational and informational purposes only. Not a product recommendation or suitability determination. Requires licensed FSA review per FINRA Reg BI."*

### 4.3 No Invented Farmers Data
Commission splits, FNWL term-conversion windows, product availability, carrier rules, and Farmers/FFS API availability are **NOT publicly documented**. Ship them as **clearly-labeled, editable configuration defaults** — never as hard-coded facts.
- Every such value carries `is_assumption = true` and renders a **gold "config default — verify"** badge (archetype A10).
- Do NOT invent an integration or API that has not been verified. Where none exists, implement the configured **manual / CSV-import / secure-reference-field** fallback, explicitly labeled as a placeholder.

---

## 5. Scope exclusions (do not build)

- **NIGO defect-prevention** ("Not In Good Order" prediction/scoring) is a **separate project, OUT OF SCOPE.** Create no NIGO defect-prevention module, agent, report, category, import, or score, and do not cross-link such a system into the aggregate-root case spine. The legitimate application-tracking work lives in **Case Management OS** (`/app/cases`): applications, submission tracking, underwriting, carrier requirements, documents, status/issue tracking, service requests, case timelines — with **no** NIGO defect-prevention functionality (`cases` stays NIGO-free).
  - **Authorized exception — Compliance Intelligence (NIGO-*resolution*).** The owner-authorized (2026-07-19), **isolated** Compliance Intelligence module — a retrieval-grounded drafting/analysis aid at `/app/compliance/intelligence` (`/api/compliance/*`) that helps the FSA *resolve* not-in-good-order correspondence, harden case notes to the objective standard, and check RightBridge paperwork — is **in scope and permitted**. It lives on its **own** `compliance_*` / `nigo_cases` / `nigo_issues` tables with **no FK into the aggregate-root case spine**, stays inside the securities firewall (§4.1), grounds every output in the authority-tagged corpus (never invents a rule — §4.3, `finra-rule-ingestion`), and produces internal drafts the FSA reviews before use (no autonomous outward dispatch). This is NIGO *resolution*, not NIGO *defect-prevention*; the exclusion above still bars any prediction/scoring system and any cross-link into the case spine. **Authorization of record: `docs/adr/ADR-012-compliance-intelligence-exception.md`** (§19). Skill: `fsos-nigo-intelligence`; blueprint: `docs/compliance/`.
- **Billing/subscription** (`/super/billing`) is a P3 placeholder only — build nothing unless FSOS is later commercialized as multi-tenant SaaS.

---

## 6. Architecture preservation rule

FSOS has one architecture. Protect it. Fragmentation is the primary long-term risk in an AI-assisted codebase.

- **Never duplicate an existing subsystem.** One design system, one permission model, one AI gateway, one communications dispatcher, one audit trail. Extend them — never clone.
- **Never create a competing pattern.** If a pattern exists for this problem, conform to it; do not introduce a second way to do the same thing.
- **Reuse services before creating new ones.** Search for existing domain logic in `src/lib/services/*` first.
- **Consolidate, don't fragment.** Prefer widening an existing module over spawning a near-duplicate.
- **Refactor only when it meaningfully improves the architecture** and the change is in scope; otherwise conform. No speculative rewrites.
- **Preserve bounded contexts:** the Agency-Partnership aggregate root (§10, ADR-001), the securities firewall (§4.1, ADR-004), Case Management OS vs. the out-of-scope NIGO project (§5). Do not blur these boundaries.
- **Keep the layering intact:** thin routes → services → data; Zod at the edge; RLS + audit at the store. Business rules never migrate into components or route handlers.
- **Consult the relevant ADR (§19) before modifying an accepted architecture**, and update it in the same change.

---

## 7. Skill orchestration standard (all 26 installed skills)

Skills in `.claude/skills/` encode how this codebase must be built. **They are mandatory, not optional.** Never begin coding from the task description alone — inspect the implementation first via the Superpowers analysis skills.

### 7.1 Canonical execution order (the default loop for any non-trivial task)

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

**Superpower first** — understand the system before changing it: read docs, inspect the existing implementation, trace data flows and user journeys, identify dependencies and downstream effects, choose the correct architectural layer, then plan in phases. **Frontend Design** shapes every user-facing surface. **Impeccable** runs *after* implementation as the final product-quality gate. Do not stop when a feature merely works — continue until it is coherent, refined, tested, and production-ready (§21).

### 7.2 Skill matrix — invoke when

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
| `verification-before-completion` | Before claiming any task done — prove it against §21. |
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
| `fsos-nigo-intelligence` | The owner-authorized, isolated **Compliance Intelligence** module (NIGO-*resolution*) at `/app/compliance/intelligence` — §5 authorized exception. **Never** for NIGO defect-prevention/scoring or case-spine cross-links. |
| `fsos-security-audit` | RLS, guardrails, PII, audit-log security review — run on any data-touching change. |
| `farmers-brand-website` | Public marketing surface / Farmers branding work (§17). |
| `finra-rule-ingestion` | Ingesting authority-tagged rule docs into the corpus. |
| `rightbridge-pdf-analysis` | Parsing/analyzing RightBRIDGE suitability PDFs. |
| `twilio-a2p-compliance` | Outbound SMS, A2P 10DLC, TCPA, quiet-hours, consent (§12). |

**Meta (skill authoring)**
| Skill | Invoke when |
|---|---|
| `skill-creator` / `writing-skills` | Creating, editing, optimizing, or verifying a project skill. |

> Note: `fsos-nigo-intelligence` drives the owner-authorized, isolated **Compliance Intelligence** module (NIGO-*resolution*; §5 authorized exception, recorded in `docs/adr/ADR-012-compliance-intelligence-exception.md`) — retrieval-grounded, firewall-bound (§4.1), no FK into the aggregate-root case spine. It must **never** be used to introduce NIGO *defect-prevention/scoring* into FSOS, nor to cross-link the compliance tables into the case spine (§5).

---

## 8. Execution methodology (how a task actually runs)

1. **Frame** — restate the objective, the affected portals/routes, the data touched, and the guardrails in play (§4).
2. **Inspect** — read `CLAUDE.md` + relevant `/docs` + any relevant ADR (§19) + `DESIGN.md` + the actual files. Trace the data flow end-to-end. Identify duplication risk and downstream effects (§6).
3. **Plan** (`writing-plans`) — break into safe, independently verifiable phases. State assumptions explicitly. Mark Farmers-config assumptions (§4.3).
4. **Test-first** (`test-driven-development`) — failing tests for logic, authorization, RLS, guardrails, and state transitions before implementing.
5. **Build** — thin routes, Zod at the edge, services for logic, tokens for styling, archetype shells for pages. Preserve the existing architecture (§6).
6. **Debug** (`systematic-debugging`) — reproduce, isolate, hypothesize, prove, fix the root cause. No speculative patches.
7. **Polish** (`frontend-design` → `impeccable`) — states, responsiveness, a11y, microcopy, consistency.
8. **Verify** (`verification-before-completion`) — run the full §21 Definition of Done. `npm run build` clean, tests green.
9. **Review & finish** (`requesting-code-review` → `finishing-a-development-branch`) — request review, address feedback, then merge/cleanup.
10. **Report** — list every changed file, assumptions made, guardrails touched, and known limitations.

---

## 9. Portals (six + public surface)

See `docs/sitemap.md` (every page), `docs/routes.md` (file-path map), `docs/specs/rbac-matrix.md` (permissions), `docs/middleware-auth.md` (session guards). One backend, one design system, one permission model. Rationale: `docs/adr/ADR-005-portal-architecture.md`.

| Portal | Route group | Users |
|---|---|---|
| FSA Portal | `(fsa)` → `/app/*` | The FSA + delegated licensed staff |
| Admin / Back-Office | `(admin)` → `/admin/*` | Assistants, case managers, ops, sysadmin |
| Compliance & Supervisory | `(compliance)` → `/compliance/*` | Compliance reviewers/supervisors (supplemental to FFS systems, never a replacement) |
| Agency-Owner | `(partner)` → `/partner/*` | Farmers agency owners |
| Client-Facing | `(client)` → `/client/*` | End clients (non-securities, non-advice content only) |
| Super Admin | `(super)` → `/super/*` | Platform owner (may be a role inside Admin) |
| Public | `(public)` → `/*` | Unauthenticated |

Authorization is enforced **server-side** for every non-public route (session guard + role/scope check + RLS). The frontend never enforces permissions on its own. Forbidden deep links return 403 via `ForbiddenState`. Auth architecture: `docs/adr/ADR-006-authentication-architecture.md`.

---

## 10. Aggregate-root data model (build order matters)

Dependency spine: **Agency Partnership → Referral → Household → (Financial) Review → Opportunity → Case → Commission.** Build in that order (`docs/build-order.md`). The **Financial Review** layer is first-class — where policy/coverage/term-conversion/retirement/annual reviews happen and where opportunities originate. Rationale: `docs/adr/ADR-001-aggregate-root.md`; ownership/RLS: `docs/adr/ADR-010-data-ownership-and-rls.md`.

Core tables (DDL + RLS in `docs/data-guardrails.md`): `agency_partnerships` (root), `agency_owners`, `districts`, `regions`, `referrals`, `households`, `household_members`, `policies`, `coverages`, `carriers`, `products`, `reviews`, `opportunities`, `cases`, `case_requirements`, `commissions`, `commission_splits`, `campaigns`, `consents`, `documents`, `activities`, `tasks`, `appointments`, `ai_agents`, `agent_runs`, `agent_actions`, `compliance_events`, `audit_log`.

Every table holding client/agency data:
- carries an owner/tenant key with **Row-Level Security** keyed to the authenticated user's role + scope;
- encrypts PII at rest (Supabase default; add `pgcrypto` column encryption for DOB and equivalent sensitive fields);
- writes to the **append-only `audit_log`** on create/update/delete, via a DB role that **cannot** UPDATE/DELETE the log.

Migrations are forward-only, reviewed for RLS coverage, index coverage, N+1 risk, locking, transaction scope, backward compatibility, and rollback risk (`supabase-postgres-best-practices`). Never add a field or table without understanding ownership, lifecycle, permissions, and downstream use.

---

## 11. AI agents, background jobs & AI governance

- Agents run as **durable, event-driven background jobs** (Vercel Cron + a queue/event table), **not** open chat sessions. A job persists state and can suspend/resume across a human-approval pause. Rationale: `docs/adr/ADR-007-background-job-architecture.md`.
- Every agent run writes `agent_runs` (inputs, model, prompt version, tokens, cost, confidence); every action writes `agent_actions` (tool, target, outcome, audit link).
- Every client-facing action passes the **Compliance Guardrail** validator (§4.2) before dispatch.
- **Agent roster** (all green-zone; no NIGO agent): Executive Intelligence, Agency Growth, Agency Activation, Referral Triage, Referral Follow-Up, Pipeline, Cross-Sell, Term Conversion, Case Management, Document Intelligence, Commission Reconciliation, Marketing Automation, Compliance Guardrail (the hard-block layer), Data Quality.
- **Kill switch:** every agent and the whole gateway carry an enable/disable flag (`/super/ai/policies`) checked at run start.

### 11.1 AI governance (binding) — see `docs/adr/ADR-002-ai-gateway.md` and `ADR-008-ai-governance.md`
- **Model abstraction:** all model access is through the gateway. No provider SDK in a route or component. Swapping/falling back between models changes config, not call sites.
- **Prompt versioning:** prompts are versioned artifacts in the repo; the version used is recorded on every `agent_runs` row for reproducibility and audit.
- **Structured outputs + deterministic validation:** AI returns structured output validated with **Zod** before any use. A validation failure fails safe (no dispatch, no write) and escalates.
- **Confidence thresholds:** below the configured threshold, route to human review — never auto-dispatch or auto-write.
- **Retry, timeout, idempotency:** every gateway call has a timeout, a bounded retry with backoff, and idempotency so a retried job never double-sends or double-writes (§16).
- **Cost awareness:** record tokens and cost per run; respect budget guards; the kill switch halts spend.
- **Hallucination prevention:** never fabricate a rule, integration, citation, or product fact. Ground FNA/educational output in supplied data and the authority-tagged corpus (`finra-rule-ingestion`); where a fact is unverified, surface it as an assumption (§4.3), not a claim.
- **No autonomous mutation:** AI output must never directly mutate sensitive business data or trigger a regulated client-facing action without the required validation and human-approval controls.

---

## 12. Communications compliance (enforced in the dispatcher)

Single dispatcher for all outbound communication. Rationale: `docs/adr/ADR-003-communications-dispatcher.md`. Before ANY automated SMS/email sends, the dispatcher checks, in order, and blocks on the first failure:
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
- **Outreach must be compliant before activation:** before any automated outreach activates, it must satisfy TCPA (prior express consent), TRAIGA AI disclosure, A2P 10DLC/carrier requirements, and the §12 dispatcher gate. No named-individual sign-off is required to activate — the FSA owns go-live; any residual regulatory/carrier risk is documented and remediated, not gated behind an approver. (FFS compliance contacts remain available as a resource — Appendix A.)

Blocked sends are logged and escalated — never silently dropped.

---

## 13. Fortune 500 fintech quality standard (whole stack)

FSOS must be designed, implemented, tested, and maintained to the standard of a modern Fortune 500 financial-services platform — across the entire product: public site, auth, portals, frontend, backend, APIs, database, security, compliance, AI, jobs, integrations, observability, testing, docs, deployment. "Fortune 500 fintech quality" is not visual polish alone: the product must be **credible, secure, reliable, consistent, scalable, auditable, and professionally engineered end to end.** Exhaustive checklists live in `/docs`; the binding clauses below are the floor.

**13.1 Frontend.** Every surface is deliberately designed for a regulated environment: **enterprise information architecture**, deliberate **visual hierarchy**, **reduced cognitive load**, **dashboard usability**, **consistent navigation**, **user-journey continuity**, **trust-building UI patterns**, and **conversion optimization** on public surfaces. Plus: clear titles/breadcrumbs, responsive desktop/tablet/mobile, semantic markup, **WCAG 2.2 AA**, keyboard nav, visible focus, proper labels, clear primary/secondary actions, confirmation before destructive actions, and full **loading / skeleton / empty (with next action) / error (with recovery) / success** states. All specific design decisions defer to `DESIGN.md`.

**13.2 Dashboards.** Support operational decisions: clear priorities, actionable summaries, role-appropriate data, consistent tables (search, filter, sort, pagination, saved views), statuses, ownership, dates/deadlines, escalation visibility, quick actions, activity history, meaningful drill-downs. Never present data without helping the user see what needs attention next. (Dashboard content model: `DESIGN.md`.)

**13.3 Forms.** Treated as workflows: clear purpose, logical grouping, correct field types, persistent labels, help text, required indicators, inline validation, accessible error summaries, loading protection, **duplicate-submission prevention**, success confirmation, recovery from failed submissions with entered data preserved, and consent/disclosure language where applicable.

**13.4 Backend architecture.** Fits the existing architecture; clean separation of concerns; reuse established services/utilities; no duplicate subsystems (§6); business logic outside presentation; thin route handlers; centralized domain logic; API compatibility preserved unless change is authorized; designed for testability **and for failure** (§16).

**13.5 API.** Every endpoint: authentication where required; authorization + ownership/scope validation; **Zod** input validation; consistent response contracts; correct status codes; safe error responses (no stack traces/secrets, §16); structured server logging; audit events where required; rate limiting where risk warrants; idempotency where duplicate execution is possible; timeout handling for external services. The backend **never** relies on the frontend to enforce permissions or business rules.

**13.6 Data integrity.** Every write protects referential integrity, tenant/owner scope, required relationships, valid state transitions, duplicate prevention, concurrency safety, transaction consistency, auditability, PII handling, the securities firewall, AI red-line restrictions, and consent requirements — using DB constraints + RLS + validation + service-layer enforcement together (layered, not single-point).

**13.7 Database.** Reviewed for schema relationships, RLS coverage, index coverage, query efficiency, migration safety, backward compatibility, rollback risk, N+1 patterns, locking, transaction scope, retention, encryption, and audit logging.

**13.8 Security.** Designed into every layer; enforced server-side even when equivalent frontend controls exist. Review every change for broken auth/authz, privilege escalation, IDOR, injection, XSS, CSRF, SSRF, open redirects, unsafe uploads, sensitive-data exposure, secret leakage, insecure logging, weak sessions, missing rate limits, unsafe integrations, weak tenant isolation, improper PII handling, and dependency vulnerabilities. Run `fsos-security-audit` on any data-touching change. Never weaken auth, authz, RLS, validation, audit logging, or compliance guardrails for convenience.

**13.9 Compliance & auditability.** Every relevant operation is authorized, validated, traceable, reproducible, auditable, attributable (user/service/agent), timestamped, and linked to the affected record. Compliance-sensitive actions preserve: who, what, when, which record, automated-vs-human, which rule/control applied, pass/fail, and why blocked/escalated. Never silently bypass, suppress, or downgrade a compliance control.

**13.10 Integrations.** Isolated behind adapters/service layers (GHL, Twilio, Resend, Google Calendar, AI gateway). Each handles auth, secret management, timeouts, retries, backoff, rate limits, duplicate callbacks, idempotency, partial failure, provider outages, invalid responses, schema changes, logging, auditability, and recovery (§16). Do not spread provider-specific logic through the app. Do not claim an integration exists unless verified (§4.3).

**13.11 Background jobs.** Durable, retry-safe, idempotent where practical, observable, auditable, recoverable, protected from duplicate execution, able to record partial progress and fail without corrupting data. Long-running work never depends on an active session; it belongs in the job system, not a request handler.

**13.12 Performance & reliability.** Review for query efficiency, N+1, excessive requests, duplicate computation, bundle size, render cost, caching, pagination, memory, large-file/large-dataset behavior, and concurrency (operational budget in §14). Design for failure per the error-handling standard (§16): invalid input, missing data, unauthorized access, network/integration/DB failure, partial completion, duplicate execution, timeout, retry exhaustion, concurrent/stale changes, and interruption. Failures are visible, logged, recoverable where practical, and never silently corrupt data.

**13.13 Observability & testing.** Structured logs + audit logs + error tracking + job-run/integration status + correlation IDs; never log passwords, tokens, sensitive PII, full financial account data, or secrets. Testing reflects risk: unit, service, API, integration, **authorization, RLS, guardrail, state-transition**, form-validation, a11y, responsive, e2e journeys, background-job, retry/idempotency, failure-path, and regression. Test more than the happy path. **Never** delete, weaken, skip, or rewrite a legitimate guardrail test to make a build pass.

**13.14 Documentation.** Kept in sync with implementation. Update affected docs (including `DESIGN.md` for any design-pattern change (§18), and the relevant ADR for any architectural change (§19)) when changing architecture, routes, APIs, data models, permissions, workflows, env vars, integrations, jobs, compliance controls, AI behavior, user journeys, or build/deploy procedures. No undocumented architectural decisions hidden only in code.

---

## 14. Performance budget (operational)

Performance is a feature. Default to the cheaper, faster pattern; deviate only with reason.

- **Server-first:** prefer **React Server Components**; add `'use client'` only where interactivity genuinely requires it. No client component for static/data-display content.
- **Bundle discipline:** minimize client bundle size; **lazy-load heavy modules** (charts, editors, PDF/FNA tooling) via `dynamic()`; avoid importing large libraries into shared layouts.
- **Render efficiency:** avoid unnecessary re-renders; memoize deliberately (not reflexively); keep component trees shallow where practical.
- **Data access:** no N+1; index the columns you filter/join on; select only needed columns; paginate lists (§13.2/§13.7).
- **Caching:** cache safely with Next.js `revalidate`/route caching where correctness allows; **never** cache PII across users or serve one tenant's data to another.
- **Assets:** optimized images (`next/image`), no oversized raster where SVG suffices, fonts via `next/font`.
- **Perceived performance:** follow the loading-behavior ladder in `DESIGN.md` (instant → skeleton → progress → background job).

---

## 15. Production readiness (a feature ships only when it is operable in production)

Before any feature is "done," verify it is production-ready:

- **Logging & monitoring:** structured logs and error tracking in place; correlation IDs on request/job paths (§16).
- **Retry & recovery:** external calls retry with backoff; failures degrade gracefully; partial failures are recoverable and never corrupt data (§16).
- **Graceful degradation:** the surface remains usable (or clearly informs the user) when a dependency is down (§16).
- **All states present:** loading / empty / error / success (`DESIGN.md`).
- **Security review:** `fsos-security-audit` pass on any data-touching change.
- **Accessibility review:** `impeccable` a11y pass (WCAG 2.2 AA).
- **Documentation:** updated where §13.14 requires.
- **Upgrade safety:** migrations are forward-only, reversible where practical, with a rollback note; feature flags / kill switch for risky or automated surfaces.

---

## 16. Error handling standards

Errors are handled consistently across the platform. Every failure must be secure, understandable, recoverable where possible, and fully observable. **Never expose internal implementation details, stack traces, secrets, or sensitive data to end users.**

**16.1 User-facing errors.** Explain the problem in plain language; state what the user can do next; preserve entered data whenever possible; provide retry, recovery, or support options where appropriate. Never expose stack traces, SQL errors, provider responses, or sensitive technical details. (Copy standards: `DESIGN.md` microcopy.)

**16.2 Developer errors.** Log enough diagnostic information to investigate — correlation IDs, request context, affected resources, relevant metadata. Never log passwords, secrets, tokens, full financial account numbers, or sensitive PII. Write audit events where compliance requires (§13.9).

**16.3 Retryable failures** (network interruptions, temporary DB locks, external API timeouts, rate limiting, transient provider outages) must: use exponential backoff; respect idempotency (§11.1); enforce retry limits; and record attempts and final outcome.

**16.4 Terminal failures** (validation, authorization/permission violations, compliance-guardrail violations, missing required data, invalid state transitions) must: fail immediately; return the appropriate HTTP status; never auto-retry; and communicate the reason without exposing internals. Guardrail-violation terminal failures escalate to human review (§4.2).

**16.5 Graceful degradation.** When a dependency is unavailable: keep unaffected features operating; disable only the impacted capability; tell the user which functionality is temporarily unavailable; never leave the application in an inconsistent or partially committed state.

**16.6 Recovery guidance.** Every recoverable failure provides a clear recovery path — retry, restore unsaved work, redirect to a safe state, or escalate to human review — and is logged for audit and operational monitoring.

Error handling always prioritizes **data integrity, security, regulatory compliance, and user trust over convenience.**

---

## 17. Farmers brand & enterprise design standard

FSOS is the private OS **and** public website for an authorized Farmers Financial Services Agent. It must present Fortune-500 financial-institution credibility while remaining consistent with Farmers Insurance branding. The goal is **not** to imitate the public consumer site — build a premium enterprise platform on the official Farmers visual identity. **Full token/component/brand reference: `DESIGN.md`.** Branding work uses `farmers-brand-website` + `frontend-design` + `impeccable`.

### 17.1 Approved brand assets (trademark-safe handling)
The Farmers logo and brand assets are **trademarked**. As an authorized agent, use the **approved assets stored in the repo** — never download from third-party sites, recreate, redraw, recolor, or substitute them.
- Approved assets at `public/brand/`: `farmers-logo.svg` (primary color lockup), `farmers-logo-alt.svg`, raster fallbacks `farmers-logo.png` / `.jpeg`.
- **Never** stretch, distort, crop, rotate, recolor, redraw, or recreate the logo; never use unofficial variations, placeholders, or low-resolution images; preserve official proportions and clear space.
- The sidebar `IdentityLockup` `BrandMark` is the **FSA's own monogram, not the Farmers trademark.** Do not conflate the two.
- If an approved asset is missing, **document the gap** — do not substitute an unofficial version (§4.3 applies to assets).

### 17.2 Official Farmers palette (source of truth) — extracted from the approved asset
| Role | Official | Approx HSL | Implemented as (`DESIGN.md`) |
|---|---|---|---|
| Farmers Blue | `#1C428B` | `220 66% 33%` | basis for `--shell` navy + `--primary` blue |
| Farmers Red | `#E11631` | `352 82% 48%` | `--destructive` `350 78% 43%` (AA-tuned, faithful) |
| Light-blue accent | `#A6C3E9` | `212 62% 78%` | supporting accent / soft washes |
| Deep red | `#A20F30` | `346 83% 35%` | pressed/gradient floor for red |
| Neutral gray | `#666666` | `0 0% 40%` | neutral ink/dividers |
| White | `#FFFFFF` | `0 0% 100%` | canvas / card |

The official palette is the *source of truth*; the `DESIGN.md` tokens are the *implementation*. Divergences exist only to meet WCAG 2.2 AA and are documented in `DESIGN.md`. Never hardcode a hex — resolve through a token.

### 17.3 Consistency
The identity is consistent across homepage, public pages, login, forgot-password, dashboards, nav, headers, footers, forms, emails, PDFs, reports, loading screens, empty states, error pages, favicon, and app icons. Every screen communicates trust, security, professionalism, financial expertise, stability, reliability, simplicity, and confidence — and reads as one product. When frontend work is done, audit the affected scope and replace any placeholder branding with approved branding.

---

## 18. Design system governance

**`DESIGN.md` is the authoritative source for all design decisions:** design tokens, color system, typography, spacing, layout, components, responsive behavior, accessibility, motion, branding, and interaction patterns. Rationale: `docs/adr/ADR-009-design-system-governance.md`.

- **No component, page, or feature may introduce a new design pattern, token, or component variant without updating `DESIGN.md` in the same change.**
- Design decisions live in `DESIGN.md`, never in `CLAUDE.md`. This contract references `DESIGN.md`; it does not restate or override it.
- **Conflict order for design:** `CLAUDE.md` (this contract) → `DESIGN.md` → existing implementation.
- This prevents design drift: one source of truth, updated deliberately, applied everywhere.

---

## 19. Architecture Decision Records (ADRs)

`docs/adr/` contains accepted architectural decisions that explain **why** key system designs exist. ADRs are **authoritative for their subject matter** and must be consulted before modifying the associated architecture. **Do not change an accepted architecture without updating the relevant ADR in the same change.** CLAUDE.md stays focused on *how* to build; ADRs preserve *why* the system is designed as it is, so the rationale can't be lost and can't be silently "simplified" away.

| ADR | Subject |
|---|---|
| ADR-001 | Aggregate root = Agency Partnership (not a generic CRM contact/deal) |
| ADR-002 | Model-agnostic AI gateway |
| ADR-003 | Single communications dispatcher |
| ADR-004 | Securities firewall |
| ADR-005 | One backend, six portals |
| ADR-006 | Authentication architecture |
| ADR-007 | Durable background-job architecture |
| ADR-008 | AI governance |
| ADR-009 | Design-system governance |
| ADR-010 | Data ownership & RLS |
| ADR-012 | Compliance Intelligence (NIGO-resolution) exception (§5) |
| ADR-013 | Canonical `comm_*` communications data model (reconcile the 006 duplication) |
| ADR-014 | GoHighLevel decommission (ordered, data-preservation-first) |
| ADR-015 | Delegated agency-communication authority + actual-sender/represented-party model |
| ADR-016 | First-contact identity disclosure engine |
| ADR-017 | Policy-engine extensions: purpose classification, frequency caps, priority collision |
| ADR-018 | Conversation mode: a customer reply pauses promotional automation |
| ADR-019 | AI authority matrix + communication evaluations (code-enforced, not prompt-enforced) |
| ADR-020 | Data confidence & source verification (no specific claim on unverified data) |
| ADR-021 | Simulation mode (safe dry-run; required before campaign activation) |
| ADR-022 | Campaign + sequence builder config: message purpose + delegated-sender |
| ADR-023 | Campaign library (pre-built, compliance-ready blueprints; §17) |
| ADR-024 | Data-confidence claim wiring for campaigns (§18) |

New architectural decisions get a new ADR using `docs/adr/ADR-000-template.md`. Status values: Proposed → Accepted → Superseded (link the superseding ADR).

---

## 20. Current build reality (as of last audit)

> **Reconcile before relying on this section.** It is a point-in-time audit note, not live truth (§1 places the live repo above it). Verify against the code before planning P0 work — several original blockers have advanced.

FSOS began as a high-fidelity shell missing its spine. Two of the original P0 blockers are now substantially closed in the repo:

- **Authentication + RBAC — implemented (verify coverage, don't rebuild).** `src/middleware.ts` runs a **server-side** Supabase Auth portal gate on every non-public route (role/scope via `evaluateAccess`, MFA/`aal2` step-up, forbidden → `/403`), backed by RLS and the `fail-closed-auth` / `auth-matrix` guardrail tests (ADR-006). The original **P0-1 auth plan is therefore partly satisfied** — reconcile that plan against the implemented guard before any further auth work rather than re-building it.
- **Server-side AI — in place.** All model access is server-side through the AI gateway (`src/lib/ai/gateway.ts`); no browser-side provider calls and no `NEXT_PUBLIC_*` AI keys remain (ADR-002).

Remaining priorities to confirm against the code, ahead of net-new pages:
1. **Data layer** — real Supabase reads/writes are wired across much of the API surface (route handlers via `getDb()`); confirm any legacy command-center screens still rendering from mock arrays are retired.
2. **URL routing** — replace remaining `useState`-based navigation on legacy screens with real routes/deep links (`DESIGN.md` §12/§30).
3. **Household/Customer 360 + Book of Business** — the window into the data.
4. **Consent & opt-out ledger** — TCPA defense record.

Do not add new feature pages while a genuine P0 blocker above remains open, unless a task explicitly directs otherwise.

---

## 21. Definition of Done (every page and every task inherits this)

**Never stop at "working."** A feature is not complete because it works or the code compiles. Continue refining until it meets the standard for engineering quality, security, usability, accessibility, performance, documentation, and maintainability. Then verify:

- Implementation matches the request; existing architecture preserved (§6); no duplicate subsystem created.
- Wired real data (no placeholders/mock arrays); Zod-validated inputs; enforced permissions (403 via `ForbiddenState`).
- Full states: loading (skeleton, never a bare spinner) / empty (with next action) / error (isolated, retryable) / success.
- Responsive desktop→tablet→mobile; **WCAG 2.2 AA** (labels, keyboard, aria, AA contrast on shell and canvas).
- Backend enforces security + business rules server-side; APIs validated; errors handled per §16 (safe messages, correct status, logged); structured logs + audit events written.
- Data integrity + RLS + guardrails intact; gold assumption badge on every config default; purple firewall marker on every `is_security` row.
- AI paths: structured output validated, prompt version + cost logged, confidence-gated, human-approval where required (§11.1).
- Triggered notifications/automations wired; communications compliance (§12) enforced.
- Production-ready per §15 (logging, recovery, degradation, security + a11y review, upgrade safety).
- Tests pass (incl. authz/RLS/guardrail/state-transition/failure-path); **no legitimate guardrail test weakened or skipped.**
- `npm run build`, `type-check`, and `lint` all clean.
- No dead-end pages; no placeholders left in scope; `DESIGN.md` updated if any design pattern changed (§18); relevant ADR updated if any architecture changed (§19).
- All changed files listed; assumptions and known limitations disclosed.

The result must be demonstrably more secure, usable, reliable, maintainable, and professionally engineered than what existed before the task began.

---

## 22. Session protocol (how to start and finish)

**On start:** read this file → relevant `/docs` → relevant ADR(s) (§19) → `DESIGN.md` → the actual files in scope. Confirm the portal(s), routes, and tables you touch and which guardrails apply. Load the domain + DB + design skills for the surface.

**During:** build in dependency order (Foundation → P0 → P1 → P2 → P3, `docs/build-order.md`); apply the three guardrails (§4), communications compliance (§12), and error-handling standards (§16) everywhere they touch; keep routes thin, validate at the edge, resolve styling through tokens, compose pages from archetype shells; preserve the architecture (§6).

**On finish:** run the full §21 Definition of Done; `npm run build` clean; verify with `verification-before-completion`; request review; then report every changed file, assumptions made, guardrails touched, and known limitations.

---

## Appendix A — FFS key contacts
- **Ryan Anderson**, Compliance TX — **(253) 242-0597** (FFS compliance contact/resource for TX — not an approval gate; the FSA owns go-live)
- **Matt Anderson**, FSD Central — (818) 584-0264
- **Sales Desk** — (866) 888-9739, Option 3 → 3, Mon–Fri 7AM–5PM PT

## Appendix B — GDC payout tiers *(config defaults — `is_assumption = true`, verify before relying on them)*
- **Tier 1:** under $15k rolling-12-mo GDC → **40%** FSA payout
- **Tier 2:** $15k–$54,999 → **60%**
- **Tier 3:** $55k+ → **80%**

## Appendix C — Companion docs
`docs/sitemap.md` · `docs/routes.md` · `docs/middleware-auth.md` · `docs/specs/rbac-matrix.md` · `docs/build-order.md` · `docs/archetypes.md` · `docs/data-guardrails.md` · `docs/design-system.md` · `docs/adr/` · `DESIGN.md` · `docs/specs/comms-ai-compliance.md` · `docs/specs/review-conversion-crosssell.md`
