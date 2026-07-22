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
- **Compliance gate.** The 7-step gate is pure in `lib/comms/gate.ts` and bound to the
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
| 1 | AI Command Center composed view + compliance-spine proof | **Delivered** |
| 2 | Cross-Sell revenue workflow (end-to-end) | Planned |
| 3 | Life Win-Back revenue workflow | Planned |
| 4 | Term Conversion revenue workflow | Planned |
| 5 | Appointment Generation & Recovery | Planned |
| 6 | Revenue Center (composed view) + Executive Dashboard enrichment | Planned |

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
