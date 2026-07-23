-- scripts/ghl-migration/rollback-optouts.sql
-- Rollback for the D0 GHL opt-out import (import-optouts.ts --commit).
--
-- The importer wrote ONLY new, marker-tagged rows:
--   • dnc_entries with reason = 'ghl_migration'
--   • consents    with source = 'ghl_migration'
-- using on-conflict-do-nothing (insert-only-when-absent), so it never modified a
-- pre-existing consent or suppression row. This delete therefore restores the
-- exact pre-import state — it removes only what the migration added and leaves
-- every native STOP/consent row untouched.
--
-- Verify (should both return the pre-import baseline afterward):
--   select count(*) from consents    where source = 'ghl_migration';   -- expect 0
--   select count(*) from dnc_entries where reason = 'ghl_migration';   -- expect 0
--
-- Audit rows (audit_log) are append-only by design and are intentionally NOT
-- removed — they remain as the tamper-evident record that the migration ran.

begin;

delete from consents    where source = 'ghl_migration';
delete from dnc_entries where reason = 'ghl_migration';

commit;
