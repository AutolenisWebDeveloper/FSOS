# ADR-034 — Life Win-Back agent (first-class win-back outreach)

**Status:** Accepted
**Date:** 2026-08-02
**Owner:** FSOS Engineering

## Context
The green-zone agent roster (`src/lib/ai/roster.ts` → seeded into `ai_agents`) never exposed a
dedicated agent for re-engaging **former life-insurance households whose coverage lapsed** — the
"Life Win-Back" book (`contacts` where `source = 'winback_life'`, surfaced at `/app/winback` and in
`lib/dashboards/winback.ts`). Win-back was instead scaffolded *inside* the generic
`marketing_automation` agent and left unfinished:

- `marketing_automation` was listed as an outreach agent in `OUTREACH_AGENTS`, and its
  `OUTREACH_PROMPTS` entry was actually a win-back re-engagement prompt.
- Its `agent_daily_targets` row shipped `enabled = false`, noted *"Pending win-back mapping."*
- Its workforce candidate builder returned `[]` (`workforce.ts`: *"win-back → member/consent mapping
  is a pending config; no candidates yet"*), so it never ran.
- The pure core reserved a `win_back` `OutreachSource`, a `lapsedMonths` signal, and a
  `priorityOf('win_back')` ramp — all unreachable dead code, because nothing emitted a `win_back`
  candidate.

Result: the roster page showed no "Life Win-Back" agent, the win-back capability was mislabeled as
"Marketing Automation", and the outreach path was inert. This is a fragmentation/naming problem
(§6) and a visibility gap.

Constraints: automated outreach to a **former** client is regulated — TCPA requires current, granted
consent before any automated message, and the securities firewall (§4.1) and AI red-line (§4.2) apply
to every touch. FSOS must not invent consent for a lapsed client (§4.3).

## Decision
Promote win-back to a **first-class, kill-switch-gated green-zone agent, `life_winback` ("Life
Win-Back")**, and retire the `marketing_automation` *outreach* slot:

1. **Roster:** add `life_winback` to `AGENT_ROSTER` (green-zone tools only:
   identify/educate/invite/schedule/remind/follow_up/escalate/log). Bump `PROMPT_VERSION`.
2. **Pure core (`outreach.ts`):** replace `marketing_automation` with `life_winback` in
   `OUTREACH_AGENTS` and move the re-engagement prompt to `OUTREACH_PROMPTS.life_winback`. The
   existing `win_back` source, `lapsedMonths` signal, and `priorityOf('win_back')` ramp are now
   reachable.
3. **Candidate builder (`workforce.ts`):** implement `lifeWinbackCandidates()` over
   `contacts` where `source='winback_life'`, **only for contacts linked to a household** (the dispatch
   path resolves the recipient + consent through a household member). Recency proxy for
   `lapsedMonths`: time since import (no lapse date is tracked — the same proxy the win-back dashboard
   documents).
4. **Seed (`migration 090`):** register `life_winback` in `ai_agents` and repurpose the former
   `marketing_automation` `agent_daily_targets` row into `life_winback`, **`enabled = false` by
   default** until the household/member + consent mapping is verified.
5. **`marketing_automation` REMAINS a roster agent** — it is the campaign-dispatch actor
   (`agent:marketing_automation`) used by the comms dispatcher and the campaign engines. Only its
   (never-implemented) proactive-outreach slot moved.

Every Life Win-Back touch routes ONLY through `sendThroughGate` (consent, quiet hours, DNC, approved
template/AI policy, no recommendation language, securities firewall). A lapsed household without
granted consent is dropped at selection/send (`selectForQuota` → skipped; gate → blocked), never
contacted.

## Rationale
- **De-fragmentation (§6):** one clearly-named agent for one job, instead of win-back masquerading as
  "Marketing Automation". Reuses the existing workforce/gate/roster machinery — no parallel subsystem.
- **Compliance-first:** disabled by default; contacts must resolve to a household member with granted
  consent, so the honest TCPA posture is enforced in code, not prose. No invented consent (§4.3).
- **Visibility:** the FSA now sees a real "Life Win-Back" agent in the roster, workforce, and quota
  editor, with its own kill switch.

## Alternatives Considered
- **Roster/display entry only (no builder):** rejected — leaves the capability inert and misleading
  (an enabled-looking agent that sends nothing).
- **Add `life_winback` *alongside* `marketing_automation` as outreach agents:** rejected — leaves the
  mislabeled, inert placeholder in place (fragmentation, §6).
- **Surface the Pipeline Win-Back campaign (ADR-031) as the "agent":** rejected — that campaign is a
  separate engine for stalled *internal opportunities*, a different bounded context from the lapsed
  *former-client* book; conflating them would blur boundaries.
- **Contact lapsed clients without a resolved household/consent mapping:** rejected — TCPA / §4.2.

## Consequences
**Positive**
- Life Win-Back is a visible, governed, kill-switch-gated agent with its own daily quota.
- Win-back outreach is now reachable and provably green-zone (guardrail tests), routed through the
  single compliance gate.
- Roster naming matches the product surface (`/app/winback`).

**Negative / trade-offs**
- Only `winback_life` contacts already linked to a household + member with granted consent are
  contacted; the rest depend on the ongoing data-quality household backfill + consent capture. This is
  intentional (safe by default), and the quota ships disabled until verified.
- `lapsedMonths` uses import-time as a lapse proxy until a real lapse date is tracked.

## Related Documents
- CLAUDE.md (§4.1, §4.2, §4.3, §6, §11, §12, §19)
- src/lib/ai/roster.ts · src/lib/ai/outreach.ts · src/lib/ai/workforce.ts
- src/lib/dashboards/winback.ts · supabase/migrations/090_life_winback_agent.sql
- docs/adr/ADR-031-pipeline-winback-campaign.md (distinct: stalled internal opportunities)
- tests/workforce.test.mjs · tests/p1-gate.test.mjs
