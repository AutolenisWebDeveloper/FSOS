# ADR-017 — Policy-Engine Extensions: Purpose Classification, Frequency Caps & Priority Collision

**Status:** Accepted
**Date:** 2026-07-23
**Owner:** FSOS Engineering
**Related:** ADR-003 (single dispatcher), ADR-004 (securities firewall), ADR-013 (canonical `comm_*`), ADR-015 (delegation), ADR-016 (identity disclosure); CLAUDE.md §4, §12; master build instruction §9/§10.

## Context

The send gate (`gate.ts`) enforced consent, quiet hours, business hours, DNC, template approval, recommendation, and the securities firewall — plus delegation (ADR-015). Master build instruction §9/§10 requires three more policy dimensions, all of which must live **inside the one gate** (CLAUDE.md §6; no second policy engine):

1. **Purpose classification.** Every automated message is exactly one purpose (MARKETING, TRANSACTIONAL, SERVICING, APPOINTMENT, RELATIONSHIP, BIRTHDAY, WORKSHOP, APPLICATION_STATUS, DOCUMENT_REQUEST, POLICY_DEADLINE). Purpose drives required consent, quiet-hour/frequency treatment, and campaign priority.
2. **Purpose-scoped consent.** The enforced consent store (`consents`) was per-channel only. §9 requires a purpose axis (TRANSACTIONAL_SMS, MARKETING_SMS, …) so a contact can grant/revoke a specific purpose. A birthday message must require a birthday-communication permission — an existing relationship is **never** implicit consent.
3. **Frequency caps + priority collision.** Per-recipient rate limits (max SMS/day + /7d, max marketing emails/day + /7d, max combined touches/day, min interval) and the §10 rule that a lower-priority send pauses when a higher-priority campaign or an active conversation is underway.

## Decision

**Pure decision cores, DB-backed resolvers, enforced as gate steps** — the pattern established by ADR-015/016.

**1. `purpose.ts` (pure).** The `MessagePurpose`/`ConsentPurpose` enums, `purposeToConsentPurpose(purpose, channel)`, `isMarketingPurpose`, and the §9 default `purposePriority` ordering (`yieldsTo`). Birthday/relationship map to `BIRTHDAY_COMMUNICATIONS`; marketing to channel marketing consent; workshop to `WORKSHOP_COMMUNICATIONS`; servicing/application/document/deadline to `SERVICE_NOTIFICATIONS`.

**2. `frequency.ts` (pure).** `evaluateFrequency` (counts + caps → decision) and `evaluateCollision` (candidate purpose + active-conversation + active-campaign-purpose → pause decision). Marketing-email caps apply only to marketing purposes; combined-touches + min-interval apply to all. During an active conversation only "necessary" sends (priority ≤ 3: servicing/deadline/appointment/transactional) proceed — promotional/relationship automation pauses (§10).

**3. `gate.ts` — two new steps.** `frequency` and `collision`, both **default-permissive** (existing callers unaffected) and both **non-escalating deferrals** (like `business_hours`): a capped or paused send is held/dropped for a later cycle, not a compliance escalation. They are placed after the operational `business_hours` deferral and before the compliance blocks, so a genuine compliance failure (consent/DNC/etc.) still surfaces and escalates first.

**4. Migrations 054 + 055 — additive schema.**
- **Purpose consent lives in a COMPANION table `comm_consent_purposes`** (member/channel/purpose, FULL `unique(member_id, channel, purpose)` → upsert-safe), NOT as a column on `consents`. The channel-wide `consents` table and its `unique(member_id, channel)` constraint are **left untouched**, so the existing consent upserts (`onConflict: 'member_id,channel'` in the STOP/START handler, the client consent portal, and referral-convert) and `hasConsent()`'s `maybeSingle()` keep working. The resolver prefers the purpose-scoped row, else falls back to the channel-wide `consents` row. `consent_ledger` is untouched (append-only evidence, §9).
  - *History note:* 054 first attempted this as a `consents.purpose` column + partial unique indexes; that broke `onConflict (member_id, channel)` (a partial index can't be an ON CONFLICT arbiter without its WHERE). **Migration 055 reconciles it** — restores the `consents` constraint, drops the column, and introduces the companion table. New work targets the companion table.
- `comm_messages.purpose` (nullable): records each send's purpose for frequency counting + analytics (indexed on `(member_id, channel, sent_at)` filtered to outbound+sent — matching the count queries).
- `comm_frequency_policy` (singleton): editable caps as **config defaults** (`is_assumption` → gold "verify" badge, §4.3).

**5. `policy-resolver.ts` (DB-backed) + `send.ts` (opt-in).** `resolveSendPolicy` resolves purpose-scoped consent (prefer the scoped row, else channel-wide; a scoped revoke wins), frequency (counts derived from `comm_messages` + editable caps), and collision (active-conversation from the thread; active-campaign-purpose supplied by the caller). `sendThroughGate` applies these only when `ctx.purpose` is set: purpose-scoped consent replaces the channel-wide check, and frequency/collision feed the two new gate steps. **Fails safe** — consent lookup fails closed; frequency/collision lookups fail open (an operational cap must not silently drop a compliance-clean send).

## Rationale

- **One gate.** Purpose/frequency/collision are policy dimensions, so they belong with consent/DNC/firewall in the single dispatcher (ADR-003). Pure cores keep the decisions testable; resolvers are thin DB adapters.
- **Backward-compatible.** Every new column is nullable; every new gate input defaults permissive; purpose policy is opt-in via `ctx.purpose`. No existing send changes behavior until a caller adopts purposes.
- **Consent integrity.** The purpose axis extends the *enforced* store (`consents`), not `consent_ledger` — consistent with §9 and ADR-013's reconciliation.
- **Relationship ≠ consent.** Mapping birthday/relationship to an explicit `BIRTHDAY_COMMUNICATIONS` consent purpose encodes the §9 rule that an existing relationship never silently authorizes outreach.

## Alternatives Considered

- **A second "frequency/preference engine"** — rejected (fragmentation; CLAUDE.md §6, master build §0).
- **A dedicated send-counter table** — rejected for now: `comm_messages` already records every send with member/channel/purpose/sent_at; counts are a query (indexed in 054). A materialized counter can be added later if the query becomes hot.
- **Enforcing purpose consent by rewriting the channel-wide `consents` semantics** — rejected: would break existing channel-wide grants. The nullable-purpose + partial-index design preserves them.

## Consequences

**Positive**
- Purpose-aware consent, rate limiting, and priority arbitration are enforced in the one gate, with pure, tested cores.
- The frequency policy and consent purposes are editable/auditable; nothing is hard-coded.

**Negative / trade-offs**
- Purpose policy is opt-in this slice; a caller that passes no `ctx.purpose` still uses channel-wide consent and no caps. Adopting purposes across the campaign library is later-slice work (the campaign-builder + library slices).
- The remaining §9 breadth — the full preference-center UI, all 14 suppression *types*, signed unsubscribe/preference tokens, and destination-ownership validation — is **explicitly scoped to follow-up slices**; this ADR covers purpose classification, frequency caps, and collision (the §4 Slice-3 core).

## Amendment — 2026-08-06: reply-scoped frequency caps

**Status of the amendment:** Accepted. The decisions above stand; this narrows the *scope* of
the frequency caps and is recorded here so the narrowing is not later read as drift.

### What this ADR did not contemplate

Every cap in this ADR was designed for **proactive outreach**: the case being bounded is a
drip texting someone twice in an hour. An **inbound-triggered conversation reply** was never
in scope — not because it was considered and excluded, but because at the time this ADR was
written the reply path (`inbound.ts` → `tryAutoReply`) supplied no `ctx.purpose` at all and
therefore never entered the policy engine. The caps and the reply path simply never met.

They met when replies were classified so the §11 authority matrix could clear them
(`reply-classification.ts`). `evaluateOutboundMessage` requires a purpose, so supplying one —
correctly — also enrolled replies in §9 frequency counting for the first time. Measured
against a real database (`tests/comms-inbound-e2e.test.mjs` §1c):

```
seeded caps: min_interval=60 max_sms_day=2 enabled=true
turn 1 sent=true | turn 2 sent=false → failed|frequency|Minimum interval not met (0m < 60m).
```

A normal back-and-forth stalls after one AI turn. Answering someone who just texted you is
not the mass-outreach case the interval cap exists to bound.

### Decision

Add a **second cap row**, `comm_frequency_policy` id `'reply'` (migration 102), selected by
the send path via `SendContext.isConversationReply` → `resolveSendPolicy({ frequencyPolicyId })`.

- `min_interval_minutes = 0` — the spacing rule is the part that does not apply to a reply.
- The **per-day and per-7-day maxima remain**, as config defaults (`is_assumption = true`).
  They are the real volumetric bound, and they are what makes this safe to land **before** the
  per-conversation turn limit rather than after it.
- A missing `'reply'` row falls back to `'global'` — the **tighter** of the two — so an
  unapplied migration can never leave a send less bounded than it is today.

### Why a row and not a code exemption

Three options were considered:

- **A blanket exemption in `send.ts`** — rejected. It removes the only volumetric bound on AI
  messaging, and an exemption buried in a call site is invisible to whoever audits this later.
- **Widening the global `min_interval_minutes`** — rejected. It weakens the caps for drips,
  which is the case this ADR was actually written for.
- **A second cap row** — accepted. The ceiling stays real, stays auditable next to the
  outreach caps, and can be dialled back without a deploy. `isConversationReply` *selects* a
  row; it can never remove one.

This mirrors the design already used for hours of operation (`comm_hours_policy`): operator-
editable configuration carrying `is_assumption`, not a hard-coded behavioural exception.

### Relationship to the per-conversation turn limit

The reply cap and the turn limit bound the same behaviour along **different axes**, and are
deliberately non-overlapping:

| | Reply cap (this amendment) | Turn limit |
|---|---|---|
| Scope | per contact, per day/7 days | per conversation, since the last human turn |
| Bounds | total volume of AI replies to a person | how long the AI may talk before a licensed FSA takes over |
| Where | send gate, step `frequency` | `tryAutoReply`, before the model is called |
| On hit | send deferred | thread disarmed, handed to the FSA |

Neither can contradict the other: they are evaluated at different points and both fail in the
same direction (no send). **Both escalate.** The gate classes `frequency` as a non-escalating
deferral — correct for a drip, which retries next cycle — but `tryAutoReply` escalates on any
non-send, so a capped *reply* still reaches the FSA queue with its reason. A reply is never
silently dropped by either bound.

### Scope of the amendment

Unchanged: purpose classification, purpose-scoped consent, collision, the pure cores, and the
`'global'` caps that bound all campaign/drip outreach. No caller that omits
`isConversationReply` is affected.

## Related Documents

- CLAUDE.md §4, §6, §12; master build instruction §9, §10
- ADR-003, ADR-004, ADR-013, ADR-015, ADR-016
- Migrations `supabase/migrations/054_comm_purpose_frequency.sql`, `102_comm_reply_frequency_policy.sql` (amendment)
- `src/lib/comms/purpose.ts`, `frequency.ts`, `policy-resolver.ts`, `gate.ts`, `send.ts`, `inbound.ts`, `reply-classification.ts`
- Tests: `tests/comms-policy.test.mjs`, `tests/rls-firewall.test.mjs` (extended), `tests/comms-inbound-e2e.test.mjs` §1c
