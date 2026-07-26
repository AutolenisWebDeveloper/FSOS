-- ═══════════════════════════════════════════════════════════════════
-- FSOS — Contact Center: consolidation reporting surface
-- Migration: 070_contact_consolidation_report
--
-- Read-only reporting views that make the Contact Center's consolidation state
-- observable in-product (Slice 1): how many contacts exist, how many are ORPHANED
-- (household_id IS NULL — i.e. blocked from native campaign enrollment, which keys
-- on household_members), how many carry a reachable channel, contact-type coverage,
-- and a per-source breakdown. No new staging table is introduced — staging + audit
-- remain import_batches / import_records (migration 031); this only reports over the
-- canonical contacts book. Rationale: docs/adr/ADR-028-contact-consolidation-dedup.md.
--
-- Security: security_invoker views inherit the contacts_read RLS policy (026), so a
-- reader sees exactly the contacts it may already read; the service role (used by the
-- server report service) bypasses RLS as elsewhere. Idempotent; nothing dropped.
-- ═══════════════════════════════════════════════════════════════════

-- ── One-row book summary ─────────────────────────────────────────────────────
create or replace view v_contact_consolidation
with (security_invoker = true) as
select
  count(*)                                              as total,
  count(*) filter (where household_id is null)          as orphaned,
  count(*) filter (where household_id is not null)      as linked,
  count(*) filter (where email_lc is not null)          as with_email,
  count(*) filter (where phone_digits is not null)      as with_phone,
  count(*) filter (where email_lc is null
                     and phone_digits is null)          as unreachable,
  count(*) filter (where contact_type <> 'unknown')     as typed,
  count(*) filter (where contact_type = 'unknown')      as untyped,
  count(*) filter (where status = 'active')             as active,
  count(*) filter (where status = 'archived')           as archived
from contacts
where deleted_at is null;

-- ── Per-source breakdown (count + how many of each source are orphaned) ──────
create or replace view v_contact_by_source
with (security_invoker = true) as
select
  coalesce(nullif(btrim(source), ''), '(unspecified)')  as source,
  count(*)                                               as total,
  count(*) filter (where household_id is null)           as orphaned
from contacts
where deleted_at is null
group by 1;
