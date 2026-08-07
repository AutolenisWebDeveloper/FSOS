# ADR-037 — Communication Template Version History (Database-Enforced Copy Retention)

**Status:** Accepted
**Date:** 2026-08-07
**Owner:** FSOS Engineering

## Context

`comm_templates` is the single store for every approved outbound asset — campaign emails, SMS
bodies, and AI conversation openings. It carries a `version` integer and an `approval_status`,
and every write path bumps the version and resets approval to `draft` when the copy changes, so
an edited-after-approval template cannot dispatch until it is re-approved (`sendThroughGate()`
refuses an unapproved template).

What the schema never had is the **prior copy**. The body was overwritten in place and lost. The
PATCH handler said so in a comment: *"old body retained in a prior version row is out of scope
for P1."* A bare version counter records that copy changed, not what it said.

That is a retention gap with regulatory weight. The practice sends licensed, compliance-reviewed
insurance marketing under TCPA/CAN-SPAM/A2P and FINRA Reg BI supervision. When the question is
"what did the message that went out in March actually say, and had it been approved?", the answer
has to come from the system of record. Migrations 099/100/101 made this concrete: they replaced
all 66 lifecycle bodies in place, and the only surviving copy of the superseded text is the text
of the earlier migrations in version control.

Six distinct paths update `comm_templates`:

1. `PATCH /api/comms/templates/[id]` — the editor
2. the submit transition in the same route
3. the approve/reject transition in the same route
4. `PATCH /api/comms/templates/bulk`
5. `scripts/build-email-templates.ts` and `scripts/build-sms-templates.ts`
6. copy migrations themselves (099/100/101, and their successors)

## Decision

Add an append-only `comm_template_versions` table, written **by a database trigger** on
`comm_templates`, not by application code (migration 105).

- `trg_comm_templates_snapshot` fires `after update ... for each row when (old.body is distinct
  from new.body or old.body_text is distinct from new.body_text)` and inserts the **OLD** row.
- The snapshot captures `body`, `body_text` and `render_sha` together, because ADR-025 makes all
  three one approved, immutable artifact.
- The function is `SECURITY DEFINER` with a pinned `search_path`: the app roles hold no INSERT on
  the history table, so an invoker-rights trigger could not write the snapshot it exists to take.
- The table is append-only and tamper-evident on the `audit_log` pattern **as it stands after
  migration 077**: UPDATE and DELETE are revoked from the app roles and blocked by
  `trg_ctv_no_mutate`, and TRUNCATE — which those revokes miss and row-level triggers never see —
  is revoked from `public` and blocked by the statement-level `trg_ctv_no_truncate`. Migration 077
  exists because `audit_log` shipped without that third guard; the hole is closed here at birth.
- `superseded_by` records an actor only when the UPDATE actually asserted one
  (`nullif(new.updated_by, old.updated_by)`). `updated_by` is a persisted column, so a bare
  `new.updated_by` would carry the last setter's name into writes that never touched it, and
  `current_user` inside a `SECURITY DEFINER` body resolves to the function owner rather than the
  updater. Both are confident lies in a column that exists to answer "who".
- The FK is `on delete restrict`, so deleting a template is not a route to erasing the record of
  what it used to say. Nothing in the app hard-deletes a template (the UI archives via
  `archived_at`), so this restricts nothing that currently happens.
- RLS follows the migration-083 internal-ops convention: read for fsa / licensed_staff / ops /
  admin / compliance / supervisor / super. Never client or agency_owner.

Approval-state transitions that do **not** change copy write no snapshot. Those already go to
`audit_log` via `writeAudit('approval.decided')`. This table answers *what the copy said*;
`audit_log` answers *who changed its state, and when*.

## Rationale

**Why the database, not a service hook.** A service-layer hook would have to be added in six
places and would still miss raw SQL and every future migration. Retention evidence that a caller
can bypass is not evidence. CLAUDE.md §13.6 calls for layered enforcement at the store, and this
is the case that most needs it: the writers that matter most (the copy migrations) are precisely
the ones that never touch application code.

**Why snapshot the OLD row.** The PATCH path bumps the version and resets approval in one UPDATE.
Capturing OLD therefore records exactly the fact needed — "this body, at this version, stood in
this approval state until `superseded_at`" — with no reconstruction required.

**Why no `unique (template_id, version)`.** A caller that changes a body twice without bumping the
version is a caller bug, but a unique constraint would turn this trigger into a denial of service
on template editing, and `on conflict do nothing` would silently drop evidence. An append-only log
accepts both rows and lets `superseded_at` distinguish them — the honest failure mode of the three.
Idempotency comes from the trigger's `WHEN` clause instead: re-running a copy migration changes no
body, so it fires nothing.

## Alternatives Considered

- **Service-layer snapshot in each write path.** Rejected: six call sites, bypassable by SQL and
  migrations, and silently incomplete the moment a seventh path is added.
- **Reconstruct history from `audit_log`.** Rejected: the audit diff records that a version changed,
  not the superseded body. Widening audit rows to carry full bodies would bloat the log and blur
  two bounded contexts (§6).
- **Snapshot on every UPDATE, including approval transitions.** Rejected: duplicates what
  `writeAudit('approval.decided')` already records, forking a second audit subsystem.
- **A generic temporal/history extension over all tables.** Rejected as disproportionate: one table
  has this requirement, and a repo-wide mechanism would be a new architecture to maintain.
- **Backfilling the pre-105 bodies from migrations 082/084/086.** Rejected: the one field this table
  exists to establish — *when* a body was superseded — is unknowable after the fact, and seeding a
  compliance evidence table with an invented timestamp is worse than an honest gap (§4.3). The v1
  copy remains authoritative and available in those immutable migrations.

## Consequences

**Positive**
- "Which copy was approved and in force at time T?" becomes answerable from the database.
- Coverage is complete by construction — every present and future write path is captured, including
  migrations, with no discipline required of the caller.
- Tamper-evident: history cannot be rewritten or deleted, even by the table owner.
- No application code changed to gain the guarantee; the PATCH handler is untouched behaviourally.

**Negative / trade-offs**
- History begins at migration 105. Bodies superseded by 099/100/101 are not in the table; they
  remain recoverable only from migrations 082/084/086 in version control.
- `on delete restrict` means a template with history cannot be hard-deleted without an explicit
  decision to remove its evidence first. This is deliberate friction.
- Attribution has a known false negative: the same actor editing twice consecutively leaves the
  second snapshot's `superseded_by` NULL, because the write asserted no *change* of actor. Erring
  toward absent is deliberate — `audit_log` records every edit with its actor and timestamp, so a
  missing name is recoverable while a wrong one is not.
- The table grows without bound. Copy changes are rare and human-driven (tens per year), so no
  retention/pruning policy is defined yet; if that changes, pruning must be a deliberate,
  documented retention decision rather than an ad-hoc cleanup.
- No UI surfaces the history yet. It is queryable by internal roles; a diff view is future work.

## Related Documents
- `CLAUDE.md` §4 (guardrails), §6 (architecture preservation), §13.6/§13.7/§13.9 (data integrity,
  database, auditability), §13.14 (documentation)
- `docs/adr/ADR-025-email-rendering.md` — why `body_text` + `render_sha` are part of the artifact
- `docs/adr/ADR-031-pipeline-winback-campaign.md`, `ADR-032-cross-sell-life-campaign.md` — the
  campaigns whose copy this protects
- `supabase/migrations/105_comm_template_version_history.sql`
- `supabase/migrations/010_rls_guardrails.sql` — the append-only `audit_log` pattern mirrored here
- `tests/comm-template-version-history.test.mjs` — the proof (RLS set)
