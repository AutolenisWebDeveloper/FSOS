# FSOS Part 3 — End-to-End Workflow Maps: Core Spine

> Traces each major workflow trigger→completion through every screen, automation, agent, data change, state transition, notification, exception, and recovery path. Read with Part 1 (`../sitemap.md`, `../routes.md`, `../data-guardrails.md`) and Part 2 specs.
> Every workflow documents: **Happy · Empty · Error · Unauthorized · Duplicate · Cancellation · Retry · Recovery.** Guardrail checkpoints are marked 🛡. Audit writes are marked 📝. Escalation points are marked ⤴.

---

## WF-1 · Referral → Placement (the revenue spine)

**Trigger:** an agency owner submits a referral (partner portal, public form, or FSA logs it).

**Happy path:**
1. **Intake.** `/partner/refer` or `/refer` or `/app/referrals/new` → `POST api/referrals` → row in `referrals` (status=received, received_at set, sla_due_at computed). Consent captured (channel + source + disclosure). 📝 create.
2. **Triage.** `referral-sla` job + Referral Triage agent: dedupe (🛡 firewall n/a), set engagement suggestion, prioritize. Appears in `/app/referrals` inbox with SLA timer. 🔔 new-referral notification to FSA.
3. **First touch.** FSA opens `/app/referrals/[id]`, logs first touch (stops SLA clock) or Referral Follow-Up agent drafts consented outreach → 🛡 comms gate (consent/quiet-hours/DNC/template/not-securities) → send or ⤴ escalate. 📝 activity.
4. **Convert.** `/app/referrals/[id]/convert` (wizard): match/create household (dedupe email/phone) → confirm members + DOB + consent → create opportunity (engagement, product, is_security, required_license) → review → submit. 🛡 if product.is_security and creator lacks securities scope → block ⤴. Sets referral.status=converted; writes referring_agency_id onto opportunity (attribution). 📝 conversion with created ids.
5. **Review (optional but common).** Opportunity often originates from a `/app/reviews/[id]` outcome (see WF-2). 
6. **Pipeline.** `/app/opportunities/board`: prospect→fact_find→quoted_proposed→application→underwriting_suitability→placed_issued. Each drag 📝 stage_history. 🛡 securities opps: underwriting_suitability is a pointer to FFS (`ffs_case_ref`), no suitability stored; automated sends suppressed.
7. **Case.** On application, `/app/cases/new` from the opportunity → `cases` row; requirements tracked; Document Intelligence flags missing docs; consented status updates via 🛡 gate.
8. **Issue.** Case → issued → policy recorded (`/app/policies/new` or auto from case). Opportunity → placed_issued.
9. **Commission.** Placement prompts a `commissions` row using `commission_splits` defaults (assumption-flagged) → expected commission tracked (WF-7). 📝 create.
10. **Attribution close.** Agency rollups (ytd_referrals, ytd_placed_premium, ytd_fsa_commission) update; partner portal reflects production.

**Empty:** no products configured → convert/opportunity create blocks with "configure products" (→ `/super/products`). No agencies → referral has no attribution source; internal referral allowed without agency.
**Error:** household create fails mid-wizard → draft preserved, resumable; no orphan opportunity created (transactional).
**Unauthorized:** licensed_staff without securities scope converting a securities product → blocked ⤴ before any write.
**Duplicate:** dedupe on email/phone at convert; if match, offers merge into existing household instead of creating; conversion is idempotent (retry does not double-create).
**Cancellation:** referral rejected `/app/referrals/[id]/reject` (loss reason) → status=declined; optional consented thank-you; 📝.
**Retry:** convert wizard ret/network fail → idempotency key prevents duplicate household/opportunity.
**Recovery:** SLA breach → `referral-sla` job ⤴ escalation to FSA; stalled opportunity → Pipeline agent flags + drafts green-zone follow-up.

---

## WF-2 · Financial Review lifecycle (the connective layer)

**Trigger:** review due (annual anniversary, term-conversion window, retirement age, life event) detected by a job, OR FSA/agent schedules one, OR a client requests via `/client/schedule`.

**Happy path:**
1. **Schedule.** `/app/reviews/new` → `reviews` row (type, household, scheduled_at, agenda template) → creates appointment (Google Calendar 🔌 or manual) + prep task. 🛡 confirmation/reminders through comms gate. 📝 create.
2. **Prep.** `/app/reviews/[id]/prep`: Document Intelligence assembles household snapshot (policies, prior reviews, coverage gaps from `v_cross_sell_gaps`, conversion windows) — **read-only assembly, no recommendation** 🛡.
3. **Conduct.** The FSA meets the client (in person/virtual). FSOS records; it does not recommend.
4. **Outcome.** `/app/reviews/[id]/outcome`: capture discussed needs (structured) → originate opportunities (one per need/product family) → schedule follow-ups. 🛡 securities need → routed to FFS-supervised follow-up (pointer), not an FSOS sequence ⤴; replacement discussed → replacement-notice flag ⤴. 📝 outcome + generated-opportunity ids.
5. **Downstream.** Generated opportunities enter WF-1 pipeline; follow-ups become tasks.

**Empty:** household with no policies → review still valid (needs-discovery/new-business); prep shows "no existing coverage."
**Error:** calendar integration down → appointment falls back to manual entry (🔌 A12 fallback), review still proceeds.
**Unauthorized:** client cannot see the outcome record (column allowlist); only permitted review info via `/client/reviews`.
**Duplicate:** one household review per annual cycle enforced (consolidation) to avoid over-contact; scheduling a second warns.
**Cancellation:** review cancelled → appointment cancelled + client notified (🛡 gate); status logged; no opportunities orphaned.
**Retry:** outcome save fails → draft retained; opportunity origination idempotent.
**Recovery:** no-show → missed-appointment handling reschedules + green-zone reminder; overdue reviews surface in `/app/reviews/due`.

**Compliance invariant:** the outcome cannot be saved as a "recommendation." It records needs + opportunities; the recommendation is the licensed human's, made in the meeting.

---

## WF-3 · Term Conversion outreach (educational only)

**Trigger:** `conversion-watch` job detects an own-book term policy whose `conversion_deadline` (config-default window, assumption-flagged) falls in a tier (≤365/≤180/≤90/≤30 days).

**Happy path:**
1. **Detect.** Job writes/updates conversion opportunity; policy appears in `/app/conversions/eligible` + dashboard tiers. 📝.
2. **Enroll.** Term Conversion agent enrolls the household in the **educational** cadence (green-zone) 🛡 — neutral info about permanent life + an invitation to review. Hard-blocked from naming a specific permanent product.
3. **Outreach.** Each send → 🛡 comms gate (consent/quiet-hours/DNC/approved-education-template/not-securities). Blocked → ⤴ escalation. 📝 each send.
4. **Response → Review.** Client responds → schedule a review (WF-2, type=term_conversion). 
5. **Outcome.** Review outcome may originate a conversion opportunity/application (WF-1). If the client asks "which product should I convert to?" → ⤴ escalate to FSA (red line). Conversion that discontinues existing coverage → replacement-notice flag ⤴.
6. **Track.** `/app/conversions/[id]` records enrollment, delivery, responses, meeting, outcome, application linkage, lost-reason.

**Empty:** no policies with a configured window → nothing asserted eligible (window source badged "config default — verify").
**Error:** template unapproved → agent cannot send; ⤴ to configure. 
**Unauthorized:** securities-flagged policy → excluded from automated sends entirely (🛡 firewall); handled by human/FFS.
**Duplicate:** re-enrollment guarded (no double cadence for the same window).
**Cancellation:** client opts out → suppression honored immediately; cadence stops. 
**Retry:** failed send retries idempotently.
**Recovery:** approaching-deadline with no response → escalate to FSA for personal outreach before the window closes.

**Red line:** the UI/agent may explain permanent life neutrally and invite a review; it must NEVER tell the client which permanent product to buy.

---

## WF-4 · Cross-Sell origination (identify & invite, never recommend)

**Trigger:** `cross-sell-scan` job computes `v_cross_sell_gaps` (household lines held vs recommended basket) and `v_crosssell_targets` (agencies: large P&C book, low life penetration).

**Happy path:**
1. **Detect.** Gaps surface in `/app/cross-sell` + `/household-gaps`; agency targets in `/agency-penetration`. 📝.
2. **Score & enroll.** Cross-Sell agent scores + enrolls households in a **review-invitation** campaign (green-zone) 🛡 — framed as "coverage gap / review opportunity," never "recommended product."
3. **Invite.** Sends → 🛡 gate. DNC/consent-invalid auto-suppressed + reported. Blocked → ⤴.
4. **Review → placement.** Response → review (WF-2) → opportunity (WF-1).

**Empty:** household already multi-line/no gap → not surfaced. **Error/Unauthorized/Duplicate/Cancellation/Retry/Recovery:** as WF-3.
**Red line:** output is a coverage gap + review invitation. No product recommendation surface exists. Securities gap → route to FFS-supervised follow-up (pointer) ⤴.

---

*Next: `workflows-ops-compliance.md` — Campaign Send, Agency Activation/Dormancy, Commission Reconciliation, AI Agent Run→Escalation, Consent Capture/Revocation, Incident/Breach Response, Data Import.*
