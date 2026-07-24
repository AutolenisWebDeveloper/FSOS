# AI Revenue Command Center — Initiative Log

> In-place extension of FSOS into an AI Revenue Command Center staffed by the existing
> governed multi-agent workforce. Delivered in **vertical slices** (§7.A of the build
> instruction), each its own draft PR that stops for review. This log records the
> discovery findings, the slice roadmap, and per-slice delivery. It does not restate
> `CLAUDE.md` (authority §1) or `DESIGN.md` (design authority §18).

## Current-state findings (discovery)

The orchestration foundation and compliance gate **already exist and are enforced** —
this is an extension, not a rebuild:

- **Orchestration.** `lib/ai/workforce.ts` (`buildQueue` → `runOutreachAgent` →
  `runWorkforce`) over the pure planner `lib/ai/outreach.ts` (`priorityOf`,
  `selectForQuota`, firewall/consent/DNC baked in). Durable runs via
  `jobs/agent-runner.ts` (`agent_runs` / `agent_actions` / `compliance_events`,
  kill-switch, idempotency, retry). Cron entry `workforce-orchestrator`.
- **Compliance gate.** The 13-step gate (`docs/data-guardrails.md` §5) is pure in `lib/comms/gate.ts` and bound to the
  DB at send time in `lib/comms/send.ts` (`sendThroughGate`): consent, quiet hours,
  business hours, DNC, approved template/AI policy, recommendation language,
  `is_security`. `lib/comms/dispatcher.ts` is the single send path; there is no
  force-send. The workforce dispatch path already routes every send through it.
- **Data model (additive-ready).** `outreach_queue`, `agent_daily_targets`,
  `v_workforce_today` (mig 034); `comm_campaigns` / `comm_campaign_enrollments` /
  `comm_conversations` / `comm_message_events` (migs 006/009/012/033); `consents`,
  `dnc_entries`, `comm_templates` (mig 009). No parallel tables are needed for the
  Command Center surface.
- **Surfaces.** `/app/ai/workforce`, `/app/ai/agents`, `/app/ai/escalations`,
  `/app/ai/runs`; `/super/ai/{policies,hours,targets,sandbox}`; `/app/comms/*`.

**Gap the initiative closes:** the workforce surface was a two-table dashboard, not the
operational cockpit of §20 (no executive status band, no unified human-attention queue,
no roster health, no results roll-up). Downstream revenue workflows (Cross-Sell,
Win-Back, Term Conversion, Appointment, Revenue Center) build on top of that cockpit.

## Slice roadmap

| # | Slice | Status |
|---|---|---|
| 1 | AI Command Center composed view + compliance-spine proof | **Delivered** (PR #90, merged) |
| 2 | Cross-Sell revenue workflow (end-to-end) | **Delivered** (PR #91, merged) |
| 3 | Life Win-Back revenue workflow | **Delivered** (PR #92, merged) |
| 4 | Term Conversion revenue workflow | **Delivered** (PR #94, merged) |
| 5 | Appointment Generation & Recovery | **Delivered** (PR #95, merged) |
| 6 | Revenue Center (composed view) | **Delivered** |

Each slice is one end-to-end capability (discovery → design → additive DB → services →
API → frontend → TDD → verification → docs), opened as its own draft PR, reviewed
before the next slice starts. No slice introduces a parallel subsystem; the aggregate
root (ADR-001), securities firewall (ADR-004), and NIGO boundaries (§5, ADR-012) are
preserved throughout.

## Slice 1 — AI Command Center (delivered)

**What.** Evolved `/app/ai/workforce` into the **AI Command Center** — a composed
operational view over existing data. No new source of truth, no new engine, no
migration.

**Changes.**
- `src/lib/ai/command-center.ts` — new **pure** view-model (DB-free, unit-provable in
  isolation like `outreach.ts`): `executiveStatus`, `resultsToday`, `rosterHealth`,
  `attentionItems`, `heldCount`. It composes `v_workforce_today`, `outreach_queue`,
  `agent_actions` escalations, and `compliance_events` into the operator's rollups.
  Securities-flagged queue rows surface as **critical `firewall` attention items** and
  are never counted toward sent/engaged results.
- `src/app/(fsa)/app/ai/workforce/page.tsx` — retitled to **AI Command Center**; added
  the executive status band, a ranked **Needs your attention** queue (escalations /
  blocked sends / held / firewall, with the purple securities marker and
  color-independent severity labels), an **AI employee roster** with health, and a
  **Results today** roll-up. Preserves the run button and the outreach queue.
- `src/app/(fsa)/layout.tsx` — added an **AI Command Center** nav entry (→
  `/app/ai/workforce`) in the Overview cluster. Every existing route is preserved.
- `tests/command-center.test.mjs` — compiles the pure module in isolation and proves
  the roll-ups plus the firewall invariant (a securities item is surfaced, never sent).
  Wired into `npm test`.

**Verification.** `npm run build`, `type-check`, `lint` clean; full `npm test` green
(new suite: 12 assertions). No schema change, no parallel subsystem; the compliance
gate remains the single enforced send path.

**Not in this slice.** Revenue attribution and the Revenue Center (slice 6); the
per-workflow specialists (slices 2–5). Autonomous outbound stays disabled by default at
`/super/ai/policies` (§35).

## Slice 2 — Cross-Sell revenue workflow (delivered)

**What.** Closed the §13.1 gap: cross-sell detection previously only logged an
`activity` (`crossSellScan`) or sent outreach — it **never created a tracked, attributed,
deduplicated pipeline opportunity**. This slice originates cross-sell **opportunities**
from detected coverage gaps, reusing the existing `opportunities` table (no parallel
pipeline).

**Changes.**
- `supabase/migrations/045_opportunity_source.sql` — **additive** nullable
  `opportunities.source` column + partial index. The explicit origination-provenance
  tag (§28) and the dedup key. Existing rows/paths unaffected; RLS inherited.
- `src/lib/opportunities/crosssell.ts` — new **pure** planner (DB-free, unit-provable):
  `isEligibleGap`, `engagementForGap`, `crossSellReason`, `planCrossSellOpportunities`.
  Every draft is `is_security: false` (a literal — cross-sell is never a securities
  target), carries **no invented commission/premium** (§4.3 — the FSA prices it), and
  is **deduplicated across the household** (one open cross-sell opportunity per
  household, and within a batch).
- `src/lib/opportunities/originate.ts` — impure service: reads `v_cross_sell_gaps` +
  open cross-sell opportunities, delegates the decision to the pure planner, inserts
  drafts on `opportunities` (attribution: `household_id`, `referring_agency_id`,
  `engagement`, `source='cross_sell'`, `stage_history`), and writes a per-opportunity +
  summary audit.
- `src/app/api/app/cross-sell/originate/route.ts` — `POST` (fsa + permission, Zod
  `limit`), green-zone data assembly that **sends nothing**.
- `src/components/app/OriginateCrossSellButton.tsx` + the cross-sell page — a "Create
  opportunities" action and a "Cross-sell opportunities" KPI (open, in-pipeline).
- `tests/crosssell-originate.test.mjs` — compiles the pure planner in isolation and
  proves eligibility, dedup (across household, batch, and vs. terminal/other-source),
  and the firewall invariant. Wired into `npm test`.

**Verification.** `build`, `type-check`, `lint` clean; full `npm test` green (new
suite: 13 assertions; `firewall-write-scan` still passes). Migration is additive +
forward-only; the existing three opportunity-creation paths are untouched.

**Known limitations.** No per-opportunity revenue estimate is invented (§4.3); the
aggregate cross-sell revenue estimate remains assumption-badged on the dashboard.
Origination is a human-triggered action (button) / callable service — wiring it into the
`cross-sell-scan` cron is a controlled follow-up so a production job's behavior isn't
changed inside this slice.

## Slice 3 — Life Win-Back revenue workflow (delivered)

**What.** Closed the §13.2 gap, exactly parallel to cross-sell: former-life clients are
imported into `contacts` (`source='winback_life'`, tagged `life-winback`) and a dashboard
reads them, but **nothing ever originated a tracked win-back opportunity**. This slice
originates deduplicated `win_back` opportunities from those contacts, reusing the
`opportunities` table.

**Key difference from cross-sell.** Win-back attributes to a **contact** (many imported
former-life prospects have no household yet), and `opportunities` had no contact linkage
— so this slice adds an additive `opportunities.contact_id` (mirroring how slice 2 added
`source`). The aggregate root stays the agency partnership (ADR-001); `contact_id` is a
supporting link, not a new root.

**Changes.**
- `supabase/migrations/046_opportunity_contact.sql` — **additive** nullable
  `opportunities.contact_id` FK (`→ contacts on delete set null`) + partial index. The
  attribution key when no household is resolved yet, and the win-back dedup key.
- `src/lib/opportunities/winback.ts` — new **pure** planner (`hadLife`,
  `isEligibleWinback`, `engagementForContact`, `winbackReason`,
  `planWinbackOpportunities`). Every draft is `is_security: false`; the reason is
  grounded in the imported list and **never claims a current/active policy or carrier**
  (§13.2 / §4.3); deduplicated to **one open win_back opportunity per contact**.
- `src/lib/opportunities/originate.ts` — extended with `originateWinBackOpportunities`
  (reads `contacts` where `source='winback_life'` + tag `life-winback` + un-worked, plus
  open win_back opportunities; plans; inserts with `contact_id` + attribution; audits).
- `src/app/api/app/winback/originate/route.ts` — `POST` (fsa + permission, Zod).
  Green-zone data assembly — sends nothing.
- `src/components/app/OriginateWinBackButton.tsx` + the win-back page — a "Create
  opportunities" action and a "Win-back opportunities" KPI.
- `tests/winback-originate.test.mjs` — proves eligibility (life-winback required), dedup
  (per contact, batch, terminal, other-source), and the firewall invariant. Wired into
  `npm test`.

**Verification.** `build`, `type-check`, `lint` clean; full `npm test` green (new suite:
15 assertions; `firewall-write-scan` still passes). Migration is additive + forward-only;
the win-back importer and dashboard are unchanged.

**Known limitations.** Win-back **outreach** (a `win_back` workforce candidate generator)
remains pending config as before — this slice originates opportunities only, not sends.
No policy/carrier/lapse-date is captured or invented (§4.3); premium-at-risk remains an
assumption-badged aggregate on the dashboard.

## Slice 4 — Term Conversion revenue workflow (delivered)

**What.** Closed the §13.3 gap, the third in the origination pattern: `v_conversions_due`
(keyed on **policy**, with a stored `conversion_deadline`) feeds detection/outreach, but
**no term-conversion opportunity was ever originated**. This slice originates
deadline-grounded, deduplicated `term_conversion` opportunities, reusing the
`opportunities` table.

**Completes the attribution trio.** `opportunities` had no policy linkage, so this adds
an additive `opportunities.policy_id` — the third additive origination key after `source`
(045) and `contact_id` (046). Aggregate root unchanged (ADR-001).

**Changes.**
- `supabase/migrations/047_opportunity_policy.sql` — **additive** nullable
  `opportunities.policy_id` FK (`→ household_policies on delete set null`) + partial
  index. Per-policy attribution + dedup key.
- `src/lib/opportunities/termconversion.ts` — new **pure** planner (`urgencyWindow`,
  `isEligibleConversion`, `conversionReason`, `planTermConversionOpportunities`).
  **Securities-flagged policies are EXCLUDED (firewall §4.1) — checked first, routed to
  FFS, never originated**; every draft is `is_security: false`. The deadline/urgency come
  from the **stored** `conversion_deadline` (nothing invented, §4.3); the reason is
  educational, never a conversion/product recommendation. Deduplicated to **one open
  `term_conversion` opportunity per policy**; finer urgency windows (7/14/30/60/90/180/365)
  derived from `days_remaining`.
- `src/lib/opportunities/originate.ts` — extended with
  `originateTermConversionOpportunities` (reads `v_conversions_due` with `is_security=false`
  + actionable tiers, plans, inserts with `policy_id` + product + household, audits;
  securities exclusions surfaced in the result note).
- `src/app/api/app/conversions/originate/route.ts` — `POST` (fsa + permission, Zod).
  Green-zone data assembly — sends nothing.
- `src/components/app/OriginateTermConversionButton.tsx` + the conversions page — a
  "Create opportunities" action and a "Conversion opportunities" KPI.
- `tests/termconversion-originate.test.mjs` — proves urgency windows, eligibility, the
  **securities-exclusion firewall**, and dedup. Wired into `npm test`.

**Verification.** `build`, `type-check`, `lint` clean; full `npm test` green (new suite:
14 assertions; `firewall-write-scan` still passes). Migration is additive + forward-only;
the conversion importer, dashboard, and per-policy action route are unchanged.

**Known limitations.** Term-conversion **outreach** already exists (workforce
`termConversionCandidates`); this slice adds the missing **opportunity origination** and
does not change the outreach path. No commission is invented (§4.3). Wiring origination
into the `conversion-watch` cron is a controlled follow-up.

## Slice 5 — Appointment Generation & Recovery (delivered)

**What.** FSOS had an `appointments` table (status `scheduled/completed/cancelled/no_show`)
but **nothing ever advanced an appointment past `scheduled`** — no lifecycle management,
no no-show detection, no recovery, and no direct opportunity link. This slice adds the
**recovery half of §13.4** — appointment lifecycle + no-show recovery + funnel + a direct
opportunity link — reusing `appointments` / `work_tasks`. It does **not** fabricate a
calendar integration (none is verified — §4.3): appointments stay manually entered /
created from a review, and this layer manages their lifecycle.

**Changes.**
- `supabase/migrations/048_appointment_lifecycle.sql` — **additive** nullable
  `appointments.opportunity_id` FK (§13.4 "link the appointment to its originating
  opportunity") + the two indexes the lifecycle/recovery sweep needs (the table had
  none).
- `src/lib/appointments/recovery.ts` — new **pure** core: `canTransition` (validated
  status state machine), `isOverdue` (scheduled-but-past triage), `needsRecovery`,
  `appointmentFunnel` (honest show-rate = held ÷ (held + no-show), 0 when none held),
  `planNoShowRecovery` (one recovery task per un-recovered no-show, deduped).
- `src/lib/appointments/service.ts` — `setAppointmentStatus` (validated transition +
  audit) and `runNoShowRecovery` (sweeps no-shows, creates internal reschedule
  `work_tasks`, deduped against open agent tasks, + activity + audit).
- `src/app/api/app/appointments/[id]/route.ts` (`PATCH` status) and
  `src/app/api/app/appointments/recovery/route.ts` (`POST` sweep) — fsa + permission,
  Zod. **Green-zone — they send nothing.**
- The calendar page — an appointment funnel (scheduled / held / no-shows / show-rate),
  an **Overdue — needs a decision** triage panel (mark held / no-show), a **No-shows**
  panel + a **Run no-show recovery** action. The disconnected Google Calendar shell is
  preserved (no fabricated integration).
- `tests/appointment-recovery.test.mjs` — proves the state machine, overdue detection,
  the funnel, and recovery planning/dedup. Wired into `npm test`.

**Verification.** `build`, `type-check`, `lint` clean; full `npm test` green (new suite:
14 assertions; `firewall-write-scan` still passes). Migration is additive + forward-only;
the review-create appointment insert path and CalendarView are unchanged.

**Known limitations.** The **Generation-from-replies** half of §13.4 (parsing inbound
replies into appointment intent) is **deferred**: inbound `cancel`/`yes` are already
consent STOP/START keywords, so appointment-intent parsing must not naively reclassify
them — a compliance-sensitive design left to a dedicated slice. No calendar API is wired
(manual entry + labeled disconnected shell, §4.3). Wiring the recovery sweep into a cron
is a controlled follow-up.

## Slice 6 — Revenue Center (delivered)

**What.** The **one net-new top-level page** the initiative permits (§0/§21): a
**composed, read-only** view over existing data — it holds **no revenue source of
truth**. It is the capstone that ties the whole initiative together: the opportunities
the workforce originates in slices 2–4 roll up here, attributed by workflow via the
`source` tags those slices created.

**Changes (no migration — pure composition).**
- `src/lib/revenue/center.ts` — new **pure** view-model: `revenueSummary` (securities
  separated from every automated total), `revenueBySource` (**revenue by workflow — the
  payoff of the `source` tags**), `pipelineByStage`, `conversionFunnel` (monotonic
  at-or-past), `revenueAtRisk` (stalled + lost), `attributionQuality`, and
  `dataQualityWarnings` (unattributed / no-value / unresolved-identity — surfaced, never
  hidden, §17/§32).
- `src/app/(fsa)/app/revenue/page.tsx` — the composed page. **Distinguishes Actual /
  Weighted / Expected / Projected / Potential** with distinct labels and assumption
  badges on estimates (§21): Actual from reconciled `v_commission_monthly`, Weighted +
  Projected reuse `lib/analytics/forecast.ts` (`weightedPipeline` / `runRate`), Expected
  from open opportunities, securities tracked on their own line. Plus revenue-by-workflow,
  pipeline + conversion funnels, the appointment funnel (slice 5), today's workforce
  activity, revenue-at-risk, and attribution/data-quality panels — all from the existing
  dashboard components.
- `src/app/(fsa)/layout.tsx` — a **Revenue Center** nav entry in the Overview cluster
  (beside the AI Command Center). Every existing route preserved.
- `tests/revenue-center.test.mjs` — proves the roll-ups, securities separation, source
  attribution, funnels, at-risk, and the data-quality warnings. Wired into `npm test`.

**Verification.** `build`, `type-check`, `lint` clean; full `npm test` green (new suite:
10 assertions; `firewall-write-scan` still passes). No schema change, no new source of
truth; every figure composes existing data with a clear Actual/Weighted/Expected/
Projected/Potential label.

**Known limitations.** Per-campaign **attributable revenue** is not shown — `v_campaign_metrics`
carries delivery/engagement only, no revenue attribution exists per campaign (would need a
new attribution model, out of scope). Executive-dashboard enrichment beyond this page is a
follow-up.

---

## Initiative status

All six planned slices are delivered, each as its own reviewed PR. The four §13 priority
revenue workflows (Cross-Sell, Life Win-Back, Term Conversion) originate tracked,
attributed, deduplicated, firewall-safe opportunities through **one shared, unit-proven
origination pattern** (pure planner → service → API → UI → test, additive migrations
045–047); appointments have real lifecycle + no-show recovery (048); and the AI Command
Center (evolved `/app/ai/workforce`) + the Revenue Center compose it all into operator and
executive cockpits. No parallel subsystem was created; the aggregate root (ADR-001),
securities firewall (ADR-004), and NIGO boundaries (§5) are intact throughout.
