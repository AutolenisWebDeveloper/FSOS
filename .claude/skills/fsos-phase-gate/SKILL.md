---
name: fsos-phase-gate
description: Use before coding a stage, during review, and before any claim that a Voice Agent stage is complete. Enforces the build checklist and the completion rule.
---

# FSOS phase gate

The checklist lives in `docs/voice/voice-agent-build-checklist.md`. Read it from there every time; do not rely on a copy in memory or in this skill (a copy would drift).

## Before coding a stage
List every item under that stage plus the universal definition of done, and state how each will be satisfied or why it is BLOCKED (owner).

## Status for every item
PASS (with evidence) · FAIL · BLOCKED (outside owner + decision needed) · N/A (with reason). NOT VERIFIED is never PASS.

Evidence labels: CODE-VERIFIED · TEST-VERIFIED · INTEGRATION-VERIFIED · BROWSER-VERIFIED · COMPLIANCE-VERIFIED · EXTERNAL-DEPENDENCY · NOT VERIFIED.

Items owned by Counsel, Compliance, Principal or Ops are BLOCKED until a person records the approval. The agent cannot mark them PASS. An item tagged "owner decision pending, Cnn" is BLOCKED (owner: the FSA, decision Cnn in `docs/voice/repo-map.md` §12) until the owner decides; do not build on the default as if it were settled.

## Completion rule
Say PHASE COMPLETE only if all of these are true:
- every mandatory item = PASS
- every P0 = closed
- every stage exit criterion = PASS with evidence
- every required approval = recorded
- no mandatory item = NOT VERIFIED

Otherwise say PHASE NOT COMPLETE and list what blocks it. Code existing, compiling or passing the happy path is not completion.

## Report
Write `docs/voice/reports/stage-NN.md` using the checklist's phase completion report template (status, requirements, code, screens, security, compliance, data/audit, tests, failure modes, exit criteria with evidence labels, open items, final determination).

## Scope
No phase bleed: do not implement the next stage's items. Note them as out of scope.
