# FSOS Part 4 — Data & API Map

> Connects every module to its database tables, API routes, background jobs, triggers, integrations, and audit events. Pairs with `../routes.md` (file paths), `../data-guardrails.md` (schema/RLS/guardrails), and Part 3 workflows.
> Every API route: `dynamic='force-dynamic'`, `runtime='nodejs'`, Zod-validated, RLS + `rbac` enforced, mutations write `audit_log`. 🛡 = passes a guardrail lib.

---

## 1. Module → data layer map

### Agency Network (OS-02)
- **Tables:** `regions, districts, agency_partnerships (root), agency_owners, agency_activation, agency_tags, tags`
- **Views:** `v_top_agencies, v_agencies_overdue_checkin, v_crosssell_targets`
- **API:** `api/agencies` (GET/POST), `api/agencies/[id]` (GET/PATCH/DELETE-soft), `api/agencies/[id]/activation`
- **Jobs:** `agency-dormancy` (flag dormant → task), activation reminders
- **Triggers:** on partnership create → seed activation + first check-in task; rollup refresh on referral/placement
- **Integrations:** none required (manual/CSV import fallback)
- **Audit:** create/edit/delete, status change, check-in send/block

### Referral (OS-03)
- **Tables:** `referrals, consents (capture), households (on convert)`
- **Views:** `v_referrals_awaiting_action`
- **API:** `api/referrals`, `api/referrals/[id]`, `api/referrals/[id]/convert` 🛡, `api/referrals/[id]/reject`
- **Jobs:** `referral-sla` (aging/breach → ⤴)
- **Triggers:** create → SLA timer + notify FSA; convert → household/opportunity + attribution
- **Integrations:** public form intake; Twilio/email for follow-up 🛡
- **Audit:** create, first-touch, convert (with ids), reject

### Client & Household (OS-04)
- **Tables:** `households, household_members (DOB encrypted), consents, preferences, activities, notes`
- **API:** `api/households`, `api/households/[id]`, `api/households/[id]/members`, `api/households/merge`
- **Triggers:** DOB → birthday/life-event review triggers; merge → re-point children + tombstone
- **Audit:** create/edit (field diff), DOB view, member add, merge (both ids + decisions)

### Policy & Coverage (OS-05)
- **Tables:** `policies (is_security, x_date, conversion_deadline, is_with_us), coverages, carriers, products`
- **Views:** `v_cross_sell_gaps` (household lines), lapse-risk view
- **API:** `api/policies`, `api/policies/[id]`
- **Jobs:** `renewal-watch` (renewal tasks), `xdate-watch` (competitor X-date cadence), `conversion-watch`
- **Audit:** create/edit, is_security view (firewall event on any automation attempt)

### Financial Review (OS-06)
- **Tables:** `reviews, activities, appointments, tasks, documents (materials), opportunities (originated)`
- **API:** `api/reviews`, `api/reviews/[id]`, `api/reviews/[id]/outcome` 🛡
- **Jobs:** review-due detection (anniversaries, windows, life events)
- **Integrations:** Google Calendar 🔌 (fallback manual)
- **Audit:** schedule, outcome, generated-opportunity ids; securities/replacement ⤴ events

### Term Conversion (OS-07)
- **Tables:** `policies (conversion_deadline), campaigns, campaign_enrollments, activities`
- **Views:** conversions-due (tiered)
- **API:** `api/conversions`, `api/conversions/[id]`
- **Jobs:** `conversion-watch` → enroll + educational cadence 🛡
- **Audit:** enrollment, sends/blocks, responses, outcome

### Cross-Sell (OS-08)
- **Tables:** `campaigns, campaign_enrollments`; **Views:** `v_cross_sell_gaps, v_crosssell_targets`
- **API:** `api/cross-sell`
- **Jobs:** `cross-sell-scan` → score + enroll (invitation only) 🛡
- **Audit:** enrollment, sends/blocks, responses, outcome

### Opportunity & Pipeline (OS-09)
- **Tables:** `opportunities (is_security, license_basis_used, ffs_case_ref, stage_history), tasks, documents, activities`
- **Views:** `v_pipeline_by_engagement`
- **API:** `api/opportunities`, `api/opportunities/[id]`, `api/opportunities/[id]/stage` 🛡
- **Triggers:** placed_issued → prompt commission record
- **Audit:** create, every stage change (actor+ts), outcome; securities-scope blocks

### Case Management (OS-10)
- **Tables:** `cases, case_requirements, documents, activities`
- **API:** `api/cases`, `api/cases/[id]`, `api/cases/[id]/requirements`
- **Jobs:** milestone tracking, missing-document detection (Document Intelligence)
- **Audit:** create, status/requirement/issue changes, service requests

### Commission (OS-11)
- **Tables:** `commissions (generated split amounts), commission_splits (defaults, is_assumption)`
- **Views:** `v_commission_by_agency`
- **API:** `api/commissions`, `api/commissions/[id]`, `api/commissions/splits`
- **Jobs:** `commission-reconcile` (expected vs received → discrepancy)
- **Integrations:** no Farmers payout API (manual/CSV fallback, labeled)
- **Audit:** create, split-config change (before/after), adjustment (reason), chargeback

### Marketing & Communications (OS-12)
- **Tables:** `campaigns, campaign_enrollments, templates (versions, approval), messages, suppression, consents`
- **API:** `api/comms/send` 🛡 (the dispatcher), `api/comms/templates`, `api/comms/campaigns`
- **Jobs:** `campaign-dispatch` 🛡 (per-recipient 13-step gate — `../data-guardrails.md` §5)
- **Integrations:** Twilio 🔌 (`webhooks/twilio` inbound STOP), email provider 🔌 (`webhooks/email`)
- **Audit:** template create/edit/approve, campaign activate, every send AND block

### Document (OS-13)
- **Tables:** `documents (versions, classification, retention, legal_hold), document_requests`
- **API:** `api/documents`, `api/documents/[id]`, `api/documents/upload`
- **Integrations:** Supabase Storage 🔌 (signed URLs, virus scan)
- **Audit:** upload, classify, share (signed URL), delete (legal-hold check)

### Tasks, Calendar & Workflow (OS-14)
- **Tables:** `tasks, appointments, workflows, workflow_runs`
- **API:** `api/tasks`, `api/calendar`, `api/appointments`
- **Jobs:** recurring-task generation; workflow engine (triggers/conditions/delays/branching/failure/retry)
- **Integrations:** Google Calendar 🔌
- **Audit:** task state, appointment lifecycle, workflow runs

### AI Operations (OS-15)
- **Tables:** `ai_agents, agent_runs, agent_actions, compliance_events (escalations)`
- **API:** `api/ai/run` (enqueue durable job), `api/ai/escalations`
- **Jobs:** `agent-runner` 🛡 (kill-switch → gateway → guardrail → act/escalate)
- **Integrations:** AI gateway 🔌 (Claude-first, OpenAI/Gemini fallback), cost/token logging
- **Audit:** every run (model, tokens, cost, confidence), every action, every escalation

### Compliance (OS-16) + Compliance Portal (P-3)
- **Tables:** `compliance_events, consents, dnc, licenses, appointments(licensing), exceptions, incidents, legal_holds, attestations, policy_versions, audit_log`
- **API:** `api/consent`, compliance read endpoints, `api/compliance/incidents`
- **Jobs:** license-expiry watch; incident deadline reminders
- **Audit:** all reads logged (oversight); exception overrides; incident steps

### Reporting & Analytics (OS-17)
- **Tables:** reads across all + `reports, scheduled_reports`
- **API:** `api/reports`, `api/reports/[id]/export`
- **Jobs:** scheduled-report delivery (email)
- **Audit:** generation + export

### System Administration (OS-18) + Super (P-6)
- **Tables:** `users, roles, permissions, orgs, districts, agencies, carriers, products, states, feature_flags, integrations, api_keys, webhooks, jobs, errors, usage, backups, retention_policies`
- **API:** `api/super/*`, `api/admin/imports`, `api/health`
- **Jobs:** `backup-verify`, `data-quality`, job queue/retry infra
- **Integrations:** all connectors managed here 🔌 (never invents an unavailable Farmers/FFS API)
- **Audit:** every platform action, impersonation, config change

---

## 2. Background job registry (Vercel Cron → `jobs/`)
| Job | Cadence | Reads | Writes | Guardrail |
|---|---|---|---|---|
| `renewal-watch` | daily | policies | tasks/reviews | — |
| `conversion-watch` | daily | policies (conversion_deadline) | conversion opps, enrollments | 🛡 education-only |
| `xdate-watch` | daily | policies (x_date) | tasks, cadence | 🛡 gate |
| `referral-sla` | hourly | referrals | escalations | ⤴ |
| `agency-dormancy` | daily | agency_partnerships | status, tasks | — |
| `cross-sell-scan` | daily | v_cross_sell_gaps | opps, enrollments | 🛡 invite-only |
| `commission-reconcile` | daily | commissions | discrepancies | — |
| `campaign-dispatch` | minutes | campaigns, consents | messages | 🛡 13-step gate (`../data-guardrails.md` §5) |
| `agent-runner` | event/schedule | per agent | agent_actions, escalations | 🛡 guardrail + kill switch |
| `data-quality` | daily | all | flags | — |
| `backup-verify` | daily | backups | status | — |
> All jobs: idempotent (dedupe key), retry w/ backoff, check kill switch, write `audit_log`, route client-facing output through the dispatcher.

## 3. Integration registry (managed at `/super/integrations`; A12 states)
| Integration | Use | Fallback if unavailable |
|---|---|---|
| Twilio 🔌 | SMS + inbound STOP | manual log |
| Email provider 🔌 | transactional/campaign email | manual log |
| Google Calendar 🔌 | scheduling | manual appointment entry |
| Supabase Storage 🔌 | documents (signed URL, scan) | required (core) |
| AI gateway 🔌 | Claude-first + fallbacks | agent disabled (kill switch) |
| Farmers/FFS APIs | **not verified** | manual / CSV / secure reference-field placeholder (labeled) |

## 4. Audit event taxonomy (every one writes `audit_log`)
`entity.created · entity.updated(field diff) · entity.deleted(soft) · entity.viewed(sensitive) · stage.changed · comms.sent · comms.blocked · consent.captured · consent.revoked · firewall.blocked · ai.run · ai.action · ai.escalated · approval.decided · config.changed(before/after) · import.committed · import.rolledback · impersonation.started/ended · incident.step`

## 5. Screen → data completeness rule
No screen ships without: its listed tables reachable via RLS, its API routes returning typed (Zod) data, its mutations writing audit, its jobs wired (if applicable), and its integration states (A12) or labeled fallback present. A screen with a table but no API, or an API but no audit, fails the Definition of Done.
