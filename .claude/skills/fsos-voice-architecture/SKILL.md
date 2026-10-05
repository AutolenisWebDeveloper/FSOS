---
name: fsos-voice-architecture
description: Use whenever touching anything in the FSOS Voice Agent (telephony, orchestrator, LLM gateway, policy engine, tools, playbooks, voice data). Encodes the system shape and the invariants that must never be broken.
---

# FSOS Voice Agent architecture

## Call path
```
Caller
  → Twilio Voice + ConversationRelay (speech to text, text to speech, barge-in, keypad, recording)
  → signed WebSocket (X-Twilio-Signature checked on upgrade)
  → FSOS Voice Orchestrator (one session per call, container runtime)
       ├─ Identity (assurance AL0–AL3)
       ├─ Firewall (rules → classifier → output guard)
       ├─ LLM gateway (primary + fallback model behind an LlmProvider interface)
       └─ Policy engine (identity, permission, compliance gate, workflow state, parameters)
  → Approved tools only
  → FSOS systems of record (Postgres with agency RLS, CRM, calendar, policy system, consent, licensing, audit)
Outbound: FSOS agents / calendar → outreach intent → sendThroughGate → dialer + AMD → same orchestrator
```

## Components and where they run (from the plan; confirm in repo-map)
- TwiML webhooks: `/voice/inbound`, `/voice/connect-action`, `/voice/status` on the existing web host (Vercel).
- Orchestrator: long-running WebSocket service on a container runtime (ECS Fargate or Fly.io). Not serverless functions.
- Redis: session snapshots, idempotency keys, rate limits.
- Models: Claude Haiku 4.5 (`claude-haiku-4-5-20251001`) primary; Claude Sonnet 5 (`claude-sonnet-5`) fallback and post-call summaries. Pin model IDs; every model change re-runs the full evaluation suite.
- Data: `voice` schema in Supabase Postgres.

## Invariants (never break)
1. One orchestrator. Workflows are versioned playbooks, never separate bots.
2. The model only requests actions. FSOS authorizes and executes. Model output never decides authorization.
3. No direct database access or mutation by the model; approved tools only.
4. Every tool call passes the policy engine and is audited.
5. Every outbound call, text and voicemail goes through `sendThroughGate`. No second send path.
6. Keypad digits, PINs and one-time codes never reach the model, prompts or ordinary logs.
7. Facts (policy status, deadlines, appointments, licensing) come only from source systems. Missing or stale data is never guessed.
8. A caller can always reach a person ("representative", "agent", keypad 0).
9. Prompt text is guidance; enforcement lives in the firewall, policy engine, output guard, tool permissions and gate.
10. Excluded: product recommendations, suitability, money movement, beneficiary/payment/address changes by AI alone, underwriting or eligibility decisions, voice biometrics, NIGO workflows.

## Required review question
Before changing architecture, answer in writing: does this preserve one orchestrator, versioned playbooks, FSOS-owned authorization, approved-tool-only data access and the single outbound gate? If not, stop and raise it.

## Failure model
| Failure | Behavior |
|---|---|
| FSOS or orchestrator down | Twilio number fallback URL rings the office group |
| Primary model slow/failing | Fallback model; filler S-HOLD-01 after 0.7 s on slow lookups |
| Both models fail | Fixed script S-FALL-01, then transfer to a person |
| WebSocket drops | One reconnect attempt, then the office ring group |
| Calendar unavailable | No booking; offer callback task |
| Policy system unavailable | No policy facts spoken; "can't confirm right now" path |
| Compliance gate unavailable | No outbound call |
| Spend or concurrency cap | AI pauses; calls ring the office |
