# Native Communications Platform — Slice 7 (§15–§16): Campaign + Sequence Builder Config

> Vertical slice per master build instruction §4 (Slice 7 of 9). Authoritative rationale: **ADR-022**.
> Extend-before-build: the gate + send ctx already accepted purpose/delegation — the builder now
> STORES the config and dispatch/simulation PASS it. GHL untouched (§0.A).

## What shipped

| Concern | Delivery |
|---|---|
| **Message purpose (§9/§10)** | `comm_campaigns.purpose` + `comm_sequences.purpose` (checked vocabulary). Dispatch passes `ctx.purpose` → purpose-scoped consent + frequency caps + priority collision. Drip inherits the sequence's default purpose. |
| **Delegated sender (§7)** | `comm_campaigns.represented_agency_owner_id` + `delegation_id`. A delegated campaign resolves the delegation FRESH per send (gate `delegation`/`ownership`), attributing the represented agency/owner distinct from the actual sender. |
| **Pure core** | `campaign-config.ts`: `campaignSendConfig` (row → gate config; invalid purpose dropped, half-configured delegation ignored), `validateDelegatedConfig` (both fields set together), `delegationSendContext` (distinct actual-sender vs represented-party ctx). |
| **Dispatch** | `campaignDispatchContext(campaign)` resolves purpose + delegated-sender ONCE; the broadcast loop (`campaign.ts`) + drip runner (`handlers.ts`, cached per campaign) pass it. |
| **Simulation lights up** | `simulation.ts` computes the SAME purpose policy (`resolveSendPolicy`) + delegation validity (`resolveDelegation`) read-only; per-contact decisions now include `purpose` / `frequency` / `collision` / `delegation` (the ADR-021 promise). |
| **UI** | Campaign builder: Purpose select + optional "Send on behalf of (delegated)" picker (ACTIVE delegations only). Sequence builder: Purpose select. |

## Extend-before-build

`send.ts` `SendContext` already accepted `purpose`, `delegation`, `ownership`. Slice 7 added **no send-path
logic and no new engine** — only the builder storage (migration 058, additive), a small pure mapper, and the
dispatch/simulation calls that pass the existing ctx fields. Default-permissive: a campaign with no purpose /
no delegation dispatches exactly as before.

## Scope boundary

- **Data-confidence claim declaration is deferred to Slice 8** (campaign library), where the claim-bearing
  templates (term-conversion deadline, cross-sell) live — the §13 slice doc named that as the follow-up.
- Simulation resolves purpose policy + delegation per recipient (accurate, contact-agency aware) — a read-only
  cost bounded by the capped preview loop, incurred only when those dimensions are configured.

## Evidence

- `tests/comms-campaign-config.test.mjs` — 10 assertions: purpose mapping (valid / invalid-dropped / all 10),
  delegated detection (both-or-neither), the create-time validator, and the distinct actual-sender/represented
  ctx assembly.
- `tests/rls-firewall.test.mjs` — applies migration 058 (real Postgres).
- `npm test` (+`comms-campaign-config`) · `type-check` · `lint` · `build` — all green.

## Guardrails touched

Purpose + delegation only ADD gate governance; no compliance control weakened. The delegated picker offers
only real ACTIVE delegations (no invented data, §4.3); the gate re-verifies the delegation per send (a stale/
revoked one hard-blocks + escalates). Securities firewall + AI red-line unchanged. GHL frozen (§0.A).
