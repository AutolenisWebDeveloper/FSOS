# Native Communications Platform — Slice 6 (§13): Data Confidence & Source Verification

> Vertical slice per master build instruction §4 (Slice 6, part 1 of 2). Authoritative rationale: **ADR-020**.
> Enforced in the ONE gate; **code-only (no migration)**. GHL untouched (§0.A). §14 simulation is the immediate next PR.

## What shipped

| Concern | Delivery |
|---|---|
| **Data confidence (§13)** | `data-confidence.ts` (pure): `evaluateDataConfidence` — a message with no specific claims always passes; a specific claim passes only when **every** dependent field is verified/non-conflicting/above-threshold, returning **all** insufficient fields. |
| **Gate enforcement** | `gate.ts` step `data_confidence` (default-permissive; a false **hard-blocks + escalates**). Sits after `is_security`, before `other_rule` — an escalating block ahead of the operational deferrals. |
| **Exclude + verify** | `send.ts` (opt-in via `ctx.dataConfidence`): an unverified/conflicting specific claim excludes the send and raises a **verification task** (`work_tasks`); never sent on a guess. |

## Why "specific claims" scoping

The check keys on whether the *message* asserts a specific claim (a deadline, ownership, lapse/age/appointment status), so generic educational invitations are never blocked while a deadline/ownership claim requires verified data — matching §13 precisely.

## Scope boundary

Enforcement is **opt-in** via `ctx.dataConfidence`; existing generic sends are unchanged. Claim-field verification metadata is caller-supplied (no schema change). Adopting it across the campaign-library claim paths (term-conversion, cross-sell) is the follow-up. **§14 simulation mode** (required-before-activation dry-run preview) is the next slice.

## Evidence

- `tests/comms-data-confidence.test.mjs` — 9 assertions: no-claim passes, verified claim passes, unverified claim excluded + lists the field, conflicting field insufficient, confidence-threshold boundary, all-insufficient-fields collected, and the gate step (backward-compat, hard-block+escalate, compliance-precedes / precedes-operational-deferrals).
- `npm test` (+data-confidence) · `type-check` · `lint` · `test:rls` (unchanged) · `build` — all green.

## Guardrails touched

Securities firewall (§4.1) still precedes data confidence. §4.3 (no invented Farmers/policy data) operationalized at the send boundary. Every actual send still passes the full gate. `work_tasks` records the verification exception. GHL frozen (§0.A).
