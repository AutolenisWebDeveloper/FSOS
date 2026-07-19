# FSOS Fortune-500 Fintech Readiness — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the compliance, security, coverage, and observability gaps between FSOS's current state and a regulated-fintech engineering bar — without adding new product features.

**Architecture:** FSOS is effectively two codebases: a disciplined newer *aggregate-root spine* (`households → opportunities → cases → commissions`, with a tested 7-step comms gate, immutable `audit_log`, and pgcrypto DOB encryption) sitting beside a *legacy command-center layer* (`customers`/`policies`/`campaigns`/`assistant`) that predates the guardrails and violates most of them. This plan hardens the seams and either brings the legacy layer up to the spine's bar or formally retires it. Work is phased strictly by risk: production compliance/PII holes first, then enforcement backstops, then coverage, then observability, then polish.

**Tech Stack:** Next.js 14 (App Router) · TypeScript strict · Supabase (Postgres/RLS/pgcrypto) · Vercel + Vercel Cron · Node `node:test`-style `.mjs` suites (candidate: migrate to vitest) · the existing AI gateway (`src/lib/ai/gateway.ts`).

## Global Constraints

- **Read before write** (CLAUDE.md §1.4): open and read every file named in a task before editing; never recreate an existing file.
- **Supabase access:** always `getDb()` from `@/lib/supabase/client`; never instantiate a client at module level (CLAUDE.md §1.1).
- **Every API route** exports `export const dynamic = 'force-dynamic'` and `export const runtime = 'nodejs'`.
- **Public routes stay auth-guard-free:** `/[slug]`, `/upload/[slug]`, `/forms/[formId]` and the P-0 public surface.
- **Validation:** every input validated with Zod; types via `z.infer`. No unvalidated writes.
- **Build discipline:** after any code change run `npm run build` and fix EVERY error before stopping.
- **The three guardrails** (§2) and **communications compliance** (§7) apply to every task that touches those surfaces. No new bypass paths.
- **No invented Farmers/FFS data** (§2.3): config defaults carry `is_assumption = true` and a "config default — verify" badge.

---

## Audit Findings Register (source of truth for this plan)

Severity-ranked, de-duplicated across the four audits. `▲N` = number of independent audit agents that flagged it (confidence signal).

### CRITICAL
| ID | Finding | Evidence | ▲ |
|----|---------|----------|---|
| C1 | `/api/campaigns/run` cron (every 30 min) sends via raw `@/lib/messaging`, enforcing only a stale consent boolean — skips quiet-hours, DNC, approved-template, recommendation-language, and `is_security`. Direct §7 violation; the "no bypass path (WF-5)" invariant is false. | `src/app/api/campaigns/run/route.ts:5,85,88,97,100` · `vercel.json:22` | ▲3 |
| C2 | No CI exists (`.github/` absent). The strong guardrail/RLS/auth tests run only when a human types `npm test`; Vercel runs `next build` only. | no `.github/`, no husky; `package.json:17` | ▲1 |
| C3 | Legacy `customers.dob` stored **plaintext** on a live, service-role-accessible table (`/api/customers/*`). Direct §5(b) violation. | `supabase/migrations/001_initial_schema.sql:51,527` | ▲1 |

### HIGH
| ID | Finding | Evidence | ▲ |
|----|---------|----------|---|
| H1 | Internal/command-center auth **fails OPEN** when `FSOS_API_SECRET`/`FSOS_ADMIN_PASSWORD` unset → unauthenticated access to the plaintext-DOB customer book. | `src/lib/http.ts:78` · `src/middleware.ts:21` | ▲1 |
| H2 | Middleware excludes `/api/*` — no coarse authz backstop; any route missing its `requireApiRole`/`requireInternalAuth` check is fully exposed (service-role `getDb()` bypasses RLS). | `src/middleware.ts:16` | ▲1 |
| H3 | `/super` step-up MFA never re-challenges (`stepUpFresh = mfaSatisfied`); mandatory fresh re-auth is a no-op. | `src/middleware.ts:88` | ▲1 |
| H4 | Firewall field-scan (`assertNotSecuritiesSystemOfRecord`) missing on `cases` and `commissions` write routes — 2 of the 4 contractually-named entities are unscanned. | `cases/route.ts`, `commissions/[id]/route.ts`, `commissions/splits/route.ts` (no firewall import) | ▲1 |
| H5 | Compliance Intelligence `ingest`/`note`/`analyze` routes persist free-text governing docs & NIGO notes with **no** firewall/redaction — §3 firewall binding is docs-only. | `src/app/api/compliance/{ingest,note,analyze}/route.ts` | ▲1 |
| H6 | 6 direct Anthropic SDK call sites bypass the AI gateway → no kill switch, no token/cost logging (§1). | `api/assistant/route.ts:3,41` · `api/briefing/send/route.ts:5,93` · `api/customers/meeting-prep/route.ts:5,72` · `api/customers/next-action/route.ts:5,105` · `lib/fna.ts:7,108` · `lib/columnAI.ts:14,93` | ▲1 |
| H7 | Silent-skip tests read as PASS: RLS-firewall and resolution suites `process.exit(0)` when Postgres/esbuild absent — crown-jewel proofs become green no-ops in a bare runner. | `tests/rls-firewall.test.mjs:34-38` · `tests/resolution.test.mjs:21-24` | ▲1 |
| H8 | No error/audit monitoring backbone (no Sentry/structured logging); `writeAudit` is fire-and-forget (`{ok:false}` ignored everywhere) → an un-audited mutation is invisible. | `src/lib/audit/log.ts:69-77`; only `api/audit/log/route.ts:27` checks result | ▲1 |
| H9 | Money paths (`commissions/splits`), consent/DNC write paths (`consent/opt-out`, Twilio inbound STOP), and firewall-guarded spine routes (`referrals/convert`, `opportunities`, `policies`, `reviews/outcome`) have **zero** route-level tests. | see coverage audit F-4/F-5/F-6 | ▲1 |
| H10 | Most agents never open `agent_runs`: only 3 outreach agents use the durable runner; detection crons (`jobs/handlers.ts`) skip `agent_runs`; ad-hoc AI routes omit `confidence` (§6 attribution unmet). | `src/lib/ai/workforce.ts:321` · `src/jobs/handlers.ts:15-127` | ▲1 |
| H11 | 32 mutating routes lack `writeAudit`, concentrated in legacy `customers`/`campaigns`/`tasks`/`forms` (e.g. `customers/upsert` writes customer+policy with zero audit). | `api/customers/upsert/route.ts:113-216` | ▲1 |

### MEDIUM
| ID | Finding | Evidence |
|----|---------|----------|
| M1 | `is_security` hard-coded `false` at the AI send boundary — collapses the two promised hard gates into one upstream filter. | `workforce.ts:396` · `jobs/handlers.ts:196` |
| M2 | Red-line detection is ~11 fixed regexes; individualized recs that dodge the patterns pass. | `src/lib/compliance/guardrail.ts:46-61` |
| M3 | Workshop confirmation email bypasses the gate (unaudited, no DNC). | `api/workshops/register/route.ts:5,102` |
| M4 | RLS policies role-gated but **not scope-gated**; `owner_scope`/`securities_scope` columns exist but unused in policies. | `010_rls_guardrails.sql:113-114,122,152` |
| M5 | Audit is best-effort, not transactional — a mutation can commit without its audit row. | `src/lib/audit/log.ts:69-77` |
| M6 | Role source-of-truth drift: middleware/API read JWT `app_metadata.roles`; RLS reads `user_roles` table. | `middleware.ts:86` vs `010:17-24` |
| M7 | DOB decrypt RPCs are SECURITY DEFINER with no `REVOKE EXECUTE … FROM PUBLIC`. | `010:49-57` · `011:145` |
| M8 | Two parallel send stacks (`lib/messaging` raw vs `lib/comms` gated) with nothing forbidding the raw one. | coverage F-7 |
| M9 | No test framework / coverage tooling; 13-file `&&` chain aborts on first failure, no coverage %. | `package.json:17` |
| M10 | Global kill switch fails **open** on DB read error (per-agent correctly fails closed). | `gateway.ts:88-93` |
| M11 | Dead-end placeholder pages (`partner/schedule`, `client/case-status`); only 11 `loading.tsx` + 1 `error.tsx` for 241 pages. | observability Area 5 |

### LOW
| ID | Finding | Evidence |
|----|---------|----------|
| L1 | Named §2.2 validator `validateAIClientMessage` runs only in the sandbox; prod path re-implements equivalent checks in `gate.ts` (drift risk). | `guardrail.ts:108` used only by `super/sandbox/route.ts:47` |
| L2 | `suitability_status_pointer` whitelisted in firewall allowlist but not named in §2.1. | `firewall.ts:32` |
| L3 | `tsc --noEmit` unverifiable in this checkout (deps absent); `BadgeProps.variant` / missing-`children` prop errors need a real run. | coverage TYPE-1 |

---

## Phased Roadmap

| Phase | Theme | Findings | Why this order |
|-------|-------|----------|----------------|
| **0** | Stop the bleeding | C1, C2, C3, H1 | Live production compliance/PII holes + the CI net that keeps them closed |
| **1** | Close firewall & gateway seams | H4, H5, H6, M1, M3 | Guardrail enforcement gaps on real write paths |
| **2** | Auth hardening | H2, H3, M6, M7, M10 | Authorization backstops & fail-closed posture |
| **3** | Coverage program | H7, H9, M8, M9, L3 | Turn the guardrails into enforced, measured invariants |
| **4** | Observability & audit integrity | H8, H10, H11, M5 | Make every mutation & agent run attributable and alertable |
| **5** | Scope, red-line depth & DoD | M2, M4, M11, L1, L2 | Defense-in-depth and Definition-of-Done polish |

Each phase produces working, independently shippable software. Phases 1–5 should each be expanded into their own detailed TDD plan (via `superpowers:writing-plans`) when picked up; **Phase 0 is fully elaborated below and is ready to execute now.**

---

# PHASE 0 — Stop the Bleeding (elaborated, execute now)

## File Structure (Phase 0)
- `src/app/api/campaigns/run/route.ts` — MODIFY: replace raw `sendEmail`/`sendSms` with `sendThroughGate`.
- `tests/campaign-gate.test.mjs` — CREATE: proves the cron path blocks quiet-hours/DNC/`is_security`/recommendation and escalates.
- `.github/workflows/ci.yml` — CREATE: type-check + lint + test + RLS test as required checks with a Postgres service.
- `tests/rls-firewall.test.mjs`, `tests/resolution.test.mjs` — MODIFY: convert silent skips to hard failures under `CI_REQUIRE_INFRA=1`.
- `supabase/migrations/0XX_encrypt_legacy_customer_dob.sql` — CREATE: encrypt/retire legacy `customers.dob`.
- `src/lib/http.ts`, `src/middleware.ts` — MODIFY: fail closed when auth secrets are unset.

---

### Task 1: Route the campaign cron through the tested compliance gate (C1)

**Files:**
- Modify: `src/app/api/campaigns/run/route.ts:5,85-121`
- Test: `tests/campaign-gate.test.mjs` (create)
- Reference (mirror): `tests/guardrail-proof.test.mjs` (cases 2/4/5), `src/lib/comms/send.ts` (`sendThroughGate`)

**Interfaces:**
- Consumes: `sendThroughGate(input)` from `src/lib/comms/send.ts` — the same entry the newer `comm_campaign-dispatch` path uses; it computes consent/DNC/quiet-hours/template-approval/`is_security` fresh from the DB and writes `compliance_events` + escalation + audit on block.
- Produces: no new public signature; the route's outbound send behavior now goes through the gate.

- [ ] **Step 1: Read the current route and the gate entry** — `src/app/api/campaigns/run/route.ts` and `src/lib/comms/send.ts`. Confirm the exact `sendThroughGate` parameter shape (recipient, channel, body, template ref, entity ids for `is_security` derivation). Do not guess the signature — copy it.

- [ ] **Step 2: Write the failing test** in `tests/campaign-gate.test.mjs`, mirroring `guardrail-proof.test.mjs`'s spy-dispatch harness. Seed four recipients on a campaign: (a) clean/consented, (b) `is_security = true`, (c) on DNC, (d) outside 9am–8pm local. Drive the campaign runner's send loop. Assert: (a) sends once with the `Reply STOP` footer; (b)(c)(d) are **not** sent, each writes a `compliance_events` row + escalation, and none is silently dropped.

- [ ] **Step 3: Run it and watch it fail** — `node tests/campaign-gate.test.mjs`. Expected: FAIL (current route bypasses the gate, so b/c/d get sent).

- [ ] **Step 4: Implement** — in `route.ts`, remove the `sendEmail`/`sendSms` imports from `@/lib/messaging`; replace the per-recipient send (lines ~85–121) with a `sendThroughGate` call per recipient, passing DB-derived `is_security` (never a literal — see M1). Keep the enrollment-consent read but let the gate be authoritative.

- [ ] **Step 5: Run the test to green** — `node tests/campaign-gate.test.mjs`. Expected: PASS. Then `npm test` to confirm no regression.

- [ ] **Step 6: Build** — `npm run build`; fix any error.

- [ ] **Step 7: Commit** — `git commit -m "fix(comms): route campaign cron through the 7-step compliance gate"`

---

### Task 2: Stand up CI as a required gate (C2)

**Files:**
- Create: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: `package.json` scripts `type-check`, `lint`, `test`, `test:rls`.
- Produces: a required status check on PR + push to the default branch.

- [ ] **Step 1: Write `.github/workflows/ci.yml`** — trigger on `pull_request` and `push`. Job steps: `actions/checkout` → `actions/setup-node` (Node ≥ 18) → `npm ci` → `npm run type-check` → `npm run lint` → `npm test` → `npm run test:rls`. Add a `postgres:16` service container and export `DATABASE_URL`/`PGHOST` so `rls-firewall` actually runs. Set env `CI_REQUIRE_INFRA=1` (consumed in Task 3).

- [ ] **Step 2: Verify the workflow parses** — `npx --yes @action-validator/cli .github/workflows/ci.yml` (or lint via `yamllint`). Expected: valid.

- [ ] **Step 3: Commit** — `git commit -m "ci: run type-check, lint, tests, and RLS proof on PR/push"`

- [ ] **Step 4: (post-merge, manual)** In GitHub branch protection, mark the CI job a required check. Not a code step — note it in the PR description as a follow-up for the repo admin.

---

### Task 3: Make infrastructure-dependent tests fail loudly in CI (H7)

**Files:**
- Modify: `tests/rls-firewall.test.mjs:34-38`, `tests/resolution.test.mjs:21-24`

**Interfaces:**
- Consumes: `process.env.CI_REQUIRE_INFRA` (set by Task 2's workflow).

- [ ] **Step 1: Read both skip branches** — confirm the exact conditions that currently `process.exit(0)`.

- [ ] **Step 2: Edit the skip logic** — in each, when the toolchain (Postgres / esbuild) is unavailable **and** `process.env.CI_REQUIRE_INFRA === '1'`, `console.error` a clear message and `process.exit(1)` instead of `0`. Preserve the graceful local skip when the flag is unset.

- [ ] **Step 3: Prove it locally** — run `CI_REQUIRE_INFRA=1 node tests/resolution.test.mjs` with esbuild deliberately unavailable. Expected: exit 1 with the message. Without the flag: still skips 0.

- [ ] **Step 4: Commit** — `git commit -m "test: hard-fail RLS/resolution proofs when CI infra is required"`

---

### Task 4: Encrypt or retire the legacy plaintext `customers.dob` (C3)

**Files:**
- Create: `supabase/migrations/0XX_encrypt_legacy_customer_dob.sql` (use the next migration number)
- Modify: legacy read/write paths `src/app/api/customers/upsert/route.ts`, `src/app/api/customers/detail/route.ts`, and `loadCustomerProfile` (grep for `customers.dob` / `.dob`)
- Reference (mirror): `supabase/migrations/011_*.sql` (the spine's `dob_enc` + `member_create`/`member_dob` SECURITY DEFINER RPC pattern), `src/lib/fna/household-fna.ts:92`

**Interfaces:**
- Produces: `customers.dob_enc bytea` + RPCs `customer_dob_set(id, dob)` / `customer_dob_get(id)` mirroring the spine, keyed by the same `DOB_ENCRYPTION_KEY` env; plaintext `customers.dob` dropped.

- [ ] **Step 1: Decision gate** — confirm with the owner whether the legacy `customers` book stays live or is retired. If retired, this task becomes "drop the plaintext column + 410 the routes" and is smaller. **This is a product decision — do not proceed to encryption without it.** (Captured in the execution handoff below.)

- [ ] **Step 2 (if keeping): Write the failing test** in `tests/customer-dob-encryption.test.mjs`: assert `customers` has no readable plaintext `dob` column and that `customer_dob_get` round-trips a value written via `customer_dob_set`. Mirror the spine's DOB test if one exists.

- [ ] **Step 3: Run it, watch it fail** — expected FAIL (column still plaintext).

- [ ] **Step 4: Write the migration** — add `dob_enc bytea`; backfill `dob_enc = pgp_sym_encrypt(dob::text, current_setting('app.dob_key'))` for existing rows; add the two SECURITY DEFINER RPCs with `REVOKE EXECUTE … FROM PUBLIC, anon` (also fixes M7 for the legacy side); `DROP COLUMN dob`. Update the `001:527` trigger that reads `dob`.

- [ ] **Step 5: Update the routes** — replace direct `dob` reads/writes with the RPCs; exclude `dob_enc` from any client-facing column allowlist.

- [ ] **Step 6: Run tests + build** — `npm run migrate` against a scratch DB, `node tests/customer-dob-encryption.test.mjs`, `npm test`, `npm run build`. All green.

- [ ] **Step 7: Commit** — `git commit -m "security(pii): encrypt legacy customer DOB with pgcrypto, drop plaintext column"`

---

### Task 5: Fail closed when internal-auth secrets are unset (H1)

**Files:**
- Modify: `src/lib/http.ts:78`, `src/middleware.ts:21`
- Test: `tests/fail-closed-auth.test.mjs` (create)

**Interfaces:**
- Consumes: `FSOS_API_SECRET`, `FSOS_ADMIN_PASSWORD`, `NODE_ENV`.

- [ ] **Step 1: Read both call sites** — confirm the current "unset ⇒ authorized/null" behavior.

- [ ] **Step 2: Write the failing test** — `requireInternalAuth` with both secrets unset and `NODE_ENV=production` must return an unauthorized result (not `null`); with a valid secret it authorizes. Assert the middleware Basic-auth gate is not skipped in production when `FSOS_ADMIN_PASSWORD` is unset.

- [ ] **Step 3: Run it, watch it fail** — expected FAIL (currently fails open).

- [ ] **Step 4: Implement** — in production, treat missing secrets as **deny** (or throw on boot). Keep a clearly-logged dev-only allowance behind an explicit `ALLOW_INSECURE_LOCAL=1` so local dev isn't broken but production can never silently open.

- [ ] **Step 5: Green + build** — `node tests/fail-closed-auth.test.mjs`, `npm test`, `npm run build`.

- [ ] **Step 6: Commit** — `git commit -m "security(auth): fail closed when internal-auth secrets are unset in production"`

---

## Phase 0 Self-Review
- **Coverage:** C1→T1, C2→T2, H7→T3, C3→T4, H1→T5. All four Phase-0 findings mapped.
- **Placeholder scan:** T4 Step 1 is a genuine decision gate (product input required), not a placeholder — flagged explicitly in the handoff. All other steps carry concrete files/commands.
- **Type consistency:** `sendThroughGate` (T1) is consumed, not redefined; DOB RPC names (T4) mirror the existing spine pattern — verify exact names against `migrations/011` when implementing.

---

# PHASES 1–5 — Workstream Specs (expand each into its own TDD plan when picked up)

Each item lists: **fix** · **files** · **test/acceptance**. These are deliberately spec-level; run `superpowers:writing-plans` on a phase to generate its bite-sized TDD tasks before executing it.

### Phase 1 — Firewall & Gateway Seams
- **H4** Add `assertNotSecuritiesSystemOfRecord(v.data)` to `cases/route.ts`, `cases/[id]/route.ts`, `commissions/[id]/route.ts`, `commissions/splits/route.ts`. *Test:* securities payload → 4xx + no row + `firewall.blocked` audit, mirroring `opportunities/[id]/stage` at `:41`.
- **H5** Add an input redaction/block step (account-number/SSN/order-pattern regex) to `compliance/ingest` and `compliance/note`; block + write `compliance_event`; add a human-attestation checkbox. *Test:* a body containing a synthetic account number is blocked/masked and logged.
- **H6** Migrate the 6 direct-SDK call sites to `runGateway({ agentKey })`; retire the stale `api/assistant` in favor of `api/app/assistant`. *Test:* a static guard test asserting no `src/app/api/**` or `src/lib/**` file imports `@anthropic-ai/sdk` outside the gateway.
- **M1** Derive `is_security` from the entity at send time inside `sendThroughGate` instead of accepting a caller literal (`workforce.ts:396`, `handlers.ts:196`). *Test:* a target flagged securities *after* queueing is blocked at dispatch.
- **M3** Route `workshops/register` email through `sendThroughGate` (transactional/approved-template flag) or document an audited carve-out. *Test:* a DNC registrant is blocked/audited.

### Phase 2 — Auth Hardening
- **H2** Add an `/api/*` authorization backstop (middleware matcher or a shared wrapper) **and** a CI static check that every route calls `requireApiRole`/`requireInternalAuth`. *Test:* a route without a guard fails the static check.
- **H3** Implement real `/super` step-up freshness: track `auth_time`/step-up timestamp, force `/login/mfa?step_up=1` when older than N minutes (`middleware.ts:88`). *Test:* extend `auth-matrix.test.mjs` with a stale-step-up case → re-challenge.
- **M6** Single source of truth for roles — sync `user_roles` into JWT claims (or read the table in both layers). *Test:* a revoked role is denied in both middleware and RLS.
- **M7** `REVOKE EXECUTE … FROM PUBLIC, anon` on the DOB RPCs; grant only the service role.
- **M10** Global kill switch fails **closed** (or alerts) when `ai_policies` can't be read (`gateway.ts:88-93`). *Test:* simulated DB read error ⇒ gateway disabled.

### Phase 3 — Coverage Program
- **H9** Route/integration tests against the ephemeral Postgres for: `commissions/splits` (non-FSA→403, upsert writes `config.changed` audit, sum≠100→400); `consent/opt-out` (flips flags + `consent_ledger` row + `consent.revoked` audit); Twilio inbound STOP (revoke + DNC); firewall-guarded spine routes (securities payload blocked before write + audit).
- **M8** Static guard test: no `src/app/api/**` imports `lib/messaging`/provider SDKs except gate internals (turns M1/H6/C1 into an enforced invariant).
- **M9** Adopt `vitest` (v8 coverage), keeping the pure-core test style; set a `lib/ ≥ 80%` floor in CI.
- **L3** In CI, run `npm ci && npm run type-check`; specifically resolve the `BadgeProps.variant` and `PageHeader/Section` missing-`children` errors if they survive install.

### Phase 4 — Observability & Audit Integrity
- **H8** Add an error-monitoring sink (Sentry or equivalent); route `console.error` and `writeAudit` `{ok:false}` results to it and **alert** on audit-write failure.
- **H10** Route all agent execution through `runAgent`; have detection crons (`jobs/handlers.ts`) open an `agent_runs` row (even a zero-token detection run); make `confidence` non-null in the ad-hoc AI writers.
- **H11** Add `writeAudit` to the 32 legacy mutating routes (or formally deprecate that layer); add `consent.revoked` to opt-out.
- **M5** Make audit transactional — DB-trigger-based audit, or a same-transaction insert whose failure rolls back the mutation.

### Phase 5 — Scope, Red-Line Depth & DoD
- **M2** Back the red-line regex with an LLM-judge classifier via the gateway, and/or restrict AI client-facing bodies to approved templates only (regex stays as a fast pre-filter).
- **M4** Add scope predicates (`owner_scope = auth.uid()`/team map, `securities_scope`) to the spine RLS policies so they are keyed to role **and** scope per §5.
- **M11** Wire real data + a next-action into `partner/schedule` and `client/case-status`; add per-portal `loading.tsx`/`error.tsx` boundaries (systemic: 241 pages, 11 loading + 1 error today).
- **L1** Have `gate.ts` delegate to `validateAIClientMessage` (single canonical §2.2 validator).
- **L2** Confirm `suitability_status_pointer` is non-substantive; document in §2.1 or remove from the firewall allowlist.

---

## Strengths to preserve (do NOT regress)
- DB-enforced **append-only `audit_log`** (`010:66-85`: revoke + raising trigger, fires even against the service role).
- **New-spine DOB** pgcrypto-encrypted with an external key, excluded from client output.
- **Kill switch** wired at both run-start (`agent-runner.ts:55`) and gateway-call (`gateway.ts:217`); guardrail agent cannot be disabled.
- **Grounding / verify-gate** in Compliance Intelligence (`intelligence.ts:185`): ungrounded citations stripped, insufficiency-as-answer.
- **7-step gate + firewall + auth-matrix** are genuinely tested (`guardrail-proof`, `rls-firewall`, `auth-matrix`) — the model to replicate, not replace.
