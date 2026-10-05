---
name: fsos-call-intelligence
description: Use when working on call records, transcripts, recordings, summaries, outcome extraction, the call_outcomes table, the supervision queue, complaint cases, retention or the archive.
---

# FSOS call intelligence and records

## Stored per call (append-only)
Call SID and FSOS call ID, direction, contact, timestamps, duration; assurance history; every turn with redacted text and what the caller actually heard; model, prompt, playbook, rules and script versions; tool requests and policy decisions; firewall and output-guard events; transfers; consent changes; recording reference (dual-channel, where approved); final disposition.

Tables (checklist Stage 0, repo-map §5): new `calls`, `call_turns`, `llm_calls`, `tool_invocations`, `dispositions`, `summaries`, `transfers` and `call_outcomes`, in `public` unless the owner chooses a `voice` schema (owner decision pending, C6). Consent changes go to the existing stores (`consents`, `comm_consent_purposes`, `comm_contact_consents`); audit goes through `writeAudit()` to the existing append-only `audit_log`. There is no voice `consent_records` or `audit_log`. Update and delete are blocked by trigger on turns and tool requests, reusing the `audit_log` pattern (`010:73-85`, `077:30-41`).

## Structured outcome (`extractCallOutcome`, runs after the call)
```ts
{ primaryIntent, secondaryIntent, disposition, appointmentId, opportunityId,
  followUps: [...], consentChange, complaintFlag, securitiesFlag, escalation, confidence }
```
Schema-validated. Below the confidence threshold → human review; never silently written. Outcomes create CRM notes and tasks through existing FSOS services (`notes`, `work_tasks`, `activities`), never directly. Summary via `createCallSummary` (template summary-v4).

## Supervision
Queue extends the existing escalation queue (`compliance_events`, `agent_actions`, written by `src/lib/comms/escalation.ts`) and receives firewall handoffs, output-guard blocks, complaints, consent changes and repeated verification failures, each linked to the source call. Complaint flow: detect → case → acknowledgment through the dispatch chokepoint → principal's reportability decision → close.

## Archive and retention
Write-once archive (object lock) and hash chain, both new (owner decision pending, C7); retention per counsel's schedule (SEA 17a-4 / FINRA 4511 scope confirmed by counsel); legal hold (existing `legal_holds` table) overrides deletion. Exports are logged; call history is read-only.

## Exit (Stage 4)
≥ 95% extraction accuracy on a 300-call labeled set; 100 random calls restored with the hash chain intact; supervision staffed; go/no-go signed for the practice.
