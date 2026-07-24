# Native Communications Platform — Slice 6 (§14): Simulation Mode

> Vertical slice per master build instruction §4 (Slice 6, part 2 of 2 — completes Slice 6). Authoritative rationale: **ADR-021**.
> Read-only; reuses the pure gate + audience resolver — **cannot call a provider by construction**. GHL untouched (§0.A).

## What shipped

| Concern | Delivery |
|---|---|
| **Safe dry-run (§14)** | `simulation.ts` `simulateCampaign` (read-only): resolves the audience, computes the SAME gate inputs the real send uses, runs the pure `evaluateGate` per contact, renders the body — **writes no message, calls no provider** (never touches `sendThroughGate`/`dispatch`). |
| **Per-contact preview** | Each entry: would-send vs excluded + **exact reason**, resolved represented agency, template version, rendered body, scheduled time, and every gate decision (§14). |
| **Pure core** | `simulation-core.ts`: `verdictFromGate`, `summarizeSimulation`, `simulationSatisfiesActivation` (the §14 required-before-activation gate). |
| **Required before activation** | Migration 057 (`comm_campaigns.simulated_at` + `last_simulation`); the activate API returns **422 `simulation_required`** unless a recent simulation is on record; `action: 'simulate'` runs + persists it. |
| **UI** | Campaign detail "Run simulation (safe preview)" control showing would-send / excluded-by-step (no messages sent). |

## Safe by construction

`simulateCampaign` never calls `sendThroughGate`/`dispatch`, so the "never calls Twilio or Resend" property is structural — not a flag that could be mis-set. It reuses the same pure gate as the real send, so the preview matches the actual decision and stays correct as gate steps evolve.

## Scope boundary

Today's campaign model carries no purpose/delegation/data-confidence config (Slice 7 builder fields), so the simulation currently exercises consent/quiet-hours/business-hours/DNC/template/securities; the richer dimensions appear in the preview once the builder adds them. Activation freshness window is a fixed 24h default.

## Evidence

- `tests/comms-simulation.test.mjs` — 7 assertions: verdict from a passing/blocked gate, summary counts + bucketing, and the required-before-activation gate (none / recent / stale / future-invalid).
- `tests/rls-firewall.test.mjs` — applies migration 057 (13/13 real Postgres).
- `npm test` (+simulation) · `type-check` · `lint` · `build` — all green.

## Guardrails touched

Every simulated decision runs the real gate (securities firewall + all steps). No send path changed — the simulator is additive and read-only. Activation is now gated on a simulation pass. GHL frozen (§0.A).
