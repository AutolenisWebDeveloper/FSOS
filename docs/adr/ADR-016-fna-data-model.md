# ADR-016 — FNA Data Model (structured, versioned, immutable, auditable)

**Status:** Accepted
**Date:** 2026-07-23
**Owner:** FSOS Engineering

## Context
Slice 1 (ADR-015) delivered a pure, deterministic calculation engine but nothing
persists an FNA: there is no structured data model, no captured inputs, no stored
assumptions, no versioning, no scenarios, no reproducibility, no audit trail. The
only related tables are `reviews` / `review_types`. This ADR defines the additive
data model that lets an FNA be captured, calculated, versioned immutably,
scenario-tested, and reproduced — attached to the aggregate root at the household.

Forces:
- **Reproducibility** (ADR-015) — a stored result must be recomputable identically,
  so each version pins the exact inputs snapshot + assumption-set version + engine
  version + per-formula result envelopes.
- **Immutability & audit** (build instruction §4, §9) — regenerating creates a new
  version; nothing overwrites history; an APPROVED version never mutates.
- **Aggregate root** (`CLAUDE.md` §10, ADR-001) — FNA attaches to `households` /
  `household_members`; no parallel ownership columns.
- **One engine, many plan types** — the same tables serve every plan type;
  adding a type is configuration, not schema.
- **Securities firewall** (§4.1) — aggregate/permitted balances only; never
  securities account numbers / holdings / suitability determinations.
- **Graceful degradation** (§0.B) — inputs carry provenance/quality metadata and
  multiple values per fact are allowed so conflicts are *detected*, not silently
  resolved; missing data is a warning, not a blocker.
- **Don't fragment** (§6) — reuse `reviews`, `households`, the app-level append-only
  `audit_log` (`writeAudit`), the shared `update_updated_at()` trigger, and the
  `is_super()`/`has_role()` RLS helpers.

## Decision
Additive migration **051** (050 is the current head — the build instruction's
"start at 049" is stale) adds an `fna_*` table family. All money/rate values are
stored as `numeric`; the engine (ADR-015) remains the only place math runs.

Tables:
- **`fna_plans`** — the FNA record: `household_id` (FK, cascade), optional
  `review_id` (reuse `reviews`), `plan_type` (registry key — text, validated in
  app so new types need no migration), `status`, `title`, `current_version_id`,
  authorship, `deleted_at` (soft delete).
- **`fna_versions`** — an **immutable snapshot**: `plan_id`, `version_no`
  (unique per plan), `status`, `assumption_set` + `assumption_set_version`,
  `engine_version`, `inputs_snapshot`, `results` (rollup), optional `narrative`,
  approval fields, `superseded_by_version_id`. **A trigger forbids mutating any
  snapshot column and forbids deleting an APPROVED version** — content is frozen;
  only lifecycle transitions (status advance, supersede pointer, approval stamp)
  are allowed.
- **`fna_inputs`** — the live working set: `plan_id`, `section`, `key`,
  optional `member_id`, `value_numeric`/`value_text`, `unit`, and full provenance
  (`source_label` from the §1 vocabulary, `source_record`, `entered_by`,
  `verification_status`, `effective_date`, `freshness_at`, `confidence`,
  `client_confirmed`). **No uniqueness on (plan, section, key)** — multiple rows
  for one fact are the raw material for conflict detection.
- **`fna_assumption_sets`** — the versioned, editable store seeded from the
  engine's `DEFAULT_ASSUMPTIONS` (`default-v1`, global scope); supports
  household-scoped overrides. A version references a frozen snapshot of this.
- **`fna_results`** — per-formula `CalcResult` envelopes for a version, linked to
  `formula_id` + `formula_version` and optionally a `goal_id`. Immutable (child of
  a version).
- **`fna_scenarios`** — named what-ifs **branched from a frozen `base_version_id`**
  with `overrides` + computed `results`.
- **`fna_goals`** — first-class goals (`goal_type`, priority, target, funding,
  status, confidence, progress); analyses attach here rather than hardcoding
  retirement/education.
- **`fna_data_quality_exceptions`** — missing / stale / conflicting / unverified
  inputs with `severity` (error/warning/info).

Audit reuses the append-only `audit_log` via `writeAudit` (`entity = 'fna_plan'`
/ `'fna_version'`, action `entity.created` / `entity.updated` / `approval.decided`)
— no separate FNA audit table (§6).

**Status flow** (checked in app + enforced by allowed transitions in the service):
`DRAFT → IN_PROGRESS → CALCULATED → UNDER_REVIEW → APPROVED → SUPERSEDED → ARCHIVED`.
Only an **APPROVED** version may be presented to a client.

**RLS:** default-deny; back-office/licensed roles read/write, mirroring the
compliance module (mig 036) and household-adjacent internal tooling. No `client`
policy in this slice (the RLS proof asserts a client sees zero `fna_*` rows) — and
because reads go through `is_super()/has_role()` a future client-scoped read policy
(via `user_households`, like `hh_read`) can be added without reshaping the model.

**Existing save path preserved & extended** (§4): `/api/fna/save` keeps writing to
`documents` + `activities`; it *additionally* persists a structured plan + an
immutable version. The structured write is best-effort and never breaks the
existing document save; anything not back-fillable is documented.

## Rationale
Immutable versions + pinned assumption-set/engine versions + per-formula envelopes
make every stored figure reproducible and auditable. Allowing duplicate input rows
turns conflict handling into detection-and-surface rather than silent resolution.
Reusing `reviews`, `audit_log`, and the RLS helpers keeps one architecture.

## Alternatives Considered
- **Store everything as JSON on one row.** Rejected: not queryable, no immutability
  guarantees, no per-input provenance, no conflict detection.
- **Unique (plan, section, key) on inputs.** Rejected: silently collapses
  conflicting sources; the instruction requires conflicts be surfaced.
- **DB triggers writing a separate FNA audit table.** Rejected: fragments the
  audit trail; `audit_log` + `writeAudit` already is the one append-only path (§6).
- **Row-scoped client RLS now.** Deferred: client portal is out of scope this
  initiative; role-based back-office RLS does not preclude adding it later.

## Consequences
**Positive**
- Reproducible, immutable, auditable FNAs attached to the aggregate root.
- One model serves all plan types and every analysis (goal-attached).
- Existing document save keeps working; structured data added alongside.

**Negative / trade-offs**
- A sizeable additive migration (nine tables + RLS + triggers + indexes).
- Immutability triggers must be maintained as the version lifecycle evolves.
- Duplicate input rows push conflict resolution to the service/UI layer.

## Related Documents
- `CLAUDE.md` §4 (guardrails), §6 (architecture preservation), §10 (aggregate root), §13.6/§13.7 (data integrity/DB)
- ADR-001 (aggregate root), ADR-010 (data ownership & RLS), ADR-015 (calculation engine)
- Build instruction §4 (Slice 2), §0.B (validation severity)
- `docs/data-guardrails.md`, `docs/fna/current-state.md`
- Migration precedent: `supabase/migrations/036_compliance_intelligence.sql`
</content>
