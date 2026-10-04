# Migration runbook — `fix/automation-e2e` (137 → 141)

For the owner to run by hand. **This document contains no PII.** Every query in it is either
read-only (`begin read only … commit`) or a step you choose to run. Nothing here was run against
production by Claude except the read-only checks whose results are quoted (2026-10-04).

Connect with a role that can write DDL. Use `psql "$DATABASE_URL"`, and never paste the URL into a
shared place.

## 0. What is going on with migrations in production

**What applies migrations to production?** Nothing in the repo does it automatically.

| Mechanism | What it does |
|---|---|
| `npm run migrate` (`scripts/migrate.mjs`) | Applies **every** `supabase/migrations/*.sql` file not recorded in `public.schema_migrations`, in filename order, then records each one. Runs only when someone runs it with `DATABASE_URL` set. |
| `.github/workflows/ci.yml` | Never applies to production. It proves the chain on an ephemeral Postgres. Its "drift check" is read-only and unarmed (no `DATABASE_URL` secret). |
| Supabase GitHub integration (outside the repo) | Posts the "Supabase Preview" check on PRs. Its `main` branch record reads `MIGRATIONS_FAILED`, last updated 2026-09-03 01:35 UTC. |

**What failed in the integration's run on `main`?** **NOT VERIFIED.** The failure log is not
readable from this session: Supabase log queries reach back 24 hours and the run is a month old,
and the Vercel/Supabase dashboards are not accessible. What can be read:

- The integration keeps its own ledger (`supabase_migrations.schema_migrations`), separate from
  the repo's `public.schema_migrations`. It holds **14 entries**, all timestamp-versioned
  (`20260607…` to `20260817…`).
- The repo's files are versioned `001_…` to `141_…`.

**Likely cause (ASSUMPTION, from how the Supabase CLI orders versions):** `001` to `141` all sort
*before* the integration's newest recorded version (`20260817184608`). The CLI refuses to insert
migrations before the last remote one unless told to include them all, so the run fails before
applying anything.

**Would merging trigger it again?** Probably yes. The integration acts on pushes to `main`.

- If the assumption above holds, it fails the same way and applies nothing.
- If instead it is configured to include all files, it would try to replay `001…` against a
  populated database. That is the dangerous case.

**Check before merging:** Supabase dashboard → Branches → `main` → the failed run's log, and
Project Settings → Integrations → GitHub → whether "deploy to production on merge" is on. If it
is on, turn it off (or point it elsewhere) before merging. This runbook assumes you apply the
migrations yourself.

### Do not run `npm run migrate` against production for this rollout

`public.schema_migrations` records 131 files but **not 128–134 and not 137**, although 128–134's
objects exist (checked below). `npm run migrate` would therefore:

- re-run 128–134;
- apply 137;
- apply **139 before the deploy**.

Use the per-file steps below instead.

## 1. Read-only: prove 128–134's objects match their files

Run, read, then run step 2 only if every row is `true`.

```sql
begin read only;
select m, ok from (values
 ('128 workshop_registrations.guest_count', exists(select 1 from information_schema.columns where table_name='workshop_registrations' and column_name='guest_count')),
 ('128 idx_wreg_active_email', exists(select 1 from pg_indexes where indexname='idx_wreg_active_email')),
 ('128 fn workshop_claim_registration', exists(select 1 from pg_proc where proname='workshop_claim_registration')),
 ('129 workshop_registrations.marketing_opt_in', exists(select 1 from information_schema.columns where table_name='workshop_registrations' and column_name='marketing_opt_in')),
 ('129 workshop_registrations.consent_form_version', exists(select 1 from information_schema.columns where table_name='workshop_registrations' and column_name='consent_form_version')),
 ('129 workshops.senior_disclosure_config_id', exists(select 1 from information_schema.columns where table_name='workshops' and column_name='senior_disclosure_config_id')),
 ('130 workshops_status_chk', exists(select 1 from pg_constraint where conname='workshops_status_chk')),
 ('130 wmt_kind_chk', exists(select 1 from pg_constraint where conname='wmt_kind_chk')),
 ('130 workshop_sessions.cadence_generation', exists(select 1 from information_schema.columns where table_name='workshop_sessions' and column_name='cadence_generation')),
 ('130 workshop_sessions.change_kind', exists(select 1 from information_schema.columns where table_name='workshop_sessions' and column_name='change_kind')),
 ('130 workshop_message_log.cadence_generation', exists(select 1 from information_schema.columns where table_name='workshop_message_log' and column_name='cadence_generation')),
 ('130 idx_wml_claim', exists(select 1 from pg_indexes where indexname='idx_wml_claim')),
 ('130 workshop_registrations.cancelled_at', exists(select 1 from information_schema.columns where table_name='workshop_registrations' and column_name='cancelled_at')),
 ('130 trg_workshop_publish_gate', exists(select 1 from pg_trigger where tgname='trg_workshop_publish_gate')),
 ('130 trg_workshop_terminality', exists(select 1 from pg_trigger where tgname='trg_workshop_terminality')),
 ('130 trg_workshop_cancel_cascade', exists(select 1 from pg_trigger where tgname='trg_workshop_cancel_cascade')),
 ('131 workshop_comms_config.nurture_followup_delay_minutes', exists(select 1 from information_schema.columns where table_name='workshop_comms_config' and column_name='nurture_followup_delay_minutes')),
 ('131 comm_templates eeee…ac01', exists(select 1 from comm_templates where id='eeee0000-0000-4000-8000-00000000ac01')),
 ('132 opportunities.source', exists(select 1 from information_schema.columns where table_name='opportunities' and column_name='source')),
 ('132 idx_opportunities_source', exists(select 1 from pg_indexes where indexname='idx_opportunities_source')),
 ('132 watt_capture_method_chk', exists(select 1 from pg_constraint where conname='watt_capture_method_chk')),
 ('132 wreg_marketing_capture_chk', exists(select 1 from pg_constraint where conname='wreg_marketing_capture_chk')),
 ('133 sender_physical_address not a placeholder', exists(select 1 from workshop_comms_config where sender_physical_address not like '[PLACEHOLDER%')),
 ('134 idx_opportunities_live_referral', exists(select 1 from pg_indexes where indexname='idx_opportunities_live_referral'))
) v(m, ok) order by m;
commit;
```

**Result on 2026-10-04 (run by Claude, read-only):** all 23 checks that existed then returned `true`. The
`130 workshop_sessions.cadence_generation` row was checked separately and also exists.

## 2. Record-only ledger backfill for 128–134

This changes **no schema**. It only records what is already there, so `schema_migrations` stops
lying.

```sql
begin;
insert into schema_migrations (filename) values
 ('128_workshop_registration_integrity.sql'),
 ('129_workshop_consent_model.sql'),
 ('130_workshop_lifecycle.sql'),
 ('131_workshop_cadence.sql'),
 ('132_workshop_hardening.sql'),
 ('133_workshop_sender_address.sql'),
 ('134_opportunity_referral_dedupe.sql')
on conflict (filename) do nothing;
commit;
```

**Verify:**

```sql
select count(*) from schema_migrations where left(filename,3) between '128' and '134';  -- expect 7
```

**Rollback:**

```sql
delete from schema_migrations where filename in ('128_workshop_registration_integrity.sql','129_workshop_consent_model.sql','130_workshop_lifecycle.sql','131_workshop_cadence.sql','132_workshop_hardening.sql','133_workshop_sender_address.sql','134_opportunity_referral_dedupe.sql');
```

## 3. Apply 137 (already on `main`, missing in production)

**What depends on it today.** The production code (`main`) reads the reminder offsets from
`booking_reminder_config` and the `appointment` frequency row. Without 137:

- the row still holds `{1440}`, so only the 24-hour reminder is sent, not 24h + 12h + 1h;
- the appointment caps stay at migration 136's 4 SMS / 8 touches a day.

**Nothing is failing because of it.** It is a missing feature, not an error. Production has 0
future appointments, so no reminder is due either way.

```sh
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 --single-transaction -f supabase/migrations/137_booking_reminder_cadence.sql
psql "$DATABASE_URL" -c "insert into schema_migrations (filename) values ('137_booking_reminder_cadence.sql') on conflict do nothing;"
```

**Verify:**

```sql
select offsets_minutes from booking_reminder_config where id='global';                 -- {1440,720,60} (unless operator-edited)
select max_sms_per_day, max_combined_touches_per_day from comm_frequency_policy where id='appointment';  -- 6, 12 (unless edited)
```

**Rollback** (from the file):

```sql
alter table booking_reminder_config alter column offsets_minutes set default '{1440}';
update booking_reminder_config set offsets_minutes = '{1440}' where id = 'global';
update comm_frequency_policy set max_sms_per_day = 4, max_combined_touches_per_day = 8 where id = 'appointment';
delete from schema_migrations where filename = '137_booking_reminder_cadence.sql';
```

## 4. Apply 138, 140, 141 (safe before the deploy; the running code ignores them)

```sh
for f in 138_dnc_lift_marker 140_automation_switches 141_engine_retry_redispatch_switch; do
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 --single-transaction -f "supabase/migrations/$f.sql" &&
  psql "$DATABASE_URL" -c "insert into schema_migrations (filename) values ('$f.sql') on conflict do nothing;"
done
```

**Verify:**

```sql
select column_name from information_schema.columns where table_name='dnc_entries' and column_name in ('lifted_at','lifted_reason');  -- 2 rows
select key, mode from automation_switches order by key;  -- callback_engine_state off, engine_retry_redispatch off
select relrowsecurity from pg_class where relname='automation_switches';  -- true
```

**Rollback, in this order** (141 before 140):

```sql
delete from automation_switches where key = 'engine_retry_redispatch';             -- 141
drop table if exists automation_switches;                                          -- 140
alter table dnc_entries drop column if exists lifted_reason;                       -- 138
alter table dnc_entries drop column if exists lifted_at;                           -- 138
delete from schema_migrations where filename in ('138_dnc_lift_marker.sql','140_automation_switches.sql','141_engine_retry_redispatch_switch.sql');
```

- Rolling back 138 after the new code has lifted rows **loses those lifts**. The rows then read
  as active, which is the restrictive direction.
- Without 138, the new code's START and re-consent lifts fail and lift nothing (fail closed).

## 5. Apply 139 at or after the deploy

**Why it waits.** On today's code, Cross-Sell Life's purpose is invalid, so every cross-sell send
is blocked. 139 makes it valid. If someone unpaused Cross-Sell before this branch's engine fixes
were deployed, the old engine could start sending. Both campaigns are paused with 0 enrollments.

```sh
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 --single-transaction -f supabase/migrations/139_campaign_purpose_marketing.sql
psql "$DATABASE_URL" -c "insert into schema_migrations (filename) values ('139_campaign_purpose_marketing.sql') on conflict do nothing;"
```

**Verify:**

```sql
select purpose, status from life_campaigns;        -- MARKETING, paused
select purpose, status from xsell_life_campaigns;  -- MARKETING, paused
```

**Rollback** (from the file):

```sql
alter table life_campaigns alter column purpose set default 'POLICY_DEADLINE';
update life_campaigns set purpose = 'POLICY_DEADLINE', updated_at = now() where purpose = 'MARKETING';
alter table xsell_life_campaigns alter column purpose set default 'CLIENT_CARE_CROSS_SELL';
update xsell_life_campaigns set purpose = 'CLIENT_CARE_CROSS_SELL', updated_at = now() where purpose = 'MARKETING';
delete from schema_migrations where filename = '139_campaign_purpose_marketing.sql';
```

The rollback resets **every** MARKETING row. Production has one of each, so it restores the
seeded state exactly.

## 6. Order on the day

1. Section 0 check: confirm the Supabase integration will not deploy on merge.
2. Sections 1 → 2 (prove, then record 128–134).
3. Section 3 (137).
4. Section 4 (138, 140, 141).
5. Merge and deploy. `CRON_SECRET` and `SMS_A2P_APPROVED` are already set (owner).
6. Section 5 (139).
7. The canary checks in the audit report (§8), using the verified `comms_test_recipients` entries.
   Leave both switches `off` until they pass.

Each file is additive or a config row, and each was proven forward → rollback → re-apply on a
real Postgres by `tests/automation-migrations-rollback.test.mjs` (138–141). 137's rollback is the
one written in its own file and is not part of that test.
