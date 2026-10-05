---
name: fsos-twilio-voice
description: Use when working on Twilio Voice, ConversationRelay, TwiML webhooks, the orchestrator WebSocket, recording, keypad input, transfers, answering-machine detection, outbound dialing or phone-number routing for FSOS.
---

# FSOS Twilio voice conventions

Verify every Twilio detail against current Twilio docs (use the Twilio docs tools if available) before coding; the notes below come from the build spec and may have changed.

## Inbound
- `/voice/inbound` (TwiML webhook, signature-validated) returns `<Connect action="/voice/connect-action"><ConversationRelay url="wss://…" …/></Connect>` with per-office settings (language, voice, transcription provider, DTMF detection, interruptible).
- Recording starts before the opening disclosure DISC-v3; disclosure is not interruptible.
- Number fallback URL points straight to the office ring group if FSOS is unreachable.
- `/voice/status` records call status callbacks, correlated by Call SID.

## WebSocket (orchestrator)
- Validate `X-Twilio-Signature` on upgrade; confirm the exact URL format used for signing in staging. Reject and alert on failure.
- One connection per call; session keyed by Call SID; snapshot to Redis.
- Incoming messages: `setup`, `prompt`, `interrupt`, `dtmf`, `error`. Outgoing: `text`, `play`, `sendDigits`, `language`, `end`. Schema-check every outgoing frame.
- `dtmf` digits go to the identity module only, never to the model.
- `interrupt` cancels the in-flight model turn and records what the caller actually heard (tokens played).
- Dropped connection: one reconnect attempt, then the office ring group.

## Transfer
Orchestrator sends `end` with an opaque transfer ID in handoff data → Twilio calls `/voice/connect-action` → FSOS resolves the target server-side and returns `<Dial>` with whisper; recording notice repeated on the new leg; no answer → voicemail + callback task.

## Outbound
`calls.create` only from the dialer after `sendThroughGate` passes; async answering-machine detection; pacing and concurrency per office; attempt caps; idempotency on intent ID so retries never double-dial.

## Limits and ops
Get written confirmation of ConversationRelay max call length, concurrency and data locations (Ops). Separate subaccounts for dev, staging, prod. Per-office concurrency limit and spend cap. Twilio AI/ML addendum accepted before use.

## Tests
Signature rejection, reconnect, barge-in mid-sentence, DTMF isolation, transfer no-answer, AMD human/machine, duplicate status callbacks, concurrency cap reached.
