# ADR-039 — Production migration control: gated pipeline, drift detection, and no out-of-band DDL

- **Status:** Proposed. Enforcement layer **3a is implemented** (deny Supabase write/DDL MCP tools in a session — see PR "chore(security): deny Supabase write/DDL MCP tools in a session"). Layers 1, 2, 3b, 3c are proposed and will be adopted as their own reviewed steps.
- **Date:** 2026-08-17
- **Owner decision required** to proceed with each subsequent layer.

## Context

Production schema changes have repeatedly been applied **outside any reviewed pipeline**, and this caused real drift and a real security exposure:

- **119** (null-host double-book guard) was hand-applied to prod before it was even in a session's view.
- **091** (host overlap-booking guard) was **missing** from prod for an unknown period — the repo had it, prod didn't — and was then applied mid-session from chat.
- **120** (drop of an errant RLS policy) was applied manually.
- **`public_form_token_read`** — an over-permissive RLS policy granting `anon` SELECT on `form_submissions` (PII: a DOB, IP, customer link, form tokens) — was **hand-added directly to prod and never existed in any migration**. It was found only by a read-only drift audit and removed by migration 120.

Root causes:

1. **No `schema_migrations` ledger in prod.** `scripts/migrate.mjs` already creates and reads this ledger and applies only unrecorded files, but prod was never bootstrapped into it and `npm run migrate` is not part of any deploy. So there is no record of what is applied and no idempotent apply path.
2. **DDL can be applied from too many places** — the Supabase dashboard SQL editor, a manual `psql`, and (critically) an **agent session** via the Supabase MCP (`apply_migration` / write `execute_sql`). A verbal "please apply only through the pipeline" is not a control.

### Reconcile — how far has prod actually drifted? (read-only, 2026-08-17)

A full repo-vs-live comparison (tables, named constraints, indexes, RLS enablement + policies, functions, triggers, and all 158 migration-added columns) found prod matches the repo's **cumulative** migration state **exactly**, with these exceptions:

- **Genuinely missing (repo has, prod lacks):** exactly **two** trivial performance indexes from `001_initial_schema` — `idx_form_submissions_pending` (on `form_submissions`) and `idx_opra_uncontacted` (on `opra_cases`). Both are low-impact perf indexes on legacy/low-volume tables.
- **Prod-only extra (drift IN):** `public_form_token_read` on `form_submissions` — **already removed** by migration 120.
- **Correctly absent (NOT drift):** `customers.dob_enc` + `customer_dob_get` / `customer_dob_set` — added by 042, **intentionally dropped by 044** ("revert DOB encryption, owner decision"). Prod correctly reflects the net post-044 state.
- **0** missing tables, **0** missing named constraints, **0** missing triggers, **0** genuinely missing functions, **0** genuinely missing columns.

**Conclusion:** the drift is tiny (2 trivial indexes) — but the *mechanism* that allowed a hand-added anon-PII-read policy to sit undetected is the real risk. This ADR fixes the mechanism.

## Decision

Adopt a layered control so that **production schema changes flow only through applied, CI-gated migrations**, and no DDL can be applied out of band. Each layer is its own reviewed step.

### Layer 1 — `schema_migrations` ledger + idempotent, recorded `npm run migrate` (the sanctioned path)
1. **Reconcile (read-only)** — done (above): the definitive applied-vs-repo list.
2. **Bootstrap the ledger once** — `create table schema_migrations (...)`, then INSERT one row per migration filename whose net effect is already present in prod (mark-as-applied; do **not** re-run DDL). This one-time bootstrap is the single deliberate manual prod step — performed by the owner (or via an explicit standalone "apply" instruction), logged.
3. **Wire into deploy** — a CI job on merge-to-`main` runs `DATABASE_URL=<prod> npm run migrate`: idempotent (skips recorded files), per-file transactional, fails the deploy loudly on error. The prod migrator credential lives **only** in the CI secret store.
4. **From then on** — every schema change is a migration file in a PR → merge → CI applies + records it. No hand-writes.

The **two trivial indexes** are applied as the *first* migration through this new pipeline — a clean end-to-end test of the pipeline itself. (They are NOT hand-applied.)

### Layer 2 — CI schema-diff gate (the auditor; two-directional)
On every PR / nightly: spin ephemeral Postgres, apply **all** repo migrations (reuse the RLS test harness that already does this), `pg_dump --schema-only` + dump policies/RLS, read-only dump prod's schema, normalize, and **fail on any diff**. This catches prod-only objects like `public_form_token_read` that Layer 1 alone would not (the ledger tracks forward application, not hand-added extras). Layer 1 guarantees repo→prod; Layer 2 guarantees prod contains nothing but what the repo put there.

### Layer 3 — Enforcement (make out-of-band DDL impossible)

**3a — Agent/session DB access denies write/DDL (IMPLEMENTED).** `permissions.deny` in project `.claude/settings.json` blocks the Supabase MCP tools that mutate schema/project/branch state (`apply_migration`, `deploy_edge_function`, `create/delete/merge/reset/rebase_branch`, `create/pause/restore_project`, `confirm_cost`). Read tools + `execute_sql` remain for read-only inspection.
- **Known gap:** `execute_sql` is dual-use and kept for reads, so it is still technically DDL-capable. The complete physical lock requires **scoping the Supabase connector/credential to a read-only DB role** (owner-side), or denying `execute_sql` once ad-hoc read SQL isn't needed.

**3b — App runtime role is DML-only, never DDL.** Verify the app's `service_role`/service key lacks `CREATE/ALTER/DROP` on the schema and is not the schema owner; revoke if present. A leaked service key or app bug then can't alter schema.

**3c — In-DB DDL guard (defense against dashboard/ad-hoc DDL).** An event trigger that rejects DDL unless a migration-context GUC is set:
```sql
create function guard_ddl() returns event_trigger language plpgsql as $$
begin
  if coalesce(current_setting('app.migration', true),'') <> 'on' then
    raise exception 'DDL blocked: schema changes must run through the migration pipeline';
  end if;
end $$;
create event trigger block_adhoc_ddl on ddl_command_start execute function guard_ddl();
```
Only the CI runner sets `set app.migration='on'`; everything else's DDL is rejected — dashboard, MCP, ad-hoc `psql` alike. (This ships as a migration through the pipeline.) Requires a short spike to confirm this project's `postgres` role can install the trigger and cannot trivially bypass it.

## Consequences

- **Residual risk (stated plainly):** on Supabase-hosted you cannot 100% stop a human with project-owner/dashboard access from running DDL — `supabase_admin` can drop the event trigger and break glass. What this design achieves: agent sessions can't DDL (3a), app runtime can't (3b), accidental/ad-hoc DDL is rejected (3c), and any drift is caught (Layer 2). "Apply to prod" becomes a deliberate, reviewed, logged pipeline step, with break-glass as a rare, visible exception.
- **Operational cost:** one CI job for apply (Layer 1) and one for the diff gate (Layer 2); a one-time ledger bootstrap; a read-only connector role for sessions.

## Rollout order (recommended)

1. **3a** — implemented (PR #298). Closes the session-DDL hole immediately (config, no code).
2. **Read-only connector role** for agent sessions (completes 3a's `execute_sql` gap) — owner-side.
3. **Layer 1** — ledger bootstrap + `npm run migrate` in CI. Owner performs the one-time bootstrap (or sends a standalone "apply").
4. **3b** — tighten the app role to DML-only.
5. **Layer 2** — CI schema-diff gate (reuse the ephemeral-PG harness).
6. **3c** — event-trigger DDL guard, after the spike.

## Hard rule (in force now)

Until the pipeline exists: **zero prod DDL from a session** — safe, urgent, or "obviously right" — without the owner applying it or sending a standalone "apply X" message of its own. Urgent items are surfaced and wait. Read-only inspection is always fine.
