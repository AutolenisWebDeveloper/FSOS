# Campaign Platform — Final Production Review (Phase 1: Audit + Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task in **Phase 2**, dispatched **per campaign** (Cross-Sell Life first as the reference, then Life Conversion and Win-Back to parity). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the three FSOS campaign modules (Life Conversion, Cross-Sell Life, Win-Back Life) to verified Fortune-500 fintech production readiness — correct dynamic-data resolution, preview/production render parity, complete operational controls, observability parity, consistent enterprise UI, and closed security/test gaps — without changing approved schedules, content, eligibility, consent, or compliance behavior except where a verified defect requires it.

**Architecture:** Two complementary layers per domain — legacy **origination dashboards** (`/app/{conversions,cross-sell,crosssell,winback}`, opportunity origination on `@/components/dashboards` primitives) and canonical **campaign engines** (`/app/comms/{life-conversion,cross-sell-life,pipeline-winback}` + `/api/{life-campaign,cross-sell-life,pipeline-winback}`). Cross-Sell Life is the reference engine (retry/dead-letter/health, versioning, per-enrollment controls, 4 resume strategies). The other two lag and must reach parity. Shared platform seams: `personalize.ts`, `dispatcher.ts`, `render.ts`, the compliance gate, and the audit log.

**Tech Stack:** Next.js 14 App Router, TypeScript strict, Supabase (Postgres + RLS + service-role access via `getDb()`), Vercel Cron, Tailwind + shadcn/ui, Twilio (SMS), Resend (email), bespoke Node test runner (`scripts/run-tests.mjs` → `unit` / `rls`).

## Global Constraints (verbatim from CLAUDE.md + task)

- **This is a two-run, human-in-the-loop workflow. Phase 1 STOPS for approval. Phase 2 is dispatched per campaign in separate runs.**
- Do **not** change approved campaign schedules, content, eligibility, consent, compliance controls, or business behavior unless a **verified defect** requires it; any such change is documented and needs explicit human approval **before** implementation.
- Denied/held operations this session (must remain blocked without explicit human authorization): production Supabase writes · `apply_migration` · `execute_sql` · `deploy_edge_function` · branch merge/reset/delete · live SMS/email dispatch · `git push` · `gh pr merge` · production deployment · destructive DB operations.
- Every API route exports `export const dynamic = 'force-dynamic'` and `export const runtime = 'nodejs'`.
- Supabase access only via `getDb()`; never a module-level client. Thin routes → services → data; Zod at the edge.
- Styling resolves through design tokens (`DESIGN.md`); no hardcoded color/spacing/font.
- Three guardrails intact (securities firewall, AI green-zone/red-line, no-invented-Farmers-data). No guardrail test weakened/skipped.
- `npm run build`, `lint`, `type-check`, `test`, `test:rls` must pass. No e2e/a11y/security-scan harness exists — do not assert those results by inspection; add a real harness as a plan item if required.
- Blocking-tier dynamic variables (identity + compliance) **fail closed**; cosmetic defaults (first_name → greeting) are intentional and stay.

---

## 0. Preflight result (recorded)

- Branch `claude/campaign-platform-prod-review-ldeayv` == `main` tip `17f0982`; working tree clean; even with the merged history.
- **Deviation:** `.claude/settings.local.json` is **absent** — it was gitignored in PR #211 (`9951352`) as a per-developer file and never travels with a fresh remote clone. Phase 1 is read-only and performs none of the denied operations; all denied operations are independently blocked (Supabase/Twilio MCP unauthenticated; push/merge/deploy harness-gated). **Human decision required at this gate:** confirm/restore the intended scoped-permission posture before Phase 2.
- All 22 required skills present and loadable (incl. `marketing-plan`).

---

## 1. Defect Register (evidence-first, severity-ranked)

| ID | Area | Sev | Defect | Evidence | Proposed fix |
|---|---|---|---|---|---|
| **D1** | Dynamic data (production) | **HIGH** | Booking confirmation/reminder/reschedule/cancel emails render `{{appointment_time}}`, `{{meeting_details}}`, `{{reschedule_url}}`, `{{cancel_url}}` to **empty** — appointment time and join/manage links silently vanish from delivered mail. `personalize.ts` has no keys for them; send path passes them but the resolver drops them. | `src/emails/appointments.tsx:20-24`; `src/lib/booking/notify.ts:135`; `notify-core.ts:71-100`; `personalize.ts:16-38,88-92`; untested (`tests/booking-notify.test.mjs:71` asserts context, not substituted body) | Extend `RecipientContext`/`values` with booking keys **or** route booking mail through pre-substitution (as the workshop engine does), + add a blank-blocking-token guard. |
| **D2** | Dynamic data (fail-mode) | **HIGH** | `personalize.ts` never **fails closed**. Any token outside the 10-key allowlist → `''`; blocking identity/compliance tokens fall to generic defaults. No unresolved/blank-blocking-token assertion before dispatch (not in `personalize.ts`, `gate.ts`, `dispatcher.ts`, `send.ts`). Violates §10 blocking-tier requirement. | `personalize.ts:40-51,88-92` | Add a blocking-tier presence check that hard-fails render + blocks dispatch (escalate), while preserving cosmetic defaults. Platform-wide change (~17 importers) — approval item. |
| **D3** | Dynamic data (links) | **HIGH** | `{{scheduling_link}}` defaults to relative `/schedule`; `{{unsubscribe_url}}` to relative `/unsubscribe` — broken inside email/SMS (no origin). Campaign ticks never inject absolute `siteUrl()` URLs. Unsubscribe relative = CAN-SPAM exposure. | `personalize.ts:83-84`; send path `send.ts:377`; contrast correct absolute links `booking/notify.ts` | Resolve these as blocking-tier absolute URLs from `siteUrl()`; inject per-recipient at the tick/send layer. |
| **D4** | Identity resolution | **HIGH** | Campaign message bodies pass only `{ full_name }`. `{{fsa_name}}`, `{{agency_name}}`, `{{advisor_phone}}`, `{{advisor_email}}` → generic defaults; the real single FSA (`site.ts BUSINESS.agent`) is never wired in. No assigned-advisor concept (`host_user_id` nullable/never set). Delegated represented-agency (ADR-015) resolved for gate/audit but **not** the visible body. | `life-campaign/tick.ts`, `cross-sell-life/tick.ts`, `pipeline-winback/tick.ts` `fireMessageTouch`; `personalize.ts:43-50`; `campaign-config.ts` | Populate advisor/agency identity into `recipientContext` from `site.ts` (single-FSA authoritative) and, for delegated sends, from the resolved represented agency. |
| **D5** | Operational (resume) | **MED-HIGH** | Life Conversion & Win-Back resume replays missed touches **one-per-tick** (delayed catch-up) instead of recording them **skipped**; only 1/4 resume strategies; resume does not recompute `next_touch_at`. Violates §4.2 "no automatic catch-up / record as Skipped." | `life-campaign/controls.ts:73-83`; `pipeline-winback/controls.ts`; `life-campaign/tick.ts:236-247`; contrast reference `cross-sell-life/controls.ts:80-185` (`recordSkipped`, `resumePaused`, 4 strategies) | Port cross-sell `resumePaused`/`recordSkipped` + `next_touch_at` fast-forward + the 4-strategy/replay-policy model to Life & Win-Back. |
| **D6** | Security (concurrency) | **MED** | `applyControl` TOCTOU: reads `status`, checks `canTransition`, then `.update({status:to}).eq('id',…)` with **no** `.eq('status', from)` predicate / idempotency → concurrent authorized POSTs both commit (double-pause/resume, misleading audit pair). All three. | `life-campaign/controls.ts:48-55`; `cross-sell-life/controls.ts`; `pipeline-winback/controls.ts` | Add optimistic-concurrency predicate `.eq('status', from)`; treat 0-row update as `409 stale_state`. |
| **D7** | Security (validation) | **MED** | Advisor-ownership route writes an **unvalidated** advisor UUID as `assigned_advisor` and flips enrollment to `advisor_owned` (AI stops) — no check it's a real licensed user; a `licensed_staff` caller can stall automation. | `src/app/api/cross-sell-life/enrollments/[enrollmentId]/advisor-ownership/route.ts:13,30`; `cross-sell-life/inbound.ts:107-114` | Validate `advisor` against the user/advisor set; default to session user. |
| **D8** | Operational (booking exit) | **MED** | Life Conversion has **no** pause/exit when a client books — `life-campaign/eligibility.ts` has no appointment signal and `book.ts` fires no life-campaign exit. Client keeps receiving conversion touches after booking. (Cross-Sell exits; Win-Back pauses via view filter.) | `src/lib/life-campaign/eligibility.ts`; `src/lib/booking/book.ts`; `grep exitOnAppointment src/lib/life-campaign` → none | Add appointment signal to Life eligibility (or an `exitOnAppointment` hook in the booking path) mirroring the other two. |
| **D9** | Observability parity | **MED** (approval-gated schema) | Life & Win-Back execution tables lack `attempts`, `next_retry_at`, `dead_letter` status + partial index; no retry sweep, no `-retry` cron, no health route. Cross-Sell has the full stack. `attempt_logged` is on the **advisor-touches** tables (all three) — not the parity gap. | `081:103-143`, `083:112-152` vs `085:151-201`; `cross-sell-life/jobs.ts:61-89`; `cross-sell-life/health/route.ts`; `vercel.json:8-12`; `src/jobs/index.ts:50-58` | Forward-only migration adding the columns/status/index to both tables + ported `runRetrySweep` jobs + two `-retry` cron entries + two health routes. **See §4.** |
| **D10** | Preview fidelity | **MED** | **No** preview surface uses the production render path. Detail pages dump raw `template.body` with unresolved `{{tokens}}` in `<pre>`; SMS previews omit the TRAIGA AI-disclosure + STOP footer (appended **only** at `dispatcher.ts:150`); simulation renders (name-only, no footer/disclosure/escape) but the UI shows **counts only**. | `life-conversion/[id]/page.tsx:142`; `cross-sell-life/[id]/page.tsx:245,498`; `comms/campaigns/[id]/page.tsx:48-63`; `simulation.ts:105`; `CampaignControls.tsx:198-212`; `dispatcher.ts:150` | Extract one shared render service used by dispatch **and** preview; make preview read-only, non-dispatching, version/recipient-aware; resolve compliance text from `gate.ts`/`a2p.ts`/`compliance.ts` (never hardcode). |
| **D11** | Audit completeness | **LOW-MED** | Control audit diff omits **tenant/agency id**, **correlation id**, and **resume/replay strategy** (cross-sell chooses a strategy but logs neither). All three. | `life-campaign/controls.ts` diff; `cross-sell-life/controls.ts:83-107`; `src/lib/audit/log.ts:70-78` | Enrich the audit diff with agency/tenant, correlation id, and applied strategy. |
| **D12** | IA / consolidation | **MED** (approval-gated) | Canonical engines are **orphaned from the primary sidebar** (registry-driven) — reachable only via in-page `CommsSubnav`; legacy origination dashboards are the discoverable first-class workspaces; two name collisions ("Life Conversion", "Win-Back"). | `registry.ts:141-154,189-237`; `CommsSubnav.tsx:20-22`; `comms/page.tsx` (no engine links); `BriefingHero.tsx:34-35`, `AgencyProfile.tsx:339` link legacy | **See §3 consolidation proposal.** Do not retire/merge without approval. |
| **D13** | UI/UX consistency | **LOW-MED** | Forked `Section`/`Cell`/`FunnelCell` primitives copy-pasted 3×; raw `amber-*`/`emerald-*` literals instead of `status-*` tokens; `window.confirm()` for destructive actions (with a false "matches DESIGN.md" comment); Win-Back + Life-list wide tables missing `overflow-x-auto`/`scope="col"`; secondary trees lack `loading.tsx`/`error.tsx`. | `life-conversion/[id]/page.tsx:215`; `cross-sell-life/[id]/page.tsx:398`; `pipeline-winback/page.tsx:179,328,391`; controls `:11-12,44-57`; `campaign-controls.tsx:94`; token set `states.tsx:49,93` | Unify primitives; swap literals for `status-*` tokens; replace `window.confirm` with archetype A9 dialog; wrap tables; add route boundaries. |
| **D14** | Feature parity | **MED** | Life & Win-Back lack health-monitoring + version/audit-history UI; Cross-Sell's 4 resume strategies are **dead capability** (API accepts `resumeBehavior`/`replayPolicy`, UI POSTs only `{action}`); enrollment queue, reports/exports, retry/recovery UI missing in all. | matrix §2 (surface agent); `cross-sell-life/[id]/controls.tsx:65`; control route `:11-14` | Bring Life & Win-Back to the cross-sell bar; surface resume strategies in the UI; add retry/recovery + health panels where backed by real infra (post-D9). |
| **D15** | Test coverage | **MED** | No route-level authz tests on the campaign control plane; no `applyControl` concurrency test; no advisor-ownership validation test; no a11y/e2e harness. | `auth-matrix.test.mjs`, `fail-closed-auth.test.mjs` reference none of these routes; `package.json` scripts | Add authz/route-smoke + concurrency + validation tests; add axe-core a11y harness as an explicit item. |
| **F3/F6** | Security (low) | **LOW** | Service-role `getDb()` bypasses RLS while a comment claims "RLS remains the primary row guarantee" (misleading; route-layer is the sole guard — acceptable single-tenant); non-constant-time internal-auth bearer compare (fails closed in prod when unset — OK). | `src/lib/supabase/client.ts:34-51`; `src/lib/auth/api.ts:6-7`; `src/lib/http.ts:118-127` | Correct the comment/doc the reliance; constant-time compare. |
| **P1** | Config hygiene (low) | **LOW** | `localhost:3000` base-URL fallback when `VERCEL_URL`/site-URL unset; `scripts/seed-demo.mjs` fake fixtures have no `NODE_ENV==='production'` refusal. Neither is production-reachable today. | `src/lib/forms.ts:51`; `scripts/seed-demo.mjs` | Guarantee prod site-URL env; add a prod-refusal guard to the demo seed. |

**No production-reachable placeholder/test data found** (all `example.com`/`555` are input `placeholder=` hints; "Markist Athelus"/McKinney is the real FSA principal identity; `sandbox` refers to the legitimate Super AI-guardrail feature; no Calendly/GHL/placeholder booking links reach production — ADR-027 native booking confirmed).

---

## 2. Campaign Feature-Parity Matrix

Legend: ● Present · ◐ Partial · ○ Missing.

| Capability | Life Conversion | Cross-Sell Life (reference) | Win-Back Life | Required remediation |
|---|---|---|---|---|
| Dashboard | ● list+detail | ● multi-campaign list+detail | ◐ single combined page (no `[id]`) | Win-Back: add list/detail split or justify single-campaign model |
| Eligibility view | ◐ rule-only | ○ (enroll API only) | ● dedicated section + count | Cross-Sell: add eligibility section; Life: promote to a real section |
| Enrollment queue | ○ | ○ | ◐ count only | Add actionable pending-to-enroll queue (all) |
| Active enrollments | ● | ● | ● | Add search/filter/sort/pagination (all — currently `.limit(50)`) |
| Schedule | ● 20-touch | ● 35-touch | ● 24-touch | Table `scope`/overflow parity |
| Asset library | ● | ● (richest) | ● | Preview parity (D10) |
| Conversation workflow | ◐ prose only | ● rich green/red-zone | ● playbooks + escalate/exit | Life: add per-playbook detail |
| Advisor tasks | ◐ prose only | ● scripts + goals | ● scripts + goals | Life: add scripts |
| Booking | ○ (exit ref only) | ○ | ○ | Wire booking CTA + exit (D8) |
| Analytics | ● | ● | ● (richest) | Consistency of funnel viz |
| Operational controls | ● | ● (+version) | ● | Surface resume strategies (D14) |
| Audit history (UI) | ○ | ◐ activation history | ○ | Add audit-history UI (all) |
| Health monitoring | ○ | ● HealthPanel + `/health` | ○ | Add for Life & Win-Back (post-D9) |
| Campaign versions | ○ | ● | ○ | Add for Life & Win-Back |
| Execution failures / retry-recovery | ○ | ◐ health, no failures UI | ◐ touch outcomes | Requires D9 schema first; then UI |

---

## 3. Surface Consolidation Proposal (APPROVAL REQUIRED — do not execute in Phase 1)

**Finding:** legacy `/app/{conversions,cross-sell,crosssell,winback}` and canonical `/app/comms/{life-conversion,cross-sell-life,pipeline-winback}` are **complementary**, not duplicate: legacy = eligibility/origination (writes `opportunities`/`contacts`/`households`, reads/feeds `v_*_due` views); canonical = campaign engines (own `*_campaign_*` tables, enroll from the same `v_*_due` views). No table collisions. The `originate`/import endpoints feed the very eligibility views the engines enroll from — retiring them would starve enrollment.

| Item | Authoritative | Duplicate/legacy | Unique-if-retired | Proposed canonical destination | Retirement sequence | Regression tests |
|---|---|---|---|---|---|---|
| Life Conversion | `/app/comms/life-conversion` + `/api/life-campaign` | `/app/conversions` (7 pages) | policy-window detection, agency×urgency heat map, per-policy detail, CSV import, originate | Keep both layers; fold origination into engine workspace as an "Eligibility & Origination" tab | (1) fix IA (add engines to registry) → (2) relabel legacy → (3) fold origination → (5) retire dup analytics/monitoring after parity | registry-reachability; redirect for `conversions/eligible`; eligibility-view contract |
| Cross-Sell Life | `/app/comms/cross-sell-life` + `/api/cross-sell-life` (14 routes) | `/app/cross-sell` (5), `/app/crosssell` (1 import) | household gap scoring, agency penetration, per-household detail, P&C import | Same; collapse `crosssell`→`cross-sell` at route level (already unified in nav) | after Life pattern proven | existing `tests/cross-sell-life-*` (7); redirect for `cross-sell/agency-penetration` |
| Win-Back Life | `/app/comms/pipeline-winback` + `/api/pipeline-winback` | `/app/winback` (2) | imported lapsed-life book (`contacts` source=`winback_life`) | **Keep separate** — ADR-031 distinct populations (imported vs internal stalled) | relabel only; do **not** merge populations | ADR-031 population-exclusion test; existing `tests/pipeline-winback-*` (4) |

**Lowest-risk, highest-value first step (recommend approving independently):** add the three engines to the registry Communications workspace nav / `comms/page.tsx` and resolve the "Life Conversion"/"Win-Back" **name collisions** (relabel legacy to "Conversion Windows" / "Lapsed-Life Book (Imported)"). This is presentation-only, no data change, and fixes the orphaned-navigation defect (D12).

**Compatibility risks:** deep links from `BriefingHero.tsx:34-35` and `AgencyProfile.tsx:339` to legacy routes need redirects + caller updates; merging win-back populations would violate ADR-031; retiring `originate` endpoints would starve `v_*_due`.

---

## 4. Observability-Parity Migration Spec (APPROVAL REQUIRED — non-trivial schema)

Forward-only migration (new file; **no** edits to 081/083). Applied identically to `life_campaign_executions` and `pipeline_winback_executions`:

**Columns (2 per table):** `attempts integer not null default 0`; `next_retry_at timestamptz` (nullable).
**Status CHECK (1 per table):** drop-and-recreate to add `'dead_letter'` → `('scheduled','sent','suppressed','skipped','fulfilled','missed','dead_letter')`.
**Partial index (1 per table):** `create index idx_lcx_deadletter on life_campaign_executions (status) where status='dead_letter';` and `idx_pwx_deadletter` equivalently (mirrors `idx_xlcx_deadletter`, `085:201`).

**Scoping decision for approval:** the reference `runRetrySweep` filters on `idempotency_key`, which neither lagging table has. Choose either (a) add `idempotency_key text` + unique partial index to both tables for full parity, **or** (b) drop the idempotency filter from the ported sweep. **Recommendation: (a)** — matches the reference and hardens dedup.

**Code + route + cron delta (accompanies the schema — schema alone is inert):**
- Port `runRetrySweep` (backoff `[5,30,120,1440]` min, `maxAttempts=5`, → `dead_letter` at ceiling, set `next_retry_at` on first sweep of a stuck row) into `src/lib/life-campaign/jobs.ts` and `src/lib/pipeline-winback/jobs.ts`.
- Register `life-conversion-retry` and `pipeline-winback-retry` in `src/jobs/index.ts` + `src/jobs/handlers.ts`.
- Add two hourly cron entries in `vercel.json` (e.g. `"30 * * * *"`).
- Clone `src/app/api/cross-sell-life/health/route.ts` → `src/app/api/life-campaign/health/route.ts` and `src/app/api/pipeline-winback/health/route.ts` (FSA-gated), pointed at each campaign's execution/enrollment tables and its own `CRON_JOBS` list.

---

## 5. Phased Remediation Plan (Phase 2 — execute per campaign after approval)

> Sequencing rule (§0.3): shared-platform fixes land first behind tests, then **Cross-Sell Life** (reference) is finished, then **Life Conversion** and **Win-Back Life** are brought to parity. Each task is TDD, buildable, and independently reviewable. Denied ops stay held.

### Phase 2.0 — Shared platform (cross-cutting; gated by the platform-change approval for `personalize.ts`)
- **T0.1** Dynamic-variable tiering + fail-closed guard (D2): add blocking-tier registry + `assertResolvable()` that hard-fails render and blocks dispatch on a missing/empty blocking token, preserving cosmetic defaults. Tests: blocking-missing → throw/block+escalate; cosmetic-missing → default; unresolved-token scan (no `{{…}}`, `undefined`, `null`, `[object Object]` in output).
- **T0.2** Booking merge keys (D1): extend `RecipientContext`/`values` (or booking pre-substitution) for `appointment_time`/`meeting_details`/`reschedule_url`/`cancel_url` (+ workshop keys audit). Test: substituted **body** asserts real values (not just context).
- **T0.3** Absolute links (D3): resolve `scheduling_link`/`unsubscribe_url` as blocking absolute `siteUrl()` URLs; inject per-recipient. Test: rendered body contains absolute origin, no relative path.
- **T0.4** Identity wiring (D4): populate advisor/agency identity into campaign `recipientContext` from `site.ts` (single-FSA) and resolved represented agency (delegated). Test: body shows real FSA/agency, not generic default; delegated send shows represented agency.
- **T0.5** Shared render service + preview parity (D10): one service used by `dispatcher`/`render` **and** preview; SMS footer/identity-disclosure/unsubscribe resolved from `gate.ts`/`a2p.ts`/`compliance.ts`; preview read-only, non-dispatching. Parity test: identical inputs → identical resolved output; preview writes no comm record / fires no provider / advances no enrollment.
- **T0.6** Audit diff enrichment (D11): add agency/tenant, correlation id, applied resume/replay strategy to the control audit path.

### Phase 2.A — Cross-Sell Life (reference; finish)
- **A1** `applyControl` optimistic-concurrency guard (D6) — `.eq('status', from)`, 0-row → `409 stale_state`; test two concurrent POSTs.
- **A2** Advisor-ownership validation (D7) — validate advisor UUID against user/advisor set; default to session user; test unknown UUID → 400.
- **A3** Surface the 4 resume strategies + replay policy in the resume UI (D14 dead capability); test the POST body carries the chosen strategy; log it (D11).
- **A4** Consistency: `status-*` tokens, archetype A9 confirm dialog, shared `Section`/`Cell` primitives (D13); eligibility section (matrix §2).
- **A5** Route-level authz + concurrency + validation tests (D15).

### Phase 2.B — Life Conversion → parity
- **B1** Observability parity: migration + `runRetrySweep` + `-retry` cron + `/health` route (D9). *(schema approval-gated)*
- **B2** Resume: port `resumePaused`/`recordSkipped` + `next_touch_at` fast-forward + 4-strategy model; **no catch-up** (D5); tests: missed → `skipped`, no burst on resume, revalidation before any replay.
- **B3** Booking pause/exit on appointment (D8); test a booked appointment stops conversion touches.
- **B4** UI parity: HealthPanel, version/audit-history, per-playbook conversation + advisor scripts (D14); tables `overflow-x-auto`/`scope` (D13).
- **B5** Tests (authz/state/resume/skip/booking-exit/health).

### Phase 2.C — Win-Back Life → parity
- **C1** Observability parity (D9) *(schema approval-gated)*.
- **C2** Resume skip/no-catch-up + 4 strategies (D5).
- **C3** UI parity: HealthPanel, version/audit-history (D14); wide-table `overflow-x-auto`/`scope` (D13, highest-risk tables).
- **C4** Tests.

### Cross-cutting cleanup (fold into the campaign that touches the file)
- IA/nav + name-collision relabel (D12) — **after** consolidation approval; recommend the presentation-only nav+relabel step be approved independently.
- Route boundaries for secondary trees; `status-*` token sweep; F3/F6 comment+constant-time fixes; P1 env/seed guards.
- **Harness:** add axe-core a11y harness + a route-smoke authz suite as explicit tasks (D15); run in Phase 2 — never assert a11y/e2e/security by inspection.

---

## 6. Test & Evidence Plan

- **Run only what exists:** `npm run build`, `npm run lint`, `npm run type-check`, `npm run test` (unit), `npm run test:rls`. No e2e/a11y/security harness exists — add axe-core + route-smoke as Phase-2 tasks and run them; otherwise record a11y/e2e/security as "no harness — not asserted."
- **New/updated tests (min):** blocking-tier fail-closed + cosmetic default; missing-required-variable failure; unresolved-token scan; preview/production render parity; email HTML+plaintext; SMS assembly+segmentation (production segmenter, not an incompatible model); AI-playbook simulation (no live provider); advisor assignment; agency identity; booking (timezone/DST/conflict/confirmation/reminder/reschedule/cancel/exit) — extend existing 12 booking tests to assert substituted bodies; operational transitions incl. emergency-stop, disable/resume strategies, no-auto-catch-up, replay authorization; audit writes (enriched diff); route-level authz on the campaign control plane; `applyControl` concurrency; placeholder detection.
- **Evidence to produce at Phase-2 close:** files changed · migrations added · routes added/corrected · tests added/updated · commands run + results · build result · a11y result (only if harness added) · security-review result (`fsos-security-audit`) · rendered-preview evidence · known limitations · blocked operations requiring human authorization.

---

## 7. Approval Gate (Phase 1 STOP)

Explicit human approval required before any Phase 2 work on:
1. The **remediation plan** (§1, §5).
2. The **surface consolidation proposal** (§3) — and separately, the low-risk **nav+relabel** step.
3. The **observability-parity migration** (§4), incl. the idempotency-key scoping decision (recommend option (a)).
4. Any change to **approved content or business logic** — the plan targets **only verified defects**; D5/D8 correct behavior to match the written §4.2/booking-exit contract (flagged for confirmation).
5. The **scoped-permission posture** (settings.local.json deviation, §0).
