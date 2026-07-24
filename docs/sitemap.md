# FSOS Sitemap — Complete Page Inventory

> Every page in FSOS, enumerated. Format: `route` — Name **[Archetype]** *(Priority)*.
> Archetypes defined in `archetypes.md`. File paths in `routes.md`. Priorities: **P0** system-functional · **P1** professional launch · **P2** operational enhancement · **P3** advanced future.
> Guardrails (securities firewall, AI green-zone/red-line, no-invented-Farmers-data, NIGO excluded) per `../CLAUDE.md`.

## Portals
- **P-0** Public (`(public)`) · **P-1** FSA (`(fsa)` `/app`) · **P-2** Admin (`(admin)` `/admin`) · **P-3** Compliance (`(compliance)` `/compliance`) · **P-4** Agency-Owner (`(partner)` `/partner`) · **P-5** Client (`(client)` `/client`) · **P-6** Super Admin (`(super)` `/super`)

---

## P-0 · Public Website & Forms
- `/` — Public home **[A1-lite]** *(P1)*
- `/about` — About **[static]** *(P2)*
- `/education` — Education library **[A2]** *(P1)*
- `/education/[slug]` — Education article **[A3-lite]** *(P1)*
- `/refer` — Public referral intake **[A5]** *(P0)*
- `/refer/success` — Referral confirmed **[A9]** *(P0)*
- `/schedule` — Public scheduling **[A6]** *(P1)*
- `/schedule/success` — Appointment confirmed **[A9]** *(P1)*
- `/events` — Event listing **[A2]** *(P2)*
- `/events/[id]` — Event detail **[A3-lite]** *(P2)*
- `/events/[id]/register` — Event registration **[A5]** *(P2)*
- `/events/[id]/register/success` — Registered **[A9]** *(P2)*
- `/consent` — Consent capture (token) **[A5]** *(P0)*
- `/consent/preferences` — Preferences (token) **[A5]** *(P1)*
- `/privacy` — Privacy/GLBA notice **[static]** *(P0)*
- `/terms` — Terms **[static]** *(P0)*
- `/disclosures` — Disclosures (Form CRS link to FFS) **[static]** *(P0)*
- `/support` — Support request **[A5]** *(P1)*
- `/login` **[A13]** *(P0)* · `/login/mfa` **[A13]** *(P0)*
- `/forgot-password` **[A13]** *(P0)* · `/reset-password/[token]` **[A13]** *(P0)*
- `/invite/[token]` — Accept invite **[A6]** *(P0)* · `/verify/[token]` **[A13]** *(P0)*
- `/403` `/404` `/500` `/maintenance` `/offline` **[A13]** *(P0)*

---

## P-1 · FSA Portal (`/app`)
Shell: top bar (global search, notifications, AI-priorities bell, profile, portal switcher), left nav (18 OS groups), breadcrumb, ⌘K command palette.

### OS-01 Executive Intelligence
- `/app` — Executive dashboard **[A1]** *(P0)*
- `/app/briefing` — Daily AI briefing **[A1]** *(P1)*
- `/app/kpis` — KPI overview **[A1]** *(P1)*
- `/app/production` — Agency production overview **[A11]** *(P1)*
- `/app/performance/referrals` **[A11]** *(P1)* · `/app/performance/placements` **[A11]** *(P1)* · `/app/performance/commission` **[A11]** *(P1)*
- `/app/opportunities/conversion` — Conversion overview **[A11]** *(P1)*
- `/app/opportunities/cross-sell` — Cross-sell overview **[A11]** *(P1)*
- `/app/alerts` — Alerts **[A2]** *(P1)*
- `/app/trends` **[A11]** *(P2)* · `/app/forecasts` **[A11]** *(P2)* · `/app/goals` **[A11]** *(P2)* · `/app/compare` **[A11]** *(P2)*
- `/app/dashboards` **[A2]** *(P3)* · `/app/dashboards/builder` **[A5/A1]** *(P3)* · `/app/dashboards/[id]` **[A1]** *(P3)*

### OS-02 Agency Network
- `/app/agencies` — Directory **[A2]** *(P0)*
- `/app/agencies/map` **[A1-map]** *(P2)* · `/app/agencies/leaderboard` **[A11]** *(P2)*
- `/app/agencies/new` — Create partnership **[A5]** *(P0)*
- `/app/agencies/[id]` — Agency profile **[A3]** *(P0)*; tabs: `overview`*(P0)* `staff`*(P1)* `activation`**[A4]***(P1)* `relationship`**[A3-timeline]***(P1)* `notes`*(P1)* `meetings`*(P1)* `training`*(P2)* `referrals`*(P0)* `opportunities`*(P1)* `production`**[A11]***(P1)* `commissions`*(P1)* `engagement`*(P2)* `documents`*(P1)* `communications`**[A2-timeline]***(P1)* `goals`**[A5]***(P2)* `penetration`**[A11]***(P2)* `health`**[A1]***(P2)*
- `/app/agencies/activation` — Global activation pipeline **[A4]** *(P1)*
- `/app/agencies/dormant` — Dormancy & reactivation **[A2]** *(P1)*

### OS-03 Referral
- `/app/referrals` — Inbox **[A2]** *(P0)*
- `/app/referrals/new` **[A5]** *(P0)* · `/app/referrals/[id]` — Detail **[A3]** *(P0)*
- `/app/referrals/[id]/convert` — Convert **[A6]** *(P0)* · `/app/referrals/[id]/reject` — Reject **[A7]** *(P1)*
- `/app/referrals/routing` **[A2]** *(P1)* · `/app/referrals/sla` **[A1]** *(P1)* · `/app/referrals/aging` **[A11]** *(P1)*
- `/app/referrals/duplicates` **[A2]** *(P1)* · `/app/referrals/analytics` **[A11]** *(P2)*

### OS-04 Client & Household
- `/app/households` — Directory **[A2]** *(P0)*
- `/app/households/new` **[A5]** *(P0)*
- `/app/households/[id]` — Profile **[A3]** *(P0)*; tabs: `overview members relationships dependents beneficiaries products coverage financial-snapshot needs-analysis goals documents consent preferences notes activities appointments opportunities policies reviews referring-agency portal-access` *(P0–P2)*
- `/app/households/[id]/members/new` **[A5]** *(P0)* · `/app/households/[id]/members/[mid]` **[A3]** *(P0)*
- `/app/households/merge` — Merge tool **[A6]** *(P1)*

### OS-05 Policy & Coverage
- `/app/policies` — Directory **[A2]** *(P0)*
- `/app/policies/new` **[A5]** *(P0)*
- `/app/policies/[id]` — Detail **[A3]** *(P0)* (coverage, carrier, product, owner, insured, beneficiaries, riders, premium, billing, effective/issue/renewal dates, term expiration, conversion deadline, status, in-force, lapse-risk, replacement indicators, documents, service history, review history, event timeline)
- `/app/policies/lapse-risk` **[A2]** *(P2)* · `/app/policies/renewals` **[A2]** *(P1)*

### OS-06 Financial Review
- `/app/reviews` — Directory **[A2]** *(P1)*
- `/app/reviews/board` — Pipeline board **[A4]** *(P1)*
- `/app/reviews/new` — Schedule/create **[A5]** *(P1)*
- `/app/reviews/[id]` — Workspace **[A3]** *(P1)* · `/app/reviews/[id]/prep` **[A3]** *(P1)* · `/app/reviews/[id]/outcome` — Outcome + opportunity origination **[A5]** *(P1)*
- `/app/reviews/calendar` **[A1-cal]** *(P1)* · `/app/reviews/due` **[A2]** *(P1)* · `/app/reviews/types` — Config **[A10]** *(P2)*

### OS-07 Term Conversion
- `/app/conversions` — Dashboard **[A1]** *(P1)*
- `/app/conversions/eligible` **[A2]** *(P1)* · `/app/conversions/timeline` **[A11]** *(P1)* · `/app/conversions/monitoring` **[A2]** *(P1)*
- `/app/conversions/[id]` — Detail **[A3]** *(P1)* · `/app/conversions/analytics` **[A11]** *(P2)*

### OS-08 Cross-Sell
- `/app/cross-sell` — List **[A2]** *(P1)*
- `/app/cross-sell/household-gaps` **[A11]** *(P1)* · `/app/cross-sell/agency-penetration` **[A11]** *(P2)*
- `/app/cross-sell/[id]` — Detail **[A3]** *(P1)* · `/app/cross-sell/analytics` **[A11]** *(P2)*

### OS-09 Opportunity & Pipeline
- `/app/opportunities` — Directory **[A2]** *(P0)* · `/app/opportunities/board` — Kanban **[A4]** *(P0)*
- `/app/opportunities/new` **[A5]** *(P0)*
- `/app/opportunities/[id]` — Detail **[A3]** *(P0)* (engagement model, product family/product, agency/referral/household attribution, assigned user, stage history, expected value/premium/assets/commission, actual outcome, lost reasons, tasks, documents, activities, communications, underwriting status, **suitability-status pointer (FFS)**, **FFS case reference**, approval/escalation history)

### OS-10 Case Management *(NIGO-free)*
- `/app/cases` — Directory **[A2]** *(P1)* · `/app/cases/board` **[A4]** *(P1)*
- `/app/cases/new` **[A5]** *(P1)*
- `/app/cases/[id]` — Detail **[A3]** *(P1)* (application, submission tracking, underwriting, carrier requirements, outstanding requirements, documents, signature/form-version verification, status/issue tracking, service requests, case timeline)
- `/app/cases/[id]/checklist` **[A3]** *(P1)* · `/app/cases/requirements` **[A2]** *(P1)* · `/app/cases/service-requests` **[A2]** *(P2)*

### OS-11 Commission
- `/app/commissions` — Dashboard **[A1]** *(P1)*
- `/app/commissions/expected` **[A2]** *(P1)* · `/received` **[A2]** *(P1)* · `/pending` **[A2]** *(P1)*
- `/app/commissions/splits` — Config **[A10]** *(P1)* *(labeled config defaults; never invented)*
- `/app/commissions/reconciliation` **[A3]** *(P2)* · `/discrepancies` **[A2]** *(P2)* · `/chargebacks` **[A2]** *(P2)* · `/trails` **[A2]** *(P2)* · `/adjustments` **[A2]** *(P2)* · `/statements` **[A2]** *(P2)*
- `/app/commissions/[id]` — Detail **[A3]** *(P1)*

### OS-12 Marketing & Communications
- `/app/comms` — AI Communications Center — operational Overview (Slice 9A rebuild; in-hub `CommsSubnav` via `comms/layout.tsx`) **[A2]** *(P1)*
- `/app/comms/inbox` — Two-way inbox (threaded conversations) **[A2]** *(P1)* · `/app/comms/inbox/[id]` — Conversation thread **[A3]** *(P1)*
- `/app/comms/sms` **[A2]** *(P1)* · `/app/comms/email` **[A2]** *(P1)*
- `/app/comms/templates` **[A2]** *(P1)* · `/app/comms/templates/[id]` — Editor + approval/versioning **[A5]** *(P1)*
- `/app/comms/campaigns` **[A2]** *(P1)* · `/app/comms/campaigns/new` **[A6]** *(P1)* · `/app/comms/campaigns/[id]` **[A3]** *(P1)*
- `/app/comms/sequences` **[A2]** *(P2)* · `/app/comms/audience` **[A5]** *(P2)* · `/app/comms/library` — Campaign library (ADR-023) **[A2]** *(P1)*
- `/app/comms/assignments` — Assignment Review / ownership queue (ADR-015) **[A2]** *(P1)* · `/app/comms/identity` — First-contact identity disclosure config (ADR-016) **[A2]** *(P1)*
- `/app/comms/suppression` **[A2]** *(P1)* · `/app/comms/delivery` **[A2]** *(P1)* · `/app/comms/analytics` **[A11]** *(P2)*

### OS-13 Document
- `/app/documents` — Library **[A2]** *(P1)* · `/app/documents/upload` **[A5]** *(P1)* · `/app/documents/requests` **[A2]** *(P1)*
- `/app/documents/[id]` — Detail (versions, permissions, expiration, secure share) **[A3]** *(P1)* · `/app/documents/missing` **[A2]** *(P2)*

### OS-14 Tasks, Calendar & Workflow
- `/app/tasks` — My tasks **[A2]** *(P0)* · `/app/tasks/team` **[A2]** *(P1)* · `/app/tasks/[id]` **[A3]** *(P0)*
- `/app/calendar` **[A1-cal]** *(P0)* · `/app/calendar/availability` **[A10]** *(P1)* · `/app/calendar/appointment-types` **[A10]** *(P1)*
- `/app/appointments/[id]` — Detail (prep, notes, follow-ups) **[A3]** *(P1)*
- `/app/workflows` **[A2]** *(P2)* · `/app/workflows/builder` **[A5/A6]** *(P2)* · `/app/workflows/[id]` **[A3]** *(P2)*

### OS-15 AI Operations
- `/app/ai` — Ops center **[A1]** *(P1)*
- `/app/ai/agents` **[A2]** *(P1)* · `/app/ai/agents/[id]` **[A3]** *(P1)*
- `/app/ai/runs` **[A2]** *(P1)* · `/app/ai/runs/[id]` **[A3]** *(P1)*
- `/app/ai/escalations` — Queue **[A2]** *(P0)* · `/app/ai/escalations/[id]` **[A3]** *(P0)*
- `/app/ai/errors` **[A2]** *(P1)* · `/app/ai/evaluations` **[A11]** *(P2)*

### OS-16 Compliance (FSA subset)
- `/app/compliance` — Dashboard **[A1]** *(P1)*
- `/app/compliance/firewall` **[A2]** *(P0)* · `/licenses` **[A2]** *(P0)* · `/consent` **[A2]** *(P0)* · `/dnc` **[A2]** *(P0)* · `/exceptions` **[A2]** *(P1)*

### OS-17 Reporting & Analytics
- `/app/reports` — Library **[A2]** *(P1)* · `/app/reports/builder` **[A5/A11]** *(P2)* · `/app/reports/[id]` **[A11]** *(P1)* · `/app/reports/scheduled` **[A2]** *(P2)*

### OS-18 System Administration (personal subset)
- `/app/settings` **[A10]** *(P0)* · `/app/settings/profile` **[A10]** *(P0)* · `/notifications` **[A10]** *(P1)* · `/security` **[A10]** *(P0)* · `/integrations` **[A10]** *(P1)*

---

## P-2 · Admin / Back-Office (`/admin`)
- `/admin` — Dashboard **[A1]** *(P1)*
- `/admin/cases` — Processing queue **[A2]** *(P1)*
- `/admin/documents` **[A2]** *(P1)* · `/admin/documents/verify` **[A2]** *(P1)*
- `/admin/data/imports` **[A6]** *(P1)* · `/admin/data/imports/[id]` — Job (mapping, preview, validation, error report, rollback, audit) **[A3]** *(P1)*
- `/admin/data/exports` **[A2]** *(P2)* · `/admin/data/duplicates` **[A2]** *(P2)*
- `/admin/support/requests` **[A2]** *(P1)* · `/admin/support/requests/[id]` **[A3]** *(P1)*
- `/admin/users` — Support (invite, reset, unlock, impersonate-with-audit) **[A2]** *(P1)*
- `/admin/config/*` — Operational config (tags, statuses, loss reasons, appointment types, review types, templates) **[A10]** *(P1–P2)*

---

## P-3 · Compliance & Supervisory (`/compliance`)
> Banner on every page: "FSOS supervisory views are supplemental. They do not replace FFS-required supervisory systems or books-and-records."
- `/compliance` — Overview **[A1]** *(P1)*
- `/compliance/audit` **[A2]** *(P0)* · `/compliance/audit/[id]` **[A3]** *(P1)*
- `/compliance/communications` — Flagged comms **[A2]** *(P1)* · `/compliance/approvals` **[A2]** *(P1)*
- `/compliance/consent` **[A2]** *(P0)* · `/compliance/licenses` **[A2]** *(P0)* · `/compliance/firewall` **[A2]** *(P0)*
- `/compliance/violations` **[A2]** *(P1)* · `/compliance/exceptions` **[A2]** *(P1)* · `/compliance/escalations` **[A2]** *(P1)*
- `/compliance/incidents` — Breach-response workflow **[A3/A6]** *(P1)*
- `/compliance/legal-holds` **[A2]** *(P2)* · `/compliance/retention` **[A10]** *(P1)* · `/compliance/attestations` **[A2]** *(P2)* · `/compliance/policies` **[A2]** *(P2)*

---

## P-4 · Agency-Owner (`/partner`)
- `/partner` — Dashboard **[A1]** *(P1)*
- `/partner/refer` — Submit referral **[A5]** *(P0)*
- `/partner/referrals` **[A2]** *(P1)* · `/partner/referrals/[id]` **[A3]** *(P1)*
- `/partner/production` **[A11]** *(P1)*
- `/partner/commissions` — Attributed commissions **[A2]** *(P2)* *(permission-gated; only where config permits comp disclosure)*
- `/partner/materials` **[A2]** *(P1)* · `/partner/schedule` **[A6]** *(P1)* · `/partner/training` **[A2]** *(P2)*
- `/partner/messages` **[A2-timeline]** *(P1)* · `/partner/tasks` **[A2]** *(P2)* · `/partner/settings` **[A10]** *(P1)*

---

## P-5 · Client-Facing (`/client`)
> Firewall: non-securities, non-advice content only. No securities milestones, recommendations, or comp data.
- `/client` — Home **[A1-lite]** *(P1)*
- `/client/schedule` **[A6]** *(P0)* · `/client/intake` **[A6]** *(P1)*
- `/client/documents` — Upload **[A5]** *(P1)* · `/client/documents/requests` **[A2]** *(P1)*
- `/client/education` **[A2]** *(P1)* · `/client/appointments` **[A2]** *(P1)*
- `/client/profile` **[A5]** *(P1)* · `/client/preferences` **[A5]** *(P0)* · `/client/consent` **[A5]** *(P0)*
- `/client/reviews` — Permitted policy-review info **[A2]** *(P2)* · `/client/case-status` — Non-securities milestones **[A3-lite]** *(P2)*

---

## P-6 · Super Admin (`/super`)
> May be implemented as a super-admin role within Admin; listed separately for completeness.
- `/super` — Control dashboard + health **[A1]** *(P1)*
- `/super/users` **[A2]** *(P0)* · `/super/roles` **[A2]** *(P0)* · `/super/permissions` **[A10]** *(P0)*
- `/super/orgs` **[A2]** *(P1)* · `/super/districts` **[A2]** *(P1)* · `/super/agencies` **[A2]** *(P1)*
- `/super/carriers` **[A2]** *(P1)* · `/super/products` **[A2]** *(P1)* · `/super/products/[id]` — Config (eligibility, license req, is_security, conversion window [config default]) **[A10]** *(P1)*
- `/super/states` — State rules & quiet hours **[A10]** *(P1)*
- `/super/workflows` **[A2]** *(P2)*
- `/super/ai/agents` **[A2]** *(P1)* · `/super/ai/prompts` **[A2]** *(P1)* · `/super/ai/models` **[A10]** *(P1)* · `/super/ai/policies` — Approval policies & kill switches **[A10]** *(P0)* · `/super/ai/sandbox` **[A3]** *(P2)*
- `/super/templates` **[A2]** *(P1)*
- `/super/integrations` **[A12]** *(P1)* · `/super/integrations/[id]` **[A12]** *(P1)*
- `/super/feature-flags` **[A10]** *(P1)* · `/super/audit` **[A2]** *(P0)* · `/super/retention` **[A10]** *(P1)* · `/super/security` **[A10]** *(P0)*
- `/super/jobs` **[A2]** *(P1)* · `/super/jobs/[id]` **[A3]** *(P1)* · `/super/webhooks` **[A12]** *(P2)* · `/super/api-keys` **[A10]** *(P1)*
- `/super/errors` **[A2]** *(P1)* · `/super/usage` **[A11]** *(P1)* · `/super/health` **[A1]** *(P1)* · `/super/backups` **[A2]** *(P0)*
- `/super/billing` **[A10]** *(P3)* *(placeholder — build nothing unless commercialized)*

---

## Anti-dead-end related-record links (enforced on detail pages)
- **Agency** → referrals · opportunities · production · commissions · activities · documents · staff · training · reviews · penetration · health
- **Household** → members · policies · referrals · opportunities · reviews · documents · communications · appointments · consent · referring-agency
- **Policy** → insured · owner · beneficiaries · conversion opportunity · reviews · documents · case · commissions · event-timeline
- **Opportunity** → agency · referral · household · product · case · documents · commission · communications · approval history
- **Review** → household · policies · generated opportunities · educational materials · appointment · follow-up tasks · outcome
- **Case** → opportunity · household · product · carrier · requirements · documents · commissions · service requests · timeline
