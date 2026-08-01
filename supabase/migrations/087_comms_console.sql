-- ─────────────────────────────────────────────────────────
-- Migration: 087_comms_console
--
-- Communications Command Console (feature spec v1) — the single operator console that
-- sends an individual SMS/email, reuses any communication asset from any campaign,
-- initiates an outbound AI conversation, and runs a real per-campaign TEST send.
--
-- CARDINAL PRINCIPLE (spec §0): the console adds NO new send path. Every outbound
-- message — manual, asset-sourced, AI-initiated, or test — flows through the SAME
-- production rails (sendThroughGate → evaluateGate 7-step → dispatch → comm_messages).
-- This migration only adds the metadata those rails need to attribute a send to its
-- source, an owner-scoped verified allowlist for test destinations, an outbound-origin
-- marker on conversations, and a READ-ONLY catalog view over the per-campaign asset
-- tables. It introduces no override, no bypass, and no securities data (firewall §4.1).
--
-- Additive · forward-only · idempotent. New columns are NULLABLE / defaulted so every
-- existing caller of comm_messages / comm_conversations is unaffected.
-- ─────────────────────────────────────────────────────────

-- ── 1. Send provenance on comm_messages ──────────────────────────────────────
-- Where a console send originated, so a test row is excludable from production
-- analytics and a campaign-asset send is traceable back to its source table/row.
alter table comm_messages
  add column if not exists source_kind         text not null default 'blank'
    check (source_kind in ('blank','campaign_asset','agent_seed','test')),
  add column if not exists source_campaign_key text,
  add column if not exists source_asset_id     uuid,
  add column if not exists source_asset_table  text,
  add column if not exists is_test             boolean not null default false;

comment on column comm_messages.source_kind is
  'Console send provenance: blank (free compose) | campaign_asset (reused touch/template) | agent_seed (AI opener) | test (per-campaign test send). Default blank keeps existing callers unchanged.';
comment on column comm_messages.is_test is
  'True for a per-campaign TEST send to a verified self destination. Test rows are a real gated send but are EXCLUDED from production campaign analytics/KPIs.';

-- Analytics exclude test rows cheaply; the partial index only covers the rare test rows.
create index if not exists idx_comm_messages_is_test on comm_messages (is_test) where is_test = true;
create index if not exists idx_comm_messages_source_campaign on comm_messages (source_campaign_key)
  where source_campaign_key is not null;

-- ── 2. Owner-scoped verified test-recipient allowlist ─────────────────────────
-- A test send may ONLY target a verified destination the acting operator owns. This
-- is what prevents a "test" from ever reaching a real client. Verification (verified_at)
-- is required before the address is usable.
create table if not exists comms_test_recipients (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null,                              -- operator who owns this destination
  channel           text not null check (channel in ('sms','email')),
  address           text not null,                              -- E.164 phone or lower-cased email
  label             text,                                       -- optional operator label ("my cell")
  verified_at       timestamptz,                                -- must be non-null before test sends allowed
  -- Ownership proof: a one-time code is sent (through the production gate) to the address;
  -- the operator confirms it to prove they control the destination before any test send.
  verification_code text,
  verification_sent_at timestamptz,
  created_at        timestamptz not null default now(),
  unique (channel, address)
);

create index if not exists idx_ctr_user on comms_test_recipients (user_id);

alter table comms_test_recipients enable row level security;

-- Owner-scoped: an operator sees and manages only their own destinations; super admins
-- may read all for oversight. App routes use the service-role client (getDb, bypasses RLS)
-- and additionally enforce user_id = actor on every read/write; this policy is the backstop.
drop policy if exists ctr_owner_all on comms_test_recipients;
create policy ctr_owner_all on comms_test_recipients for all
  using (is_super() or user_id = auth.uid())
  with check (user_id = auth.uid());

-- ── 3. Outbound-origin marker on comm_conversations ──────────────────────────
-- Conversations are created from INBOUND today. The console can INITIATE one (B1):
-- origin distinguishes an operator-started AI thread, and agent_key binds the agent
-- that governs its auto-replies. ai_autoreply / is_security semantics are unchanged.
alter table comm_conversations
  add column if not exists origin    text not null default 'inbound'
    check (origin in ('inbound','outbound_manual','campaign')),
  add column if not exists agent_key text references ai_agents(key) on delete set null;

comment on column comm_conversations.origin is
  'How the thread began: inbound (a reply arrived), outbound_manual (operator initiated via the console), or campaign (enrollment). Default inbound keeps existing rows unchanged.';
comment on column comm_conversations.agent_key is
  'The ai_agents.key bound to an operator-initiated AI conversation (B1). Governs auto-replies via the existing ai_autoreply path; guardrail agents are never bound here.';

-- ── 4. Cross-campaign sendable-asset catalog (READ-ONLY view) ─────────────────
-- The SINGLE source for "any sendable asset from any campaign". Every campaign's touch
-- rows and the standalone template library are normalized to one shape so the console
-- asset picker learns about a new campaign by adding exactly one `union all` here.
--
-- Column reconciliation (spec §3.4 — the sketch assumed columns that don't exist):
--   • The touch tables carry `kind` (email|sms|ai_conversation|advisor_outreach),
--     `template_id` → comm_templates, `asset_label`, `touch_no`, `day_offset`. They have
--     NO channel/name/version/compliance_class of their own, so those are LEFT JOINed
--     from the referenced comm_template (the row the gate actually renders + approves).
--   • comm_templates has `category` (the nearest thing to a compliance class), no subject.
--   • workshop_message_templates carries its own channel/subject/body + comm_template_id.
-- `template_id` is the render + gate handle (an approved comm_template satisfies gate
-- step 4). advisor_outreach touches produce a work_task, not a send, so they are EXCLUDED
-- (the picker only lists genuinely sendable assets).
create or replace view comm_sendable_assets as
  -- Standalone template library (not bound to a single campaign).
  select
    t.id                                            as asset_id,
    'comm_templates'::text                          as source_table,
    null::text                                      as campaign_key,
    t.channel                                       as channel,
    t.channel                                       as kind,
    t.name                                          as name,
    t.version                                       as version,
    t.category                                      as category,
    t.id                                            as template_id,
    null::text                                      as playbook_key,
    t.approval_status                               as approval_status
  from comm_templates t
  where t.archived_at is null

  union all
  -- Life Conversion Campaign touches (ADR-029).
  select
    lt.id,
    'life_campaign_touches',
    'life_conversion',
    coalesce(t.channel, case when lt.kind in ('email','sms') then lt.kind end),
    lt.kind,
    coalesce(lt.asset_label, t.name, 'Touch ' || lt.touch_no),
    t.version,
    t.category,
    lt.template_id,
    null::text,
    t.approval_status
  from life_campaign_touches lt
  left join comm_templates t on t.id = lt.template_id
  where lt.kind <> 'advisor_outreach'

  union all
  -- Cross-Sell Life Campaign touches (ADR-032).
  select
    xt.id,
    'xsell_life_campaign_touches',
    'cross_sell_life',
    coalesce(t.channel, case when xt.kind in ('email','sms') then xt.kind end),
    xt.kind,
    coalesce(xt.asset_label, t.name, 'Touch ' || xt.touch_no),
    t.version,
    t.category,
    xt.template_id,
    xt.playbook_key,
    t.approval_status
  from xsell_life_campaign_touches xt
  left join comm_templates t on t.id = xt.template_id
  where xt.kind <> 'advisor_outreach'

  union all
  -- Pipeline Win-Back Campaign touches (ADR-031).
  select
    pt.id,
    'pipeline_winback_touches',
    'pipeline_winback',
    coalesce(t.channel, case when pt.kind in ('email','sms') then pt.kind end),
    pt.kind,
    coalesce(pt.asset_label, t.name, 'Touch ' || pt.touch_no),
    t.version,
    t.category,
    pt.template_id,
    null::text,
    t.approval_status
  from pipeline_winback_touches pt
  left join comm_templates t on t.id = pt.template_id
  where pt.kind <> 'advisor_outreach'

  union all
  -- Workshop cadence templates (self-contained body + gate handle comm_template_id).
  select
    wt.id,
    'workshop_message_templates',
    'workshops',
    wt.channel,
    wt.channel,
    wt.kind,
    wt.version,
    null::text,
    wt.comm_template_id,
    null::text,
    wt.status
  from workshop_message_templates wt;

comment on view comm_sendable_assets is
  'READ-ONLY normalized catalog of every SENDABLE communication asset across all campaigns + the template library (spec §3.4). One row per asset; template_id is the render + gate handle. A new campaign adds one union all here — the only place the console picker must learn about it. advisor_outreach touches (work_task, not a send) are excluded.';

-- ── 5. Designated ad-hoc / manual templates for blank compose ─────────────────
-- Free-form (blank) compose still needs an APPROVED comm_template so classification and
-- the email compliance footer resolve (spec §5). These carry only the compliance footer
-- (unsubscribe token for email; the SMS TRAIGA/STOP footer is appended by the dispatcher).
-- The operator's typed body is the message; these satisfy gate step 4 and anchor the
-- CAN-SPAM footer. Seeded approved because a licensed operator authoring a 1:1 message is
-- itself the content approval (send.ts humanAuthored); recommendation language is still
-- hard-blocked at gate step 5.
insert into comm_templates (name, channel, category, body, approval_status, version, approved_at, approved_by)
select 'Ad-hoc manual — Email', 'email', 'ad_hoc',
  '<p>{{body}}</p><hr/><p style="font-size:12px;color:#666">You are receiving this because you are a client or contact of your Farmers Financial Services agent. <a href="{{unsubscribe_url}}">Unsubscribe</a>.</p>',
  'approved', 1, now(), 'system:087_comms_console'
where not exists (select 1 from comm_templates where category = 'ad_hoc' and channel = 'email' and archived_at is null);

insert into comm_templates (name, channel, category, body, approval_status, version, approved_at, approved_by)
select 'Ad-hoc manual — SMS', 'sms', 'ad_hoc',
  '{{body}}',
  'approved', 1, now(), 'system:087_comms_console'
where not exists (select 1 from comm_templates where category = 'ad_hoc' and channel = 'sms' and archived_at is null);
