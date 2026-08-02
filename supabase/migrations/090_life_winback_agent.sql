-- ═══════════════════════════════════════════════════════════════════
-- FSOS — Life Win-Back agent (ADR-034)
-- Migration: 090_life_winback_agent
--
-- Promotes the win-back capability from the mislabeled `marketing_automation`
-- outreach stub to a FIRST-CLASS, kill-switch-gated green-zone agent: `life_winback`.
-- Its book is former life-insurance households whose coverage lapsed (`contacts`
-- where source='winback_life'; see lib/dashboards/winback.ts). It only ever
-- identifies, educates, and INVITES a reconnect — never a product/policy
-- recommendation and never a securities call-to-action (§4.1/§4.2 green zone).
--
-- `marketing_automation` REMAINS a roster agent — it is the campaign-dispatch actor
-- (agent:marketing_automation) used by the comms dispatcher and the campaign engines.
-- What moves here is only its (previously unimplemented) proactive-outreach slot.
--
-- DISABLED BY DEFAULT: automated re-engagement of a FORMER client requires current,
-- granted consent (TCPA) plus the household/member mapping the dispatch path resolves
-- through. The quota row ships enabled=false until the operator verifies that mapping;
-- even once enabled, the compliance gate drops any recipient without granted consent,
-- outside quiet hours, on DNC, or securities-flagged. Idempotent; nothing dropped.
-- ═══════════════════════════════════════════════════════════════════

-- 1. Register the agent in the roster table (kill-switch lives on ai_agents.enabled).
insert into ai_agents (key, name, is_guardrail) values
  ('life_winback','Life Win-Back', false)
  on conflict (key) do nothing;

-- 2. Repurpose the former marketing_automation outreach quota into life_winback.
--    (agent_daily_targets.agent_key is the PK; buildQueue only iterates OUTREACH_AGENTS,
--    which no longer includes marketing_automation, so its old row would otherwise be a
--    dead, uneditable entry — the targets edit API validates against OUTREACH_AGENTS.)
update agent_daily_targets
  set agent_key = 'life_winback',
      channel = 'email',
      enabled = false,
      is_assumption = true,
      note = 'Former life-insurance households to re-engage (green-zone educational reconnect invite). Disabled until the household/member + consent mapping is verified — a former client still needs current granted consent (TCPA). Config default — verify cadence + volume with compliance.',
      updated_at = now()
  where agent_key = 'marketing_automation';

-- 3. Fallback for a fresh DB seeded without the marketing_automation row: ensure a
--    life_winback quota row exists (no-op if the update above already created it).
insert into agent_daily_targets (agent_key, daily_target, channel, enabled, is_assumption, note) values
  ('life_winback', 12, 'email', false, true,
   'Former life-insurance households to re-engage (green-zone educational reconnect invite). Disabled until the household/member + consent mapping is verified — a former client still needs current granted consent (TCPA). Config default — verify cadence + volume with compliance.')
  on conflict (agent_key) do nothing;
