-- 018_forms_workshops.sql
-- Legacy-port Client Forms (docs/legacy-port.md 2.3) and Workshops (2.5).
--
-- Client Forms are ported onto NEW FSOS-native tables that link to the aggregate
-- spine (households), NOT the legacy customer_id-based form_submissions/form_sends
-- from migration 001 (those stay in place for retention, never dropped).
--
--   form_templates  - a reusable form definition (public slug + field schema)
--   form_responses  - one submitted/sent response, attachable to a household
--
-- Workshops reuse the legacy workshops/workshop_registrations tables (001) but are
-- EXTENDED here to link registrations to the referral spine (fsos referrals) and
-- to carry a lifecycle status + captured-consent pointer. Legacy columns stay.
--
-- GUARDRAILS:
--  - Guardrail 1 (securities firewall): no securities data is collected on any
--    public form; there is no column for it here. Enforced in the API routes.
--  - Guardrail 7 (comms compliance): consent is captured at public submission
--    (consent_* flags on the response) so an imported/never-consented contact
--    cannot be messaged. Materialized into `consents` when attached to a member.
--  - Guardrail 4 (audit): every mutation is audited in the API route.
--
-- RLS: default-deny. Internal staff read via role policies; writes run through the
-- service role after an rbac assertion in the route (getDb bypasses RLS). Public
-- submission also runs through the service role in a public API route.
--
-- NOTE: comments are on their own lines and contain no semicolons, so every
-- terminator in this file is a real one (safe for naive SQL splitters).

-- ---------------------------------------------------------------------------
-- 1. form_templates - a reusable client intake form definition.
--    slug is the stable public key used in /forms/[formId].
--    fields is an ordered array of field defs:
--      { key, label, type, required, options?, help? }
-- ---------------------------------------------------------------------------
create table if not exists form_templates (
  id               uuid primary key default gen_random_uuid(),
  slug             text not null unique,
  name             text not null,
  description      text,
  fields           jsonb not null default '[]'::jsonb,
  captures_consent boolean not null default true,
  active           boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists idx_form_templates_active on form_templates(active);

-- ---------------------------------------------------------------------------
-- 2. form_responses - a sent or submitted response to a template.
--    household_id is null until the response is attached to a household.
--    token is a per-send opaque link key (null for anonymous public forms).
--    consent_channels records which channels the submitter consented to at
--    submission time (materialized into `consents` on attach).
-- ---------------------------------------------------------------------------
create table if not exists form_responses (
  id                uuid primary key default gen_random_uuid(),
  template_id       uuid not null references form_templates(id) on delete cascade,
  household_id      uuid references households(id) on delete set null,
  token             text unique,
  status            text not null default 'pending'
                      check (status in ('pending','submitted','attached','archived')),
  data              jsonb,
  submitter_name    text,
  submitter_email   text,
  submitter_phone   text,
  consent_channels  text[] not null default '{}',
  ip_address        text,
  submitted_at      timestamptz,
  attached_at       timestamptz,
  deleted_at        timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists idx_form_responses_template on form_responses(template_id);
create index if not exists idx_form_responses_household on form_responses(household_id);
create index if not exists idx_form_responses_status on form_responses(status) where deleted_at is null;

-- ---------------------------------------------------------------------------
-- 3. Workshops - EXTEND the legacy tables (001) onto the FSOS spine.
--    Legacy columns (customer_id etc.) are retained. New columns are additive.
-- ---------------------------------------------------------------------------
alter table workshops add column if not exists description text;
alter table workshops add column if not exists status text not null default 'draft';
alter table workshops add column if not exists updated_at timestamptz not null default now();

-- Registrations link to the referral spine (attendee -> referral conversion) and
-- capture consent + a lifecycle status. household_id is set when converted.
alter table workshop_registrations add column if not exists referral_id uuid references referrals(id) on delete set null;
alter table workshop_registrations add column if not exists household_id uuid references households(id) on delete set null;
alter table workshop_registrations add column if not exists name text;
alter table workshop_registrations add column if not exists email text;
alter table workshop_registrations add column if not exists phone text;
alter table workshop_registrations add column if not exists consent_channels text[] not null default '{}';
alter table workshop_registrations add column if not exists status text not null default 'registered';

create index if not exists idx_workshop_regs_referral on workshop_registrations(referral_id);
create index if not exists idx_workshops_status on workshops(status);

-- ---------------------------------------------------------------------------
-- 4. RLS - default-deny; internal staff read. Writes via service role in routes.
-- ---------------------------------------------------------------------------
alter table form_templates enable row level security;
alter table form_responses enable row level security;

-- form_templates: any internal staff role may read the catalog.
drop policy if exists form_templates_read on form_templates;
create policy form_templates_read on form_templates for select using (
  is_super() or has_role('compliance') or has_role('supervisor')
  or has_role('fsa') or has_role('licensed_staff')
  or has_role('admin') or has_role('ops') or has_role('case_manager')
);

-- form_responses: fsa/licensed_staff/admin/ops read (client intake handling).
-- Never clients or agency owners.
drop policy if exists form_responses_read on form_responses;
create policy form_responses_read on form_responses for select using (
  is_super() or has_role('fsa') or has_role('licensed_staff')
  or has_role('admin') or has_role('ops') or has_role('case_manager')
);

-- Legacy workshops/workshop_registrations already have a service_role policy from
-- 001. Add internal-staff read policies keyed to FSOS roles for the new app reads.
drop policy if exists workshops_staff_read on workshops;
create policy workshops_staff_read on workshops for select using (
  is_super() or has_role('fsa') or has_role('licensed_staff') or has_role('admin') or has_role('ops')
);

drop policy if exists workshop_regs_staff_read on workshop_registrations;
create policy workshop_regs_staff_read on workshop_registrations for select using (
  is_super() or has_role('fsa') or has_role('licensed_staff') or has_role('admin') or has_role('ops')
);

-- ---------------------------------------------------------------------------
-- 5. Seeds - two starter form templates (editable config, not Farmers data).
--    No securities fields (guardrail 1). captures_consent = true.
-- ---------------------------------------------------------------------------
insert into form_templates (slug, name, description, captures_consent, fields) values
  (
    'client-questionnaire',
    'Client Questionnaire',
    'Baseline household intake for a first financial review.',
    true,
    '[
      {"key":"full_name","label":"Full name","type":"text","required":true},
      {"key":"email","label":"Email","type":"email","required":true},
      {"key":"phone","label":"Phone","type":"tel","required":false},
      {"key":"household_size","label":"Household size","type":"number","required":false},
      {"key":"goals","label":"What are your top financial goals?","type":"textarea","required":false}
    ]'::jsonb
  ),
  (
    'financial-needs-analysis',
    'Financial Needs Analysis Intake',
    'Collects the household context used to prepare a Financial Needs Analysis. Educational only - no product application.',
    true,
    '[
      {"key":"full_name","label":"Full name","type":"text","required":true},
      {"key":"email","label":"Email","type":"email","required":true},
      {"key":"phone","label":"Phone","type":"tel","required":false},
      {"key":"annual_income","label":"Approximate annual household income","type":"number","required":false},
      {"key":"dependents","label":"Number of dependents","type":"number","required":false},
      {"key":"existing_coverage","label":"Existing life insurance coverage (face amount)","type":"number","required":false},
      {"key":"concerns","label":"Primary concerns or life events","type":"textarea","required":false}
    ]'::jsonb
  )
  on conflict (slug) do nothing;
