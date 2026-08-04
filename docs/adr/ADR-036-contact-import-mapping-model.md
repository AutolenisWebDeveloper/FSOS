# ADR-036 — Contact Import: Field Recognition & Mapping Model

**Status:** Accepted
**Date:** 2026-08-04
**Owner:** FSOS Engineering

## Context

FSOS ingests contacts from five real Farmers **district exports** (Life Conversion —
Policy Detail / Convertible, District Life Conversion, District Win Back, District
Cross Sell) plus arbitrary operator CSV/Excel files. Before this change each district
file had its **own** importer: a dedicated route, a hard-coded header-alias
dictionary, and a bespoke "find the header row" heuristic
(`conversionList.ts`, `crossSellList.ts`, `winBackList.ts`, `inforceBook.ts`), while
the generic Contact Center importer used a separate exact-alias → AI → content
recognizer (`ghlContacts.ts`). None of them could:

- recognize *which* file was dropped and apply a known mapping automatically;
- split a **composite** column (e.g. `AOR with Series Code` → AOR code + series code);
- let an operator map an **unrecognized** header once and **remember** it;
- accept **operator-defined custom fields** without a schema migration.

The contact-import build spec v2.1 ("Field Recognition & Mapping Model") asks for a
single, self-learning mapper across all of these, explicitly with **no consent step
and no birthday/DOB gating** — DOB imports as a plain field.

The reconciliation constraint (CLAUDE.md §6, ADR-028) is that FSOS already has one
import staging/dedup/audit substrate (`import_batches`/`import_records`), one entity
resolution engine (`resolution.ts`), and one household materializer
(`householdMaterialize.ts`). A new mapper must **extend** these, not fork them.

## Decision

1. **A pure, deterministic mapping-model library** (`src/lib/import/mapping/`) is the
   single recognizer: a target-field **catalog** spanning household/member/policy/
   agency (`fields.ts`), an **auto-recognition dictionary** with exact-then-fuzzy
   matching (`dictionary.ts`), **composite split** rules (`composite.ts`),
   **template detection by header signature** for the five district files plus a
   stable generic `signatureHash` (`templates.ts`), and a **plan builder**
   (`plan.ts`) that resolves each header in precedence order: saved template →
   per-header memory → composite → dictionary/fuzzy → unrecognized. No I/O, no clock,
   no randomness — fully unit-testable.

2. **Mapping memory is persisted** (migration 096): `import_templates`
   (header signature → confirmed header_map, auto-loaded next time),
   `import_header_memory` (every confirmed per-header decision, global across files),
   and `custom_fields` (operator-defined fields; values land in the entity's `custom`
   jsonb — no per-field schema change). `contacts` gains a `custom` jsonb and a
   **plain `dob date`** column (no gating, no encryption — consistent with the
   owner's plain `customers.dob` decision, mig 044).

3. **The commit path is the existing one.** A confirmed mapping is translated
   (`commit.ts`) into the legacy row mapper's inputs plus "extras" (address block,
   plain DOB, custom values, LOB tags, composite splits, joint owner) and flows
   through the **same** `resolution.ts` → `householdMaterialize.ts` →
   `import_batches`/`import_records` pipeline in `/api/app/contacts/import`. The route
   gained an optional `mapping` payload; absent it, behavior is unchanged.

4. **No new commit subsystem, no consent/DOB friction.** A dry-run
   `/api/app/imports/analyze` returns the plan for review; commit remembers the
   template + per-header decisions + custom fields. Owner + joint owner on one row
   seed two contacts sharing a household (via the materializer's origin key).

## Rationale

Optimizes for **one recognizer, one commit pipeline, one audit substrate** — the
opposite of the five-parallel-importers status quo — while making the recognizer
*learn* so the second file of any shape needs zero operator effort. Keeping the model
pure makes the five district signatures, the composite split, and the memory
precedence provable in fast unit tests, and keeps the regulated commit path
(resolution, RLS, audit, materialization) untouched and already-tested.

## Alternatives Considered

- **Extend each district importer in place.** Rejected: entrenches five parallel
  recognizers and can never recognize an unknown file or remember a custom mapping.
- **A brand-new unified commit endpoint.** Rejected (§6): would duplicate the
  resolution/materialize/audit backend. We reuse `/api/app/contacts/import`.
- **Add a column per custom field.** Rejected (§4.3 / migration-safety): unbounded
  schema churn. Custom values live in a `custom` jsonb behind a `custom_fields`
  registry.
- **Encrypt/ gate DOB.** Rejected per spec + the owner's plain-DOB decision (mig 044).

## Consequences

**Positive**
- All five district exports auto-detect and map with one click; unknown files map
  once and are remembered.
- Composite `AOR with Series Code` splits automatically; DOB imports plainly.
- Custom fields require no migration; the mapping is auditable and idempotent
  (rollback via the existing `import_batches` token flow).

**Negative / trade-offs**
- The default composite delimiter is a labeled **config assumption** (§4.3); an odd
  AOR/series format may need a one-time operator correction (then remembered).
- The generic contact commit stores policy/agency/joint fields it recognizes into
  `contacts.custom`; first-class **policy-entity** creation and full owner+joint
  *two-member* materialization beyond the shared-household seed remain with the
  dedicated conversion/book importers (follow-up to route them through this mapper).
- Per-header "remember" is a single batch-level toggle for template save; individual
  decisions are always remembered (a deliberate simplification of the spec's
  per-row toggle).

## Related Documents
- CLAUDE.md (§4.3 no-invented-data, §6 architecture preservation, §10 data model)
- ADR-028 (import consolidation/dedup substrate this extends)
- docs/specs/contact-import-mapping-model.md (spec v2.1)
- Migration `096_contact_import_mapping_model.sql`
- `src/lib/import/mapping/*`, `src/app/api/app/imports/analyze/route.ts`,
  `src/app/api/app/contacts/import/route.ts`, `src/components/app/ContactImportMapper.tsx`
