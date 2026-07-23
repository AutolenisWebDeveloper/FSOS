# ADR-013 — Canonical `comm_*` Communications Data Model (reconcile the 006 duplication)

**Status:** Accepted
**Date:** 2026-07-23
**Owner:** FSOS Engineering
**Related:** ADR-001 (aggregate root), ADR-003 (single dispatcher), ADR-010 (ownership & RLS); CLAUDE.md §6, §10; master build instruction §0

## Context

FSOS carries **two parallel drip/campaign engines** that were built at different times against different spines. This duplication is real, load-bearing today, and must be reconciled deliberately — not silently averaged away (CLAUDE.md §6: "never duplicate an existing subsystem"; §1 authority order).

**Engine A — legacy `campaigns` / `campaign_enrollments` (migration `006_campaigns.sql`).**
- `campaigns`: PK `campaign_id`; `steps jsonb` (inline `[{order, delay_days, subject, body}]`); `channel`, `status`, `created_by`.
- `campaign_enrollments`: PK `enrollment_id`; FK `campaign_id → campaigns`; **FK `customer_id → customers`** (the *legacy* customer table, migration 001); `current_step`, `next_send_at`.
- Self-contained: steps embedded as JSON, no template/sequence tables, no per-message event ledger.
- Migration `043_legacy_campaign_template_gate.sql` later bolted on `campaigns.template_id → comm_templates` **only** so its sends could satisfy gate step 4 (`approved_template`). It was retrofitted to pass the gate, never migrated onto the spine.
- **Actual callers (grep of `src/`):** only the legacy `/api/campaigns/route.ts`, `/api/campaigns/enroll/route.ts`, `/api/campaigns/run/route.ts`, plus the pure helper `src/lib/comms/campaign-run.ts` (`buildCampaignSend`, `fill`). Keyed to legacy `customers`.

**Engine B — `comm_*` family (migration `009_aggregate_root_core.sql`, extended by `012`, `013`, `033`, `035`).**
- `comm_campaigns` / `comm_campaign_enrollments`: enrollments key to **`households` / `household_members` / `agency_partnerships`** (the aggregate-root spine, ADR-001), FK to `comm_templates` / `comm_sequences`, full `comm_messages` + `comm_message_events` telemetry, A/B variants, drip cursor.
- Supporting tables: `comm_templates` (with the approval columns `submitted_at`, `approved_at`, `approved_by`, `archived_at`, `requires_optout` from `012`), `comm_sequences`, `comm_audiences`, `comm_conversations`, `comm_message_events`, `comm_hours_policy`.
- **Actual callers:** the live comms platform — `src/lib/comms/campaign.ts`, `src/jobs/handlers.ts` (the daily `campaign-dispatch` cron), the `/app/comms/*` UI, and `/api/comms/*`.
- The 009 migration deliberately named `comm_campaign_enrollments` to avoid colliding with the pre-existing `campaign_enrollments` (comments at 009:357–358, 420–421).

Both engines already route every send through the one dispatcher (`sendThroughGate` → `dispatch` → `evaluateGate`), so compliance is *not* the divergence risk. The divergence risk is **schema fragmentation**: two campaign models, two enrollment models, two spines (legacy `customers` vs. aggregate-root `households`), diverging over time.

**Relationship to `docs/legacy-mapping.md` (C1–C6).** legacy-mapping records two things that must be reconciled explicitly, not silently contradicted (authority order, CLAUDE.md §1). (a) Its C1/C6 decisions state that legacy tables "are kept in place and left untouched — nothing is renamed or dropped." (b) Its own legacy→aggregate-root **table mapping already names `comm_campaigns` / `comm_campaign_enrollments` as the aggregate-root equivalent** of legacy `campaigns` / `campaign_enrollments` ("New comms model routes every send through the 7-step dispatcher gate"). This ADR is consistent with (b) and **narrowly supersedes (a) for exactly two tables** — see the Decision.

## Decision

**The `comm_*` family is the single canonical communications data model.** All new communications work — campaigns, enrollments, templates, sequences, audiences, messages, conversations, events, hours — targets `comm_*` and the aggregate-root spine (`households` / `household_members` / `agency_partnerships` / `contacts`). No third family may be introduced (master build instruction §0: "do not add a third family").

**This ADR narrowly supersedes the C1/C6 "kept untouched, never dropped" stance for exactly two tables — `campaigns` and `campaign_enrollments` (migration 006) — and nothing else.** Every other legacy table named in `docs/legacy-mapping.md` (`customers`, `commission_cases`, `activity`, `consent_ledger`, `policies`, `scores`, `opra_cases`, …) remains governed by legacy-mapping and is untouched by this decision. The reason for the narrow exception: unlike those tables, the `006` campaign engine is a *second live implementation of a subsystem FSOS already has* (`comm_*`), which CLAUDE.md §6 forbids — and legacy-mapping itself already designates `comm_*` as its equivalent. `docs/legacy-mapping.md` is updated in the same change to note this supersession.

The legacy `006` engine (`campaigns`, `campaign_enrollments`) and its `/api/campaigns/*` routes are the **deprecation surface**, not a second sanctioned pattern:

1. **Freeze — do not extend.** No new columns, routes, UI, or callers are added to the `006` engine. New features build on `comm_*` only.
2. **Reconcile forward (later slice, additive).** Any active enrollments and campaign definitions still living in `006` are migrated into `comm_*`, re-keyed from legacy `customers` onto `household_members` via the existing legacy→spine provenance mapping (migrations `024_legacy_provenance` / `025_legacy_backfill`; `docs/legacy-mapping.md`). This is an additive, forward-only migration with a row-count + checksum reconciliation report (master build instruction §2.A) and a tested rollback.
3. **Retire the routes when drained.** Once no active enrollment references the `006` tables, `/api/campaigns/*` is redirected/removed and the `006` tables are retained as legacy provenance until a later, separately-reviewed schema-retirement migration drops them (never in the same change that removes the code — mirrors the GHL D3/D4 discipline in ADR-014).

**Ownership stays on the existing spine keys.** `comm_*` tables carry no per-row tenant column; scope is derived transitively through the `household_id` / `member_id` / `agency_id` FKs and enforced by the role-based RLS helpers (`has_role`, `current_user_agencies`, `current_user_household`) defined in `010_rls_guardrails.sql`. No parallel ownership column (e.g. `book_of_business_id`) is introduced (master build instruction §0).

## Rationale

- **One spine, one model.** The aggregate root is the Agency Partnership → Household spine (ADR-001). A campaign engine keyed to the legacy `customers` table cannot participate in that spine's ownership, RLS, or attribution. `comm_*` already does.
- **`comm_*` is the live engine.** It backs the cron, the UI, and `/api/comms/*`; the `006` engine survives only behind `/api/campaigns/*`. Reconciling toward the smaller, dead surface would be backwards.
- **Compliance is already unified.** Both engines send through the single dispatcher; consolidating the *data* model closes the remaining fragmentation without touching the enforced compliance path.
- **Deprecate-then-drain, never big-bang.** Retiring the `006` engine by migrating live enrollments (with reconciliation + rollback) preserves the zero-data-loss requirement (master build instruction §2.A).

## Alternatives Considered

- **Keep both engines indefinitely** — rejected: permanent schema fragmentation, two divergent spines, the exact risk §6 forbids.
- **Reconcile toward `006`** — rejected: `006` is keyed to the legacy `customers` table, is not spine-integrated, has no template/sequence/event tables, and is nearly dead (only `/api/campaigns/*`). Moving the live engine backwards onto it would be a large regression.
- **Immediately drop `006`** — rejected: it may hold active enrollments; dropping before draining violates zero-data-loss. Freeze → drain → retire is the safe order.

## Consequences

**Positive**
- A single communications data model on the aggregate-root spine; one place to evolve campaigns/templates/sequences.
- Consistent ownership, RLS, and attribution for all messaging.
- Clear, enforceable rule for reviewers: new comms code touches `comm_*`, never `006`.

**Negative / trade-offs**
- A forward migration of any live `006` enrollments is required before the tables can be retired (its own slice, reconciliation report + rollback).
- Until that migration lands, `/api/campaigns/*` and the `006` tables remain present (frozen) as a deprecation surface — reviewers must guard against new callers.

## Related Documents

- CLAUDE.md §1, §6, §10; master build instruction §0, §2.A, §5, §15
- `docs/legacy-mapping.md` (legacy `customers` → spine mapping; C1–C6 decisions)
- `docs/comms-ghl-migration/data-model-inventory.md` (full `comm_*` DDL + duplication facts)
- ADR-001 (aggregate root), ADR-003 (dispatcher), ADR-010 (ownership & RLS), ADR-014 (GHL decommission)
