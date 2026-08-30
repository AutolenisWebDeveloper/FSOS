-- ─────────────────────────────────────────────────────────
-- 124 — tz_resolution_method gains 'both' (NPA/ZIP dual resolution)
--
-- WHY. When a recipient's phone NPA and ZIP each resolve to a timezone, the dispatch
-- chokepoint now resolves BOTH and reconciles (mig 123 recorded whichever single input
-- won). Agreement records one zone on the evidence of both inputs; disagreement records
-- BOTH zones and the quiet-hours decision must hold in each — the intersection of the two
-- zones' windows, never wider than either alone.
--
-- Record shapes this migration admits (comm_messages):
--   tz_resolution_method = 'both'
--   tz_resolution_input  = '<npa>+<zip3>'            e.g. '310+752'
--   resolved_timezone    = '<zone>'                  when the two inputs AGREE
--                          '<npaZone>+<zipZone>'     when they DISAGREE (decision held in both)
--
-- Additive, forward-only, idempotent; constraint re-created to widen the enum only.
-- Existing 'npa'/'zip'/null rows all satisfy the new constraint, so this validates
-- without a table rewrite.
-- ─────────────────────────────────────────────────────────

alter table comm_messages drop constraint if exists comm_messages_tz_resolution_method_check;
alter table comm_messages add constraint comm_messages_tz_resolution_method_check
  check (tz_resolution_method in ('npa', 'zip', 'both') or tz_resolution_method is null);

comment on column comm_messages.tz_resolution_method is
  'Evidence class the recipient zone was resolved from: ''npa'' (phone area code), ''zip'' (recipient ZIP), or ''both'' (phone AND ZIP each resolved — mig 124; on disagreement resolved_timezone records both zones joined ''+'' and the quiet-hours decision held in both). Null when the caller supplied the zone, the legacy default applied, or the row predates mig 123.';
