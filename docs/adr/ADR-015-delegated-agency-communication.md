# ADR-015 — Delegated Agency-Communication Authority & Actual-Sender vs Represented-Party Model

**Status:** Accepted
**Date:** 2026-07-23
**Owner:** FSOS Engineering
**Related:** ADR-001 (aggregate root), ADR-003 (single dispatcher), ADR-004 (securities firewall), ADR-010 (ownership & RLS), ADR-013 (canonical `comm_*`); CLAUDE.md §0, §4, §6, §10, §12; master build instruction (Native Communications Platform) §6–§7, §12.

## Context

FSOS's business model is B2B2C (CLAUDE.md §0): a licensed Financial Services Agent (the FSA — e.g. Markist Athelus) communicates with an agency owner's existing clients **on behalf of that agency owner**. The communications platform must model three facts the pre-Slice-1 schema could not express:

1. **Delegated authority.** The FSA may only communicate on behalf of an agency owner when an explicit, in-scope, time-bounded authorization exists. Before Slice 1 there was no record of this authority; `agency_partnerships` has no delegation column and `agency_owners` models the *owner*, not a delegate (see `docs/comms-ghl-migration/data-model-inventory.md` §4).
2. **Actual sender vs represented party.** Every outbound message has an *actual communicator* (the FSA/team member) and a *represented party* (the agency owner / agency whose relationship it is). These must never collapse into one ambiguous "agent" field, or a message can misrepresent who is contacting the client and on whose behalf (master build instruction §7).
3. **Ownership must resolve before sending.** If FSOS cannot confidently resolve who a contact belongs to and who is represented, it must **not** send — the record is held for authorized human resolution, never sent on a guess (master build instruction §6).

The send path is already unified through the one dispatcher (ADR-003): every automated SMS/email passes `sendThroughGate` → `dispatch` → `evaluateGate`. So the correct place to enforce delegation and ownership is **inside that existing gate**, not a second gate (CLAUDE.md §6; master build instruction §0 "do not create a second policy engine").

## Decision

**1. A first-class delegation record: `agency_communication_delegations` (migration 049).** It authorizes a `representative_user_id` (the FSA/team member) to communicate on behalf of an `agency_owner_id` for an `agency_id`, scoped by `permitted_campaign_types`, `permitted_channels`, `permitted_contact_segments`, approved sender-identity / phone / email-domain allow-lists, and an `effective_at`/`expires_at` window, with a `status` lifecycle (`DRAFT → ACTIVE → SUSPENDED → EXPIRED → REVOKED`). A NULL/empty scope array on any dimension means "no restriction on that dimension." Sender-identity allow-lists are stored as bare `uuid[]` (no FK) because the sender-identity table lands in a later slice (§8/§18) — the delegation model is complete without forward-referencing a table that does not yet exist.

**2. Delegation is a step inside the existing gate, decided by a pure core.** `src/lib/comms/delegation.ts` (`evaluateDelegation`) is a pure, clock-injected decision (mirrors `gate.ts`): existence → `ACTIVE` → effective → not-expired → contact-agency binding (no cross-agency contamination) → campaign-type scope → channel scope. `gate.ts` gains two steps — `ownership` (step 0) and `delegation` (step 2c) — both **default-permissive** (existing callers and their tests are unaffected) and both **hard-block + escalate** when explicitly failed. `ownership` is checked **before consent** because a mis-owned contact cannot be trusted for any downstream signal; `delegation` is checked **before content approval / recommendation** because a message the FSA is not authorized to send at all must never reach content checks.

**3. Distinct attribution on every message.** `comm_messages` gains `actual_sender_user_id`, `represented_agent_id`, `represented_agency_owner_id`, `represented_agency_id`, `contact_owner_id`, `communication_operator_id`, `book_of_business_ref`, and `delegation_id`. These are **additive and nullable**; existing rows and existing send paths are unchanged. The book-of-business reference maps to the existing spine key (`households.owner_scope`) — **no parallel ownership column is introduced** (master build instruction §0; ADR-013).

**4. Unresolved ownership routes to a review queue, never a send.** `comm_assignment_reviews` (migration 049) holds records whose ownership could not be resolved, with the conflicting source data (`conflict jsonb`) and a `status` lifecycle (`open → resolved | dismissed`). The DB-backed resolvers live in `src/lib/comms/ownership.ts` (`resolveDelegation`, `resolveOwnershipForSend`, `enqueueAssignmentReview`), all **fail-closed** (an unverifiable delegation or a failed lookup is treated as invalid/unresolved — never send blindly, §16.4). `sendThroughGate` resolves delegation **fresh at send time** (never from an enrollment snapshot), persists the attribution columns, and enqueues an assignment review when the gate blocks on `ownership`. The queue is surfaced at `/app/comms/assignments` with a resolve/dismiss API (`/api/comms/assignments/[id]`), authorized server-side.

**5. Scope boundary for this slice.** Slice 1 delivers the delegation model, the two gate steps, the resolvers, the attribution columns, and the review queue, wired into `sendThroughGate` as **opt-in context** (`SendContext.delegation` / `SendContext.ownership` / `SendContext.ownershipResolved`). Existing send paths that pass no delegation context are unaffected — a plain FSA broadcast is not "on behalf of" anyone and is not gated by delegation. Retro-fitting the campaign builder to mark campaigns as *delegated* (which turns delegation enforcement on for a whole campaign, and makes ownership resolution mandatory per recipient) is the campaign-builder slice (master build instruction §15, Slice 7). This preserves behavior (no regression to existing campaigns) while putting the enforcement primitives in place. `comm_campaigns` sends now persist `represented_agency_id` (non-breaking).

## Rationale

- **One gate, not two.** Delegation and ownership are authorization concerns that belong with consent/DNC/quiet-hours/firewall in the single dispatcher (ADR-003, CLAUDE.md §6). Adding steps to the pure `evaluateGate` keeps one enforcement decision, one audit path, one escalation path, and one place reviewers must look.
- **Pure decision, DB adapter.** Following the established `gate.ts` pattern, the *decision* (`evaluateDelegation`) is pure and exhaustively unit-tested offline; the *resolver* (`ownership.ts`) is a thin, fail-closed DB adapter. Testability and correctness come from the pure core; the schema is validated by the RLS firewall proof.
- **Fail-closed everywhere.** Unresolvable ownership and unverifiable delegation both stop the send. Ambiguity is never resolved by sending — it is queued for a human (master build instruction §6, §16.4).
- **Additive, behavior-preserving.** Every new column is nullable; every new gate input defaults permissive. No existing caller, test, or campaign changes behavior until a later slice opts it into delegated mode.

## Alternatives Considered

- **Fold delegation into `agency_partnerships` columns** — rejected: delegation is a many-valued, scoped, time-bounded, status-tracked relationship between a representative and an owner; it does not fit as a handful of columns on the partnership root (data-model-inventory §4).
- **A separate "delegation gate" module** — rejected: a second gate is exactly the fragmentation CLAUDE.md §6 and master build instruction §0 forbid. Delegation is a step in the one gate.
- **Send with a default/fallback owner when unresolved** — rejected: sending on a guessed owner can misrepresent who is contacting the client on whose behalf; §6 mandates hold-and-review, not a fallback.
- **Store the represented party as one "agent" field** — rejected: collapses actual-sender and represented-party, the precise ambiguity §7 prohibits.

## Consequences

**Positive**
- FSOS can authoritatively express and enforce on-behalf-of authority; every message records who actually sent it and whom it represents.
- Unresolved ownership can never leak out as a mis-attributed send; it is visible and actionable in the review queue.
- The enforcement primitives (gate steps, resolvers, queue) are in place for the campaign-builder, simulation, and analytics slices to consume.

**Negative / trade-offs**
- Enforcement is opt-in this slice; a plain broadcast is not yet delegation-gated. The campaign-builder slice must turn it on for delegated campaigns (documented boundary above) — reviewers should not read Slice 1 as "all campaigns now enforce delegation."
- Sender-identity allow-lists are `uuid[]` without an FK until the sender-identity slice; the FK is added when that table exists.

## Related Documents

- CLAUDE.md §0, §4.1, §6, §7, §10, §12; master build instruction §6, §7, §12, §15
- `docs/comms-ghl-migration/data-model-inventory.md` §4 (delegation is net-new)
- ADR-001, ADR-003, ADR-004, ADR-010, ADR-013
- Migration `supabase/migrations/049_comm_delegation_ownership.sql`
- `src/lib/comms/delegation.ts`, `src/lib/comms/ownership.ts`, `src/lib/comms/gate.ts`, `src/lib/comms/send.ts`
- Tests: `tests/comms-delegation.test.mjs`, `tests/rls-firewall.test.mjs` (extended)
