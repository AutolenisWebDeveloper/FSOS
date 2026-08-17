-- 119_appointments_nullhost_double_book_guard.sql
-- B-1: close the null-host double-booking gap.
--
-- The existing DB guards both scope `host_user_id IS NOT NULL`:
--   • uq_appointments_host_slot (mig 069) — partial UNIQUE (host_user_id, starts_at) WHERE
--     status='scheduled' AND host_user_id IS NOT NULL — exact-start collisions.
--   • excl_appointments_host_overlap (mig 091) — GiST EXCLUDE on (host_user_id =, range &&)
--     WHERE status='scheduled' AND host_user_id IS NOT NULL — range overlaps.
-- For a PRACTICE-WIDE appointment type (`appointment_types.host_user_id IS NULL` = "default
-- practice host", supported by slots.ts and mig 069:38), NEITHER guard applies — a NULL never
-- collides with another NULL in a unique index, and the GiST constraint's WHERE excludes null-host
-- rows. So two concurrent bookings of the same practice-wide slot both commit at the DB level, and
-- only the app-layer check-then-insert (book.ts) — which has a TOCTOU window — protects them.
--
-- This deployment is a SINGLE-FSA practice (mig 069/091 comments), so a NULL host means "the one
-- practice host": two scheduled practice-wide appointments must never overlap. These two additive,
-- forward-only guards enforce that at the database level, mirroring 069 + 091 for the null-host
-- bucket. (If this practice ever becomes multi-FSA with a shared "any available advisor" pool, the
-- overlap rule would need to key off assigned capacity instead — revisit then.)
--
-- Additive + forward-only. COMPLEMENTS the host-scoped guards; does not touch them.
--
-- PRE-APPLY CHECKS — both MUST return 0 rows, or ADD CONSTRAINT / CREATE UNIQUE INDEX will fail.
-- Resolve any existing null-host collisions first.
--
--   -- exact-start null-host collisions:
--   select starts_at, count(*) from appointments
--   where status = 'scheduled' and host_user_id is null
--   group by starts_at having count(*) > 1;
--
--   -- overlapping null-host ranges:
--   select a.id as a_id, b.id as b_id
--   from appointments a join appointments b on a.id < b.id
--   where a.status = 'scheduled' and b.status = 'scheduled'
--     and a.host_user_id is null and b.host_user_id is null
--     and a.ends_at is not null and b.ends_at is not null
--     and tstzrange(a.starts_at, a.ends_at, '[)') && tstzrange(b.starts_at, b.ends_at, '[)');
--
-- LOCK / PERF: ADD CONSTRAINT EXCLUDE takes an ACCESS EXCLUSIVE lock and validates existing rows
-- with one scan. The appointments table is small (single-FSA practice), so this is fast; on a large
-- table, run it in a maintenance window.
--
-- ROLLBACK:
--   alter table appointments drop constraint if exists excl_appointments_nullhost_overlap;
--   drop index if exists uq_appointments_nullhost_slot;

-- 1. Exact-start collisions for null-host scheduled appointments (covers legacy rows with a null
--    ends_at, which the range exclusion below intentionally skips — mirrors uq_appointments_host_slot).
create unique index if not exists uq_appointments_nullhost_slot
  on appointments (starts_at)
  where (status = 'scheduled' and host_user_id is null);

comment on index uq_appointments_nullhost_slot is
  'B-1: no two scheduled PRACTICE-WIDE (null-host) appointments may share an identical starts_at. '
  'The null-host analog of uq_appointments_host_slot (mig 069), which excludes null hosts.';

-- 2. Overlapping ranges for null-host scheduled appointments. No scalar `=` operand (all null-host
--    rows are the single practice bucket), so this needs only the range && operator — btree_gist is
--    not required here (it is already installed by mig 091 and harmless).
alter table appointments
  add constraint excl_appointments_nullhost_overlap
  exclude using gist (
    tstzrange(starts_at, ends_at, '[)') with &&
  )
  where (
    status = 'scheduled'
    and host_user_id is null
    and starts_at is not null
    and ends_at is not null
  );

comment on constraint excl_appointments_nullhost_overlap on appointments is
  'B-1: no two scheduled PRACTICE-WIDE (null-host) appointments may have overlapping '
  '[starts_at, ends_at) ranges. The null-host analog of excl_appointments_host_overlap (mig 091), '
  'which excludes null hosts. Single-FSA practice: a null host is the one practice host.';
