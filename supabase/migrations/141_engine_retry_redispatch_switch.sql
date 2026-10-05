-- 141_engine_retry_redispatch_switch.sql
-- Seed the engine_retry_redispatch automation switch OFF (mig 140 table; src/lib/ops/automation-switch.ts).
--
-- When ON, the four campaign retry sweeps release an orphaned message claim that never reached
-- dispatch (no message-of-record row) so the next tick re-claims the still-due touch and re-runs
-- stop conditions, eligibility and the gate (src/lib/ops/orphan-executions.ts; audit D-07 / E-10 /
-- H-11 / J-06). Off is identical to no row. `canary` does not apply to this consumer (the sweep has
-- no recipient to compare to the allow-list) and behaves as off. Turning it on is an owner decision.
--
-- Config row only; no schema change, no client data.
--
-- ROLLBACK:
--   delete from automation_switches where key = 'engine_retry_redispatch';

insert into automation_switches (key, mode, note)
values ('engine_retry_redispatch', 'off',
        'Campaign retry sweeps release never-dispatched orphaned claims for the tick to re-send. Owner enables.')
on conflict (key) do nothing;
