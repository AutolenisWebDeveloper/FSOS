-- 138_dnc_lift_marker.sql
-- Let a bare START restore a keyword opt-out WITHOUT deleting the DNC row.
--
-- WHY: owner decision 4 (docs/ops/automation-inventory.md §10) — never delete DNC or consent rows
-- of any kind; a re-opt-in is recorded as a new event. dnc_entries is unique(contact, channel), so
-- the only prior way to restore was DELETE. Instead a START now marks the row lifted:
--   • lifted_at / lifted_reason — set by inbound START (src/lib/comms/inbound.ts applyOptIn) only
--     when the row is a KEYWORD opt-out (inbound STOP or carrier 21610). Bounce, complaint,
--     unsubscribe and operator rows are never lifted.
--   • A later STOP re-arms the same row by refreshing created_at (src/lib/comms/opt-out.ts), and
--     the gate treats a row as active unless lifted_at > created_at
--     (src/lib/comms/contact-consent.ts isDncLifted).
--
-- DEPLOY ORDER: apply this migration BEFORE (or with) the code. The gate reads `select('*')`, so
-- the code is safe without the column (no row ever reads as lifted — the restrictive default);
-- only START restores are refused until it lands.
--
-- Additive, nullable, no backfill, no RLS change (dnc_entries keeps its existing policies).
--
-- ROLLBACK:
--   alter table dnc_entries drop column if exists lifted_reason;
--   alter table dnc_entries drop column if exists lifted_at;

alter table dnc_entries
  add column if not exists lifted_at timestamptz,
  add column if not exists lifted_reason text;

comment on column dnc_entries.lifted_at is
  'Set when a bare START restored a KEYWORD opt-out (owner decision 4). The row is active again '
  'whenever created_at > lifted_at (a later STOP refreshes created_at). Rows are never deleted.';
comment on column dnc_entries.lifted_reason is
  'Audit text for the START that lifted this keyword opt-out (conversation id).';
