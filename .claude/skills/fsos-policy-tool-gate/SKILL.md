---
name: fsos-policy-tool-gate
description: Use when adding, changing or calling any Voice Agent tool, or touching the policy engine. Tool execution is the security boundary between the model and FSOS data.
---

# FSOS policy engine and tool gate

## Evaluation order for every tool request
1. Tool exists and is enabled for this office
2. Tool is on the current playbook's allow-list
3. Caller role and agency permit it
4. Session assurance ≥ the tool's minimum
5. Subject (contact/client) is one this caller may act on
6. Consent requirement met (outbound and messaging tools)
7. Compliance rules satisfied (firewall state, script approval, calling window)
8. Licensing requirement met (routing and regulated topics)
9. Parameters valid against the schema
10. Source state re-read where it can change (slot still free, deadline still current)
11. Execute with idempotency key; write audit event

Any failure returns a typed denial the orchestrator can speak through an approved script. Denials are audited like executions. Log each request as requested → validated or denied → executed or failed.

## Tool definition contract
```ts
interface VoiceToolDefinition<I, O> {
  name: string;
  schema: ZodSchema<I>;              // or the repo's existing validator (check repo-map)
  minimumAssurance: 'AL0' | 'AL1' | 'AL2' | 'AL3' | 'SYSTEM' | 'NONE';
  allowedWorkflows: WorkflowId[];
  permissionPolicy: PolicyFn;
  compliancePolicy: PolicyFn;
  idempotencyPolicy: { keyFrom: (input: I) => string; ttlSeconds: number };
  auditPolicy: { redact: (keyof I)[] };
  timeoutMs: number;
  execute(input: I, ctx: ToolContext): Promise<O>; // calls existing FSOS services only
}
```

## Tool catalog (minimum identity)
findClient AL0 (match status + token only below AL2) · findLead AL0 · getAppointmentAvailability AL0 · scheduleAppointment AL0 new / AL1 existing · rescheduleAppointment AL1 + number match · cancelAppointment AL1 + number match · confirmAppointment AL1 · createFollowUpTask AL0 · getCaseStatus AL2 · sendApprovedSMS AL1 (via sendThroughGate) · transferToFSA AL0 · createOrUpdateContact AL0 · qualifyLead AL0 · createServiceCase AL1 · recordSuppression NONE · leaveApprovedVoicemail SYSTEM · extractCallOutcome SYSTEM · createOutreachIntent SYSTEM · recordConsentChange SYSTEM · logCall SYSTEM · createCallSummary SYSTEM · checkConsent / checkDNC / sendThroughComplianceGate SYSTEM.

SYSTEM tools are never exposed to the model's tool list.

## Must never exist
recommendInvestment, recommendAnnuity, selectProduct, determineSuitability, moveMoney, changeBeneficiary, approveUnderwriting, and any NIGO tool. A review that finds one blocks the stage.

## Rules
- Tools call existing FSOS services; they do not write tables directly unless repo-map shows no service exists, and then the service is added, not the shortcut.
- Results are filtered by assurance on the server before the model sees them.
- No tool returns internal IDs, stack traces or other agencies' data.
- Tests per tool: schema rejection, each denial branch, idempotent retry, cross-agency denial, audit written.
