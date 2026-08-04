# ADR-029 — Household materialization (contact → household spine)

**Status:** Accepted
**Date:** 2026-07-26
**Owner:** FSOS Engineering

## Context

`contacts.household_id` is nullable (`ON DELETE SET NULL`, migration 026) and the
contact import path never sets it or creates a `household_members` row. The native
campaign engine (`src/lib/comms/campaign.ts` → `resolveAudience`) enrolls on
`household_members.member_id`, filtering `households.deleted_at IS NULL` and
`do_not_contact = false`. Therefore **every imported contact is currently
unenrollable** — it floats with no household and no member row. Slice 1
(ADR-028) made this orphan count observable; this slice closes it.

The aggregate root is the Agency Partnership, and the household spine
(`households` → `household_members` → `household_policies`) is the client-side
entity the life campaigns (Cross-Sell, Life Conversion, Win-Back) target
(ADR-001). Agency owners and business contacts are the **B2B** side — they link to
`agency_partnerships` (via `dataQualityReconcile`), not to households. An existing
precedent materializes book-imported households keyed by `households.book_owner_key`
and dedupes members by `(household_id, full_name)` (`conversions/import`).

## Decision

1. **Materialize client-eligible orphan contacts into the household spine.** For
   each `contacts` row with `household_id IS NULL` whose `contact_type ∈ {client,
   prospect, cross_sell, term_conversion, unknown}`, ensure a household and a
   `household_members` row exist and set `contacts.household_id`. **Exclude
   `agency_owner` and `business`** — those belong to the agency/B2B side and are
   reconciled to `agency_partnerships`, not households. This keeps the bounded
   contexts intact (§6) while making every campaign-targetable contact enrollable.

2. **Grouping is deterministic via `households.origin_key`.** People who share a
   household — same normalized last name + street + zip — resolve to the **same**
   `origin_key` (`hh:{nameKey(last)}|{streetKey(street)}|{zipKey(zip)}`) and are
   grouped into one household with multiple members. A contact lacking a usable
   address falls back to a **single-member** household keyed `hh:solo:{contact_id}`.
   The key is a unique partial index, so re-runs (and the import path) **reuse** an
   existing household rather than spawning a parallel one.

3. **Idempotency, two anchors.** (a) The backfill only scans `household_id IS NULL`,
   so a linked contact is never reprocessed. (b) `household_members.source_contact_id`
   (unique, nullable FK → contacts) is the contact↔member link: materialization is a
   no-op if a member already exists for the contact. Re-running the backfill, or
   importing the same file twice, creates **no** duplicate household or member.

4. **Go-forward on every write path.** The bulk importer, the **Life Win-Back importer**
   (`/api/app/winback/import`), the manual single-create route, and the daily
   `data-quality` job all call the same `materializeContact` / `backfillOrphanHouseholds`
   service — one materialization code path, reused, never cloned. New eligible contacts
   are materialized into the spine at creation time; the daily job drains any stragglers
   in bounded batches. (The Win-Back importer originally skipped this step, leaving the
   whole `winback_life` book orphaned and unreachable by the Life Win-Back agent (ADR-034)
   and the consent-group backfill; it was wired in and the existing cohort repaired by
   migration `097_winback_life_household_reachability.sql`.)

5. **Safe fallback, no forced grouping.** When signals are weak (no address), the
   single-member household is the safe default — never a bad merge into an unrelated
   family. Materialization is best-effort per contact: a failure on one contact is
   logged and skipped, never failing the whole import or corrupting the spine.

## Rationale

Optimizes for the enrollment unlock without a parallel household model: it reuses the
existing spine, the existing member-dedupe convention, and the existing job
infrastructure. The deterministic `origin_key` makes grouping reproducible and
idempotent across the three write paths and repeated runs. Excluding B2B types
preserves the aggregate-root boundary rather than blurring agency owners into
households.

## Alternatives Considered

- **Materialize every contact into a household, including agency owners.** Rejected —
  puts B2B entities in a client-side structure, violating ADR-001's bounded contexts.
- **Dedupe members only by `(household_id, full_name)` (no `source_contact_id`).**
  Kept as a secondary guard, but a stable contact↔member FK is needed for Slice 5 to
  enroll a *contact* segment through the member-keyed engine without a fragile
  name-join.
- **One-shot SQL backfill migration.** Rejected — not resumable, no per-contact audit,
  and it would run the grouping logic in SQL instead of the tested TS engine. The
  bounded job drains safely and is observable.

## Consequences

**Positive**
- Zero enrollment-blocking orphans among client-eligible contacts; imported contacts
  become reachable by the native campaigns.
- One idempotent materialization path shared by import, manual create, and cron.
- Grouping is deterministic, reproducible, and dedupe-safe across re-runs.
- `source_contact_id` gives Slice 5 a clean contact→member enrollment mapping.

**Negative / trade-offs**
- Two new nullable columns + two partial unique indexes on the spine (forward-only,
  additive, no data rewrite).
- Address-based grouping is heuristic: unrelated people at the same address with the
  same last name would group (rare; the safe direction is grouping over splitting, and
  a household can be split manually). People at the same address with *different* last
  names stay in separate single-member households (conservative).
- Backfill is eventual for very large books (bounded per run), consistent with the
  existing reconcile pass.

## Related Documents
- CLAUDE.md §6 (architecture preservation), §10 (aggregate root + build order), §11 (durable jobs)
- docs/adr/ADR-001-aggregate-root.md, docs/adr/ADR-010-data-ownership-and-rls.md, docs/adr/ADR-028-contact-consolidation-dedup.md
- supabase/migrations/026_contacts.sql, 009_aggregate_root_core.sql, 071_household_materialization.sql
- src/lib/services/householdMaterialize.ts, src/jobs/handlers.ts (data-quality job)
- Forward: ADR for contact segmentation (Slice 5) — enrolls via `source_contact_id`
