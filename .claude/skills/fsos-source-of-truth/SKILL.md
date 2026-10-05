---
name: fsos-source-of-truth
description: Use before any material FSOS Voice Agent change (code, schema, playbook, script, screen). Reconciles the approved documents with the existing code before anything is proposed, and fixes which document wins when they disagree.
---

# FSOS source of truth

## Source precedence (highest first)
1. The current approved stage prompt from the user
2. The root `CLAUDE.md` FSOS rules (architecture invariants, compliance boundaries, protected paths). The voice documents never override them.
3. `docs/voice/voice-agent-plan.md` (scope, agent model, 12-stage sequence, compliance rules, tools, metrics)
4. `docs/voice/voice-agent-build-checklist.md` (definition of done, per-stage items, exit criteria, traceability)
5. `docs/voice/repo-map.md` (what already exists in FSOS, with paths; §12 lists the reconciled conflicts)
6. The design canvas (31 screens), for layout and content only; it uses mock data and temporary styling
7. The existing implementation

The plan and checklist were reconciled with the code on Oct 5, 2026. Lines tagged "owner decision pending, Cnn" carry a default the owner has not confirmed: treat them as BLOCKED, not as settled requirements.

## Procedure before proposing changes
1. Read the plan section for the stage and the workflows involved.
2. Read that stage's checklist items and the universal definition of done.
3. Read `docs/voice/repo-map.md`; if it is missing or stale for this area, inspect the code and update it first.
4. Inspect the actual files you would touch.
5. Reconcile: for each requirement, record EXISTS (path), PARTIAL (gap) or MISSING.
6. Only then propose changes, citing the requirement each change satisfies.

## Conflicts
- If the code conflicts with the approved documents, do not silently keep the code and do not silently rewrite it. Stop, list the conflict (document, section, file, line), and ask.
- If two documents conflict, the higher one in the precedence list wins, but still report the conflict so the lower document gets fixed.
- Never invent a requirement that is not in the documents. Out-of-scope findings are reported, not implemented.

## Claim labels
Every material claim is VERIFIED (seen in code or run this session), ASSUMPTION (inferred) or UNVERIFIED (guess). "I could not find it" is a valid answer.
