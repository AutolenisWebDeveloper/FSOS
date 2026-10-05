---
name: fsos-voice-playbooks
description: Use when creating or changing any of the 18 Voice Agent workflows, their playbooks, scripts, allowed tools or exit rules, or the voice.playbooks table.
---

# FSOS Voice playbooks

A playbook is a versioned bundle the single orchestrator loads per call. It is data, stored in `voice.playbooks`, tied to a release. It is not a separate agent.

## Required fields
```yaml
workflow_id:          # 1–18, stable
name:
version:              # semver; bump on any change; approved in Change approvals
direction:            # inbound | outbound | both
purpose:              # informational | telemarketing (outbound only; counsel-classified)
required_assurance:   # minimum AL for the workflow; tools may require more
required_consent:     # none | PEC | PEWC | same-as-parent-call
allowed_tools: []     # explicit allow-list
forbidden_actions: [] # always includes the global prohibited list
approved_scripts: []  # script IDs, e.g. DISC-v3, S-SEC-01, S-HUMAN-01, S-AUTH-02, S-REVOKE-01, VM-INF-2
knowledge_scope:      # approved, unexpired answers only
firewall_rules:       # workflow-specific bait on top of the global firewall
human_transfer_rules: # when to hand off and to whom
success_outcomes: []
failure_outcomes: []
exit_rules: []
prompt_section:       # the model-facing instructions for this workflow
```

## The 18 workflows
| # | Workflow | Stage | Direction | Identity | Consent for AI voice | Hands to a person when |
|---|---|---|---|---|---|---|
| 1 | New inbound lead | 1 | Inbound | AL0 | None | Advice asked or person requested |
| 2 | Existing client | 2 | Inbound | AL1–AL2 | None | Securities, complaint, change request, failed verification |
| 3 | Missed lead | 6 | Outbound | AL0 | PEC if returning their inquiry; PEWC if marketing | Advice asked |
| 4 | Appointment scheduling | 1 | Both | AL0 new, AL1 existing | PEC | No suitable slot, special request |
| 5 | Appointment reminders | 5 | Outbound | AL1 | PEC | Anything beyond the appointment |
| 6 | Annual reviews | 7 | Outbound | AL1 | Likely PEWC (counsel) | Product questions |
| 7 | Life-policy reviews | 7 | Both | AL1 | Likely PEWC if outbound (counsel) | Product or suitability question |
| 8 | Term conversion | 8 | Both | AL2 before any policy fact | Likely PEWC if outbound (counsel) | Any "should I" question |
| 9 | Life win-back | 9 | Outbound | AL0–AL1 | PEWC | Product questions |
| 10 | Cross-sell | 11 | Outbound | AL1 | PEWC | Any product question |
| 11 | Workshop follow-up | 10 | Outbound | AL0 | PEWC on the registration form | Product questions |
| 12 | Referral follow-up | 1 | Inbound AI only; first outbound by a person | AL0 | No AI outbound | Always a person for first outbound |
| 13 | No-show recovery | 5 | Outbound | AL1 | PEC | Complaint or frustration |
| 14 | Case-status calls | 2 | Inbound | AL2 | None | Stale data, securities, disputes |
| 15 | Inbound service | 2 | Inbound | AL1 for account items | None | Beneficiary, payment, address changes |
| 16 | Human transfer | 3 | Both | Any | n/a | Always on request |
| 17 | Voicemail | 5 | Outbound | n/a | Same as the call it follows | Never marketing voicemail without PEWC |
| 18 | DNC / stop request | 1 inbound, 6 outbound | Both | None | n/a | Never blocked by verification |

"Likely" classifications are not confirmed until counsel records them. A playbook for an outbound workflow cannot be enabled while its classification is open.

## Rules
- Outbound playbooks never choose who to call. Existing FSOS agents (`term_conversion`, `marketing_automation`) and calendar events create outreach intents; the playbook only runs the call.
- Every script and answer is approved in Change approvals before use; generated text never replaces a fixed script where one is required.
- Scripts for workflows 6–11 contain no product names, rates, returns, benefit claims or comparisons.
- Playbook changes ship through the release path (flag, canary, rollback) like code.
- Tests: each playbook has scripted-call scenarios and a firewall bait set that must pass 100%.
