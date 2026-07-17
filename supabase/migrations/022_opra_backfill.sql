-- ═══════════════════════════════════════════════════════════════════
-- FSOS — OPRA data backfill (legacy opra_cases → opra_transfers)
-- Migration: 022_opra_backfill
--
-- Moves existing legacy OPRA data onto the App B spine created in 021. For every
-- legacy `opra_cases` row we ensure a household exists for its `customers` row
-- (provenance-keyed on households.legacy_customer_id so a later full customer
-- migration upserts the SAME household instead of duplicating), then insert an
-- `opra_transfers` row keyed on legacy_opra_id.
--
-- Idempotent + guarded: re-running inserts nothing new (ON CONFLICT DO NOTHING),
-- and the whole block is skipped when the legacy tables are absent (fresh App-B
-- deployments). Agency linkage (legacy text agency_id → B agency_partnerships
-- uuid) has no reliable cross-schema key, so referring_agency_id is left NULL
-- here and can be reconciled by a later agency-mapping migration.
-- ═══════════════════════════════════════════════════════════════════

-- Provenance column for idempotent household mapping from the legacy customer id.
alter table households add column if not exists legacy_customer_id uuid;
create unique index if not exists uq_households_legacy_customer
  on households(legacy_customer_id) where legacy_customer_id is not null;

do $$
begin
  -- Only run where the legacy tables actually exist (App A schema present).
  if to_regclass('public.opra_cases') is null
     or to_regclass('public.customers') is null then
    raise notice '022_opra_backfill: legacy opra_cases/customers absent — skipping.';
    return;
  end if;

  -- 1. Ensure a household exists for each customer referenced by an OPRA case.
  insert into households (legacy_customer_id, primary_name, address, city, state, zip)
  select distinct on (c.customer_id)
    c.customer_id,
    nullif(trim(coalesce(c.first_name,'') || ' ' || coalesce(c.last_name,'')), ''),
    c.address, c.city, coalesce(c.state,'TX'), c.zip
  from opra_cases oc
  join customers c on c.customer_id = oc.customer_id
  where nullif(trim(coalesce(c.first_name,'') || ' ' || coalesce(c.last_name,'')), '') is not null
  on conflict (legacy_customer_id) where legacy_customer_id is not null do nothing;

  -- 2. Insert one opra_transfers row per household (the unique live-per-household
  --    index allows only one). If a customer had multiple legacy cases, keep the
  --    most recent. Idempotent across re-runs via the legacy_opra_id conflict.
  insert into opra_transfers (
    household_id, transfer_date, annual_premium,
    contacted, contacted_at, appt_scheduled, appt_date,
    review_complete, review_date, transferred, transferred_date,
    status, notes, legacy_opra_id, created_at
  )
  select distinct on (h.id)
    h.id,
    oc.transfer_date,
    oc.annual_premium,
    coalesce(oc.contacted, false), oc.contacted_at,
    coalesce(oc.appt_scheduled, false), oc.appt_date,
    coalesce(oc.review_complete, false), oc.review_date,
    coalesce(oc.transferred, false), oc.transferred_date,
    case when oc.status in ('identified','contacted','scheduled','reviewed','transferred','declined')
         then oc.status else 'identified' end,
    oc.notes,
    oc.opra_id,
    coalesce(oc.created_at, now())
  from opra_cases oc
  join households h on h.legacy_customer_id = oc.customer_id
  order by h.id, oc.created_at desc nulls last
  on conflict (legacy_opra_id) do nothing;

  raise notice '022_opra_backfill: backfill complete.';
end $$;
