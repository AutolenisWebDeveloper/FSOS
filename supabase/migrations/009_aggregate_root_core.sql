-- ═══════════════════════════════════════════════════════════════════
-- FSOS — Aggregate-Root Core Schema
-- Migration: 009_aggregate_root_core
--
-- Builds the aggregate-root spine (data-guardrails.md §1) as FRESH tables.
-- Legacy tables (agencies, customers, policies, commission_*, opra_cases, …)
-- from migrations 001–008 are LEFT IN PLACE and UNTOUCHED; the legacy→new
-- mapping is documented in docs/legacy-mapping.md. Nothing here renames or
-- drops a legacy object.
--
-- Spine dependency order (build in this order):
--   agency_partnerships → referrals → households → reviews → opportunities
--   → cases → commissions.
-- Run in: Supabase → SQL Editor (or `npm run migrate`).
-- ═══════════════════════════════════════════════════════════════════

create extension if not exists "pgcrypto";

-- ─────────────────────────────────────────────────────────
-- Geography
-- ─────────────────────────────────────────────────────────
create table if not exists regions (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists districts (
  id          uuid primary key default gen_random_uuid(),
  region_id   uuid references regions(id) on delete set null,
  name        text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────
-- AGGREGATE ROOT — Agency-Owner Partnership
-- ─────────────────────────────────────────────────────────
create table if not exists agency_partnerships (
  id                    uuid primary key default gen_random_uuid(),
  agency_name           text not null,
  owner_name            text not null,
  district_id           uuid references districts(id) on delete set null,
  status                text not null default 'prospective'
                          check (status in ('prospective','activated','producing','dormant','terminated')),
  relationship_strength smallint,
  last_contact_at       timestamptz,
  checkin_interval_days integer not null default 30,
  comp_disclosure       boolean not null default false,   -- comp-disclosure gate (rbac §2)
  pc_book_policies      integer not null default 0 check (pc_book_policies >= 0),
  life_policies_in_force integer not null default 0 check (life_policies_in_force >= 0),
  ytd_referrals         integer not null default 0,
  ytd_placed_premium    numeric(14,2) not null default 0,
  ytd_fsa_commission    numeric(14,2) not null default 0,
  owner_scope           uuid,                              -- owning FSA user (book scope)
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create table if not exists agency_owners (
  id                uuid primary key default gen_random_uuid(),
  agency_id         uuid not null references agency_partnerships(id) on delete cascade,
  full_name         text not null,
  email             text,
  phone             text,
  portal_user_id    uuid,                                  -- links to auth user when portal access granted
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create table if not exists agency_activation (
  id            uuid primary key default gen_random_uuid(),
  agency_id     uuid not null references agency_partnerships(id) on delete cascade,
  stage         text not null default 'identified'
                  check (stage in ('identified','introduced','commitment','onboarded','first_referral','producing')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────
-- Households + members (DOB is the only sensitive PII → pgcrypto)
-- ─────────────────────────────────────────────────────────
create table if not exists households (
  id                    uuid primary key default gen_random_uuid(),
  referring_agency_id   uuid references agency_partnerships(id) on delete set null,
  primary_name          text not null,
  address               text,
  city                  text,
  state                 text default 'TX',
  zip                   text,
  do_not_contact        boolean not null default false,
  owner_scope           uuid,                              -- owning FSA user (book scope)
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create table if not exists household_members (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references households(id) on delete cascade,
  full_name     text not null,
  relationship  text,
  dob_enc       bytea,                                     -- pgcrypto-encrypted DOB (see functions in 010)
  email         text,
  phone         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────
-- Referrals (attribution source of the revenue spine)
-- ─────────────────────────────────────────────────────────
create table if not exists referrals (
  id                    uuid primary key default gen_random_uuid(),
  referring_agency_id   uuid references agency_partnerships(id) on delete set null,
  household_id          uuid references households(id) on delete set null,
  referred_name         text,
  engagement            text not null default 'warm_handoff'
                          check (engagement in ('warm_handoff','co_sell','direct')),
  status                text not null default 'received'
                          check (status in ('received','working','converted','declined')),
  received_at           timestamptz not null default now(),
  first_touch_at        timestamptz,
  sla_due_at            timestamptz,
  loss_reason           text,
  owner_scope           uuid,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────
-- Consent + DNC (gate everything — WF-9)
-- ─────────────────────────────────────────────────────────
create table if not exists consents (
  id            uuid primary key default gen_random_uuid(),
  member_id     uuid references household_members(id) on delete cascade,
  household_id  uuid references households(id) on delete cascade,
  channel       text not null check (channel in ('call','sms','email')),
  status        text not null default 'granted' check (status in ('granted','revoked')),
  source        text,
  disclosure    text,
  captured_at   timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (member_id, channel)
);

create table if not exists dnc_entries (
  id            uuid primary key default gen_random_uuid(),
  contact       text not null,                             -- phone or email
  channel       text not null check (channel in ('call','sms','email','all')),
  scope         text not null default 'internal' check (scope in ('internal','external')),
  reason        text,
  created_at    timestamptz not null default now(),
  unique (contact, channel)
);

-- ─────────────────────────────────────────────────────────
-- Carriers, products (products carry the securities firewall flag)
-- ─────────────────────────────────────────────────────────
create table if not exists carriers (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  is_farmers    boolean not null default false,
  is_ffs        boolean not null default false,            -- securities carrier
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists products (
  id                    uuid primary key default gen_random_uuid(),
  carrier_id            uuid references carriers(id) on delete set null,
  family                text not null check (family in ('life','annuity','investment','education')),
  subtype               text,
  is_security           boolean not null default false,
  required_license      text,
  conversion_window_days integer,                          -- CONFIG DEFAULT (assumption)
  conversion_window_is_assumption boolean not null default true,
  active                boolean not null default true,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────
-- Policies + coverages
-- ─────────────────────────────────────────────────────────
-- NB: named household_policies (not "policies") to avoid colliding with the
-- legacy `policies` table from migration 001, which is kept in place untouched.
create table if not exists household_policies (
  id                  uuid primary key default gen_random_uuid(),
  household_id        uuid not null references households(id) on delete cascade,
  carrier_id          uuid references carriers(id) on delete set null,
  product_id          uuid references products(id) on delete set null,
  policy_number       text,
  status              text not null default 'active'
                        check (status in ('quoted','bound','active','lapsed','cancelled','non_renewed','renewed')),
  is_with_us          boolean not null default true,
  premium             numeric(14,2),
  effective_date      date,
  expiration_date     date,
  renewal_date        date,
  x_date              date,                                -- competitor cadence (when !is_with_us)
  conversion_deadline date,
  is_security         boolean not null default false,
  ffs_case_ref        text,                                -- non-substantive pointer ONLY
  owner_scope         uuid,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create table if not exists coverages (
  id            uuid primary key default gen_random_uuid(),
  policy_id     uuid not null references household_policies(id) on delete cascade,
  detail        text,
  riders        jsonb,
  face_amount   numeric(14,2),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────
-- Financial Review (first-class connective layer — WF-2)
-- ─────────────────────────────────────────────────────────
create table if not exists reviews (
  id                  uuid primary key default gen_random_uuid(),
  household_id        uuid not null references households(id) on delete cascade,
  type                text not null check (type in ('policy','coverage','term_conversion','retirement','annual')),
  stage               text not null default 'requested'
                        check (stage in ('requested','scheduled','prepared','completed','outcome_logged')),
  scheduled_at        timestamptz,
  agenda              jsonb,
  outcome             jsonb,                               -- records NEEDS, never a "recommendation"
  generated_opp_ids   uuid[] not null default '{}',
  owner_scope         uuid,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────
-- Opportunity & Pipeline (is_security gate + ffs pointer)
-- ─────────────────────────────────────────────────────────
create table if not exists opportunities (
  id                  uuid primary key default gen_random_uuid(),
  referring_agency_id uuid references agency_partnerships(id) on delete set null,
  referral_id         uuid references referrals(id) on delete set null,
  household_id        uuid references households(id) on delete set null,
  product_id          uuid references products(id) on delete set null,
  engagement          text not null default 'warm_handoff'
                        check (engagement in ('warm_handoff','co_sell','direct')),
  stage               text not null default 'prospect'
                        check (stage in ('prospect','fact_find','quoted_proposed','application',
                                         'underwriting_suitability','placed_issued','lost')),
  is_security         boolean not null default false,
  license_basis_used  text,
  face_amount         numeric(14,2),
  premium             numeric(14,2),
  aum                 numeric(14,2),
  expected_commission numeric(14,2),
  actual_commission   numeric(14,2),
  lost_reason         text,
  ffs_case_ref        text,                                -- non-substantive pointer ONLY
  stage_history       jsonb not null default '[]',
  owner_scope         uuid,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────
-- Case Management (NIGO-FREE — application → underwriting → issue → service)
-- ─────────────────────────────────────────────────────────
create table if not exists cases (
  id            uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references opportunities(id) on delete cascade,
  household_id  uuid references households(id) on delete set null,
  carrier_id    uuid references carriers(id) on delete set null,
  status        text not null default 'submitted'
                  check (status in ('submitted','underwriting','requirements_outstanding','approved','issued','in_service','declined','withdrawn')),
  is_security   boolean not null default false,
  ffs_case_ref  text,
  submitted_at  timestamptz,
  owner_scope   uuid,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists case_requirements (
  id            uuid primary key default gen_random_uuid(),
  case_id       uuid not null references cases(id) on delete cascade,
  requirement   text not null,
  status        text not null default 'outstanding' check (status in ('outstanding','received','waived','complete')),
  document_id   uuid,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────
-- Commission (+ assumption-flagged split defaults; sum must be 100)
-- ─────────────────────────────────────────────────────────
create table if not exists commission_splits (
  id              uuid primary key default gen_random_uuid(),
  product_family  text not null check (product_family in ('life','annuity','investment','education')),
  agency_id       uuid references agency_partnerships(id) on delete cascade,   -- null = default; set = per-agency override
  fsa_split_pct   numeric(5,2) not null,
  agency_split_pct numeric(5,2) not null,
  is_assumption   boolean not null default true,          -- CONFIG DEFAULT — verify (guardrail 3)
  note            text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check (fsa_split_pct + agency_split_pct = 100)          -- E3: splits sum to 100
);

create table if not exists commissions (
  id                  uuid primary key default gen_random_uuid(),
  opportunity_id      uuid references opportunities(id) on delete set null,
  referring_agency_id uuid references agency_partnerships(id) on delete set null,
  product_family      text check (product_family in ('life','annuity','investment','education')),
  is_security         boolean not null default false,
  license_basis       text,
  total_commission    numeric(14,2) not null default 0,
  fsa_split_pct       numeric(5,2),
  agency_split_pct    numeric(5,2),
  fsa_amount          numeric(14,2) generated always as (round(total_commission * coalesce(fsa_split_pct,0) / 100, 2)) stored,
  agency_amount       numeric(14,2) generated always as (round(total_commission * coalesce(agency_split_pct,0) / 100, 2)) stored,
  is_trail            boolean not null default false,
  paid_on             date,
  reconciliation_status text not null default 'expected' check (reconciliation_status in ('expected','received','matched','discrepancy')),
  ffs_case_ref        text,
  owner_scope         uuid,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────
-- Campaigns, templates, messages, suppression (comms)
-- ─────────────────────────────────────────────────────────
create table if not exists comm_templates (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  channel       text not null check (channel in ('sms','email')),
  category      text,
  body          text not null,
  approval_status text not null default 'draft' check (approval_status in ('draft','submitted','approved')),
  version       integer not null default 1,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists comm_campaigns (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  status        text not null default 'draft' check (status in ('draft','active','paused','completed')),
  template_id   uuid references comm_templates(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- named comm_campaign_enrollments to avoid colliding with the legacy
-- `campaign_enrollments` table from migration 006 (kept in place untouched).
create table if not exists comm_campaign_enrollments (
  id            uuid primary key default gen_random_uuid(),
  campaign_id   uuid not null references comm_campaigns(id) on delete cascade,
  household_id  uuid references households(id) on delete cascade,
  member_id     uuid references household_members(id) on delete set null,
  status        text not null default 'enrolled' check (status in ('enrolled','sent','suppressed','opted_out','completed')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (campaign_id, member_id)
);

create table if not exists comm_messages (
  id            uuid primary key default gen_random_uuid(),
  channel       text not null check (channel in ('sms','email')),
  direction     text not null default 'outbound' check (direction in ('outbound','inbound')),
  recipient     text,
  body          text,
  delivery_status text not null default 'queued' check (delivery_status in ('queued','sent','delivered','failed','blocked')),
  template_id   uuid references comm_templates(id) on delete set null,
  campaign_id   uuid references comm_campaigns(id) on delete set null,
  entity_type   text,
  entity_id     uuid,
  created_at    timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────
-- Documents, activities, tasks, appointments
-- ─────────────────────────────────────────────────────────
create table if not exists documents (
  id            uuid primary key default gen_random_uuid(),
  entity_type   text,
  entity_id     uuid,
  classification text,
  storage_path  text,
  version       integer not null default 1,
  retention_until date,
  legal_hold    boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists document_requests (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid references households(id) on delete cascade,
  case_id       uuid references cases(id) on delete set null,
  requirement   text not null,
  status        text not null default 'requested' check (status in ('requested','received','waived')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists activities (
  id            uuid primary key default gen_random_uuid(),
  entity_type   text,
  entity_id     uuid,
  kind          text,
  note          text,
  actor         text,
  created_at    timestamptz not null default now()
);

-- named work_tasks to avoid colliding with the legacy `tasks` table from
-- migration 005 (kept in place untouched).
create table if not exists work_tasks (
  id            uuid primary key default gen_random_uuid(),
  title         text not null,
  entity_type   text,
  entity_id     uuid,
  assignee      uuid,
  source        text not null default 'manual' check (source in ('manual','workflow','agent')),
  due_at        timestamptz,
  completed     boolean not null default false,
  owner_scope   uuid,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists appointments (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid references households(id) on delete set null,
  review_id     uuid references reviews(id) on delete set null,
  scheduled_at  timestamptz,
  status        text not null default 'scheduled' check (status in ('scheduled','completed','cancelled','no_show')),
  external_ref  text,                                      -- Google Calendar id (or null = manual)
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────
-- AI operations + compliance events
-- ─────────────────────────────────────────────────────────
create table if not exists ai_policies (
  id                text primary key default 'global',
  gateway_enabled   boolean not null default true,        -- global kill switch
  updated_at        timestamptz not null default now()
);

create table if not exists ai_agents (
  id            uuid primary key default gen_random_uuid(),
  key           text not null unique,
  name          text not null,
  enabled       boolean not null default true,            -- per-agent kill switch
  mission       text,
  is_guardrail  boolean not null default false,           -- Compliance Guardrail cannot be disabled w/o super+2FA
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists agent_runs (
  id            uuid primary key default gen_random_uuid(),
  agent_key     text not null,
  actor         text,
  input         jsonb not null default '{}',
  status        text not null default 'running' check (status in ('running','completed','errored')),
  model         text,
  input_tokens  integer not null default 0,
  output_tokens integer not null default 0,
  cost_usd      numeric(12,4) not null default 0,
  confidence    numeric(4,3),
  error         text,
  started_at    timestamptz not null default now(),
  finished_at   timestamptz
);

create table if not exists agent_actions (
  id              uuid primary key default gen_random_uuid(),
  run_id          uuid references agent_runs(id) on delete cascade,
  kind            text not null,
  actor           text,
  outcome         text,
  target_type     text,
  target_id       uuid,
  reason          text,
  blocked_step    text,
  note            text,
  drafted_content text,
  created_at      timestamptz not null default now()
);

create table if not exists compliance_events (
  id            uuid primary key default gen_random_uuid(),
  kind          text not null,                             -- comms_blocked | firewall | agent_escalation | ...
  actor         text,
  channel       text,
  recipient     text,
  entity_type   text,
  entity_id     uuid,
  blocked_step  text,
  reason        text,
  created_at    timestamptz not null default now()
);

create table if not exists incidents (
  id            uuid primary key default gen_random_uuid(),
  scope         text,
  data_types    text,
  discovered_at timestamptz not null default now(),
  status        text not null default 'open' check (status in ('open','assessing','notifying','closed')),
  affected_count integer,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists licenses (
  id            uuid primary key default gen_random_uuid(),
  holder_user_id uuid,
  kind          text,                                      -- life/health | SIE | 6 | 7 | 63 | 66 | ...
  state         text,
  status        text not null default 'active' check (status in ('active','expired','pending')),
  expires_on    date,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────
-- Notifications (gap-closure #1)
-- ─────────────────────────────────────────────────────────
create table if not exists notifications (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null,
  kind          text,
  title         text not null,
  body          text,
  link          text,
  read_at       timestamptz,
  created_at    timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────
-- Durable-job bookkeeping (idempotency) + append-only audit
-- ─────────────────────────────────────────────────────────
create table if not exists job_runs (
  id            uuid primary key default gen_random_uuid(),
  dedupe_key    text not null unique,                      -- idempotency key
  job           text not null,
  status        text not null default 'running' check (status in ('running','completed','errored')),
  error         text,
  started_at    timestamptz not null default now(),
  finished_at   timestamptz
);

create table if not exists audit_log (
  id            bigint generated always as identity primary key,
  actor         text not null,
  action        text not null,
  entity        text not null,
  entity_id     text,
  diff          jsonb,
  at            timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────
-- Auth linkage (portal scope; RLS helpers in 010 read these)
-- ─────────────────────────────────────────────────────────
create table if not exists user_roles (
  user_id       uuid not null,
  role          text not null,
  created_at    timestamptz not null default now(),
  primary key (user_id, role)
);

create table if not exists user_agencies (
  user_id               uuid not null,
  agency_partnership_id uuid not null references agency_partnerships(id) on delete cascade,
  created_at            timestamptz not null default now(),
  primary key (user_id, agency_partnership_id)
);

create table if not exists user_households (
  user_id       uuid not null,
  household_id  uuid not null references households(id) on delete cascade,
  created_at    timestamptz not null default now(),
  primary key (user_id, household_id)
);

-- ─────────────────────────────────────────────────────────
-- Helpful indexes
-- ─────────────────────────────────────────────────────────
create index if not exists idx_referrals_status on referrals(status);
create index if not exists idx_referrals_sla on referrals(sla_due_at);
create index if not exists idx_households_agency on households(referring_agency_id);
create index if not exists idx_policies_household on household_policies(household_id);
create index if not exists idx_policies_conversion on household_policies(conversion_deadline) where conversion_deadline is not null;
create index if not exists idx_opportunities_stage on opportunities(stage);
create index if not exists idx_opportunities_household on opportunities(household_id);
create index if not exists idx_cases_status on cases(status);
create index if not exists idx_commissions_recon on commissions(reconciliation_status);
create index if not exists idx_agent_runs_agent on agent_runs(agent_key, started_at desc);
create index if not exists idx_compliance_events_kind on compliance_events(kind, created_at desc);
create index if not exists idx_audit_entity on audit_log(entity, entity_id);
create index if not exists idx_notifications_user on notifications(user_id, read_at);
