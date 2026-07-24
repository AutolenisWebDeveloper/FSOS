# Native Communications Platform — Slice 3: Policy-Engine Extensions (Purpose · Frequency · Collision)

> Vertical slice per master build instruction §4 (Slice 3 of 9). Authoritative rationale: **ADR-017**.
> Extends the ONE gate (`gate.ts`) + the enforced consent store — no second policy engine (§0/§6). GHL untouched (§0.A).

## What shipped

| Concern | Delivery |
|---|---|
| **Purpose classification (§9)** | `purpose.ts` (pure): 10 `MessagePurpose`s → 8 `ConsentPurpose`s, `isMarketingPurpose`, `purposePriority`/`yieldsTo`. Birthday/relationship require `BIRTHDAY_COMMUNICATIONS` — a relationship is never implicit consent. |
| **Purpose-scoped consent** | `consents.purpose` (mig 054, nullable = channel-wide; partial unique indexes let channel-wide + purpose rows coexist). Resolver prefers the scoped row; a scoped **revoke** overrides a channel grant. `consent_ledger` untouched (append-only evidence). |
| **Frequency caps (§9)** | `frequency.ts` `evaluateFrequency` (pure) + `comm_frequency_policy` (editable caps, config default/`is_assumption`). Counts derived from `comm_messages` (`purpose` recorded per send). Gate step `frequency` — a **non-escalating deferral**. |
| **Priority collision (§10)** | `frequency.ts` `evaluateCollision` (pure): active conversation pauses promotional/relationship sends (not necessary servicing/deadline); lower-priority campaigns yield to active higher-priority ones. Gate step `collision` — non-escalating pause. |
| **Wiring** | `policy-resolver.ts` (fail-safe: consent fails closed, frequency/collision fail open) + `sendThroughGate`, opt-in via `ctx.purpose`. |

## Enforcement placement

Both new gate steps sit after the operational `business_hours` deferral and before the compliance blocks, so a real compliance failure (consent/DNC/quiet-hours/delegation/firewall) still surfaces and **escalates first**; frequency/collision only ever defer a compliance-clean send.

## Scope boundary (read before reviewing)

Purpose policy is **opt-in** (`ctx.purpose`). Callers that pass no purpose keep channel-wide consent and no caps — existing sends are unchanged. Adopting purposes across the campaign library, plus the rest of §9 — the full **preference-center UI**, all **14 suppression types**, signed **unsubscribe/preference tokens**, and **destination-ownership** validation — are explicitly deferred to follow-up slices. This slice delivers the §4 Slice-3 core: purpose classification, frequency caps, and collision.

## Evidence

- `tests/comms-policy.test.mjs` — 16 assertions: purpose→consent mapping (incl. birthday-not-implicit), marketing classification, priority order, frequency caps (min-interval, SMS/day+7d, marketing-email-only, combined-touches), collision (active-conversation pauses promo not servicing; lower yields to higher), and the two gate steps (non-escalating; compliance still precedes).
- `tests/rls-firewall.test.mjs` (extended) — applies mig 054; proves a client sees **0** `comm_frequency_policy` rows and the `consents` constraint swap applies. 11/11 real Postgres.
- `npm test` (+policy) · `type-check` · `lint` · `test:rls` · `build` — all green.

## Guardrails touched

Securities firewall (§4.1) unchanged. Existing gate steps unchanged and still first-among-equals. `consent_ledger` not modified (§9). Frequency policy + consent purposes are editable config, not hard-coded (§4.3). GHL frozen (§0.A).
