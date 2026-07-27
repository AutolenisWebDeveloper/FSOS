-- ─────────────────────────────────────────────────────────
-- Migration: 073_calendly_decommission_reconcile
--
-- Native FSOS booking — Slice 8 (Calendly decommission). Before the Calendly webhook and
-- its Model-B activity feed are removed, reconcile any OPEN Calendly bookings onto the
-- aggregate-root spine so no client's upcoming appointment is lost when Calendly is retired.
--
-- BACKGROUND (docs/booking/current-state.md): the Calendly webhook only ever wrote a legacy
-- `activity` LOG row (type='appointment', channel='calendly') keyed on `customers`; it never
-- created a structured spine `appointments` row, so a Calendly booking was invisible to the
-- FSA calendar, client portal, revenue funnel, and comms claim-resolver. This migration
-- lifts the still-open ones onto the spine.
--
-- WHAT COUNTS AS "OPEN": a Calendly appointment activity whose start time (parsed from the
-- note `Via Calendly · <start> · <tz>`) is in the FUTURE at apply time and has NO later
-- cancellation note for the same customer. Each is inserted as a native `appointments` row
-- (booked_via='legacy_calendly', status='scheduled'), linked to the spine household via the
-- established provenance bridge (`households.legacy_customer_id = customers.customer_id`);
-- an unmapped customer still migrates (null household) so the appointment is never dropped.
-- `scheduled_at` is kept in lock-step with `starts_at` for backward-compat (mig 069 invariant).
--
-- SAFETY: forward-only + IDEMPOTENT. Each source row is deduped by
-- `external_ref = 'calendly:<activity_id>'`, so re-running inserts nothing new. Free-text
-- start times that don't parse as ISO-8601 are skipped (§4.3 — never invent data). The whole
-- reconciliation is guarded on the legacy tables existing, is a clean no-op on empty data,
-- and records a durable count in the append-only audit_log. No securities data is touched
-- (§4.1). The frozen GHL webhook's appointment handling is NOT touched.
-- ─────────────────────────────────────────────────────────

do $$
declare
  v_migrated integer := 0;
begin
  -- Only run where the legacy source + spine targets exist (robust on partial schemas).
  if to_regclass('public.activity') is null
     or to_regclass('public.appointments') is null
     or to_regclass('public.households') is null then
    raise notice 'Calendly reconciliation skipped: required tables not present.';
    return;
  end if;

  with candidate as (
    select
      a.activity_id,
      a.customer_id,
      -- `Via Calendly · <start_time> · <timezone>` → parse the middle segment as the start.
      nullif(btrim(split_part(a.notes, ' · ', 2)), '') as start_raw,
      nullif(btrim(split_part(a.notes, ' · ', 3)), '') as tz_raw,
      a.created_at
    from activity a
    where a.type = 'appointment'
      and a.channel = 'calendly'
      and a.notes is not null
  ),
  parsed as (
    select
      c.activity_id,
      c.customer_id,
      c.tz_raw,
      c.created_at,
      -- Only rows whose start segment is an ISO-8601 instant we can trust.
      case when c.start_raw ~ '^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}'
           then c.start_raw::timestamptz end as starts_at
    from candidate c
  ),
  open_bookings as (
    select p.*
    from parsed p
    where p.starts_at is not null
      and p.starts_at > now()                                   -- still upcoming
      -- No later cancellation note for the same customer.
      and not exists (
        select 1 from activity x
        where x.customer_id = p.customer_id
          and x.type = 'note'
          and x.subject ilike 'Appointment canceled%'
          and x.created_at >= p.created_at
      )
      -- Idempotent: not already reconciled.
      and not exists (
        select 1 from appointments ap where ap.external_ref = 'calendly:' || p.activity_id::text
      )
  ),
  inserted as (
    insert into appointments
      (household_id, scheduled_at, starts_at, status, booked_via, external_ref, booker_timezone, created_at)
    select
      h.id,                                                     -- null when the customer isn't bridged yet
      o.starts_at,
      o.starts_at,
      'scheduled',
      'legacy_calendly',
      'calendly:' || o.activity_id::text,
      o.tz_raw,
      now()
    from open_bookings o
    left join households h on h.legacy_customer_id = o.customer_id
    returning 1
  )
  select count(*) into v_migrated from inserted;

  -- Durable reconciliation record (append-only audit trail, §13.9).
  if to_regclass('public.audit_log') is not null then
    insert into audit_log (actor, action, entity, entity_id, diff)
    values ('system', 'import.committed', 'appointments', null,
            jsonb_build_object('source', 'calendly', 'event', 'decommission_reconcile', 'migrated', v_migrated));
  end if;

  raise notice 'Calendly reconciliation: % open booking(s) migrated onto the spine.', v_migrated;
end $$;
