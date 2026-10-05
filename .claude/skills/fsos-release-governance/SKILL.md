---
name: fsos-release-governance
description: Use when shipping any Voice Agent change (code, prompt, playbook, script, rules, model) - approvals, feature flags, shadow, canary, rollout and rollback.
---

# FSOS release governance

Nothing is "done and deployed." Every change follows:
1. Build behind a per-office feature flag (off by default)
2. Automated tests and scripted-call suite
3. Compliance red-team suite
4. Shadow mode where it applies
5. Approval in Change approvals by someone other than the requester (four-eyes)
6. Canary: one office or 10% of calls
7. Watch guardrails and business metrics
8. Expand (50% → 100%) only while exit criteria hold
9. Previous version kept for one-step rollback

Stage 1 ships the minimum path (flags, canary, rollback, approvals). Stage 12 adds the full Releases screen and automatic rollback.

## Release record
version · prompt_version · playbook_versions · rules_version · tool_versions · model (pinned ID) · approval (who, when) · test_results (links) · rollout_percent · rollback_version.

## Automatic rollback triggers
Firewall miss · forbidden recommendation output · assurance leakage · transfer failures > 2% · p90 > 2.0 s · booking errors · abnormal jump in callers asking for a person · any compliance violation.

## Rules
- Outbound workflows (stages 6–11) stay flag-off until counsel signs off that workflow.
- Model changes re-run the full suite; model IDs pinned by date.
- AI governance register updated with every release (components, versions, owner, evidence).
