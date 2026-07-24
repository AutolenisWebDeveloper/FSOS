# Native Communications Platform — Slice 4: Conversation Mode (Reply Pauses Automation)

> Vertical slice per master build instruction §4 (Slice 4 of 9). Authoritative rationale: **ADR-018**.
> Reuses the enrollment lifecycle + drip runner — no parallel scheduler (§0/§6). GHL untouched (§0.A).

## What shipped

| Concern | Delivery |
|---|---|
| **Reply pauses automation (§10)** | `inbound.ts` sets the member's `status='enrolled'` enrollments to `PAUSED_FOR_CONVERSATION` on a genuine reply (past STOP/START; excluding bare HELP), audited. |
| **Never "haven't heard back" after a reply** | Structural: the drip runner (`dripAdvance`) selects only `status='enrolled'`, so a paused enrollment is durably skipped — no follow-up can be sent after the customer replied. |
| **Pure resume decision** | `conversation-mode.ts` `evaluateResume` (offline-tested): resume on authorized manual resume, `resolved`/`closed` conversation, or customer quiet ≥ `resume_quiet_days`; else stay paused. |
| **Deferred resume** | `resumePausedEnrollments` job (`resume-paused` cron, 11:00 UTC): resolves each paused member's conversation status + last-inbound time, runs `evaluateResume`, returns eligible enrollments to `enrolled`. Idempotent. |
| **Schema** | Migration 056: enrollment `paused_for_conversation` status + `paused_at`/`pause_reason`/`resumed_at`; `comm_conversation_policy` editable quiet period (config default / `is_assumption`). |

## Belt + suspenders

This complements ADR-017's `collision` gate step (which pauses a *single* promotional send during an active conversation): the enrollment-level pause removes the contact from the drip runner's population entirely, so the "no follow-up after a reply" rule is a durable structural guarantee, not a per-send check.

## Scope boundary

Pausing covers **drip enrollments** (the scheduled-automation surface). Broadcast one-offs are point-in-time and covered by the collision gate step at send time. Resume granularity is the daily cron; same-day resume uses the manual-resume path (`evaluateResume({ manualResume: true })`).

## Evidence

- `tests/comms-conversation.test.mjs` — 7 assertions: an open/recent conversation stays paused (no "haven't heard back"), resolved/closed resumes, quiet-period resume boundary, manual-resume override, null-last-inbound safety, and `shouldPauseOnReply` (genuine reply pauses; bare keyword does not).
- `tests/rls-firewall.test.mjs` (extended) — applies mig 056; proves `comm_conversation_policy` default-deny + the enrollment status-constraint swap applies. 13/13 real Postgres.
- `npm test` (+conversation) · `type-check` · `lint` · `test:rls` · `build` — all green.

## Guardrails touched

Securities firewall (§4.1) unchanged. STOP/START opt-out path unchanged (pausing runs only past the keyword returns). No new send path — pausing/resuming only changes enrollment state; every actual send still passes the full gate. GHL frozen (§0.A).
