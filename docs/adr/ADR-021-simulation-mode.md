# ADR-021 — Simulation Mode (Safe Dry-Run; Required Before Campaign Activation)

**Status:** Accepted
**Date:** 2026-07-24
**Owner:** FSOS Engineering
**Related:** ADR-003 (dispatcher), ADR-013 (canonical `comm_*`), ADR-015–020 (comms slices); CLAUDE.md §12; master build instruction §14.

## Context

Master build instruction §14 requires a **simulation mode**: a safe dry-run that **never calls Twilio or Resend** and shows, per contact, would-enroll vs excluded (with the exact reason), the resolved ownership, the rendered body, the scheduled time, and each gate decision. Critically: **"a simulation/preview pass is required before a campaign can be activated."**

The campaign path could be activated directly (`dispatchCampaign`), with no dry-run preview and no pre-activation safety gate.

## Decision

**A read-only simulation that reuses the pure gate + the audience resolver, plus a pure activation gate — no send logic duplicated, no side effects.**

1. **`simulation-core.ts` (pure).** `verdictFromGate(gateResult)` → would-send + exact exclusion reason; `summarizeSimulation(entries)` → audience / would-send / excluded, bucketed by gate step; `simulationSatisfiesActivation(simulatedAt, now, freshnessHours=24)` → the §14 required-before-activation gate (a simulation must exist and be recent). Pure → unit-tested offline.

2. **`simulation.ts` (DB, read-only).** `simulateCampaign(campaignId)` resolves the audience (reusing `resolveAudience`), computes the **same** gate inputs the real send uses (consent, DNC, quiet/business hours, template approval, securities) with read-only queries, runs the pure `evaluateGate` per contact, renders the body (`personalize`), and returns per-contact entries + summary. It **writes no `comm_messages` and calls no provider** — the safety property is structural (it never touches `sendThroughGate`/`dispatch`).

3. **Migration 057 + the activate API.** `comm_campaigns` gains `simulated_at` + `last_simulation` (additive, nullable). The campaign route adds `action: 'simulate'` (runs `simulateCampaign`, persists `simulated_at` + the summary) and **gates `action: 'activate'`** on `simulationSatisfiesActivation` — activation returns 422 (`reason: 'simulation_required'`) unless a recent simulation is on record. The campaign detail UI adds a "Run simulation (safe preview)" control showing the summary.

## Rationale

- **Fidelity without duplication.** The simulation runs the *same* pure gate the real send runs, so the preview matches the actual decision. Reusing `resolveAudience` + `evaluateGate` avoids a second, drifting copy of the logic.
- **Safe by construction.** `simulateCampaign` never calls `sendThroughGate`/`dispatch`, so it *cannot* reach a provider or write a message — the §14 "never calls Twilio or Resend" property is structural, not a flag that could be mis-set.
- **Enforced pre-flight.** The activation gate is a pure function on `simulated_at`, so "must simulate before activating" is enforced server-side, not merely encouraged in the UI.

## Alternatives Considered

- **A `dryRun` flag threaded through `sendThroughGate`** — rejected: it would add a no-send branch to the critical send path (risk of a mis-set flag actually dispatching), whereas a separate read-only simulator cannot send by construction.
- **Simulate only counts, not per-contact reasons** — rejected: §14 requires per-contact would-send/excluded with the exact reason; the entry list provides it (capped sample for the UI, full counts in the summary).

## Consequences

**Positive**
- Operators get a faithful, side-effect-free preview and cannot activate a campaign without one.
- The simulator shares the gate, so it stays correct as gate steps evolve (delegation/frequency/data-confidence will appear in the preview once campaigns carry that config).

**Negative / trade-offs**
- Today's campaign model carries no purpose/delegation/data-confidence config (those are Slice 7 builder fields), so the simulation currently exercises consent/quiet-hours/DNC/template/securities; the richer dimensions light up as the builder adds them.
- The activation freshness window (24h) is a fixed default; a configurable window can follow if needed.

## Related Documents

- CLAUDE.md §12; master build instruction §14
- ADR-003, ADR-013, ADR-015–020
- Migration `supabase/migrations/057_comm_campaign_simulation.sql`
- `src/lib/comms/simulation-core.ts`, `simulation.ts`, `src/app/api/comms/campaigns/[id]/route.ts`, `src/components/app/CampaignControls.tsx`
- Tests: `tests/comms-simulation.test.mjs`, `tests/rls-firewall.test.mjs` (applies 057)
