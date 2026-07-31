# God-mode audit — deliberate decisions (findings addressed by NOT changing code)

Two audit findings were resolved by a design decision rather than a code change,
because the naive "fix" would have made the system worse. Recorded here so the choice
is explicit and not mistaken for an oversight.

## 1. Audit capture stays service-layer, not DB triggers

**Finding:** audit rows are written by the application (`src/lib/audit/log.ts` →
`writeAudit`), not by database triggers, so a write that skipped the helper would leave
no audit trail. Proposed fix in the audit: add `AFTER INSERT/UPDATE/DELETE` triggers on
the spine tables.

**Decision: do NOT add blanket audit triggers.** Every mutating route already calls
`writeAudit` with rich, intent-level context (actor, action verb, entity, diff, and
compliance linkage). A blanket DB trigger cannot see that context and would fire *in
addition* to the existing app-layer write, producing **duplicate audit rows** for every
audited operation — corrupting the very trail it's meant to protect. It would also fight
migration 077, which locks `audit_log` inserts to the service role.

The real residual risk — a raw service-role write that bypasses `writeAudit` — is a
code-review concern (keep mutations behind the service layer), not something a duplicating
trigger fixes. The single-writer, append-only, TRUNCATE-blocked `audit_log` (migrations
010 + 077) plus the service-layer `writeAudit` convention is the intended design.

## 2. Central env module scoped to alias-prone / security vars

**Finding:** ~47 files read `process.env` ad hoc; no central module.

**Decision:** `src/lib/env.ts` centralizes the vars that actually matter — the ones with
multiple accepted names (the Vercel↔Supabase integration aliases) or that gate security
(cron secret, deployed-runtime signal). Those were the drift source (e.g. the health
check). The remaining single-name, single-site reads are left inline **on purpose**:
funneling every innocuous `process.env.X` through a wrapper is churn with no correctness
benefit and would touch dozens of files for no behavior change. The module is the
authoritative resolver for the vars where a single resolution matters, and the place to
add startup validation if the app later needs it.
