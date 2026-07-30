# Gated migration evidence — for review before applying

Two **access-control** migrations are drafted and committed **unapplied** (this folder
is outside `supabase/migrations/`, so `npm run migrate` will not run them). They change
who can touch security-sensitive rows, so per the god-mode contract they wait for
explicit go-ahead. Below is the evidence requested before review.

Authoring session had **no live DB** (Supabase MCP not authorized), so RLS/grant state
is read from migration SQL + code, not `pg_catalog`. Confirm with `get_advisors` /
`\d+` on a real instance before applying.

---

## 1. AI-governance RLS — `DRAFT-ai-governance-rls.pending.sql`

**Is RLS enabled / FORCE set today?** No. Grep of all 75 migrations finds **no**
`enable row level security`, no `force row level security`, and no GRANT/REVOKE for
either `ai_policies` or `ai_agents`. They are the only sensitive tables missing RLS
(reference tables `carriers/districts/regions/products/job_runs` also lack it but hold
no client PII or governance state).

**Every current writer/reader (service-role vs authenticated):**

| Table | Writers (code) | Readers (code) | Client type |
|---|---|---|---|
| `ai_policies` | **0** app writers (seeded by migration only) | 7 sites (kill switch `isGatewayEnabled`, policy pages) | all `getDb()` = **service role** |
| `ai_agents` | **1**: `src/app/api/ai/agents/[id]/route.ts` (`update enabled`), gated by `requireApiRole('fsa')` + super_admin+2FA for the guardrail agent | 12 sites (kill switch `isAgentEnabled`, roster/ops pages) | all `getDb()` = **service role** |

Neither table is ever read through the browser/anon client (`getBrowserDb`/
`createBrowserClient`) — verified by grep (0 hits).

**Proof the change alters no real caller's allow/deny outcome:** service_role has the
`bypassrls` attribute, so enabling RLS + FORCE does not affect any `getDb()` path — i.e.
100% of legitimate access. The migration's `revoke … from anon, authenticated` + the
absence of a broad write policy removes exactly one thing: **direct anon/authenticated
PostgREST access**, which is the vulnerability. Net effect = pure hardening. The added
`*_super_read` policies only *widen* read access (for a hypothetical user-context admin
client); they deny nothing.

---

## 2. `audit_log` lockdown — `DRAFT-audit-log-lockdown.pending.sql`

**Current state (migration 010:64-85):** RLS enabled; `revoke update, delete … from
authenticated, anon`; a `BEFORE UPDATE OR DELETE` trigger that raises. Append-only vs
UPDATE/DELETE is genuinely enforced. Two gaps remain: the insert policy is
`to authenticated with check (true)` (forgeable rows), and TRUNCATE is neither
trigger-blocked nor revoked.

**Every INSERT/UPDATE/DELETE/TRUNCATE against `audit_log` (app, jobs, tests, migrations):**

| Source | INSERT | UPDATE | DELETE | TRUNCATE |
|---|---|---|---|---|
| App/jobs code | **1** — `src/lib/audit/log.ts:72` (`getDb()` = service role) | 0 | 0 | 0 |
| Tests (`tests/`) | 0 direct app-role inserts; **no** test asserts an authenticated insert | 0 | 0 | **0** |
| Migrations | seed/DDL only | 0 | 0 | **0** |

**Will the TRUNCATE block break test teardown?** No. The ephemeral-Postgres test harness
(`rls-firewall`, `customer-dob-plain`, …) tears down by **dropping the whole cluster**
(`pg_ctl stop` + rm datadir), never `TRUNCATE audit_log`. Grep confirms 0 `TRUNCATE`/
`DELETE FROM audit_log` anywhere in `tests/`.

**Proof of pure hardening:** the sole writer is the service role (bypasses RLS, keeps
INSERT via ownership), so dropping the authenticated insert policy + revoking
authenticated/anon INSERT changes no real write path — it only removes the forgery
vector. TRUNCATE is used by nothing, so blocking it removes only an abuse path.

---

## Recommended apply order (post-approval)

1. `DRAFT-audit-log-lockdown` → `supabase/migrations/077_…` (lowest risk; single writer).
2. `DRAFT-ai-governance-rls` → `supabase/migrations/078_…`.
3. On a live instance, first run `get_advisors` (security) to confirm the RLS gap is
   flagged, apply, then re-run to confirm it clears. Smoke-test the kill switch
   (`/super/ai/policies`) and the per-agent toggle (`/app/ai` → agent) still work
   (they use the service role, so they should be unaffected).
