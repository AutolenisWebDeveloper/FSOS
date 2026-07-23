# Native Communications Platform — Slice 1: Ownership Resolution + Delegated Agency-Owner Outreach

> Vertical slice per master build instruction §4 (Slice 1 of 9). Authoritative rationale: **ADR-015**.
> Extends `lib/comms` + `/app/comms` in place (§0) — no parallel platform, no second gate, no GHL touched (§0.A).

## What shipped

| Concern | Delivery |
|---|---|
| **Delegated authority** | `agency_communication_delegations` (mig 049): FSA→agency-owner authorization, scoped by campaign type / channel / segment / sender-identity + effective/expiry window + status lifecycle. |
| **On-behalf-of decision** | `src/lib/comms/delegation.ts` — pure `evaluateDelegation` (existence → ACTIVE → effective → not-expired → agency binding → type → channel). Clock-injected, offline-testable. |
| **Gate enforcement** | `gate.ts` gains steps `ownership` (0) and `delegation` (2c). Both **default-permissive** (backward-compatible) and **hard-block + escalate** on explicit failure. Ownership is checked before consent; delegation before content approval. |
| **Distinct attribution** | `comm_messages` + `actual_sender_user_id`, `represented_agent_id`, `represented_agency_owner_id`, `represented_agency_id`, `contact_owner_id`, `communication_operator_id`, `book_of_business_ref`, `delegation_id` (all nullable/additive). Actual sender ≠ represented party (§7). |
| **Unresolved → review** | `comm_assignment_reviews` queue (mig 049). `resolveOwnershipForSend` / `resolveDelegation` / `enqueueAssignmentReview` in `ownership.ts` are **fail-closed**. `sendThroughGate` resolves delegation fresh, persists attribution, and enqueues a review when the gate blocks on `ownership`. |
| **Queue UI/API** | `/app/comms/assignments` (all states: loading via RSC, empty w/ guidance, error, resolved history) + `/api/comms/assignments/[id]` (Zod-validated, server-authorized resolve/dismiss, optimistic concurrency guard, audited). |

## Enforcement placement (why the gate)

Delegation + ownership are authorization concerns, so they live **inside the one dispatcher gate** (ADR-003, CLAUDE.md §6) — not a second engine (master build instruction §0). The pure decision cores mirror `gate.ts`; the DB resolvers are thin, fail-closed adapters.

## Scope boundary (read before reviewing)

Enforcement is wired into `sendThroughGate` as **opt-in context** (`SendContext.delegation` / `.ownership` / `.ownershipResolved`). Existing send paths pass no delegation context, so a plain FSA broadcast is unchanged — it is not "on behalf of" anyone and is not delegation-gated. Turning delegation enforcement on per campaign (and making ownership resolution mandatory per recipient) is the **campaign-builder slice (§15, Slice 7)**. This slice lays the enforced primitives without regressing existing campaigns. `comm_campaigns` sends now persist `represented_agency_id` (non-breaking).

## Evidence

- `tests/comms-delegation.test.mjs` — 18 assertions: gate backward-compat + ownership/delegation blocks + the full `evaluateDelegation` truth table (expired, not-effective, wrong type/channel, cross-agency, open-ended expiry, "all permitted" scope).
- `tests/rls-firewall.test.mjs` (extended) — applies mig 049 to ephemeral Postgres; proves a client sees **0** delegation and **0** assignment-review rows (back-office default-deny). 9/9.
- `npm test` (full suite, +delegation) ✓ · `type-check` ✓ · `lint` ✓ · `test:rls` ✓ · `build` ✓ (both new routes compiled).

## Guardrails touched

Securities firewall (§4.1) unchanged — no securities substance stored on any new table. Consent/DNC/quiet-hours/`is_security` gate steps unchanged and still first-among-equals for existing callers. Append-only audit written on enqueue + resolve. GHL (§0.A) untouched.
