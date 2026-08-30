-- 134_opportunity_referral_dedupe.sql
-- One live opportunity per referral, enforced by the DATABASE rather than by either
-- caller's timing.
--
-- THE DEFECT. Batch 4 gave `opportunities` two independent writers that both do
-- check-then-insert on `referral_id` with nothing serializing them:
--   • src/app/api/referrals/[id]/convert/route.ts — select … maybeSingle() → enrich or insert
--   • src/lib/workshops/comms-engine.ts (routeSegmentToSpine) — the same select → insert
-- Neither holds a lock and no constraint existed, so the realistic trigger is not two
-- simultaneous conversions: it is the */15 workshop cron placing an attendance opportunity
-- at the moment the FSA converts that same referral in the UI. Both read "none yet", both
-- insert, and the pipeline double-counts — precisely what the D-2 enrich branch exists to
-- prevent. The `source='workshop_attendance'` marker then lands on one of two rows for the
-- same referral, skewing the district segmentation that marker was added to serve.
--
-- Same shape, and the same remedy, as WS-003/WS-004 in migration 128: collapse what is
-- already there, then let a partial unique index arbitrate.
--
-- ADDITIVE ONLY: no drop, no truncate, no hard delete. The collapse below marks later
-- duplicates with `deleted_at` — the soft-delete marker every read path already filters on
-- (`.is('deleted_at', null)`) — so it is auditable and reversible by clearing the column.

-- ── 1. Collapse existing duplicates BEFORE the index (keep the EARLIEST live
--       opportunity per referral; later ones are soft-deleted) ────────────────────
-- Earliest wins because that is the order the code assumes: the workshop engine PLACES
-- at attendance time and the convert route ENRICHES that row afterwards, so a later row
-- with the same referral_id is by construction the accidental second insert.
with ranked as (
  select id,
         row_number() over (
           partition by referral_id
           order by created_at asc nulls last, id
         ) as rn
  from opportunities
  where referral_id is not null
    and deleted_at is null
)
update opportunities o
set deleted_at = now(),
    updated_at = now()
from ranked
where ranked.id = o.id and ranked.rn > 1;

-- ── 2. The guard itself. Partial on both counts: a referral-less opportunity (manual
--       origination) is unconstrained, and a soft-deleted row never blocks a genuine
--       re-conversion after one is retired. ──────────────────────────────────────
create unique index if not exists idx_opportunities_live_referral
  on opportunities (referral_id)
  where referral_id is not null and deleted_at is null;

comment on index idx_opportunities_live_referral is
  'One LIVE opportunity per referral. Both writers (referrals convert route, workshop attendance placement) check-then-insert without a lock; this index is what actually decides the race, and both treat 23505 on it as success — the other writer won, and its row is the one to enrich.';
