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
  → FSOS Voice Orchestrator (one session per call, container runtime — owner decision pending, C14)
       ├─ Identity (assurance AL0–AL3)
       ├─ Firewall (rules → classifier → output guard)
       ├─ LLM gateway: runGateway() in src/lib/ai/gateway.ts (primary + fallback, kill switch, cost telemetry; streaming to add)
       └─ Policy engine (identity, permission, compliance gate, workflow state, parameters)
  → Approved tools only
  → FSOS systems of record (Postgres with FSOS role-based RLS, CRM, calendar, imported policy records, consent, licenses, audit_log)
Outbound: FSOS campaign engines / calendar → outreach intent → dispatch chokepoint (messaging.ts, voice_ai) → dialer + AMD → same orchestrator
```

## Components and where they run (reconciled with repo-map)
- TwiML webhooks: `/api/webhooks/twilio/voice/{inbound,connect-action,status}` on the existing Vercel project `fsos`.
- Orchestrator: long-running WebSocket service on a container runtime (ECS Fargate or Fly.io), not serverless functions. New infrastructure, including how it reuses `messaging.ts`, `gateway.ts` and `writeAudit` (owner decision pending, C14).
- Redis: session snapshots, idempotency keys, rate limits (new dependency (owner decision pending, C14)).
- Models: Claude Haiku 4.5 (`claude-haiku-4-5-20251001`) primary; a pinned fallback for fallback and post-call summaries (owner decision pending, C26). All calls go through `runGateway()`; never import the Anthropic SDK outside `gateway.ts` (`tests/ai-gateway-seam.test.mjs`). Every model change re-runs the full evaluation suite.
- Data: new voice tables in Supabase Postgres, in `public` unless the owner chooses a `voice` schema (owner decision pending, C6); consent and audit reuse the existing stores.

## Invariants (never break)
1. One orchestrator. Workflows are versioned playbooks, never separate bots.
2. The model only requests actions. FSOS authorizes and executes. Model output never decides authorization.
3. No direct database access or mutation by the model; approved tools only.
4. Every tool call passes the policy engine and is audited.
5. Every outbound call, text and voicemail goes through the dispatch chokepoint in `src/lib/messaging.ts`. No second send path.
6. Keypad digits, PINs and one-time codes never reach the model, prompts or ordinary logs.
7. Facts (policy status, deadlines, appointments, licensing) come only from FSOS records (`household_policies`, `appointments`, `licenses`). Missing or stale data is never guessed.
8. A caller can always reach a person ("representative", "agent", keypad 0).
9. Prompt text is guidance; enforcement lives in the firewall, policy engine, output guard, tool permissions and gate.
10. Excluded: product recommendations, suitability, money movement, beneficiary/payment/address changes by AI alone, underwriting or eligibility decisions, voice biometrics, NIGO workflows.

## Required review question
Before changing architecture, answer in writing: does this preserve one orchestrator, versioned playbooks, FSOS-owned authorization, approved-tool-only data access and the single outbound gate? If not, stop and raise it.

## Failure model
| Failure | Behavior |
|---|---|
| FSOS or orchestrator down | Twilio number fallback URL rings the practice |
| Primary model slow/failing | Fallback model; filler S-HOLD-01 after 0.7 s on slow lookups |
| Both models fail | Fixed script S-FALL-01, then transfer to a person |
| WebSocket drops | One reconnect attempt, then the practice's ring or forward number |
| Calendar unavailable | No booking; offer callback task |
| Policy records missing or stale | No policy facts spoken; "can't confirm right now" path |
| Compliance gate unavailable | No outbound call |
| Spend or concurrency cap | AI pauses; calls ring the practice |
