---
name: fsos-twilio-voice
description: Use when working on Twilio Voice, ConversationRelay, TwiML webhooks, the orchestrator WebSocket, recording, keypad input, transfers, answering-machine detection, outbound dialing or phone-number routing for FSOS.
---

# FSOS Twilio voice conventions

Verify every Twilio detail against current Twilio docs (use the Twilio docs tools if available) before coding; the notes below come from the build spec and may have changed. FSOS has no Twilio Voice code today (repo-map §8); existing Twilio code is SMS only (`src/lib/messaging.ts`, `src/lib/comms/twilio.ts`, `src/app/api/webhooks/twilio/`).

## Inbound
- `/api/webhooks/twilio/voice/inbound` (TwiML webhook, signature-validated with `verifyTwilioSignature`, failing closed when the auth token is unset) returns `<Connect action="/api/webhooks/twilio/voice/connect-action"><ConversationRelay url="wss://…" …/></Connect>` with the practice's settings (language, voice, transcription provider, DTMF detection, interruptible).
- Recording starts before the opening disclosure DISC-v3; disclosure is not interruptible.
- Number fallback URL points straight to the practice's ring or forward number if FSOS is unreachable.
- `/api/webhooks/twilio/voice/status` records call status callbacks, correlated by Call SID.

## WebSocket (orchestrator)
- Validate `X-Twilio-Signature` on upgrade; confirm the exact URL format used for signing in staging. Reject and alert on failure.
- One connection per call; session keyed by Call SID; snapshot to Redis (new dependency (owner decision pending, C14)).
- Incoming messages: `setup`, `prompt`, `interrupt`, `dtmf`, `error`. Outgoing: `text`, `play`, `sendDigits`, `language`, `end`. Schema-check every outgoing frame.
- `dtmf` digits go to the identity module only, never to the model.
- `interrupt` cancels the in-flight model turn and records what the caller actually heard (tokens played).
- Dropped connection: one reconnect attempt, then the practice's ring or forward number.

## Transfer
Orchestrator sends `end` with an opaque transfer ID in handoff data → Twilio calls `/api/webhooks/twilio/voice/connect-action` → FSOS resolves the target server-side and returns `<Dial>` with whisper; recording notice repeated on the new leg; no answer → voicemail + callback task.

## Outbound
`calls.create` only inside the dispatch chokepoint's `voice_ai` path (`startVoiceCall` → `MessagingDeps.placeCall` in `src/lib/messaging.ts`) after policy passes; async answering-machine detection; pacing and concurrency for the practice; attempt caps; idempotency on intent ID so retries never double-dial.

## Limits and ops
Get written confirmation of ConversationRelay max call length, concurrency and data locations (Ops). Separate subaccounts for dev, staging, prod. Concurrency limit and spend cap for the practice. Twilio AI/ML addendum accepted before use.

## Tests
Signature rejection, reconnect, barge-in mid-sentence, DTMF isolation, transfer no-answer, AMD human/machine, duplicate status callbacks, concurrency cap reached.
