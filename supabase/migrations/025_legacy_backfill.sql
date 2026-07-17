-- ═══════════════════════════════════════════════════════════════════
-- FSOS — Legacy→App B data migration: backfill (Milestone 4, part 2)
-- Migration: 025_legacy_backfill
--
-- Moves the legacy Command Center data onto the App B aggregate-root spine,
-- extending the provenance-keyed pattern proven by the OPRA backfill (022):
--   agencies          → agency_partnerships (+ agency_owners)
--   customers         → households (+ household_members, + consents)
--   policies          → household_policies
--   agency_referrals  → referrals
--   commission_cases  → commissions
--
-- Every step is idempotent (provenance key + ON CONFLICT DO NOTHING) and the
-- whole block is guarded — a no-op when the legacy tables are absent (fresh App
-- B deployments). Ordered by FK dependency so parents exist before children.
--
-- DOB IS DELIBERATELY NOT MIGRATED HERE. household_members.dob_enc is pgcrypto-
-- encrypted with a key the app supplies at call time (env DOB_ENCRYPTION_KEY),
-- which a SQL migration does not have. Encrypting under a wrong key would make
-- DOB permanently undecryptable, so dob_enc is left NULL; a keyed app-side script
-- can backfill DOB later. No plaintext DOB is ever written.
--
-- Cross-schema mappings with no reliable key (legacy text carrier/product →
-- App B carrier_id/product_id uuids) are left NULL and can be reconciled later.
-- ═══════════════════════════════════════════════════════════════════

do $$
begin
  if to_regclass('public.customers') is null or to_regclass('public.agencies') is null then
    raise notice '025_legacy_backfill: legacy tables absent — skipping.';
    return;
  end if;

  -- 1. agencies → agency_partnerships (parent of households/referrals/commissions)
  insert into agency_partnerships (legacy_agency_id, agency_name, owner_name, status)
  select a.agency_id, a.name, coalesce(nullif(trim(a.owner), ''), a.name), 'prospective'
  from agencies a
  on conflict (legacy_agency_id) where legacy_agency_id is not null do nothing;

  -- 1b. agency_owners (contact detail) — one per partnership, guarded (no prov key)
  insert into agency_owners (agency_id, full_name, email, phone)
  select ap.id, coalesce(nullif(trim(a.owner), ''), a.name), a.email, a.phone
  from agencies a
  join agency_partnerships ap on ap.legacy_agency_id = a.agency_id
  where not exists (select 1 from agency_owners ao where ao.agency_id = ap.id);

  -- 2. customers → households (extends the OPRA backfill to the whole book)
  insert into households (legacy_customer_id, referring_agency_id, primary_name, address, city, state, zip)
  select
    c.customer_id,
    ap.id,
    nullif(trim(coalesce(c.first_name,'') || ' ' || coalesce(c.last_name,'')), ''),
    c.address, c.city, coalesce(c.state,'TX'), c.zip
  from customers c
  left join agency_partnerships ap on ap.legacy_agency_id = c.agency_id
  where nullif(trim(coalesce(c.first_name,'') || ' ' || coalesce(c.last_name,'')), '') is not null
  on conflict (legacy_customer_id) where legacy_customer_id is not null do nothing;

  -- 2b. customers → household_members (the person; DOB intentionally NULL)
  insert into household_members (household_id, legacy_customer_id, full_name, relationship, email, phone)
  select
    h.id,
    c.customer_id,
    trim(coalesce(c.first_name,'') || ' ' || coalesce(c.last_name,'')),
    'primary',
    c.email,
    coalesce(c.phone, c.cell_phone)
  from customers c
  join households h on h.legacy_customer_id = c.customer_id
  on conflict (legacy_customer_id) where legacy_customer_id is not null do nothing;

  -- 2c. consent flags → consents (member+channel), granted only where legacy said so
  insert into consents (member_id, household_id, channel, status, source, captured_at)
  select m.id, m.household_id, v.channel, 'granted', 'legacy_import', coalesce(c.consent_date, now())
  from customers c
  join household_members m on m.legacy_customer_id = c.customer_id
  cross join lateral (values ('sms', c.consent_sms), ('email', c.consent_email)) as v(channel, granted)
  where v.granted is true
  on conflict (member_id, channel) do nothing;

  -- 3. policies → household_policies
  insert into household_policies (
    household_id, legacy_policy_id, policy_number, status, is_with_us,
    premium, effective_date, expiration_date, conversion_deadline
  )
  select
    h.id,
    p.policy_id,
    p.policy_number,
    case p.status
      when 'active' then 'active'
      when 'lapsed' then 'lapsed'
      when 'cancelled' then 'cancelled'
      when 'converted' then 'renewed'
      else 'active'
    end,
    true,
    p.annual_premium,
    p.issue_date,
    p.expiry_date,
    p.conversion_deadline
  from policies p
  join households h on h.legacy_customer_id = p.customer_id
  on conflict (legacy_policy_id) where legacy_policy_id is not null do nothing;

  -- 4. agency_referrals → referrals
  insert into referrals (
    legacy_referral_id, referring_agency_id, household_id, referred_name,
    engagement, status, received_at
  )
  select
    r.referral_id,
    ap.id,
    h.id,
    coalesce(nullif(trim(r.client_name), ''), 'Referred contact'),
    'warm_handoff',
    case r.status
      when 'new' then 'received'
      when 'contacted' then 'working'
      when 'appointed' then 'working'
      when 'applied' then 'working'
      when 'issued' then 'converted'
      when 'declined' then 'declined'
      else 'received'
    end,
    coalesce(r.submitted_at, r.created_at, now())
  from agency_referrals r
  join agency_partnerships ap on ap.legacy_agency_id = r.agency_id
  left join households h on h.legacy_customer_id = r.customer_id
  on conflict (legacy_referral_id) where legacy_referral_id is not null do nothing;

  -- 5. commission_cases → commissions
  insert into commissions (
    legacy_case_id, referring_agency_id, product_family, total_commission,
    fsa_split_pct, is_trail, paid_on, reconciliation_status
  )
  select
    cc.case_id,
    ap.id,
    case cc.pipeline
      when 'life' then 'life'
      when 'retirement' then 'annuity'
      else null
    end,
    coalesce(cc.actual_gdc, cc.estimated_gdc, 0),
    round(coalesce(cc.estimated_fsa, 0) / nullif(coalesce(cc.actual_gdc, cc.estimated_gdc), 0) * 100, 2),
    coalesce(cc.annual_trail, 0) > 0,
    cc.paid_date,
    case cc.case_status
      when 'paid' then 'received'
      when 'flagged' then 'discrepancy'
      else 'expected'
    end
  from commission_cases cc
  left join agency_partnerships ap on ap.legacy_agency_id = cc.agency_id
  on conflict (legacy_case_id) where legacy_case_id is not null do nothing;

  raise notice '025_legacy_backfill: backfill complete.';
end $$;
