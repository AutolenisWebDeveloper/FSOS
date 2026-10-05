-- 140_automation_switches.sql
-- Off / canary / on switches for automation consumers that were CONNECTED by the automation audit
-- but must not be ENABLED without the owner (docs/ops/automation-audit-brief.md, "Connected is not
-- enabled"). Read by src/lib/ops/automation-switch.ts, which fails CLOSED: a missing row, an
-- unknown mode or a read error is 'off'.
--
--   off    — the consumer does nothing (the seeded state; identical to no row at all).
--   canary — the consumer acts only for VERIFIED operator test destinations
--            (comms_test_recipients.verified_at is not null, mig 087).
--   on     — the consumer acts for everyone.
--
-- Seeded: callback_engine_state = 'off' (a carrier opt-out also closes the member's live campaign
-- cadences; audit B-10 / D-12). Turning any switch to canary/on is an owner decision.
--
-- RLS: this is a single global configuration table with no agency dimension, so it follows the
-- repo's config-table pattern (comm_hours_policy, mig 035): staff roles may READ; there is no
-- write policy, so writes are service-role only (getDb() behind requireApiRole).
--
-- ROLLBACK:
--   drop table if exists automation_switches;

create table if not exists automation_switches (
  key         text primary key,
  mode        text not null default 'off' check (mode in ('off', 'canary', 'on')),
  note        text,
  updated_by  uuid,
  updated_at  timestamptz not null default now()
);

comment on table automation_switches is
  'Off/canary/on gates for connected-but-not-enabled automation consumers. Missing row = off. Canary = verified comms_test_recipients only.';

insert into automation_switches (key, mode, note)
values ('callback_engine_state', 'off',
        'Carrier opt-out (Twilio 21610) also closes live campaign cadences for every member at the number. Owner enables.')
on conflict (key) do nothing;

alter table automation_switches enable row level security;
drop policy if exists automation_switches_read on automation_switches;
create policy automation_switches_read on automation_switches for select using (
  is_super() or has_role('compliance') or has_role('supervisor')
  or has_role('fsa') or has_role('licensed_staff') or has_role('admin')
);
