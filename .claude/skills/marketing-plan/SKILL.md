---
name: marketing-plan
description: Produce structured, compliance-safe marketing and outreach PLANS for the licensed Farmers FSA practice — objectives, audience segmentation, channel mix (email via Resend, SMS via Twilio/A2P), cadence, content themes, and measurement — mapped to FSOS's three existing campaigns (Life Conversion, Cross-Sell Life, Win-Back / pipeline-winback) and the native comms module. Use this whenever planning a marketing campaign, outreach sequence, content calendar, drip, nurture, cross-sell push, win-back push, or content-theme calendar for the practice. Reach for it even when the user just says "plan a Q4 life-conversion push", "draft an outreach cadence for stalled opportunities", "build a content calendar", or "how should we re-engage cold referrals" — so the securities firewall, consent/TCPA/TRAIGA rules, and the AI green-zone/red-line are baked into the plan from the start. This emits a planning artifact only; it never sends, never writes to campaign tables, and never alters approved campaign content.
license: Proprietary — internal FSOS use only.
metadata:
  project: FSOS
  subsystem: marketing-planning
  guardrails: "2.1, 2.2, 2.3"
---

# FSOS Marketing & Outreach Planning

Produces the *plan* behind a marketing or outreach effort for the Farmers FSA practice: a structured, compliance-safe planning artifact a human then feeds into FSOS's existing campaign and comms modules. It is a **thinking and structuring aid, not an execution surface.** No plan this skill emits touches the database, the send-path, or any approved campaign content — the plan is the deliverable.

The single most important thing to internalize: FSOS already owns the *execution* machinery (three built campaigns + the native comms platform + the compliance-gated dispatcher). This skill's job is to plan *into* that machinery, mapping every planned move onto an existing campaign or sequence — never to design a parallel marketing system or invent a new send path.

## What this skill emits — the planning artifact

Every plan uses this structure, in this order. This is a contract: a marketing plan for this practice IS these six parts. Fill each with concrete, practice-specific content — not placeholders.

1. **Objective.** One measurable business outcome, tied to the aggregate-root spine (a stage advance, a review booked, an opportunity originated, a stalled case re-engaged). State the target segment size and the time window. Name which existing campaign or comms surface will carry it (see mapping below).
2. **Audience segment / ICP.** Who this reaches, defined by data the practice actually holds (household attributes, policy/coverage status, opportunity stage, referral source, prior engagement). State the *inclusion* and *exclusion* rules explicitly — exclusions are a compliance surface (securities-flagged, no consent, DNC, active conversation, recently contacted). Never define a segment on invented Farmers data (§2.3).
3. **Message map.** The content themes and the sequence of touches — what each touch says at a *theme* level (educate, invite, remind, follow up, offer a review, schedule). Every theme stays inside the green zone: it may educate, qualify, gather info, schedule, remind, route, follow up, or escalate. It may **never** recommend a product/policy/investment/allocation/replacement, make a suitability or best-interest determination, or issue a securities call to action (§2.1, §2.2). Note where a human hand-off / escalation is the planned next step.
4. **Channel + cadence table.** A table: for each touch — channel (email via Resend / SMS via Twilio-A2P / task for a human call), day offset, theme, and the gating precondition. SMS and email cadence must respect quiet hours (9am–8pm recipient-local floor) and frequency caps. Map the whole cadence onto an existing campaign timeline rather than inventing a scheduler.
5. **Consent & compliance checklist.** Explicit, per-channel: consent basis on record, TCPA prior express written consent for any SMS, TRAIGA AI disclosure present, DNC honored, securities firewall clear (`is_security` excluded), Reg BI / FINRA framing on any advice-adjacent content, and the mandatory educational footer where FNA/educational material appears. A plan that can't check these is not ready to hand off.
6. **KPIs / measurement.** How success is judged against the Objective — leading indicators (delivery, engagement, reply, opt-out rate) and the lagging spine outcome (reviews booked, opportunities originated/advanced, cases opened). State the opt-out-rate ceiling that would pause the effort.

## Map every plan onto an existing campaign or comms surface

FSOS ships three campaigns and one native comms platform. A plan targets one of these — it does not propose a new engine.

- **Life Conversion Campaign (ADR-029).** Multi-channel single-timeline extension; eligibility is *Active Opportunity Ownership*. Plan here when the effort is converting a term/eligible life opportunity the practice already owns.
- **Cross-Sell Life Campaign (ADR-032, `xsell_life_*`).** Existing non-life client with no active life; multi-channel 35-touch / 180-day timeline. Distinct from the Cross-Sell *agent*. Plan here for cross-sell-to-life pushes into the existing book.
- **Pipeline Win-Back Campaign (ADR-031).** Stalled *internal* opportunity re-engagement. Keep it separate from imported `win_back` (a distinct, imported-contact concept) — name which one you mean. Plan here for reviving stalled pipeline.
- **Native comms module (`src/lib/comms/`, `/app/comms`; ADRs 013–025).** Campaigns, sequences, enrollments, templates, the campaign library of pre-built compliance-ready blueprints, and the conversation lifecycle (a reply pauses promotional automation). General nurtures, content calendars, and one-off sequences plan into this surface. Prefer an existing library blueprint over a net-new sequence.

If a request doesn't fit any of these, say so and plan the *closest* fit plus the gap — do not invent a fourth campaign.

## Guardrails — baked into every plan (inherit CLAUDE.md §4)

These are not review steps applied at the end; they shape the segment, the message map, and the cadence as you write them.

1. **Securities firewall (§2.1).** Plans may only educate, qualify, gather info, schedule, remind, route, follow up, and escalate. Never plan a message that recommends a product/policy/investment/allocation/replacement, makes a suitability/best-interest determination, or is a securities call to action. Any `is_security`-flagged contact is **excluded** from an automated segment and routed to human/FFS handling — build that exclusion into the segment definition, not as an afterthought.
2. **AI green-zone / red-line (§2.2).** Everything the plan schedules for automated send stays green-zone. Anything advice-adjacent, ambiguous, or a client request for a recommendation is a **planned human/FSA escalation**, never an automated touch. Say in the plan where the hand-off happens.
3. **Consent, TCPA & TRAIGA (§12).** Every SMS in the plan requires TCPA prior express written consent and a TRAIGA AI disclosure; every plan carries Reg BI / FINRA framing on advice-adjacent content. Quiet hours (9am–8pm recipient-local floor), DNC, and frequency caps are cadence constraints, stated in the channel table. Educational/FNA content carries the mandatory footer.
4. **No invented Farmers data (§2.3).** Commission splits, term-conversion windows, product availability, and carrier/FFS rules are **not** public facts. A plan may reference them only as clearly-labeled, editable config defaults ("verify") — never as asserted numbers or claims in message themes. Segment definitions rest on data the practice actually holds.

## Boundaries — what this skill does NOT do

State these in the plan itself so the reader knows the artifact's edges:

- **It does not write to campaign tables.** No `comm_*`, `xsell_life_*`, campaign, enrollment, or template rows are created or edited. The plan is a document.
- **It does not alter approved campaign content.** Approved templates and blueprints are inputs to reference, never things this skill rewrites. Content-theme suggestions are *proposals* a human drafts and routes through the existing approval gate.
- **It does not send anything.** No SMS, email, or dispatch. Nothing here touches Twilio, Resend, or the dispatcher.
- **It does not change campaign business logic.** Eligibility rules, timelines, the enrollment lifecycle, the compliance gate — all untouched. The plan works *within* them.

The output is a planning artifact — objective, segment/ICP, message map, channel + cadence table, consent/compliance checklist, KPIs — that a human feeds into the existing modules. Execution, content authoring, approval, and dispatch all happen in those modules under their own guardrails.

## Authoritative sources — read, don't duplicate

- **Contract & guardrails:** `CLAUDE.md` §0 (what FSOS is), §4 (the three guardrails), §12 (communications compliance), §11 (AI governance).
- **The three campaigns:** `docs/adr/ADR-029-life-conversion-campaign.md`, `docs/adr/ADR-031-pipeline-winback-campaign.md`, `docs/adr/ADR-032-cross-sell-life-campaign.md`; plan `docs/superpowers/plans/2026-07-31-life-conversion-campaign.md`.
- **Native comms (campaigns/enrollments/library/conversation lifecycle):** `src/lib/comms/`, `/app/comms`, ADRs 013–025, slice docs `docs/comms-native/`. See **fsos-crm-workflows** for how this plumbing actually works.
- **Send-path compliance (consent, quiet hours, DNC, A2P, simulation):** **twilio-a2p-compliance**.
- **Spine the objective must tie to:** `docs/build-order.md`, `docs/data-guardrails.md`.

## When NOT to use this skill

- **Building or changing campaign execution** — enrollment logic, the drip runner, timelines, templates → **fsos-crm-workflows**.
- **Send-path SMS/email compliance implementation** — the gate, consent records, quiet-hours enforcement, A2P registration → **twilio-a2p-compliance**.
- **Public marketing *pages*** — homepage, landing, legal, the public intake surface → **farmers-brand-website**.
- **Authoring or approving actual message copy** for send — that runs through the comms module's template + approval gate, not a plan.

## Validate before claiming done

- The artifact has all six parts (objective, segment/ICP, message map, channel + cadence table, consent/compliance checklist, KPIs), each filled with practice-specific content.
- Every automated touch is green-zone; every advice-adjacent / recommendation moment is a planned human escalation.
- Every SMS touch names its TCPA consent basis and TRAIGA disclosure; the cadence respects quiet hours, DNC, and frequency caps.
- The plan maps onto exactly one existing campaign or the native comms surface — no new engine proposed.
- No Farmers config number is asserted as fact; any such value is labeled a config default to verify.
- The plan changed no code, no migration, and no campaign/template row — it is a document.
