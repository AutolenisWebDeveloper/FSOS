# ADR-018 — Conversation Mode: A Customer Reply Pauses Promotional Automation

**Status:** Accepted
**Date:** 2026-07-24
**Owner:** FSOS Engineering
**Related:** ADR-003 (single dispatcher), ADR-013 (canonical `comm_*`), ADR-017 (policy engine); CLAUDE.md §12; master build instruction §10.

## Context

FSOS runs scheduled, one-to-many campaign automation (the drip runner) and one-to-one conversations. Master build instruction §10 requires a hard rule: **when a customer replies, promotional automation for that contact pauses**, and FSOS must **never send a "we haven't heard back" follow-up after the customer has already replied**. Automation resumes only when the conversation is resolved, the customer goes quiet for a configured period, or an authorized user resumes it.

ADR-017's `collision` gate step already pauses a *single* promotional send while a conversation is active, but that is a per-send check evaluated at dispatch time. §10 needs a **durable, enrollment-level pause** so a scheduled drip step is never even attempted after a reply — belt (enrollment status) and suspenders (the collision gate step).

## Decision

**A reply flips the enrollment to `PAUSED_FOR_CONVERSATION`; the drip runner (which only advances `status='enrolled'`) skips it; a scheduled resume job returns it to `enrolled` when §10 allows.**

1. **Pure resume decision — `conversation-mode.ts`.** `evaluateResume` (clock-injected, offline-tested): resume on an authorized manual resume, or a `resolved`/`closed` conversation, or the customer being quiet for ≥ the configured `resume_quiet_days`; otherwise stay paused. `shouldPauseOnReply` treats every genuine reply as a conversation pause but not the bare STOP/START/HELP keywords (STOP already opts out on its own path).

2. **Pause on reply — `inbound.ts`.** After recording an inbound reply (past the STOP/START keyword returns), the member's `status='enrolled'` enrollments are set to `paused_for_conversation` with `paused_at` + `pause_reason`, and the pause is audited. Because the drip runner (`dripAdvance`) selects only `status='enrolled'`, those enrollments are immediately and durably skipped — no "haven't heard back" message can follow the reply.

3. **Deferred resume — `resumePausedEnrollments` job (`resume-paused` cron).** Scans paused enrollments, resolves each member's conversation status + minutes-since-last-inbound, runs `evaluateResume` against the editable `comm_conversation_policy.resume_quiet_days`, and returns eligible enrollments to `enrolled` (`resumed_at`, `next_send_at=now`). Idempotent (the `UPDATE` re-checks the paused status).

4. **Migration 056 (additive).** `comm_campaign_enrollments.status` gains `paused_for_conversation` + `paused_at`/`pause_reason`/`resumed_at`; `comm_conversation_policy` (singleton) holds the editable quiet period as a config default (`is_assumption`, §4.3).

## Rationale

- **Structural guarantee, not a heuristic.** The "never send after a reply" rule is enforced by the drip runner's existing `status='enrolled'` filter — pausing the enrollment removes it from the runner's population entirely, rather than relying on a per-send check remembering to look.
- **One model.** Reuses the enrollment lifecycle and the drip runner (ADR-013/ADR-003) — no parallel scheduler or conversation engine.
- **Pure decision, DB adapters.** `evaluateResume` is the tested core; `inbound.ts` and the resume job are thin adapters, matching ADR-015/016/017.
- **Editable, fail-safe resume.** Resume conditions are conservative (an open, recently-active conversation never resumes) and the quiet period is operator-editable, not hard-coded.

## Alternatives Considered

- **Rely only on the ADR-017 `collision` gate step** — rejected: a per-send check still lets the runner attempt the send and depends on active-conversation detection at dispatch; the enrollment-level pause is a stronger, durable guarantee. The two are complementary (belt + suspenders).
- **Delete/exit the enrollment on reply** — rejected: a reply is usually a *pause*, not a permanent exit (§17 PAUSE ≠ EXIT). Resume must be possible when the conversation resolves or the customer goes quiet.
- **A separate paused-enrollments table** — rejected: the enrollment already has a status lifecycle; a new status value + tracking columns is the minimal, in-model change.

## Consequences

**Positive**
- A customer reply durably pauses that contact's promotional drips; no "haven't heard back" message can follow a reply.
- Resume is deferred, conservative, and operator-configurable; paused work is never lost.

**Negative / trade-offs**
- The pause covers drip enrollments (the scheduled-automation surface). Broadcast one-offs are point-in-time and not enrollment-tracked; the ADR-017 collision step covers those at send time.
- Resume granularity is the cron cadence (daily); a same-day resume needs the manual-resume path.

## Related Documents

- CLAUDE.md §12; master build instruction §10, §17
- ADR-003, ADR-013, ADR-017
- Migration `supabase/migrations/056_comm_conversation_mode.sql`
- `src/lib/comms/conversation-mode.ts`, `src/lib/comms/inbound.ts`, `src/jobs/handlers.ts`
- Tests: `tests/comms-conversation.test.mjs`, `tests/rls-firewall.test.mjs` (extended)
