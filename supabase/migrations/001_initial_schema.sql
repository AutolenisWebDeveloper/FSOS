-- ═══════════════════════════════════════════════════════════════════
-- FSOS — Complete Supabase Schema
-- Migration: 001_initial_schema
-- Run in: Supabase → SQL Editor → New Query → paste → Run
-- ═══════════════════════════════════════════════════════════════════

-- Enable required extensions
create extension if not exists "uuid-ossp";
create extension if not exists "pg_cron";

-- ─────────────────────────────────────────────────────────
-- AGENCIES
-- ─────────────────────────────────────────────────────────
create table agencies (
  agency_id           text primary key,
  name                text not null,
  owner               text not null,
  city                text,
  phone               text,
  email               text,
  slug                text unique,
  agency_zoom         boolean default false,
  apex                boolean default false,
  notes               text,
  first_referral      date,
  last_referral       date,
  last_call           date,
  last_meeting        date,
  last_email          date,
  -- Computed nightly by trigger (replaces generated columns — current_date is STABLE not IMMUTABLE)
  days_since_referral integer default 999,
  needs_attention     boolean default false,
  created_at          timestamptz default now(),
  updated_at          timestamptz default now()
);

-- ─────────────────────────────────────────────────────────
-- CUSTOMERS
-- ─────────────────────────────────────────────────────────
create table customers (
  customer_id     uuid primary key default gen_random_uuid(),
  agency_id       text references agencies(agency_id) on delete set null,
  first_name      text not null,
  last_name       text not null,
  email           text,
  phone           text,
  cell_phone      text,
  dob             date,
  -- age computed by trigger (date_part('year', age(dob)) is STABLE not IMMUTABLE)
  age             integer,
  address         text,
  city            text,
  state           text default 'TX',
  zip             text,
  employer        text,
  occupation      text,
  marital_status  text,
  dependents      integer default 0,
  has_auto        boolean default false,
  has_home        boolean default false,
  has_life        boolean default false,
  has_umbrella    boolean default false,
  policy_count    integer default 0,
  source          text default 'apex',
  ghl_contact_id  text,
  apex_id         text,
  consent_sms     boolean default false,
  consent_email   boolean default false,
  consent_date    timestamptz,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

create index idx_customers_agency on customers(agency_id);
create index idx_customers_email on customers(email);
create index idx_customers_phone on customers(phone);
create index idx_customers_ghl on customers(ghl_contact_id);
create index idx_customers_apex on customers(apex_id);
create index idx_customers_age on customers(age);
create index idx_customers_state on customers(state);

-- ─────────────────────────────────────────────────────────
-- POLICIES
-- ─────────────────────────────────────────────────────────
create table policies (
  policy_id           uuid primary key default gen_random_uuid(),
  customer_id         uuid not null references customers(customer_id) on delete cascade,
  policy_number       text,
  policy_type         text not null,
  carrier             text,
  face_amount         numeric(12,2),
  annual_premium      numeric(10,2),
  monthly_premium     numeric(10,2),
  issue_date          date,
  expiry_date         date,
  conversion_deadline date,
  -- days_to_deadline computed by trigger (conversion_deadline - current_date is STABLE)
  days_to_deadline    integer,
  status              text default 'active',
  is_employer_group   boolean default false,
  notes               text,
  created_at          timestamptz default now(),
  updated_at          timestamptz default now()
);

create index idx_policies_customer on policies(customer_id);
create index idx_policies_type on policies(policy_type);
create index idx_policies_deadline on policies(conversion_deadline) where conversion_deadline is not null;
create index idx_policies_status on policies(status);

-- ─────────────────────────────────────────────────────────
-- SCORES
-- priority_score and primary_pipeline use only sibling columns — OK as generated
-- ─────────────────────────────────────────────────────────
create table scores (
  score_id            uuid primary key default gen_random_uuid(),
  customer_id         uuid not null references customers(customer_id) on delete cascade,
  opra_score          integer default 0 check (opra_score between 0 and 100),
  conversion_score    integer default 0 check (conversion_score between 0 and 100),
  life_score          integer default 0 check (life_score between 0 and 100),
  retirement_score    integer default 0 check (retirement_score between 0 and 100),
  business_score      integer default 0 check (business_score between 0 and 100),
  priority_score      integer generated always as (
    greatest(opra_score, conversion_score, life_score, retirement_score, business_score)
  ) stored,
  primary_pipeline    text generated always as (
    case
      when conversion_score >= 75 then 'conversions'
      when opra_score >= 60 then 'opra'
      when business_score >= 60 then 'business'
      when retirement_score >= 50 then 'retirement'
      when life_score >= 50 then 'life'
      else 'general'
    end
  ) stored,
  risk_score          integer,
  risk_label          text,
  time_horizon        text,
  scored_at           timestamptz default now(),
  unique (customer_id)
);

create index idx_scores_priority on scores(priority_score desc);
create index idx_scores_pipeline on scores(primary_pipeline);
create index idx_scores_conversion on scores(conversion_score desc) where conversion_score > 0;
create index idx_scores_opra on scores(opra_score desc) where opra_score > 0;

-- ─────────────────────────────────────────────────────────
-- CONSENT LEDGER
-- ─────────────────────────────────────────────────────────
create table consent_ledger (
  consent_id      uuid primary key default gen_random_uuid(),
  customer_id     uuid not null references customers(customer_id) on delete cascade,
  channel         text not null,
  status          text not null,
  recorded_at     timestamptz default now(),
  source          text,
  ip_address      text,
  notes           text
);

create index idx_consent_customer on consent_ledger(customer_id);
create index idx_consent_channel on consent_ledger(channel, status);

-- ─────────────────────────────────────────────────────────
-- CUSTOMER PROFILES
-- ─────────────────────────────────────────────────────────
create table customer_profiles (
  profile_id              uuid primary key default gen_random_uuid(),
  customer_id             uuid not null references customers(customer_id) on delete cascade,
  annual_income           numeric(12,2),
  spouse_income           numeric(12,2),
  household_debt          numeric(12,2),
  net_worth               numeric(12,2),
  monthly_savings         numeric(10,2),
  tax_bracket             text,
  has_401k                boolean,
  balance_401k            numeric(12,2),
  has_ira                 boolean,
  ira_type                text,
  ira_balance             numeric(12,2),
  has_life_ins            boolean,
  life_coverage           numeric(12,2),
  life_coverage_adequate  boolean,
  retirement_age          integer,
  retirement_income_goal  numeric(10,2),
  social_security_est     numeric(10,2),
  primary_concern         text,
  secondary_concern       text,
  risk_score              integer,
  risk_label              text,
  time_horizon            text,
  emergency_fund          text,
  estate_docs             text,
  business_owner          boolean default false,
  long_term_care          text,
  forms_completed         text[],
  updated_at              timestamptz default now(),
  unique (customer_id)
);

-- ─────────────────────────────────────────────────────────
-- ACTIVITY LOG
-- ─────────────────────────────────────────────────────────
create table activity (
  activity_id     uuid primary key default gen_random_uuid(),
  customer_id     uuid references customers(customer_id) on delete cascade,
  agency_id       text references agencies(agency_id) on delete set null,
  type            text not null,
  direction       text,
  channel         text,
  subject         text,
  notes           text,
  ai_agent        text,
  ghl_activity_id text,
  created_at      timestamptz default now()
);

create index idx_activity_customer on activity(customer_id);
create index idx_activity_type on activity(type);
create index idx_activity_created on activity(created_at desc);

-- ─────────────────────────────────────────────────────────
-- FORM SUBMISSIONS
-- ─────────────────────────────────────────────────────────
create table form_submissions (
  submission_id   uuid primary key default gen_random_uuid(),
  customer_id     uuid references customers(customer_id) on delete set null,
  agency_id       text references agencies(agency_id) on delete set null,
  form_id         text not null,
  form_title      text not null,
  token           text unique not null,
  status          text default 'sent',
  sent_at         timestamptz default now(),
  opened_at       timestamptz,
  submitted_at    timestamptz,
  expires_at      timestamptz default (now() + interval '30 days'),
  sent_via        text,
  response_data   jsonb,
  fna_report      jsonb,
  fna_generated_at timestamptz,
  fna_urgency     text,
  ip_address      text,
  created_at      timestamptz default now()
);

create unique index idx_form_submissions_token on form_submissions(token);
create index idx_form_submissions_customer on form_submissions(customer_id);
create index idx_form_submissions_form on form_submissions(form_id);
create index idx_form_submissions_status on form_submissions(status);

-- ─────────────────────────────────────────────────────────
-- FORM SENDS LOG
-- ─────────────────────────────────────────────────────────
create table form_sends (
  send_id         uuid primary key default gen_random_uuid(),
  submission_id   uuid references form_submissions(submission_id) on delete cascade,
  customer_id     uuid references customers(customer_id) on delete set null,
  form_id         text not null,
  channel         text not null,
  destination     text not null,
  sent_at         timestamptz default now(),
  delivered       boolean default false,
  opened_at       timestamptz
);

-- ─────────────────────────────────────────────────────────
-- COMMISSION RATES
-- ─────────────────────────────────────────────────────────
create table commission_rates (
  rate_id         uuid primary key default gen_random_uuid(),
  carrier         text not null,
  product_name    text not null,
  product_type    text not null,
  product_option  text,
  age_min         integer default 0,
  age_max         integer default 99,
  state_code      text default 'ALL',
  gdc_rate        numeric(5,4) not null,
  trail_rate      numeric(5,4) default 0,
  trail_years     integer default 0,
  is_target       boolean default false,
  notes           text,
  effective_date  date not null,
  archived        boolean default false,
  created_at      timestamptz default now()
);

create index idx_rates_lookup on commission_rates(product_type, carrier, archived);

insert into commission_rates (carrier, product_name, product_type, product_option, age_min, age_max, gdc_rate, trail_rate, is_target, effective_date) values
  ('MassMutual Ascend', 'Legend 7',          'fia',  'Option 1', 0,  75, 0.0650, 0,      false, '2024-01-01'),
  ('MassMutual Ascend', 'Landmark 5',         'fia',  'Option 1', 0,  75, 0.0525, 0,      false, '2024-01-01'),
  ('Athene',            'Agility 10',          'fia',  'Option 1', 0,  70, 0.0700, 0,      false, '2024-01-01'),
  ('Pacific Life',      'Pacific Horizon IUL', 'life', null,       18, 80, 0.9500, 0,      true,  '2024-01-01'),
  ('Protective',        'SPWL',                'life', null,       50, 80, 0.0700, 0,      false, '2024-01-01'),
  ('Voya',              'Mutual Fund IRA',     'mf',   null,       18, 99, 0.0100, 0.0050, false, '2024-01-01'),
  ('Corebridge',        'Power Index Plus',    'fia',  'Option 1', 0,  80, 0.0500, 0,      false, '2024-01-01');

-- ─────────────────────────────────────────────────────────
-- COMMISSION CASES
-- ─────────────────────────────────────────────────────────
create table commission_cases (
  case_id             uuid primary key default gen_random_uuid(),
  customer_id         uuid references customers(customer_id) on delete set null,
  agency_id           text references agencies(agency_id) on delete set null,
  rate_id             uuid references commission_rates(rate_id) on delete set null,
  carrier             text not null,
  product_name        text not null,
  product_type        text not null,
  product_option      text,
  client_age          integer,
  state_code          text default 'TX',
  premium             numeric(12,2),
  target_premium      numeric(12,2),
  gdc_rate_used       numeric(5,4),
  estimated_gdc       numeric(12,2),
  estimated_fsa       numeric(12,2),
  trail_rate_used     numeric(5,4),
  annual_trail        numeric(12,2),
  rate_missing        boolean default false,
  actual_gdc          numeric(12,2),
  actual_fsa          numeric(12,2),
  pipeline            text,
  case_status         text default 'pending',
  submitted_at        timestamptz,
  issued_at           timestamptz,
  issued_date         date,
  paid_date           date,
  fna_submission_id   uuid references form_submissions(submission_id) on delete set null,
  ghl_opportunity_id  text,
  fna_urgency         text,
  notes               text,
  created_at          timestamptz default now(),
  updated_at          timestamptz default now()
);

create index idx_cases_customer on commission_cases(customer_id);
create index idx_cases_status on commission_cases(case_status);
create index idx_cases_issued on commission_cases(issued_date desc);
create index idx_cases_agency on commission_cases(agency_id);

-- ─────────────────────────────────────────────────────────
-- WORKSHOPS
-- ─────────────────────────────────────────────────────────
create table workshops (
  workshop_id       uuid primary key default gen_random_uuid(),
  agency_id         text references agencies(agency_id) on delete set null,
  title             text not null,
  topic             text not null,
  scheduled_at      timestamptz not null,
  max_attendees     integer default 50,
  location          text,
  registration_link text,
  ghl_calendar_id   text,
  created_at        timestamptz default now()
);

create table workshop_registrations (
  reg_id              uuid primary key default gen_random_uuid(),
  workshop_id         uuid not null references workshops(workshop_id) on delete cascade,
  customer_id         uuid references customers(customer_id) on delete set null,
  registered_at       timestamptz default now(),
  attended            boolean default false,
  interest_level      text,
  notes               text,
  followup_action     text,
  appointment_booked  boolean default false
);

create index idx_workshop_regs_workshop on workshop_registrations(workshop_id);
create index idx_workshop_regs_customer on workshop_registrations(customer_id);

-- ─────────────────────────────────────────────────────────
-- OPRA CASES
-- ─────────────────────────────────────────────────────────
create table opra_cases (
  opra_id           uuid primary key default gen_random_uuid(),
  customer_id       uuid not null references customers(customer_id) on delete cascade,
  agency_id         text references agencies(agency_id) on delete set null,
  policy_id         uuid references policies(policy_id) on delete set null,
  transfer_date     date,
  annual_premium    numeric(10,2),
  contacted         boolean default false,
  contacted_at      timestamptz,
  appt_scheduled    boolean default false,
  appt_date         timestamptz,
  review_complete   boolean default false,
  review_date       date,
  transferred       boolean default false,
  transferred_date  date,
  status            text default 'identified',
  notes             text,
  ghl_contact_id    text,
  created_at        timestamptz default now(),
  updated_at        timestamptz default now()
);

create index idx_opra_customer on opra_cases(customer_id);
create index idx_opra_status on opra_cases(status);
create index idx_opra_transfer_date on opra_cases(transfer_date);

-- ─────────────────────────────────────────────────────────
-- AGENCY REFERRALS
-- ─────────────────────────────────────────────────────────
create table agency_referrals (
  referral_id   uuid primary key default gen_random_uuid(),
  agency_id     text not null references agencies(agency_id) on delete cascade,
  customer_id   uuid references customers(customer_id) on delete set null,
  client_name   text,
  client_email  text,
  client_phone  text,
  referral_type text,
  notes         text,
  status        text default 'new',
  submitted_at  timestamptz default now(),
  appt_date     timestamptz,
  outcome_date  date,
  created_at    timestamptz default now()
);

create index idx_referrals_agency on agency_referrals(agency_id);
create index idx_referrals_status on agency_referrals(status);
create index idx_referrals_submitted on agency_referrals(submitted_at desc);

-- ─────────────────────────────────────────────────────────
-- AGENCY UPLOADS
-- ─────────────────────────────────────────────────────────
create table agency_uploads (
  upload_id             uuid primary key default gen_random_uuid(),
  agency_id             text not null references agencies(agency_id) on delete cascade,
  filename              text,
  upload_type           text,
  record_count          integer default 0,
  processed_count       integer default 0,
  opportunities_created integer default 0,
  status                text default 'pending',
  error_message         text,
  drive_file_id         text,
  uploaded_at           timestamptz default now(),
  processed_at          timestamptz
);

create index idx_uploads_agency on agency_uploads(agency_id);
create index idx_uploads_status on agency_uploads(status);

-- ─────────────────────────────────────────────────────────
-- DAILY BRIEFINGS
-- ─────────────────────────────────────────────────────────
create table daily_briefings (
  briefing_id               uuid primary key default gen_random_uuid(),
  briefing_date             date not null unique,
  urgent_conversions        integer default 0,
  appointments_today        integer default 0,
  new_referrals             integer default 0,
  opra_due                  integer default 0,
  forms_pending             integer default 0,
  pipeline_gdc              numeric(12,2),
  submitted_gdc             numeric(12,2),
  issued_gdc_ytd            numeric(12,2),
  ai_calls_made             integer default 0,
  ai_texts_sent             integer default 0,
  ai_emails_sent            integer default 0,
  ai_appointments_booked    integer default 0,
  priority_actions          jsonb,
  raw_data                  jsonb,
  generated_at              timestamptz default now()
);

-- ─────────────────────────────────────────────────────────
-- TRIGGERS — update_updated_at
-- ─────────────────────────────────────────────────────────
create or replace function update_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger agencies_updated_at before update on agencies
  for each row execute function update_updated_at();
create trigger customers_updated_at before update on customers
  for each row execute function update_updated_at();
create trigger policies_updated_at before update on policies
  for each row execute function update_updated_at();
create trigger commission_cases_updated_at before update on commission_cases
  for each row execute function update_updated_at();
create trigger opra_cases_updated_at before update on opra_cases
  for each row execute function update_updated_at();

-- ─────────────────────────────────────────────────────────
-- TRIGGERS — computed columns (replaces generated columns that used current_date)
-- ─────────────────────────────────────────────────────────

-- customers.age — recompute on dob change
create or replace function compute_customer_age()
returns trigger language plpgsql as $$
begin
  if new.dob is not null then
    new.age := date_part('year', age(new.dob))::integer;
  else
    new.age := null;
  end if;
  return new;
end;
$$;

create trigger customers_compute_age
  before insert or update of dob on customers
  for each row execute function compute_customer_age();

-- policies.days_to_deadline — recompute on conversion_deadline change
create or replace function compute_days_to_deadline()
returns trigger language plpgsql as $$
begin
  if new.conversion_deadline is not null then
    new.days_to_deadline := (new.conversion_deadline - current_date)::integer;
  else
    new.days_to_deadline := null;
  end if;
  return new;
end;
$$;

create trigger policies_compute_deadline
  before insert or update of conversion_deadline on policies
  for each row execute function compute_days_to_deadline();

-- agencies.days_since_referral + needs_attention — recompute on last_referral change
create or replace function compute_agency_referral_stats()
returns trigger language plpgsql as $$
begin
  if new.last_referral is null then
    new.days_since_referral := 999;
    new.needs_attention := false;
  else
    new.days_since_referral := (current_date - new.last_referral)::integer;
    new.needs_attention := (current_date - new.last_referral) > 30;
  end if;
  return new;
end;
$$;

create trigger agencies_compute_referral_stats
  before insert or update of last_referral on agencies
  for each row execute function compute_agency_referral_stats();

-- ─────────────────────────────────────────────────────────
-- NIGHTLY REFRESH — recompute all date-dependent columns
-- Run by pg_cron alongside scoring so values stay current
-- ─────────────────────────────────────────────────────────
create or replace function refresh_computed_columns()
returns void language plpgsql as $$
begin
  -- Refresh customer ages
  update customers
  set age = date_part('year', age(dob))::integer
  where dob is not null;

  -- Refresh policy deadline countdowns
  update policies
  set days_to_deadline = (conversion_deadline - current_date)::integer
  where conversion_deadline is not null;

  -- Refresh agency referral stats
  update agencies
  set
    days_since_referral = case
      when last_referral is null then 999
      else (current_date - last_referral)::integer
    end,
    needs_attention = case
      when last_referral is null then false
      else (current_date - last_referral) > 30
    end;
end;
$$;

-- ─────────────────────────────────────────────────────────
-- SCORING FUNCTIONS
-- ─────────────────────────────────────────────────────────

create or replace function score_opra(p_customer_id uuid)
returns integer language plpgsql as $$
declare
  v_score        integer := 0;
  v_has_life     boolean;
  v_has_auto     boolean;
  v_has_home     boolean;
  v_age          integer;
begin
  select has_life, has_auto, has_home, age
  into v_has_life, v_has_auto, v_has_home, v_age
  from customers where customer_id = p_customer_id;

  if not v_has_life then v_score := v_score + 40; end if;
  if (v_has_auto and not v_has_home) or (v_has_home and not v_has_auto) then
    v_score := v_score + 30;
  end if;
  if v_has_auto and v_has_home and not v_has_life then
    v_score := v_score + 20;
  end if;
  if v_age between 30 and 60 then v_score := v_score + 10; end if;

  return least(v_score, 100);
end;
$$;

create or replace function score_conversion(p_customer_id uuid)
returns integer language plpgsql as $$
declare
  v_days integer;
begin
  select min(days_to_deadline)
  into v_days
  from policies
  where customer_id = p_customer_id
    and policy_type in ('term', 'term_life')
    and status = 'active'
    and conversion_deadline is not null;

  if v_days is null then return 0; end if;
  if v_days < 0 then return 0; end if;

  if v_days <= 30  then return 100; end if;
  if v_days <= 60  then return 90;  end if;
  if v_days <= 90  then return 75;  end if;
  if v_days <= 180 then return 50;  end if;
  if v_days <= 365 then return 25;  end if;
  return 10;
end;
$$;

create or replace function score_life(p_customer_id uuid)
returns integer language plpgsql as $$
declare
  v_score      integer := 0;
  v_has_life   boolean;
  v_has_home   boolean;
  v_dependents integer;
  v_age        integer;
  v_marital    text;
begin
  select has_life, has_home, coalesce(dependents, 0), age, marital_status
  into v_has_life, v_has_home, v_dependents, v_age, v_marital
  from customers where customer_id = p_customer_id;

  if v_has_life then return 0; end if;

  if v_has_home then v_score := v_score + 40; end if;
  if v_dependents > 0 then v_score := v_score + 30; end if;
  if v_marital = 'Married' then v_score := v_score + 15; end if;
  if v_age between 28 and 55 then v_score := v_score + 15; end if;

  return least(v_score, 100);
end;
$$;

create or replace function score_retirement(p_customer_id uuid)
returns integer language plpgsql as $$
declare
  v_score    integer := 0;
  v_age      integer;
  v_has_life boolean;
begin
  select age, has_life into v_age, v_has_life
  from customers where customer_id = p_customer_id;

  if v_age is null then return 0; end if;

  if v_age >= 70 then v_score := 90;
  elsif v_age >= 60 then v_score := 80;
  elsif v_age >= 55 then v_score := 65;
  elsif v_age >= 50 then v_score := 50;
  elsif v_age >= 40 then v_score := 30;
  elsif v_age >= 35 then v_score := 15;
  else return 0;
  end if;

  if v_has_life then v_score := v_score + 10; end if;
  return least(v_score, 100);
end;
$$;

create or replace function score_business(p_customer_id uuid)
returns integer language plpgsql as $$
declare
  v_score    integer := 0;
  v_employer text;
  v_age      integer;
  v_profile  record;
begin
  select employer, age into v_employer, v_age
  from customers where customer_id = p_customer_id;

  select * into v_profile from customer_profiles
  where customer_id = p_customer_id;

  if v_profile.business_owner = true then
    v_score := 80;
  elsif v_employer is not null and length(v_employer) > 0 then
    v_score := 30;
  end if;

  if v_age between 35 and 65 then v_score := v_score + 20; end if;
  return least(v_score, 100);
end;
$$;

create or replace function run_nightly_scoring()
returns void language plpgsql as $$
begin
  -- Refresh date-dependent computed columns first
  perform refresh_computed_columns();

  -- Then rescore all customers
  insert into scores (
    customer_id, opra_score, conversion_score, life_score,
    retirement_score, business_score, scored_at
  )
  select
    c.customer_id,
    score_opra(c.customer_id),
    score_conversion(c.customer_id),
    score_life(c.customer_id),
    score_retirement(c.customer_id),
    score_business(c.customer_id),
    now()
  from customers c
  on conflict (customer_id) do update set
    opra_score        = excluded.opra_score,
    conversion_score  = excluded.conversion_score,
    life_score        = excluded.life_score,
    retirement_score  = excluded.retirement_score,
    business_score    = excluded.business_score,
    scored_at         = excluded.scored_at;
end;
$$;

-- ─────────────────────────────────────────────────────────
-- GDC CALCULATOR
-- ─────────────────────────────────────────────────────────
create or replace function calculate_case_gdc(
  p_product_type   text,
  p_carrier        text,
  p_product        text,
  p_option         text,
  p_age            integer,
  p_state          text,
  p_premium        numeric,
  p_target_premium numeric default null,
  p_fsa_tier_rate  numeric default 0.80
)
returns table (
  gdc_rate      numeric,
  trail_rate    numeric,
  estimated_gdc numeric,
  estimated_fsa numeric,
  annual_trail  numeric,
  rate_missing  boolean
) language plpgsql as $$
declare
  r         commission_rates%rowtype;
  v_premium numeric;
begin
  select * into r
  from commission_rates
  where product_type = p_product_type
    and lower(carrier)      = lower(p_carrier)
    and lower(product_name) = lower(p_product)
    and (product_option = p_option or product_option is null or p_option is null)
    and p_age between age_min and age_max
    and (state_code = p_state or state_code = 'ALL')
    and archived = false
    and effective_date <= current_date
  order by effective_date desc
  limit 1;

  if r.rate_id is null then
    return query select null::numeric, null::numeric,
      null::numeric, null::numeric, null::numeric, true;
    return;
  end if;

  if p_product_type = 'life' and r.is_target and p_target_premium is not null
    then v_premium := p_target_premium;
  else
    v_premium := p_premium;
  end if;

  return query select
    r.gdc_rate,
    r.trail_rate,
    round(v_premium * r.gdc_rate, 2),
    round(v_premium * r.gdc_rate * p_fsa_tier_rate, 2),
    round(p_premium * coalesce(r.trail_rate, 0), 2),
    false;
end;
$$;

-- ─────────────────────────────────────────────────────────
-- FORM → CUSTOMER PROFILE SYNC
-- ─────────────────────────────────────────────────────────
create or replace function sync_form_to_profile()
returns trigger language plpgsql as $$
declare
  v_score integer := 0;
  v_val   text;
begin
  if new.form_id != 'customer-profile' then return new; end if;
  if new.response_data is null then return new; end if;

  foreach v_val in array array[
    new.response_data->>'risk_q1',
    new.response_data->>'risk_q2',
    new.response_data->>'risk_q3',
    new.response_data->>'risk_q4',
    new.response_data->>'risk_q5',
    new.response_data->>'risk_q6'
  ] loop
    if v_val ~ '\((\d)\)' then
      v_score := v_score + (regexp_match(v_val, '\((\d)\)'))[1]::integer;
    end if;
  end loop;

  insert into customer_profiles (
    customer_id, risk_score, risk_label, time_horizon, updated_at
  ) values (
    new.customer_id,
    v_score,
    case
      when v_score >= 23 then 'Aggressive'
      when v_score >= 13 then 'Moderate'
      else 'Conservative'
    end,
    new.response_data->>'time_horizon',
    now()
  )
  on conflict (customer_id) do update set
    risk_score   = excluded.risk_score,
    risk_label   = excluded.risk_label,
    time_horizon = excluded.time_horizon,
    updated_at   = now();

  update scores set
    risk_score = v_score,
    risk_label = case
      when v_score >= 23 then 'Aggressive'
      when v_score >= 13 then 'Moderate'
      else 'Conservative'
    end
  where customer_id = new.customer_id;

  return new;
end;
$$;

create trigger form_submission_profile_sync
  after update of status on form_submissions
  for each row when (new.status = 'complete')
  execute function sync_form_to_profile();

-- ─────────────────────────────────────────────────────────
-- AGENCY LAST_REFERRAL sync
-- ─────────────────────────────────────────────────────────
create or replace function update_agency_last_referral()
returns trigger language plpgsql as $$
begin
  update agencies set
    last_referral = current_date,
    updated_at    = now()
  where agency_id = new.agency_id;
  return new;
end;
$$;

create trigger agency_referral_inserted
  after insert on agency_referrals
  for each row execute function update_agency_last_referral();

-- ─────────────────────────────────────────────────────────
-- pg_cron — nightly at 2AM CT (8AM UTC)
-- ─────────────────────────────────────────────────────────
select cron.schedule(
  'fsos-nightly-scoring',
  '0 8 * * *',
  'select run_nightly_scoring();'
);

-- ─────────────────────────────────────────────────────────
-- ROW LEVEL SECURITY
-- ─────────────────────────────────────────────────────────
alter table agencies               enable row level security;
alter table customers              enable row level security;
alter table policies               enable row level security;
alter table scores                 enable row level security;
alter table consent_ledger         enable row level security;
alter table customer_profiles      enable row level security;
alter table activity               enable row level security;
alter table form_submissions       enable row level security;
alter table form_sends             enable row level security;
alter table commission_rates       enable row level security;
alter table commission_cases       enable row level security;
alter table workshops              enable row level security;
alter table workshop_registrations enable row level security;
alter table opra_cases             enable row level security;
alter table agency_referrals       enable row level security;
alter table agency_uploads         enable row level security;
alter table daily_briefings        enable row level security;

create policy "service_role_all" on agencies               for all using (auth.role() = 'service_role');
create policy "service_role_all" on customers              for all using (auth.role() = 'service_role');
create policy "service_role_all" on policies               for all using (auth.role() = 'service_role');
create policy "service_role_all" on scores                 for all using (auth.role() = 'service_role');
create policy "service_role_all" on consent_ledger         for all using (auth.role() = 'service_role');
create policy "service_role_all" on customer_profiles      for all using (auth.role() = 'service_role');
create policy "service_role_all" on activity               for all using (auth.role() = 'service_role');
create policy "service_role_all" on form_submissions       for all using (auth.role() = 'service_role');
create policy "service_role_all" on form_sends             for all using (auth.role() = 'service_role');
create policy "service_role_all" on commission_rates       for all using (auth.role() = 'service_role');
create policy "service_role_all" on commission_cases       for all using (auth.role() = 'service_role');
create policy "service_role_all" on workshops              for all using (auth.role() = 'service_role');
create policy "service_role_all" on workshop_registrations for all using (auth.role() = 'service_role');
create policy "service_role_all" on opra_cases             for all using (auth.role() = 'service_role');
create policy "service_role_all" on agency_referrals       for all using (auth.role() = 'service_role');
create policy "service_role_all" on agency_uploads         for all using (auth.role() = 'service_role');
create policy "service_role_all" on daily_briefings        for all using (auth.role() = 'service_role');

-- Public read for client form portal (token-filtered in API route)
create policy "public_form_token_read" on form_submissions
  for select using (true);

-- ─────────────────────────────────────────────────────────
-- SEED DATA — 4 agency owners
-- ─────────────────────────────────────────────────────────
insert into agencies (agency_id, name, owner, city, phone, email, slug, agency_zoom, apex) values
  ('ag1', 'Johnson Agency',       'Steven Johnson',  'Corpus Christi, TX', '(361) 555-0142', 'steven@farmersagent.com', 'steven-johnson', true,  true),
  ('ag2', 'Brown Agency',         'Sarah Brown',     'McKinney, TX',       '(972) 555-0288', 'sarah@farmersagent.com',  'sarah-brown',    true,  false),
  ('ag3', 'Vega Insurance Group', 'Carlos Vega Sr.', 'San Antonio, TX',    '(210) 555-0371', 'carlos@farmersagent.com', 'carlos-vega-sr', false, true),
  ('ag4', 'Taylor Agency',        'Jack Taylor',     'Plano, TX',          '(469) 555-0199', 'jack@farmersagent.com',   'jack-taylor',    true,  true)
on conflict do nothing;
