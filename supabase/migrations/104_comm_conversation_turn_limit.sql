-- ─────────────────────────────────────────────────────────
-- 104 — Per-conversation AI turn limit (forced hand-off to the licensed FSA)
--
-- WHY. Nothing capped how many turns the automation could take in a life-insurance
-- conversation before a licensed person was brought in. Hand-off happened only if the model
-- volunteered it, or if a turn happened to trip the recommendation red line. For a regulated
-- product that is a real exposure: an unbounded AI conversation with a prospect, where each
-- individual turn passes every check and the AGGREGATE is an advisory relationship nobody
-- licensed ever entered.
--
-- WHAT. A hard, deterministic ceiling on consecutive AI turns per conversation, evaluated
-- BEFORE the model is called (so hitting it costs nothing) and enforced in code, not by
-- prompt. Reaching it is a HAND-OFF, not a stop: the thread's per-thread auto-reply is
-- disarmed, the FSA queue gets an item naming the reason, and the audit log records it. The
-- client is never met with silence — a person now owns the thread.
--
-- The counter is "AI turns SINCE THE LAST HUMAN TURN", not "AI turns ever". When Markist
-- replies from the inbox, the automation's budget resets: he has taken and returned control,
-- which is exactly the supervision the limit exists to force.
--
-- WHERE IT LIVES. comm_conversation_policy (migration 056) is already the editable
-- conversation-mode config table and already keyed by a text id. It gains `max_ai_turns` and
-- `enabled`, and becomes MULTI-ROW: 'global' is the default, and an additional row keyed by
-- an ai_agents.key (e.g. 'pipeline', 'cross_sell') overrides it for threads bound to that
-- campaign agent — the per-campaign override, as configuration rather than code. Reusing this
-- table rather than creating a parallel one keeps one conversation-policy surface (§6).
--
-- RELATIONSHIP TO THE REPLY FREQUENCY CAP (migration 103). Two bounds on the same behaviour,
-- deliberately on different axes and unable to contradict each other:
--     reply cap  → per CONTACT, per day/7 days   → volume         → gate step `frequency`
--     turn limit → per CONVERSATION, since human → depth          → before drafting
-- Both fail in the same direction (no send) and BOTH escalate to the FSA, so neither can end
-- a conversation silently.
--
-- Config defaults (§4.3): is_assumption already true on this table. 6 turns is NOT a
-- Farmers/FFS/carrier figure — it is a starting ceiling for the FSA to set deliberately.
--
-- Additive, forward-only, idempotent.
-- ─────────────────────────────────────────────────────────

alter table comm_conversation_policy
  add column if not exists max_ai_turns integer not null default 6,
  add column if not exists enabled      boolean not null default true;

-- A ceiling of 0 would mean "never auto-reply", which is what ai_autoreply=false already
-- expresses; require at least one turn so the two controls stay distinct and legible.
alter table comm_conversation_policy drop constraint if exists comm_conversation_policy_max_ai_turns_check;
alter table comm_conversation_policy
  add constraint comm_conversation_policy_max_ai_turns_check check (max_ai_turns >= 1);

comment on column comm_conversation_policy.max_ai_turns is
  'Maximum consecutive AI replies on one conversation before it is handed to the licensed FSA (§4.2). Counted SINCE THE LAST HUMAN-AUTHORED outbound message, so an FSA reply resets the budget. Reaching it disarms ai_autoreply and escalates — never a silent stop. Config default (is_assumption) — NOT a Farmers/FFS figure.';

comment on column comm_conversation_policy.enabled is
  'Whether this policy row is applied. A DISABLED row is treated as absent and the resolver falls back to the ''global'' row; disabling ''global'' itself removes the turn ceiling entirely and is intentionally an explicit, audited act.';

comment on table comm_conversation_policy is
  'Editable conversation-mode policy. MULTI-ROW: ''global'' is the default; a row keyed by an ai_agents.key overrides it for threads bound to that campaign agent (the per-campaign turn-limit override). Carries the §10 resume quiet period and the §4.2 per-conversation AI turn ceiling. Config defaults (is_assumption) — the FSA sets the real values.';

-- Backfill the existing singleton explicitly so the shipped default is visible in the row,
-- not only in the column default.
update comm_conversation_policy
   set max_ai_turns = 6,
       enabled      = true,
       is_assumption = true,
       note = coalesce(note, '') ||
              ' | Turn limit: config default — VERIFY. After 6 consecutive AI replies (counted since the last human reply) the conversation is handed to the licensed FSA and per-thread auto-reply is disarmed. Not a Farmers/FFS figure.',
       updated_at = now()
 where id = 'global'
   and max_ai_turns is distinct from 6;
