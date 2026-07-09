-- ═══════════════════════════════════════════════════════════════════
-- FSOS — Drip campaigns (multi-step SMS / email sequences)
-- Migration: 006_campaigns
-- Run in: Supabase → SQL Editor → New Query → paste → Run
--
-- A campaign is an ordered list of steps ({order, delay_days, subject, body}).
-- Contacts are enrolled (by pipeline / source / id list); /api/campaigns/run
-- sends each due step via Resend or Twilio (consent-respecting) and advances the
-- enrollment. Safe to run more than once.
-- ═══════════════════════════════════════════════════════════════════

create table if not exists campaigns (
  campaign_id uuid primary key default gen_random_uuid(),
  name        text not null,
  channel     text not null default 'email',  -- email|sms
  status      text not null default 'active',  -- active|paused
  steps       jsonb not null default '[]',     -- [{order, delay_days, subject, body}]
  created_by  text,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

create table if not exists campaign_enrollments (
  enrollment_id uuid primary key default gen_random_uuid(),
  campaign_id   uuid not null references campaigns(campaign_id) on delete cascade,
  customer_id   uuid not null references customers(customer_id) on delete cascade,
  status        text not null default 'active',  -- active|completed|stopped
  current_step  integer not null default 0,
  next_send_at  timestamptz default now(),
  last_sent_at  timestamptz,
  enrolled_at   timestamptz default now(),
  completed_at  timestamptz,
  unique (campaign_id, customer_id)
);

create index if not exists idx_enroll_due      on campaign_enrollments(next_send_at) where status = 'active';
create index if not exists idx_enroll_campaign  on campaign_enrollments(campaign_id);
create index if not exists idx_enroll_customer  on campaign_enrollments(customer_id);

-- Service-role only.
alter table campaigns             enable row level security;
alter table campaign_enrollments  enable row level security;
