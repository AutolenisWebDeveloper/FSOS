-- 091_appointments_overlap_exclusion.sql
-- D3 hardening: prevent OVERLAPPING scheduled appointments for the same host at the DATABASE
-- level — not just exact-start collisions.
--
-- The existing uq_appointments_host_slot (mig 069) only blocks two scheduled rows that share an
-- identical (host_user_id, starts_at). Two appointments with DIFFERENT starts whose
-- [starts_at, ends_at) ranges overlap slip past it, so overlap prevention currently rests entirely
-- on the app-layer buffer math (lib/booking/availability.ts). This adds a GiST EXCLUDE constraint
-- so the database itself rejects any host time-range overlap, as a defense-in-depth backstop.
--
-- Additive + forward-only. COMPLEMENTS (does not replace) uq_appointments_host_slot: that unique
-- index still guards exact-start collisions on legacy rows where ends_at is null, which this
-- partial exclusion intentionally skips.
--
-- PRE-APPLY CHECK — run this first; it MUST return 0 rows. If it returns any, resolve those
-- overlapping scheduled appointments before applying, or ADD CONSTRAINT will fail:
--
--   select a.id as a_id, b.id as b_id, a.host_user_id
--   from appointments a
--   join appointments b
--     on a.host_user_id = b.host_user_id
--    and a.id < b.id
--   where a.status = 'scheduled' and b.status = 'scheduled'
--     and a.ends_at is not null and b.ends_at is not null
--     and tstzrange(a.starts_at, a.ends_at, '[)') && tstzrange(b.starts_at, b.ends_at, '[)');
--
-- LOCK / PERF: ADD CONSTRAINT EXCLUDE takes an ACCESS EXCLUSIVE lock and validates existing rows
-- with one table scan. The appointments table is small (single-FSA practice), so this is fast; on
-- a large table, run it in a maintenance window.
--
-- ROLLBACK: alter table appointments drop constraint excl_appointments_host_overlap;
--           (btree_gist can be left installed; it is harmless.)

-- btree_gist provides the `=` operator class GiST needs for the scalar host_user_id (uuid).
create extension if not exists btree_gist;

alter table appointments
  add constraint excl_appointments_host_overlap
  exclude using gist (
    host_user_id with =,
    tstzrange(starts_at, ends_at, '[)') with &&
  )
  where (
    status = 'scheduled'
    and host_user_id is not null
    and starts_at is not null
    and ends_at is not null
  );

comment on constraint excl_appointments_host_overlap on appointments is
  'D3: no two scheduled appointments for the same host may have overlapping [starts_at, ends_at) '
  'ranges. Defense-in-depth over the app-layer buffer math; complements uq_appointments_host_slot '
  '(which still guards exact-start collisions on rows with a null ends_at).';
