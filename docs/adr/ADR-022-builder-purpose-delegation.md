# ADR-022 — Campaign + Sequence Builder Config: Message Purpose & Delegated-Sender

**Status:** Accepted
**Date:** 2026-07-24
**Owner:** FSOS Engineering
**Related:** ADR-013 (canonical `comm_*`), ADR-015 (delegation / actual-sender vs represented-party), ADR-017 (purpose / frequency / collision), ADR-021 (simulation); CLAUDE.md §12; master build instruction §15–§16.

## Context

Slices 1–6 built the gate dimensions — delegated on-behalf-of authority (§7), purpose-scoped consent + frequency caps + priority collision (§9/§10), data confidence (§13) — and the send path (`send.ts` `SendContext`) already accepts `purpose`, `delegation`, `ownership`, and `dataConfidence`. But the **campaign + sequence builder never stored that config**, so campaigns dispatched with no purpose and no delegated-sender, and ADR-021 recorded the gap explicitly: *"the campaign model carries no purpose/delegation/data-confidence config (those are Slice 7 builder fields), so the simulation currently exercises consent/quiet-hours/DNC/template/securities; the richer dimensions light up once the builder adds them."*

Slice 7 (§15–§16) closes that gap for **purpose** and **delegated-sender**. (Data-confidence claim declaration is deferred to Slice 8, where the claim-bearing campaign-library templates live — as the §13 slice doc itself noted.)

## Decision

**Store the gate config on the builder rows; pass it through dispatch + simulation via the existing `SendContext` — no new engine, no send-path change.**

1. **Schema (migration 058, additive).** `comm_campaigns` gains `purpose` (checked against the `MessagePurpose` vocabulary; NULL allowed), `represented_agency_owner_id` (→ `agency_owners`), `delegation_id` (→ `agency_communication_delegations`). `comm_sequences` gains `purpose`. All nullable → existing rows dispatch unchanged.

2. **Pure core `campaign-config.ts`.** `campaignSendConfig(row)` maps a stored row → `{ purpose?, delegated, delegationId?, representedAgencyOwnerId? }` (an invalid/absent purpose is dropped; a half-configured delegation is NOT treated as delegated). `validateDelegatedConfig()` enforces the two delegated fields are set together. `delegationSendContext(resolved)` assembles the distinct actual-sender vs represented-party `SendContext` pieces. Pure → unit-tested offline.

3. **Zod + API.** `CampaignCreateSchema`/`SequenceCreateSchema` gain `purpose` (optional `MessagePurpose` enum, single source of truth `purpose.ts`); the campaign schema also gains `represented_agency_owner_id` + `delegation_id` with refines requiring them together. The campaign route additionally verifies the delegation + owner exist and belong to the **same agency** before storing (a mismatched pairing is rejected).

4. **Dispatch + simulation wiring.** `campaignDispatchContext(campaign)` resolves the campaign-level purpose (falling back to the drip sequence's default) + the delegated-sender context ONCE per campaign; the broadcast loop (`campaign.ts`) and the drip runner (`handlers.ts` `dripAdvance`, cached per campaign) pass `ctx.purpose` + `ctx.delegation` + `ctx.ownership`. `simulation.ts` computes the SAME purpose-scoped consent / frequency / collision (`resolveSendPolicy`) and delegation validity (`resolveDelegation`) **read-only**, so the preview's per-contact decisions now include purpose + delegation — the ADR-021 "light up."

5. **UI.** The campaign builder adds a Purpose select + an optional "Send on behalf of (delegated)" picker listing only ACTIVE delegations (each carries its represented owner). The sequence builder adds a Purpose select.

## Rationale

- **Extend, don't build.** The gate, the send ctx, the delegation resolver, and the purpose policy resolver all already existed; Slice 7 only made the builder *store* the config and dispatch/simulation *pass* it. No second engine, no send-path change.
- **Default-permissive.** A campaign with no purpose / no delegation behaves exactly as before (the gate steps are no-ops), so existing campaigns are unaffected — consistent with every gate-input added since the original 7.
- **Fidelity in the preview.** The simulation shares the same resolvers as dispatch, so the purpose/delegation decisions shown in the dry-run match what the real send will decide.
- **No invented data.** The delegated picker offers only real ACTIVE delegations; the gate re-verifies the delegation's status FRESH per send (a stale/revoked one hard-blocks + escalates).

## Alternatives Considered

- **A free-text purpose column** — rejected: purpose is a controlled vocabulary that drives consent-scoping; a DB check + Zod enum keep it honest (single source of truth in `purpose.ts`).
- **Two separate delegation + owner pickers in the UI** — rejected: one delegation dropdown that carries its own represented owner makes the "set together" invariant impossible to violate from the UI.
- **Resolving the delegation per recipient in dispatch** — rejected for the campaign-level identity (resolved once); the gate still re-checks ACTIVE/in-scope status per send, and the simulation resolves per recipient so the contact-agency contamination check is reflected.

## Consequences

**Positive**
- Campaigns/sequences now exercise purpose-scoped consent + frequency + collision and delegated on-behalf-of authority; the simulation preview shows those decisions.
- The builder is the single place operators configure this; no per-send hand-wiring.

**Negative / trade-offs**
- Data-confidence claim declaration is not yet a builder field (deferred to Slice 8 with the claim-bearing library templates).
- The simulation resolves purpose policy + delegation per recipient, adding read-only queries to the (capped) preview loop when those dimensions are configured.

## Related Documents

- CLAUDE.md §12; master build instruction §15–§16
- ADR-013, ADR-015, ADR-017, ADR-021
- Migration `supabase/migrations/058_comm_builder_purpose_delegation.sql`
- `src/lib/comms/campaign-config.ts`, `campaign.ts`, `simulation.ts`, `src/jobs/handlers.ts`, `src/lib/validation/schemas.ts`, `src/components/app/CampaignControls.tsx`, `SequenceControls.tsx`
- Tests: `tests/comms-campaign-config.test.mjs`, `tests/rls-firewall.test.mjs` (applies 058)
