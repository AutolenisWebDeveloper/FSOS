-- ─────────────────────────────────────────────────────────
-- Migration: 051_comm_identity_disclosure
--
-- Native Communications Platform — SLICE 2: First-contact identity disclosure engine
-- (master build instruction §8; ADR-016).
--
-- The PLATFORM inserts the approved identity disclosure automatically — a campaign
-- author never has to remember it. This migration adds:
--
--   1. comm_identity_config — the singleton, EDITABLE, approval-gated disclosure wording
--      (full + abbreviated templates, the Farmers entity/role label, and the inactivity
--      window). The exact Farmers legal/brand wording is NOT publicly verified, so it
--      ships as a CONFIG DEFAULT (is_assumption=true → gold "config default — verify"
--      badge, §4.3) that the FSA edits and approves.
--
--   2. comm_conversations identity-state columns — the per-channel disclosure state
--      (one thread = one channel), so the engine can tell first-touch from an
--      established thread and detect refresh conditions (sender/purpose change).
--
--   3. comm_messages identity flags — what was actually disclosed on each send (full vs
--      abbreviated, first-channel-touch, the config version, and why).
--
-- Additive, forward-only, idempotent. All new comm_conversations/comm_messages columns
-- are nullable/defaulted; existing rows and send paths are unaffected. No securities
-- data stored (firewall §4.1). No GHL surface touched (§0.A).
-- ─────────────────────────────────────────────────────────

-- ── 1. Editable, approval-gated disclosure config (singleton) ────────────────
create table if not exists comm_identity_config (
  id                    text primary key default 'global',
  -- The approved Farmers entity/role label — NEVER hard-coded in app code (§4.3).
  fsa_role_label        text not null,
  -- Templates use only registered identity tokens (sender.*, agency_owner.*,
  -- communication.reason, fsa_role_label). Validated/rendered by identity.ts.
  full_template         text not null,
  abbreviated_template  text not null,
  -- Disclosure older than this many days is considered stale → re-introduce.
  inactivity_days       integer not null default 45 check (inactivity_days > 0),
  version               integer not null default 1,
  approval_status       text not null default 'draft' check (approval_status in ('draft','submitted','approved','archived')),
  approved_at           timestamptz,
  approved_by           text,
  -- §4.3: the wording/window are config defaults until the FSA verifies them.
  is_assumption         boolean not null default true,
  note                  text,
  updated_at            timestamptz not null default now()
);

comment on table comm_identity_config is
  'Editable, approval-gated first-contact identity disclosure wording + inactivity window (§8). Farmers entity label is a config default (is_assumption) — never hard-coded (§4.3). Rendered by identity.ts; auto-inserted by send.ts.';

-- Seed the singleton with the §8 default structure. CONFIG DEFAULT — is_assumption=true.
-- Left as approval_status='draft' deliberately: auto-insertion only uses an APPROVED
-- config, so nothing is disclosed with unverified wording until the FSA approves it.
insert into comm_identity_config (id, fsa_role_label, full_template, abbreviated_template, note)
values (
  'global',
  'a Financial Services Agent with Farmers Financial Solutions',
  'This is {{sender.full_name}}, {{fsa_role_label}}. I work with {{agency_owner.full_name}}, your Farmers agent, and I am reaching out on {{agency_owner.first_name}}''s behalf regarding {{communication.reason}}.',
  'This is {{sender.first_name}} (working with {{agency_owner.full_name}}).',
  'Config default — verify the exact Farmers entity/role wording and the inactivity window, then approve. Nothing is auto-disclosed until this is approved.'
)
on conflict (id) do nothing;

-- ── 2. Per-channel disclosure state on the conversation (one thread = one channel) ──
alter table comm_conversations
  add column if not exists identity_disclosed_at       timestamptz,
  add column if not exists identity_disclosure_version integer,
  add column if not exists identity_sender_user_id     uuid,
  add column if not exists identity_purpose            text;

comment on column comm_conversations.identity_disclosed_at is
  'When the last FULL identity disclosure was made on this channel/thread (§8). Null = never disclosed; drives first-touch + inactivity-refresh decisions.';

-- ── 3. What each send actually disclosed ─────────────────────────────────────
alter table comm_messages
  add column if not exists identity_full_intro         boolean,
  add column if not exists is_first_channel_touch      boolean,
  add column if not exists identity_disclosure_version integer,
  add column if not exists identity_disclosure_reason  text;

comment on column comm_messages.identity_full_intro is
  'True when the platform prepended a FULL identity introduction to this message (§8); false = abbreviated/established; null = not an identity-governed send.';

-- ── 4. RLS — singleton config: FSA/staff/compliance/supervisor/admin/super read;
--    writes are service-role after an app-layer RBAC assertion (mig 010 pattern).
alter table comm_identity_config enable row level security;
drop policy if exists cic_read on comm_identity_config;
create policy cic_read on comm_identity_config for select using (
  is_super() or has_role('compliance') or has_role('supervisor')
  or has_role('fsa') or has_role('licensed_staff') or has_role('admin')
);
