# ADR-019 — AI Authority Matrix + Communication Evaluations (Code-Enforced)

**Status:** Accepted
**Date:** 2026-07-24
**Owner:** FSOS Engineering
**Related:** ADR-002 (AI gateway), ADR-003 (dispatcher), ADR-004 (securities firewall), ADR-008 (AI governance), ADR-015/016/017/018 (comms slices); CLAUDE.md §4.2, §11; master build instruction §11/§12.

## Context

FSOS's autonomous AI may send some client-facing messages but must never auto-send advisory, policy-specific, pricing, sensitive, securities, or case-affecting content — those must be **drafted for the licensed FSA** (§11). Master build instruction §11 is explicit: this must be **"enforced through code and message classification — not prompts."** §12 requires that every outbound AI message is automatically **evaluated and blocked on failure**, with the result recorded per AI action.

The pre-Slice-5 send path had the red-line validator (`validateAIClientMessage`) and the gate's approved-AI-policy check (gate step 4), but no **authority matrix** mapping AI message *classes* to auto-send vs draft-only vs blocked, and no combined §12 evaluation record.

## Decision

**A pure authority matrix + a pure evaluation combiner, enforced in the send path for classified AI sends.**

1. **`ai-authority.ts` (pure).** `evaluateAiAuthority(messageClass) → { authority: 'auto_send' | 'draft_only' | 'blocked' }`. The approved low-risk classes (§11: approved first-touch, scheduled campaign, birthday, appointment confirmation/reminder, scheduling link, receipt acknowledgment, STOP/HELP/unsubscribe confirmation, availability question, approved thank-you) auto-send. Advisory/policy-specific/pricing/needs-analysis/product-comparison/replacement/underwriting/complaint/sensitive-data/financial-recommendation/case-affecting are **draft-only**. Securities is **blocked**. An **unknown/unclassified** class fails safe to **draft-only** — the AI never auto-sends anything the code cannot positively classify as low-risk.

2. **`evaluations.ts` (pure).** `evaluateOutboundMessage(signals) → { pass, authority, mayAutoSend, failures[] }` runs the §12 checks that combine already-resolved signals (ownership from Slice 1, identity disclosure from Slice 2, purpose + consent from Slice 3, template approval) with the draft content (reusing `containsRecommendationLanguage`) and the authority. It collects **all** failures (not just the first) so the recorded evaluation shows every issue. `mayAutoSend` is true only when the message passes **and** its class may auto-send.

3. **Enforcement in `send.ts` (opt-in via `ctx.aiMessageClass`).** For an `aiGenerated` send with a classified message, evaluations run **before dispatch**. If `!mayAutoSend` (draft-only, blocked, or any failure), the message is **not sent**: it is recorded as a draft on `agent_actions` (`kind='ai_draft'`, outcome, failure reasons, drafted content), the `comm_messages` row is marked blocked (`blocked_step='ai_authority'`), a "failed" event is logged, and the outcome escalates to the FSA. No schema change is needed — `agent_actions` and `comm_messages` already carry these fields.

## Rationale

- **Classification, not prompts.** The authority decision is a deterministic function of a message class the code assigns — not a model instruction the AI could ignore. Securities and advisory content cannot be auto-sent regardless of what a prompt says.
- **Fail-safe default.** An unclassified AI message is draft-only, so adding a new AI path without classifying it can never accidentally auto-send advisory content.
- **One send path, one record.** Enforcement lives in the existing `sendThroughGate` (ADR-003) and records to the existing `agent_actions` audit surface (ADR-008) — no parallel AI-review subsystem.
- **Composes with the gate.** Even an auto-send-class message still passes the full compliance gate (consent/DNC/quiet-hours/delegation/securities/frequency) afterwards; the authority matrix only decides *auto-send vs human draft*.

## Alternatives Considered

- **Rely on prompt instructions / the red-line validator alone** — rejected: §11 requires code+classification enforcement; a prompt is not a control, and the red-line validator checks content but not the auto-send-vs-draft authority of a message *class*.
- **A new agent-review table** — rejected: `agent_actions` already models an AI action with outcome, reason, and drafted content; a `kind='ai_draft'` row is the minimal record.
- **Enforce on all AI sends immediately (not opt-in)** — deferred: making enforcement unconditional would flip existing unclassified AI auto-replies to draft-only in one step. Opt-in via `ctx.aiMessageClass` lets each AI path adopt classification deliberately (the workforce/responder paths are the adoption follow-up), matching the behavior-preserving approach of Slices 1–4.

## Consequences

**Positive**
- The AI can auto-send only positively-classified low-risk messages; everything advisory/sensitive/securities is drafted for the licensed FSA, recorded and escalated.
- Deterministic, testable, prompt-independent enforcement with a full per-action record (§12).

**Negative / trade-offs**
- Enforcement is opt-in per `ctx.aiMessageClass`; AI paths that don't yet classify their messages keep the prior gate-only behavior (the classification-adoption follow-up covers the responder + workforce agents).
- The evaluation's DB-resolved signals (ownership/identity/consent) are passed in by the send path; a caller that mis-supplies them could mis-evaluate — mitigated by those signals being computed centrally in `sendThroughGate`.

## Related Documents

- CLAUDE.md §4.2, §11; master build instruction §11, §12
- ADR-002, ADR-003, ADR-004, ADR-008, ADR-015–018
- `src/lib/comms/ai-authority.ts`, `evaluations.ts`, `send.ts`
- Tests: `tests/comms-ai-authority.test.mjs`
