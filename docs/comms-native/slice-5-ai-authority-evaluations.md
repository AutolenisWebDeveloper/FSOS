# Native Communications Platform — Slice 5: AI Authority Matrix + Communication Evaluations

> Vertical slice per master build instruction §4 (Slice 5 of 9). Authoritative rationale: **ADR-019**.
> Enforced in the ONE send path + recorded on the existing `agent_actions` audit surface — no parallel AI-review subsystem (§0/§6). GHL untouched (§0.A). **Code-only (no migration).**

## What shipped

| Concern | Delivery |
|---|---|
| **AI authority matrix (§11)** | `ai-authority.ts` (pure): `evaluateAiAuthority(class) → auto_send | draft_only | blocked`. Approved low-risk classes auto-send; advisory/policy/pricing/needs-analysis/replacement/underwriting/complaint/sensitive/financial/case-affecting are **draft-only**; securities is **blocked**; **unknown fails safe to draft-only**. |
| **Communication evaluations (§12)** | `evaluations.ts` (pure): `evaluateOutboundMessage` collects **all** failures (recommendation language, missing purpose, unresolved ownership, missing identity disclosure, consent incompatibility, unapproved template, sensitive info, unverified fact) + the authority → `mayAutoSend`. |
| **Enforcement** | `send.ts` (opt-in via `ctx.aiMessageClass`): for a classified AI send, evaluations run **before dispatch**; `!mayAutoSend` → not sent, recorded as a draft on `agent_actions` (`kind='ai_draft'`), `comm_messages` marked blocked (`blocked_step='ai_authority'`), escalated to the FSA. |

## Enforced through code + classification, not prompts

The authority decision is a deterministic function of a code-assigned message class — a prompt cannot make the AI auto-send securities or advisory content. The full compliance gate still runs afterwards for an auto-send-class message.

## Scope boundary

Enforcement is **opt-in** via `ctx.aiMessageClass`. AI paths that don't yet classify their messages keep the prior gate-only behavior; classifying the responder + workforce agents is the adoption follow-up (documented in ADR-019). No schema change — `agent_actions`/`comm_messages` already record the AI action.

## Evidence

- `tests/comms-ai-authority.test.mjs` — 9 assertions: all 10 auto-send classes, all 12 draft-only classes, securities blocked, unknown → draft-only fail-safe, clean auto-send passes, draft-only passes eval but not auto-send, recommendation language fails, all-failures collected, sensitive-info blocks a clean class.
- `npm test` (+ai-authority) · `type-check` · `lint` · `test:rls` (unchanged) · `build` — all green.

## Guardrails touched

Securities firewall (§4.1): securities class is hard-blocked. AI red-line (§4.2): advisory/recommendation content is draft-only + recommendation language fails evaluation. Every actual send still passes the full gate. `agent_actions` records each AI action (§12). GHL frozen (§0.A).
