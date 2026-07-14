# FSOS Part 2 — Page Specs: Financial Review · Term Conversion · Cross-Sell

> Override specs on top of `../archetypes.md`. These three modules carry the heaviest green-zone/red-line nuance: the UI may invite/educate/schedule/discover needs, but must NEVER surface an individualized product/policy/investment recommendation. The "recommend" action does not exist in these UIs — only "invite to review," "assign educational material," and "escalate to FSA."

---

## OS-06 Financial Review (the connective spine)

The review is where Agency → Referral → Household → **Review** → Opportunity → Application connects. A review is a green-zone act: schedule, prepare, discover needs, educate, capture outcome, originate opportunities. The recommendation itself is the licensed human's, made in the meeting — never system-generated.

### Review Directory
- **Route/Archetype/Roles:** `/app/reviews` · A2 · fsa, licensed_staff
- **Data:** `reviews` (type: policy|coverage|term_conversion|retirement|annual) + household + stage + scheduled date + outcome + generated opportunity count.
- **Filters:** type, stage, household, due window, agency. **Search:** household name. **Sort:** scheduled date, due.
- **AI:** review-scheduling agent proposes due reviews (annual anniversaries, conversion windows, life events) as green-zone invitations.
- **Audit:** view/export logged. **Related links:** row → review workspace.
- **Acceptance:** empty state → "Schedule a review"; each review links to its household + any generated opportunities.

### Review Board
- **Route/Archetype:** `/app/reviews/board` · A4
- **Stages:** requested → scheduled → prepared → completed → outcome-logged. Drag → stage change + audit.
- **Acceptance:** completing a review routes to `/[id]/outcome`; no review is "done" without an outcome record.

### Schedule / Create Review
- **Route/Archetype:** `/app/reviews/new` · A5
- **Fields:** household (req), type (req), scheduled_at, agenda template (by type), assigned user. **Validation:** Zod; household must have valid consent for any outreach that follows.
- **Automations:** creates appointment (Google Calendar or manual), sends consented confirmation + reminders (through comms gate), creates prep task.
- **Audit:** create logged. **Acceptance:** confirmation/reminders only send if consent + quiet-hours pass; otherwise queued to escalation.

### Review Workspace / Prep / Outcome
- **Routes/Archetype:** `/app/reviews/[id]`, `/[id]/prep`, `/[id]/outcome` · A3 / A3 / A5
- **Workspace data:** type, household link, agenda, needs-discovery capture (structured fields: goals, coverage held, gaps observed, life events), assigned educational materials, meeting notes, generated opportunities, follow-ups.
- **Prep:** assembles household snapshot (policies, prior reviews, coverage gaps from `v_cross_sell_gaps`, conversion windows) — **read-only assembly, no recommendation.**
- **Outcome (A5):** captures discussed needs + originates opportunities (one per identified need/product family) + schedules follow-ups. The FSA selects what to pursue; the system records, it does not recommend.
- **Compliance:** any securities need discussed → outcome routes it to FFS-supervised follow-up (pointer), not an FSOS automated sequence. Replacement discussion → flags replacement-notice requirement + escalates.
- **AI:** Document Intelligence assembles prep; NO agent writes a recommendation. Green-zone drafting only (invitations, educational summaries).
- **Audit:** view + outcome + generated-opportunity ids logged. **Related links:** household · policies · generated opportunities · educational materials · appointment · follow-up tasks · outcome.
- **Acceptance:** outcome cannot be saved as a "recommendation"; it records needs + opportunities; securities/replacement items are firewalled/escalated, never auto-sequenced.

### Review Calendar / Due / Types
- **Routes/Archetype:** `/app/reviews/calendar` (A1-cal), `/due` (A2), `/types` (A10)
- **Due:** annual/coverage/retirement/conversion reviews approaching, from anniversaries + windows. **Types (config):** agenda templates + default cadences (assumption-flagged where Farmers-specific). **Audit:** config changes logged.

---

## OS-07 Term Conversion

Detects approaching term-expiration/conversion deadlines and launches outreach to schedule a review of available permanent options. **Educational only.** The system may explain, neutrally, what permanent life insurance is; it must NEVER tell the client which permanent product to buy. Conversion windows are **config defaults** (assumption-flagged; true values from the ICC25-FTL contract / FNWL SERFF filing).

### Conversion Opportunity Dashboard
- **Route/Archetype/Roles:** `/app/conversions` · A1 · fsa, licensed_staff
- **Widgets:** conversions due (≤365/≤180/≤90/≤30 days tiers), enrolled in educational campaign, responses, scheduled reviews, outcomes.
- **AI:** Term Conversion agent enrolls eligible policies in the educational cadence (green-zone) and schedules review invitations; hard-blocked from naming a specific permanent product.
- **Acceptance:** each tile links to the eligible/monitoring lists; securities-flagged policies excluded from automated sends.

### Eligible / Timeline / Monitoring
- **Routes/Archetype:** `/app/conversions/eligible` (A2), `/timeline` (A11), `/monitoring` (A2)
- **Data:** own-book term policies with a `conversion_deadline` (config window applied to term product), tiered by urgency.
- **Filters:** urgency tier, carrier, product, response status. **Sort:** conversion_deadline.
- **Acceptance:** window source badge shows "config default — verify"; no policy without a configured window is asserted as eligible.

### Conversion Opportunity Detail
- **Route/Archetype:** `/app/conversions/[id]` · A3
- **Data/sections:** policy + household + conversion window + campaign enrollment + educational-content delivery log + appointment scheduling + advisor escalation + client-response tracking + meeting prep + outcome tracking + application linkage + lost-reason.
- **Primary actions:** enroll in educational campaign (green-zone), schedule review, escalate to FSA, link resulting application/opportunity, record outcome.
- **Compliance:** the ONLY client-facing content permitted is neutral education + review invitation. A "recommend product X" control does not exist. If the client asks which product → escalate to FSA. Conversion that discontinues an existing policy → replacement-notice flag.
- **AI:** agent runs the cadence + drafts educational/invite messages (validated by guardrail; blocked on recommendation/consent/quiet-hours/securities).
- **Audit:** enrollment, sends, responses, outcome logged. **Related links:** policy · household · resulting opportunity/case · educational materials · appointment.
- **Acceptance:** every outbound message passes the 7-step gate; no message names/steers to a specific permanent product; escalation path present and used for advice requests.

### Conversion Analytics
- **Route/Archetype:** `/app/conversions/analytics` · A11
- **Metrics:** windows entered, enrolled, response rate, reviews scheduled, conversions placed, lost reasons. **Export:** CSV/PDF. **Audit:** generation/export logged.

---

## OS-08 Cross-Sell

Identifies coverage gaps per household and low life/financial penetration per agency book, and invites clients to a review. **Identifies and invites — never recommends a specific product.**

### Cross-Sell Opportunity List
- **Route/Archetype/Roles:** `/app/cross-sell` · A2 · fsa, licensed_staff
- **Data:** from `v_cross_sell_gaps` — households with active lines vs recommended basket, `next_best_line` (a coverage GAP, not a product recommendation), score.
- **Filters:** gap type (no-life, no-umbrella, mono-line), agency, score band, consent status. **Sort:** score.
- **AI:** Cross-Sell agent scores + enrolls in educational review-invitation campaigns (green-zone).
- **Acceptance:** UI frames output as "coverage gap / review opportunity," never "recommended product"; DNC/consent-invalid households excluded from sends.

### Household Coverage-Gap Analysis
- **Route/Archetype:** `/app/cross-sell/household-gaps` · A11
- **Data:** per-household lines held (with us) vs recommended basket (auto→home→umbrella→life priority, config-editable); gap list.
- **Compliance:** displays gaps and a review-invitation CTA; no product recommendation. **Acceptance:** basket is editable config; gap logic matches `v_cross_sell_gaps`.

### Agency-Book Penetration Analysis
- **Route/Archetype:** `/app/cross-sell/agency-penetration` · A11
- **Data:** per agency: pc_book_policies vs life_policies_in_force → life_penetration_pct; ranks large-book/low-penetration agencies (the FSA growth thesis).
- **Acceptance:** ranking matches `v_crosssell_targets`; links to the agency profile + its households' gaps.

### Cross-Sell Opportunity Detail
- **Route/Archetype:** `/app/cross-sell/[id]` · A3
- **Sections:** score · campaign enrollment · educational content · meeting invitation · response tracking · advisor follow-up · conversion tracking.
- **Compliance:** invite + educate only; advice request → escalate; securities gap → route to FFS-supervised follow-up (pointer).
- **AI:** green-zone drafting via guardrail. **Audit:** enrollment/sends/responses/outcome logged. **Related links:** household · policies · resulting opportunity · educational materials · appointment.
- **Acceptance:** no recommendation surface exists; every send passes the gate.

### Cross-Sell Analytics
- **Route/Archetype:** `/app/cross-sell/analytics` · A11
- **Metrics:** gaps identified, invited, response rate, reviews held, placements, by product family + agency. **Export:** CSV/PDF.

---

*Compliance invariant across all three modules: the words/actions available to AI and to automated comms are IDENTIFY · EDUCATE · INVITE · SCHEDULE · REMIND · FOLLOW-UP · ESCALATE. There is no RECOMMEND action in these UIs or agent tool sets. Any client request for a recommendation, any securities need, and any replacement scenario routes to the licensed human FSA (and, for securities, to FFS-supervised systems).*

*Next: `cases-commission.md`, then `comms-ai-compliance.md`, then `portals-admin.md`.*
