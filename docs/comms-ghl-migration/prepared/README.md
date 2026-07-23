# Prepared (non-executing) SQL — GHL schema retirement (ADR-014 D4)

> **These files are NOT migrations.** They live under `docs/` on purpose — they are **prepared
> artifacts**, not part of the migration chain, and **will not run** in CI, `scripts/migrate.mjs`,
> or any Supabase replay. They are staged here so the D4 SQL is version-controlled and reviewable
> before it is ever executed.

## Files

| File | Purpose |
|---|---|
| `049_ghl_schema_retirement.sql` | Forward: drop GHL indexes, export-then-drop the two upload tables, KEEP + `COMMENT` provenance columns. |
| `049_ghl_schema_retirement_rollback.sql` | Reverse: recreate the tables/indexes and clear the comments (data restored separately from backup). |

## How to execute (only at D4, only after preconditions)

1. **Do not apply until every ADR-014 D4 precondition is met** — D0 opt-out migration signed off,
   the two upload tables exported, a full backup verified, and the rollback tested on a scratch DB.
2. **PRECONDITION 0 — live-schema drift check (run first).** Confirm production's GHL schema still
   matches what `002/003/004/023` defined before you drop anything. If the drift check fails
   (an index/table/column is missing or differs), **stop** — the migration history no longer
   matches production and must be reconciled first. Query is embedded at the top of
   `049_ghl_schema_retirement.sql`.
3. **Renumber at execution.** The file is staged as `049` against the migration set at authoring
   time (highest was `048_appointment_lifecycle`). Before promoting it into `supabase/migrations/`,
   **rename it to the next free number** at that moment (check `ls supabase/migrations/`), since
   later slices (D1, appointments, etc.) may have added migrations past `048`. The number must be
   the true next-in-sequence — never reuse or backfill a number.
4. Move (do not copy) the renumbered forward file into `supabase/migrations/`, apply via the normal
   path, and keep the rollback file with the PR for the tested-rollback evidence.

## Why staged, not live

Per ADR-014, migration files are never edited/replaced and destructive schema change is deferred
until its preconditions are met. Dropping this into `supabase/migrations/` now would (a) make it
part of the live chain before D0/D3 are done, and (b) risk running before the upload tables are
exported. Staging under `docs/` keeps it reviewable without any of that risk.
