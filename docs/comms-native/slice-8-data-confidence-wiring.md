# Native Communications Platform — Slice 8 (§18): Data-Confidence Claim Wiring

> Vertical slice per master build instruction §4 (Slice 8, part 2 of 2 — completes Slice 8; §18).
> Authoritative rationale: **ADR-024**. Closes the §13 deferral from Slices 6/7 and Slice 8 §17.
> GHL untouched (§0.A).

## What shipped

| Concern | Delivery |
|---|---|
| **Campaign declares its claims (§18)** | Migration 059: `comm_campaigns.claim_fields text[]` (checked vocabulary). NULL/empty → no specific claims (unaffected). |
| **Pure core** | `claims.ts`: `CLAIM_FIELD_KEYS` (`conversion_deadline` / `policy_status` / `appointment_at`), `campaignClaimKeys` (validate stored), `buildDataConfidence(resolved)` → the gate's `DataConfidenceInput`. |
| **Fail-closed resolver** | `claim-resolver.ts` (read-only): resolves each declared field for the recipient household from `household_policies.conversion_deadline` / `.status` + `appointments.scheduled_at` — verified / **conflicting** (records disagree) / **unverified** (missing or lookup error). Never sent on a guess. |
| **Dispatch enforcement (§13)** | The broadcast loop (`campaign.ts`) + drip runner (`handlers.ts`) resolve declared claims per recipient and pass `ctx.dataConfidence`; an unverified/conflicting field **excludes** the send (gate `data_confidence`) and raises a verification task. |
| **Simulation lights up** | `simulation.ts` resolves the same fields read-only; per-contact decisions now include `data_confidence` (verified / unverified fields). |
| **Builder + library loop** | Campaign builder "Specific claims this message makes" selector; the library instantiation response already returns each blueprint's recommended claim fields. |

## Extend-before-build

`send.ts` + the gate's `data_confidence` step already enforced `ctx.dataConfidence` (Slice 6). §18 only
adds the campaign's *declaration* (migration 059), a pure mapper, a fail-closed resolver, and the dispatch/
simulation calls that pass the existing ctx field. Default-permissive: a campaign with no `claim_fields`
dispatches exactly as before.

## Scope boundary

- The resolver covers the three claim fields the claim-bearing blueprints name; a new claim type needs a
  resolver entry + a `CLAIM_FIELD_KEYS` addition.
- Claim resolution adds read-only queries per recipient only when `claim_fields` is set (skipped otherwise).

## Evidence

- `tests/comms-claims.test.mjs` — 7 assertions: key validation, `buildDataConfidence` mapping, and the
  verified / unverified / conflicting / low-confidence paths through `evaluateDataConfidence`.
- `tests/rls-firewall.test.mjs` — applies migration 059 (real Postgres).
- `npm test` (+`comms-claims`) · `type-check` · `lint` · `test:rls` · `build` — all green.

## Guardrails touched

Adds §13 enforcement to the campaign send paths — no compliance control weakened. Resolution is fail-closed
(missing/error → unverified → excluded + escalated). No invented data (§4.3): claims are grounded in the
recipient's stored values. Securities firewall + AI red-line unchanged. GHL frozen (§0.A).
