-- 111_remove_duplicate_xsell_life_v2.sql
-- Remove the DUPLICATE Cross-Sell Life campaign definition (audit remediation).
--
-- Background: xsell_life_campaigns holds two rows sharing one family_key
-- (f5c00000-0000-4000-8000-0000000000f0):
--   • version 1  id f5c00000-0000-4000-8000-000000000001  — AUTHORITATIVE. Carries the
--     real runtime footprint (49 enrollments, 98 executions). This is the live campaign.
--   • version 2  id 96ac32e5-92e5-4655-9067-01ae35a1f853  — DUPLICATE. Created 2026-08-02,
--     archived 2026-08-03, 0 enrollments, 0 executions, never sent a single message, but
--     carries its own 35 duplicate touch rows. It is a stray duplicate definition, not
--     version history that any record depends on.
--
-- Safety, verified before writing this migration:
--   • Only two tables FK to xsell_life_campaigns — xsell_life_campaign_enrollments and
--     xsell_life_campaign_touches — both ON DELETE CASCADE. v2 has 0 enrollments, so the
--     cascade only removes v2's 35 orphan touch rows.
--   • v2's touches reference the SAME comm_templates as v1 (0 v2-exclusive templates); no
--     approved template/content is deleted or orphaned by removing v2. comm_templates are
--     NOT touched.
--   • The enrollment sweep (jobs.ts) and the tick (tick.ts) both select WHERE status='active';
--     an archived row is never scheduled, enrolled, or ticked, so nothing can restart it.
--   • v2 sent no messages, so there is no comm_messages / audit-of-send history tied to it to
--     preserve.
--
-- Idempotent + guarded: the DELETE is scoped to the exact duplicate id AND requires it to be
-- archived AND to have zero enrollments, so re-running (or running against a DB where it is
-- already gone) is a no-op and it can never touch the authoritative v1.

do $$
declare
  v_dup uuid := '96ac32e5-92e5-4655-9067-01ae35a1f853';
  v_touches int;
  v_enrollments int;
begin
  -- Guard: refuse if the target somehow has enrollments (it must not) — never delete live data.
  select count(*) into v_enrollments from xsell_life_campaign_enrollments where campaign_id = v_dup;
  if v_enrollments > 0 then
    raise exception 'Refusing to remove xsell_life_campaigns % — it has % enrollment(s); not a dead duplicate.', v_dup, v_enrollments;
  end if;

  select count(*) into v_touches from xsell_life_campaign_touches where campaign_id = v_dup;

  -- Record the removal in the append-only audit log BEFORE the delete (provenance).
  if exists (select 1 from xsell_life_campaigns where id = v_dup and status = 'archived') then
    insert into audit_log (actor, action, entity, entity_id, diff)
    values (
      'system:migration',
      'entity.deleted',
      'xsell_life_campaign',
      v_dup,
      jsonb_build_object(
        'reason', 'remove_duplicate_cross_sell_life_v2',
        'family_key', 'f5c00000-0000-4000-8000-0000000000f0',
        'version', 2,
        'status', 'archived',
        'cascaded_touches', v_touches,
        'authoritative_kept', 'f5c00000-0000-4000-8000-000000000001'
      )
    );

    -- Delete the duplicate; ON DELETE CASCADE removes its orphan touch rows only.
    delete from xsell_life_campaigns where id = v_dup and status = 'archived';
    raise notice 'Removed duplicate Cross-Sell Life v2 (% touches cascaded).', v_touches;
  else
    raise notice 'Duplicate Cross-Sell Life v2 already absent — no-op.';
  end if;
end $$;
