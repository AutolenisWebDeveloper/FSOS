---
name: fsos-release-governance
description: Use when shipping any Voice Agent change (code, prompt, playbook, script, rules, model) - approvals, feature flags, shadow, canary, rollout and rollback.
---

# FSOS release governance

Nothing is "done and deployed." Every change follows:
1. Build behind the workflow's `automation_switches` key (off / canary / on; off by default; fails closed — `src/lib/ops/automation-switch.ts`)
2. Automated tests and scripted-call suite
3. Compliance red-team suite
4. Shadow mode where it applies
5. Approval in Change approvals by someone other than the requester (four-eyes)
6. Canary: verified test recipients (`comms_test_recipients`) or 10% of calls
7. Watch guardrails and business metrics
8. Expand (50% → 100%) only while exit criteria hold
9. Previous version kept for one-step rollback

Stage 1 ships the minimum path (switch keys, canary, rollback, approvals). Approvals reuse the template approval model (`src/lib/comms/template-admin.ts`: authors can't approve their own work). Migration 140 (`automation_switches`) is not yet applied to the live database (repo-map §6); it must be before any switch is relied on. Stage 12 adds the full Releases screen and automatic rollback.

## Release record
version · prompt_version · playbook_versions · rules_version · tool_versions · model (pinned ID (owner decision pending, C26)) · approval (who, when) · test_results (links) · rollout_percent · rollback_version.

## Automatic rollback triggers
Firewall miss · forbidden recommendation output · assurance leakage · transfer failures > 2% · p90 > 2.0 s · booking errors · abnormal jump in callers asking for a person · any compliance violation.

## Rules
- Outbound workflows (stages 6–11) stay switched off until counsel signs off that workflow.
- Model changes re-run the full suite; model IDs pinned by date (the gateway default `claude-sonnet-5` is an undated alias, `src/lib/ai/gateway.ts:75`).
- AI governance register updated with every release (components, versions, owner, evidence).
