# ADR-028 — Contact consolidation, dedup strategy & staging reconciliation

**Status:** Accepted
**Date:** 2026-07-26
**Owner:** FSOS Engineering

## Context

FSOS must turn a scattered contact set (already in FSOS, in CSV/spreadsheets, in the
frozen GoHighLevel account, and elsewhere) into one clean, deduplicated,
household-connected, segmentable system of record — the foundation the life campaigns
enroll from. A build brief proposed constructing a fresh staging area, a dedup engine,
and enforced-unique dedup keys.

Reconciling that brief against the live repository (CLAUDE.md §20 requires this; §6
forbids duplicating an existing subsystem) shows most of that machinery already exists
and is well-designed:

- **Staging + audit + review queue** — `import_batches` / `import_records`
  (migration 031) already land every imported record with its raw payload, the
  resolution decision (confidence, matched-by, candidate ids, conflict flag), the
  merged fields, the rejected values, and a `review_status` (`auto` / `needs_review` /
  `resolved` / `skipped`). This *is* the staging area the brief asks for.
- **Dedup engine** — `src/lib/import/resolution.ts` is a pure, unit-tested
  entity-resolution engine: strongest-first match keys (provenance → email → phone →
  policy → name+dob → name+address → name+zip → name), confidence tiers
  (`exact`/`high`/`medium`/`low`/`none`), a no-overwrite merge that unions sets and
  records rejected values, and — critically — a **conflicting-identity block**: when
  strong identifiers disagree on which existing contact they point to, it never
  auto-merges; it routes to review (`resolution.ts` conflict branch). Every importer
  and the Data Quality reconcile pass share it.
- **Dedup keys** — `contacts.email_lc` and `contacts.phone_digits` are app-maintained
  and **intentionally non-unique** (migration 026 comment: "duplicates are DETECTED
  and surfaced, not hard-blocked"), surfaced through `v_contact_duplicates`.

The genuine gaps are downstream: imported contacts are created with `household_id`
NULL and no `household_members` row, so they are **unenrollable** by the native
campaign engine (which enrolls on `household_members.member_id`); there is no
contacts-based segment layer; and there is no single surface that reports the
consolidation state (how many contacts, how many orphaned, per source).

## Decision

1. **Do not build a parallel staging table or a second dedup engine.** Reuse
   `import_batches`/`import_records` as the staging + audit substrate and
   `src/lib/import/resolution.ts` as the single dedup engine. New consolidation work
   extends these.

2. **Keep dedup keys detect-only — no unique constraint on `email_lc` /
   `phone_digits`.** A household model deliberately contains people who share an
   email and/or a phone: married couples routinely share both, and that is *correct*
   data, not a duplicate. A unique index (especially one keyed on email alone) would
   reject legitimate household members. Idempotency is guaranteed by the resolution
   engine (a re-imported row matches its existing contact on email/phone/provenance
   and merges in place rather than creating a second row), and is **proven by a
   regression test**, not by a database constraint.

3. **Consolidation is observable.** A read-only, `security_invoker` reporting surface
   (`v_contact_consolidation`, `v_contact_by_source`) exposes the current-state
   numbers — total, orphaned (`household_id IS NULL`, i.e. enrollment-blocked),
   linked, per-source counts, contact-type coverage, and duplicate-group count — so
   the book's health (and the orphan problem Slice 3 fixes) is visible in the product,
   not just in ad-hoc SQL.

4. **Ordering.** A clean, deduplicated book (this ADR) precedes household
   materialization (a separate ADR for Slice 3) which precedes the segmentation layer
   (a separate ADR for Slice 5). A narrower dedup constraint, if ever warranted, is
   reconsidered only *after* households connect and the dedup engine has run — and
   never one keyed on email alone.

## Rationale

Optimizes for architecture preservation (§6): one dedup engine, one staging substrate,
one audit trail. It honors a deliberate prior design decision (detect-don't-block)
rather than silently reversing it, and it makes correctness (idempotency) a tested
property of pure logic — reproducible in CI without a live database — instead of a
constraint that would misclassify valid household data as duplicate.

## Alternatives Considered

- **Build a new `contact_import_staging` table.** Rejected — duplicates
  `import_records`, fragmenting the audit trail (§6).
- **Enforce unique `email_lc` / `phone_digits`.** Rejected — breaks shared-contact
  households, reverses migration 026's deliberate call, and would require data cleanup
  before it could even be applied. Idempotency does not require it.
- **Enforce unique on a composite (email + name + household).** Deferred — cannot be
  keyed correctly until households connect (Slice 3); revisited then if a real
  duplicate-creation path is found that the engine does not already close.

## Consequences

**Positive**
- No new subsystem; the existing staging/dedup/audit stack is the system of record.
- Shared-email / shared-phone household members are preserved as valid data.
- Re-import idempotency is a proven, CI-runnable property (`tests/contact-consolidation.test.mjs`).
- Book health — especially the enrollment-blocking orphan count — is visible in-product.

**Negative / trade-offs**
- Idempotency depends on the resolution engine being invoked on every write path
  (enforced by test + by routing all imports through it), not on a DB guarantee. Any
  new write path that bypasses the engine must add its own idempotency coverage.
- The consolidation views are aggregate reads; on a very large book they scan
  `contacts` — acceptable for an operational dashboard tile, and bounded by the
  partial indexes already on `email_lc` / `phone_digits` / `household_id`.

## Related Documents
- CLAUDE.md §4.3 (no invented data), §6 (architecture preservation), §10 (aggregate root), §20 (reconcile the audit note)
- docs/adr/ADR-001-aggregate-root.md, docs/adr/ADR-010-data-ownership-and-rls.md
- supabase/migrations/026_contacts.sql, supabase/migrations/031_import_audit_review.sql
- src/lib/import/resolution.ts, src/lib/services/contactConsolidation.ts
- Forward: ADR for household materialization (Slice 3), ADR for contact segmentation (Slice 5)
