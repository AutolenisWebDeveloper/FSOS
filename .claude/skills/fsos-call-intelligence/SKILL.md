---
name: fsos-call-intelligence
description: Use when working on call records, transcripts, recordings, summaries, outcome extraction, voice.call_outcomes, the supervision queue, complaint cases, retention or the archive.
---

# FSOS call intelligence and records

## Stored per call (append-only)
Call SID and FSOS call ID, office, direction, contact, timestamps, duration; assurance history; every turn with redacted text and what the caller actually heard; model, prompt, playbook, rules and script versions; tool requests and policy decisions; firewall and output-guard events; transfers; consent changes; recording reference (dual-channel, where approved); final disposition.

Tables (from the spec; confirm in repo-map): `voice.calls`, `call_turns`, `llm_calls`, `tool_invocations`, `consent_records`, `dispositions`, `summaries`, `transfers`, `audit_log` (hash-chained), plus `voice.call_outcomes`. Update and delete are blocked by trigger on audit, turns, tool requests and consent.

## Structured outcome (`extractCallOutcome`, runs after the call)
```ts
{ primaryIntent, secondaryIntent, disposition, appointmentId, opportunityId,
  followUps: [...], consentChange, complaintFlag, securitiesFlag, escalation, confidence }
```
Schema-validated. Below the confidence threshold → human review; never silently written. Outcomes create CRM notes and tasks through existing FSOS services, never directly. Summary via `createCallSummary` (template summary-v4).

## Supervision
Queue receives firewall handoffs, output-guard blocks, complaints, consent changes and repeated verification failures, each linked to the source call. Complaint flow: detect → case → acknowledgment through the gate → principal's reportability decision → close.

## Archive and retention
Write-once archive (object lock), hourly hash-chain export; retention per counsel's schedule (SEA 17a-4 / FINRA 4511 scope confirmed by counsel); legal hold overrides deletion. Exports are logged; call history is read-only.

## Exit (Stage 4)
≥ 95% extraction accuracy on a 300-call labeled set; 100 random calls restored with the hash chain intact; supervision staffed; go/no-go signed.
