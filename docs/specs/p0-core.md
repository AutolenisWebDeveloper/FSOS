# FSOS Part 2 — Page Specs: P0 Core

> Page-by-page override specs for the P0 (system-functional) pages. Each page inherits its full archetype definition from `../archetypes.md`; below records only what it OVERRIDES/ADDS. Read with `../sitemap.md`, `../routes.md`, `../data-guardrails.md`.
> Convention per spec: **Route · Archetype · Roles · Purpose · Data · Primary actions · Secondary · Filters/Search/Sort · Form fields + validation · Permissions · AI · Automations · Notifications · Audit · Related links · Integrations · Acceptance.**

---

## OS-02 Agency Network

### Agency Directory
- **Route/Archetype/Roles:** `/app/agencies` · A2 · fsa, licensed_staff
- **Purpose:** the FSA's book of agency-owner partnerships (aggregate root); entry to everything.
- **Data:** `agency_partnerships` + rollups (ytd_referrals, ytd_placed_premium, ytd_fsa_commission, last_contact_at, status, health).
- **Primary actions:** New partnership → `/app/agencies/new`; row → profile.
- **Secondary:** export (CSV/PDF), saved views.
- **Filters:** status (prospective|activated|producing|dormant|terminated), district, engagement mix, health band, overdue-check-in. **Search:** agency name, owner name. **Sort:** ytd_placed_premium, last_contact_at, health, name.
- **Bulk:** assign tag, enroll in partner check-in campaign (green-zone), export.
- **Permissions:** rows within FSA book (RLS).
- **AI:** Agency Growth/Activation agents surface "overdue for check-in" and "dormant → reactivate" as row badges + `/app/agencies/dormant`.
- **Audit:** export logged.
- **Related links:** row → profile → (referrals, opportunities, production, commissions, documents, staff, training, reviews, penetration, health).
- **Acceptance:** empty state offers "Add your first agency partnership"; every row links to a live profile; dormancy badge matches `v_agencies_overdue_checkin`.

### Create Agency Partnership
- **Route/Archetype:** `/app/agencies/new` · A5
- **Form fields + validation:** agency_name (req), owner_name (req), owner_email (email), owner_phone (phone), district_id (select, req), status (default prospective), checkin_interval_days (int, default 30), pc_book_policies (int ≥0), life_policies_in_force (int ≥0). All via Zod.
- **Automations:** on create → seed an `agency_activation` row at stage `identified`; create first check-in task.
- **Audit:** create logged. **Acceptance:** duplicate owner_email warns (non-blocking); redirect to new profile.

### Agency Profile (shell + tabs)
- **Route/Archetype:** `/app/agencies/[id]` (+ `/[tab]`) · A3
- **Data:** partnership + related counts for tab badges.
- **Primary actions:** log activity, schedule meeting, start check-in (green-zone), record referral, edit.
- **Tabs (P0):** overview, referrals. (P1+ tabs per sitemap.)
- **Permissions:** in-book only; `commissions` tab hidden unless permitted.
- **AI:** Agency Growth agent posts relationship-health notes + next-best partner action (never a product recommendation).
- **Audit:** view logged (sensitive). **Related links:** the full agency set (see sitemap anti-dead-end list).
- **Acceptance:** invalid tab param → 404 within shell; every tab renders its own empty/loading/error; breadcrumb `Agencies / {name} / {tab}`.

---

## OS-03 Referral

### Referral Inbox
- **Route/Archetype/Roles:** `/app/referrals` · A2 · fsa, licensed_staff
- **Purpose:** every inbound agency referral with speed-to-lead visibility.
- **Data:** `referrals` + referring agency + SLA timers (received_at, first_touch_at, sla_due_at, status).
- **Primary actions:** open detail; quick "log first touch" (stops SLA clock).
- **Filters:** status, engagement (warm_handoff|co_sell|direct), agency, untouched-only, breached-SLA. **Search:** referred name, agency. **Sort:** sla_due_at (default), received_at, age.
- **Bulk:** assign, tag, export.
- **AI:** Referral Triage agent dedupes, sets engagement suggestion, and prioritizes; Referral Follow-Up agent drafts consented outreach (green-zone).
- **Notifications:** new referral → in-app + optional SMS/email to FSA; SLA breach → escalation.
- **Audit:** view/export logged. **Related links:** row → referral detail.
- **Acceptance:** aging/SLA colors match `v_referrals_awaiting_action`; untouched referrals older than SLA are visually flagged.

### Referral Detail
- **Route/Archetype:** `/app/referrals/[id]` · A3
- **Data:** referral + referring agency + candidate household match + product interest + consent status + activity timeline.
- **Primary actions:** Convert → `/[id]/convert`; Reject → `/[id]/reject`; log activity; contact (through comms gate).
- **Permissions:** in-book. **AI:** duplicate-match surfaced; follow-up draft offered (blocked if consent invalid/securities).
- **Audit:** view + status changes logged. **Related links:** agency · household (if matched) · resulting opportunity · communications.
- **Acceptance:** cannot contact if consent invalid (gate blocks + explains); convert disabled until minimum fields present.

### Referral Convert (wizard)
- **Route/Archetype:** `/app/referrals/[id]/convert` · A6
- **Steps:** 1) match/create household (dedupe on email/phone), 2) confirm members + DOB + consent, 3) create opportunity (engagement, product family/product, is_security flag), 4) review → submit.
- **Validation:** each step Zod-gated; securities product requires FSA securities scope else block with escalation note.
- **Automations:** creates household (if new) + opportunity; sets referral status=converted; writes attribution (referring_agency_id) onto opportunity for split tracking.
- **Audit:** conversion logged with created entity ids. **Related links:** completion → opportunity detail.
- **Acceptance:** resumable draft; conversion is idempotent (no duplicate household/opportunity on retry).

### Referral Reject (modal)
- **Route/Archetype:** `/app/referrals/[id]/reject` · A7
- **Fields:** loss reason (select from config), note. **Automations:** status=declined; optional thank-you to agency (consented). **Audit:** logged.

---

## OS-04 Client & Household

### Household Directory
- **Route/Archetype/Roles:** `/app/households` · A2 · fsa, licensed_staff
- **Data:** `households` + referring agency + member count + active policies + open opportunities.
- **Filters:** referring agency, has-life, has-financial, review-due, consent status, DNC. **Search:** primary name, member name, email, phone. **Sort:** created, review-due, referring agency.
- **AI:** Cross-Sell agent flags coverage-gap households (badge → `/app/cross-sell/household-gaps`).
- **Audit:** view/export logged. **Acceptance:** DNC households visibly badged; empty state → "Add household" or "Convert a referral."

### Household Profile (shell + tabs)
- **Route/Archetype:** `/app/households/[id]` (+ `/[tab]`) · A3
- **Data:** household + members (with DOB) + policies + reviews + opportunities + consent + preferences.
- **Primary actions:** add member, record policy, schedule review, log activity, contact (gate), grant client-portal access.
- **Tabs (P0):** overview, members, policies. (Full tab set per sitemap.)
- **Permissions:** in-book; `dob` decrypted only for permitted roles; client-portal-access action permission-gated.
- **AI:** Cross-Sell + Term Conversion agents post green-zone review invitations here; never a product recommendation.
- **Audit:** view logged (sensitive); member/policy edits diffed.
- **Related links:** members · policies · referrals · opportunities · reviews · documents · communications · appointments · consent · referring-agency.
- **Acceptance:** consent tab shows per-channel status + capture source; no send action enabled without valid consent.

### Add / Member Detail
- **Routes/Archetype:** `/app/households/[id]/members/new`, `/members/[mid]` · A5 / A3
- **Fields:** full_name (req), relationship, dob (date; encrypted at rest), email, phone, existing_coverage (json summary). **Validation:** DOB not future; email/phone format.
- **Automations:** DOB enables birthday/life-event review triggers (green-zone). **Audit:** create/update diffed.

### Household Merge (wizard)
- **Route/Archetype:** `/app/households/merge` · A6 · adds admin-style care
- **Steps:** pick duplicates → field-level survivor selection → preview merged record → confirm (A9 typed-confirmation).
- **Automations:** re-point policies/opportunities/reviews/documents to survivor; losing record tombstoned (restorable). **Audit:** merge logged with both ids + field decisions.
- **Acceptance:** no data orphaned; reversible via Admin restore within retention window.

---

## OS-05 Policy & Coverage

### Policy Directory
- **Route/Archetype/Roles:** `/app/policies` · A2 · fsa, licensed_staff
- **Data:** `policies` + household + carrier + product + status + dates + is_security + conversion_deadline + is_with_us.
- **Filters:** status, carrier, product family, is_with_us (own book vs competitor X-date), renewal window, conversion-window, lapse-risk. **Search:** policy number, insured name. **Sort:** renewal_date, x_date, conversion_deadline.
- **AI:** Term Conversion + renewal jobs badge approaching windows. **Audit:** view/export logged.
- **Acceptance:** competitor policies (is_with_us=false) surface x_date; own policies surface renewal_date + conversion_deadline.

### Policy Detail
- **Route/Archetype:** `/app/policies/[id]` · A3
- **Data/sections:** coverage, carrier, product, owner, insured, beneficiaries, riders, premium, billing mode, effective/issue/renewal dates, term expiration, conversion deadline, status, in-force, lapse-risk, replacement indicators, documents, service history, review history, event timeline.
- **Permissions:** in-book; if `is_security` → banner "Securities record — managed in FFS-supervised system; FSOS holds reference only"; no automated send action.
- **AI:** conversion watchdog surfaces the educational review invite (green-zone) when within window.
- **Audit:** view logged. **Related links:** insured · owner · beneficiaries · conversion opportunity · reviews · documents · case · commissions · event-timeline.
- **Acceptance:** `is_security` policy shows pointer, never securities order/suitability data; conversion_deadline drives the Term Conversion OS.

---

## OS-09 Opportunity & Pipeline

### Opportunity Board (Kanban)
- **Route/Archetype/Roles:** `/app/opportunities/board` · A4 · fsa, licensed_staff
- **Stages:** prospect → fact_find → quoted_proposed → application → underwriting_suitability → placed_issued → lost.
- **Data:** `opportunities` + attribution (agency/referral/household) + product + expected value/premium/aum/commission + is_security.
- **Drag = stage change** → writes stage_history + audit. **Filters:** engagement, product family, agency, is_security, assigned. 
- **Permissions:** `licensed_staff.securities_scope=false` cannot advance `is_security` opps past a configured stage (block + escalate).
- **AI:** Pipeline agent flags stalled opps + drafts green-zone follow-ups; underwriting_suitability stage is a **status pointer only** — real suitability/Reg BI happens in FFS.
- **Audit:** every stage change logged. **Acceptance:** securities opps never trigger automated client sends; `underwriting_suitability` links to `ffs_case_ref`, stores no suitability determination.

### Opportunity Detail
- **Route/Archetype:** `/app/opportunities/[id]` · A3
- **Data:** engagement model, product family/product, agency/referral/household attribution, assigned user, stage history, expected value/premium/assets/commission, actual outcome, lost reasons, tasks, documents, activities, communications, underwriting status, **suitability-status pointer (FFS)**, **ffs_case_ref**, approval/escalation history.
- **Primary actions:** advance stage, log activity, open case, record commission (on placed_issued), contact (gate).
- **Audit:** view + stage/outcome logged. **Related links:** agency · referral · household · product · case · documents · commission · communications · approval history.
- **Acceptance:** placing an opp (placed_issued) prompts commission record creation using split config defaults (assumption-flagged); securities data never stored here beyond the pointer.

### Opportunity Directory / Create
- **Routes/Archetype:** `/app/opportunities`, `/new` · A2 / A5
- **Create fields:** household (req), engagement (req), product (req; sets is_security + required_license), referring_agency (attribution), expected premium/aum. **Validation:** if product.is_security and creator lacks securities scope → block + escalate; if no products configured → guide to `/super/products`.
- **Audit:** create logged.

---

## OS-14 Tasks (P0 slice)

### My Tasks
- **Route/Archetype/Roles:** `/app/tasks` · A2 · fsa, licensed_staff
- **Data:** `tasks` (auto-generated + manual) with linked entity, due_at, completed.
- **Filters:** due (overdue|today|upcoming), source (manual|workflow|agent), linked entity type. **Sort:** due_at.
- **AI:** agents create/prioritize tasks; auto_generated flagged. **Audit:** completion logged.
- **Acceptance:** overdue/today/upcoming buckets; every task deep-links to its source record; no orphan tasks.

### Task Detail
- **Route/Archetype:** `/app/tasks/[id]` · A3
- **Actions:** complete, reschedule, reassign, open linked record. **Audit:** state changes logged.

---

## OS-15 AI Operations (P0 slice)

### AI Escalations Queue
- **Route/Archetype/Roles:** `/app/ai/escalations` (+ `/[id]`) · A2 / A3 · fsa, licensed_staff (compliance read in P-3)
- **Purpose:** the human-handoff surface — every hard-blocked or judgment-required item lands here.
- **Data:** `compliance_events` + agent_actions where escalated; reason, entity, drafted content (if any), timestamp.
- **Primary actions:** review, approve/edit-and-send (through gate), dismiss, reassign, mark handled.
- **Escalation reasons rendered:** advice/recommendation requested · securities needs FFS channel · consent unclear · compliance rule triggered · replacement/suitability/best-interest/supervision · conflicting/incomplete case · high-value/urgent.
- **Permissions:** in-book; approving a securities item is blocked (routes to FFS, not sendable from FSOS).
- **Audit:** every decision logged. **Acceptance:** nothing an agent blocked is auto-sent; queue is the only path from blocked→resolved; empty state = "No escalations — agents operating within guardrails."

---

## OS-01 Executive Intelligence (P0 slice)

### Executive Dashboard
- **Route/Archetype/Roles:** `/app` · A1 · fsa, licensed_staff
- **Widgets (each links to its source):** book snapshot (agencies by status), referrals awaiting action (→ inbox), pipeline by stage/engagement (→ board), reviews due (→ reviews/due), conversions approaching (→ conversions), cross-sell gaps (→ cross-sell), commission expected vs received (→ commissions), AI escalations count (→ escalations), overdue tasks (→ tasks).
- **AI:** Executive Intelligence agent composes the daily priority list (green-zone; no recommendations).
- **Audit:** none required (own data) beyond standard. **Acceptance:** every tile links to a live list/detail; one failing widget doesn't break the page; numbers reconcile with their source lists.

---

*End P0 core specs. Next: `review-conversion-crosssell.md` (Financial Review spine, Term Conversion, Cross-Sell), then `cases-commission.md`, `comms-ai-compliance.md`, `portals-admin.md`.*
