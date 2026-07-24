---
name: fsos-security-audit
description: Audit FSOS for security, privacy, and compliance-guardrail correctness — Row-Level Security, the three non-negotiable guardrails, the auth/scope matrix, PII handling, and the append-only audit log. Use this whenever the task is to review or harden access control, verify RLS, check the securities firewall or AI red-line, confirm quiet-hours/consent/DNC enforcement, audit PII/DOB encryption, or investigate a permissions or fail-open concern. Reach for it even when the user just says "is this endpoint safe", "can a partner see another partner's data", "did we leak PII", or "audit this before we ship" — so RLS, the guardrails, and audit-logging are all checked.
license: Proprietary — internal FSOS use only.
metadata:
  project: FSOS
  subsystem: security-compliance
  guardrails: "2.1, 2.2, 2.3, 7, 8"
---

# FSOS Security & Privacy Audit

The review lens for FSOS. This skill does not build features — it verifies that what was built cannot leak data, cannot bypass a guardrail, and cannot fail open. Assume adversarial deep-links and hostile input; the job is to prove the boundaries hold.

## What to audit (and why it matters)

### 1. Row-Level Security and scope
Every table with client/agency data carries an owner/tenant key and RLS keyed to the authenticated user's role + scope, and forbidden deep links return 403 (CLAUDE.md §5, §8). Verify a user in one scope (e.g. one agency partner) cannot read/write another's rows. RLS is the last line — a missing policy is a silent cross-tenant leak.
- Sources: `docs/data-guardrails.md`, `docs/middleware-auth.md`, `src/lib/auth/`, `supabase/migrations/010_rls_guardrails.sql`.
- Proof: `npm run test:rls` (`tests/rls-firewall.test.mjs`).

### 2. The three non-negotiable guardrails (§2)
- **Securities firewall (§2.1):** no securities account numbers, order details, suitability determinations, or client securities comms anywhere in FSOS; only `ffs_case_ref` pointers. `is_security = true` is excluded from the comms engine. Check `src/lib/compliance/firewall.ts`.
- **AI green-zone / red-line (§2.2):** no individualized product/investment/replacement/allocation recommendation or securities call-to-action reaches a client. Check `src/lib/compliance/guardrail.ts` and the dispatcher gate `src/lib/comms/gate.ts`.
- **No invented Farmers data (§2.3):** commission splits, conversion windows, product/carrier rules, and API availability ship as editable config with `is_assumption = true` and a "config default — verify" badge — never as hardcoded facts.

### 3. Communications compliance (§7)
The 13-step gate (ownership → consent → quiet_hours → delegation → dnc → approved_template → recommendation → is_security → data_confidence → other_rule → business_hours → frequency → collision) blocks on first failure; steps 1–10 escalate, the trailing three are non-escalating operational deferrals. Blocked sends are never silently dropped. Canonical enumeration: `docs/data-guardrails.md` §5. See **twilio-a2p-compliance** for the mechanics; audit that nothing sends around the gate.

### 4. PII & audit integrity
- PII encrypted at rest (Supabase default; `pgcrypto` column encryption for DOB) — CLAUDE.md §5.
- The `audit_log` is append-only, written on every create/update/delete, under a DB role that cannot UPDATE/DELETE the log (`src/lib/audit/`). Verify it cannot be tampered.

### 5. Fail-closed posture
Auth/verification must fail **closed** in production. Example precedent: Twilio inbound rejects unverifiable requests in production (`src/lib/comms/twilio.ts`); the config gate (`src/lib/auth/config-gate.ts`) and middleware (`src/middleware.ts`) fail closed. Any "fail open in production" is a finding.
- Proof: `tests/fail-closed-auth.test.mjs`, `tests/auth-matrix.test.mjs`, `tests/guardrail-proof.test.mjs`.

## How to run an audit

1. Scope the change: which tables, routes, portals, and guardrails does it touch? (`docs/routes.md`, `docs/sitemap.md`, `docs/specs/rbac-matrix.md`.)
2. Trace each data path from request → auth/scope → RLS → query → response; look for a path that skips a layer.
3. Run the proof suite: `npm test` (auth-matrix, guardrail, guardrail-proof, fail-closed-auth, p0/p1 gates) and `npm run test:rls`. A guardrail is only real if a test proves it — never weaken or delete a guardrail test to make a build pass (§1.5).
4. Report findings ranked by severity with the concrete failing scenario (inputs → wrong outcome), not vague concerns.

## When NOT to use this skill

- Implementing the feature itself → the relevant build skill (**fsos-crm-workflows**, **twilio-a2p-compliance**, **fsos-nigo-intelligence**, **farmers-brand-website**).
- General code-quality review with no security/guardrail angle → the built-in **code-review** skill.

## Definition of Done for an audit

- Every touched guardrail has a passing proof test; `npm run test:rls` green.
- No fail-open path in production; no cross-scope read/write; no securities-prohibited field; no un-audited mutation of client/agency data.
