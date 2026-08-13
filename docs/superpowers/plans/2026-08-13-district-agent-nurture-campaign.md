# Plan — District Agent FS Nurture Campaign ("The Second Conversation")

**Date:** 2026-08-13 · **ADR:** ADR-038 · **Branch:** `claude/district-agent-financial-campaign-kdt3c1`

Agent-facing 12-month educational nurture. Mirrors Life Conversion onto the agency spine; reuses
gate, dispatcher, consent, state machine, resume/retry, analytics, presentation, and UI kit.

## Curriculum (12 sequential modules → 40 touches / 365 days)

| # | Module | Email A (concept) | SMS (nudge) | Email B (apply + CTA) |
|---|---|---|---|---|
| 1 | Financial foundations | ✓ | ✓ | ✓ |
| 2 | Managing money, reserves & debt | ✓ | ✓ | ✓ |
| 3 | Retirement planning for agency owners | ✓ | ✓ | ✓ · **Q1 live touch** |
| 4 | Homeownership & household protection | ✓ | ✓ | ✓ |
| 5 | Family protection & education funding | ✓ | ✓ | ✓ |
| 6 | Financial Needs Analysis | ✓ | ✓ | ✓ · **Q2 live touch** |
| 7 | Business-owner planning | ✓ | ✓ | ✓ |
| 8 | Term, Whole Life, IUL & VUL education | ✓ | ✓ | ✓ |
| 9 | Protection planning & LIAM | ✓ | ✓ | ✓ · **Q3 live touch** |
| 10 | Investments, IRAs, rollovers & money in motion | ✓ | ✓ | ✓ |
| 11 | Annuities & retirement-income planning | ✓ | ✓ | ✓ |
| 12 | Education, legacy, beneficiaries & annual planning | ✓ | ✓ | ✓ · **Q4 live touch** |

Day offsets: module *m* → Email A `(m-1)*30+1`, SMS `+9`, Email B `+19`; live touches after
modules 3/6/9/12. Curriculum is sequential relative to baseline; LIAM & seasonal money-in-motion
are `CALENDAR_OVERLAYS` (activation tasks), not reorderings.

## Phases

1. **Schema migration (112)** — `district_nurture_{campaigns,touches,enrollments,executions,advisor_touches}`,
   `v_district_nurture_candidates`, indexes, RLS (deny-by-default, 7 internal roles), registry trigger.
2. **Content migration (113)** — 24 email + 12 SMS `comm_templates` (draft, agent-facing, education-boundary-safe,
   email-shell vocabulary), 1 campaign row, 40 touch rows, seed advisor scripts as data.
   **Observability migration (114)** — executions retry/dead-letter columns.
3. **lib/district-nurture** — `engine.ts` (barrel), `schedule.ts`, `eligibility.ts`, `data.ts`, `enroll.ts`,
   `tick.ts`, `controls.ts`, `inbound.ts`, `conversation.ts`, `analytics.ts`, `detail.ts`, `jobs.ts`, `playbooks.ts`.
4. **Routes + jobs** — `/api/district-nurture/{route,enroll,[id]/control,health}`; `districtNurtureTick/-Retry/-Enroll`
   handlers + `JOBS` + `vercel.json` crons.
5. **UI** — `/app/comms/district-nurture/{page,[id]/page,loading}`; `CAMPAIGN_ENGINES.district_nurture` +
   nav + subnav; curriculum timeline, module details, content library/preview, participants, analytics,
   launch-readiness, config, overlays.
6. **Tests** — `district-nurture-{schedule,eligibility,states,messaging,content-integrity}.test.mjs` (unit) +
   RLS proof; then `tsc`, `lint`, `build`, `run-tests unit`.
7. **Review + verify** — requesting/receiving-code-review, impeccable UI pass, verification-before-completion,
   commit + push. Leave campaign **draft / inactive**; nothing approved or activated.
