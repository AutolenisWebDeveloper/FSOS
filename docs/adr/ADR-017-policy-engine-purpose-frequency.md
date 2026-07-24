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

## Related Documents

- CLAUDE.md §4, §6, §12; master build instruction §9, §10
- ADR-003, ADR-004, ADR-013, ADR-015, ADR-016
- Migration `supabase/migrations/054_comm_purpose_frequency.sql`
- `src/lib/comms/purpose.ts`, `frequency.ts`, `policy-resolver.ts`, `gate.ts`, `send.ts`
- Tests: `tests/comms-policy.test.mjs`, `tests/rls-firewall.test.mjs` (extended)
