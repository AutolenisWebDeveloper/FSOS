# ADR-024 — Data-Confidence Claim Wiring for Campaigns (§18)

**Status:** Accepted
**Date:** 2026-07-24
**Owner:** FSOS Engineering
**Related:** ADR-020 (data confidence), ADR-021 (simulation), ADR-022 (builder config), ADR-023 (campaign library); CLAUDE.md §4.2/§4.3/§13; master build instruction §18.

## Context

ADR-020 (Slice 6, §13) built the data-confidence gate step and the send-path enforcement (`send.ts` accepts `ctx.dataConfidence`; the gate excludes an unverified/conflicting specific claim and raises a verification task). But **no campaign ever passed `ctx.dataConfidence`** — so a campaign whose message rests on a specific claim (a term-conversion deadline, a coverage/lapse status, an appointment time) dispatched with no data-confidence check. Slice 7 and Slice 8 §17 both explicitly deferred this: *"data-confidence claim declaration is a Slice 8 builder field / §18 follow-up, where the claim-bearing library blueprints live."* §18 closes that gap.

## Decision

**A campaign DECLARES the claim fields its message depends on; dispatch resolves those fields per recipient from stored data and passes `ctx.dataConfidence` to the existing gate step.** No new gate, no send-path change.

1. **Schema (migration 059, additive).** `comm_campaigns.claim_fields text[]` (checked against the `CLAIM_FIELD_KEYS` vocabulary; NULL/empty → no specific claims). Existing campaigns are unaffected.

2. **Pure core `claims.ts`.** `CLAIM_FIELD_KEYS` (`conversion_deadline`, `policy_status`, `appointment_at` — matched to the claim-bearing blueprints), `campaignClaimKeys(stored)` (drop unknown keys), `buildDataConfidence(resolved)` → `DataConfidenceInput` (empty list ⇒ `makesSpecificClaims=false`). Pure → unit-tested offline.

3. **DB resolver `claim-resolver.ts` (read-only, fail-closed).** `resolveClaimFields(declared, { householdId })` reads the recipient household's stored data — `household_policies.conversion_deadline` / `.status`, `appointments.scheduled_at` — and returns a `ClaimField` per declared key: verified when exactly one coherent value exists, **conflicting** when records disagree, **unverified** when missing or on any lookup error. Never sent on a guess.

4. **Dispatch + simulation wiring.** The broadcast loop (`campaign.ts`) and the drip runner (`handlers.ts`) resolve the declared claims per recipient and pass `ctx.dataConfidence`; an unverified/conflicting field excludes the send and raises the verification task (via the existing §13 send-path handling). `simulation.ts` resolves the same fields read-only and surfaces a `data_confidence` decision per contact.

5. **Builder.** The campaign builder adds a "Specific claims this message makes" selector (the `CLAIM_FIELD_KEYS`); the library's instantiation response already returns each blueprint's recommended claim fields, so a campaign built from a claim-bearing blueprint declares them.

## Rationale

- **Closes the §13 loop for campaigns without a second engine.** The gate step + send-path handling already existed; §18 only makes campaigns *declare* their claims and dispatch *resolve + pass* them.
- **Explicit declaration over purpose-inference.** Deriving claims from a campaign's purpose over-applies (e.g. a broad `SERVICING` purpose is not always a lapse-status claim). An explicit per-campaign `claim_fields` matches the blueprint model exactly and never blocks a generic send.
- **Fail-closed resolution.** A missing value or a lookup error marks the field unverified, so an ambiguous claim is excluded + escalated — the conservative §13 posture.

## Alternatives Considered

- **Infer claims from purpose** — rejected: imprecise (over-blocks broad purposes, under-covers status claims), whereas explicit `claim_fields` is exact.
- **Store the full claim value + verification metadata on the campaign** — rejected: the truth is the recipient's stored data, resolved fresh at send time; snapshotting it on the campaign would drift.

## Consequences

**Positive**
- A campaign that states a deadline / status / appointment time now cannot send it to a recipient whose stored data doesn't verify it — it is excluded and a verification task is raised.
- The simulation preview shows the data-confidence decision, so operators see exclusions before activating.

**Negative / trade-offs**
- Claim resolution adds read-only queries per recipient when `claim_fields` is set (bounded; skipped entirely for campaigns with no declared claims).
- The resolver covers the three blueprint claim fields; new claim types need a resolver entry + a `CLAIM_FIELD_KEYS` addition.

## Related Documents

- CLAUDE.md §13; master build instruction §18
- ADR-020, ADR-021, ADR-022, ADR-023
- Migration `supabase/migrations/059_comm_campaign_claim_fields.sql`
- `src/lib/comms/claims.ts`, `claim-resolver.ts`, `campaign.ts`, `simulation.ts`, `src/jobs/handlers.ts`, `src/lib/validation/schemas.ts`, `src/components/app/CampaignControls.tsx`
- Tests: `tests/comms-claims.test.mjs`, `tests/rls-firewall.test.mjs` (applies 059)
