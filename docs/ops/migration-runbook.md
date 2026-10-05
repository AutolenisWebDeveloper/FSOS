# Migration runbook — production after PR #322 (128 → 141)

For the owner to run by hand. **This document contains no PII.** Every query in it is either
read-only (`begin read only … commit`) or a step you choose to run. Nothing here was run against
production by Claude except the read-only checks whose results are quoted (2026-10-04/05).

PR #322 (`fix/automation-e2e`) is merged: `main` is at `804222f` or later. This runbook brings the
production **database** up to that code. It does not merge or deploy anything.

Connect with a role that can write DDL. Use `psql "$DATABASE_URL"`, and never paste the URL into a
shared place.

**How each file is applied (owner, round 4).** A file and its ledger record go in **one
transaction**, with a lock timeout so a busy table makes the file fail fast instead of queueing
every query behind it:

```sh
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -1 \
  -c "set local lock_timeout = '5s'" \
  -f <file> \
  -c "insert into schema_migrations (filename) values ('<file>');"
```

- `-1` wraps the `-c`, `-f`, `-c` sequence in a single `BEGIN … COMMIT`; `ON_ERROR_STOP` makes any
  error roll back all of it. A file is never applied without being recorded, or recorded without
  being applied.
- `set local` lasts only for that transaction. If a lock is not granted within 5 seconds the file
  fails with `canceling statement due to lock timeout`, and nothing from it is applied or recorded.
  Wait for a quieter moment and run it again.
- The insert has **no `on conflict do nothing`**: a file that is already recorded fails loudly,
  and its statements roll back with it.
- None of 128–141 contains its own `BEGIN`/`COMMIT`, which would break the single transaction.
- Proven on a throwaway local Postgres with psql 16 (2026-10-05): a good file + record commits
  both; an already-recorded file exits non-zero and leaves its table uncreated; a failing file
  leaves neither its objects nor a record; with another session reading `dnc_entries`, 138 failed
  after 5 seconds with `lock timeout` and left no column and no record, then applied once the
  reader finished, and `lock_timeout` was back to its default afterwards. Use psql 15 or later
  (**ASSUMPTION**: older clients may not wrap a mixed `-f`/`-c` run in one transaction; only 16
  was tested).

**Every rollback below runs in its own transaction** (`begin; … commit;`). If any statement
fails, type `rollback;` and stop.

## Step 0 — Confirm you can restore (do this first)

In the Supabase dashboard → **Database → Backups**, confirm before any write below:

- the most recent daily backup completed within the last 24 hours, **or**
- Point-in-Time Recovery is enabled and its window covers now.

Note the backup time (or the PITR window) in your run log. If neither holds, stop and take a
backup first. Every step below has a SQL rollback, but a restore is the backstop if a rollback
itself goes wrong.

## Step 0b — Where the database is now (read-only)

The merge may have changed things since this was written (see Section 0). Read the ledger first:

```sql
begin read only;
select filename from schema_migrations where left(filename, 3) between '128' and '141' order by 1;
commit;
```

On 2026-10-04 the ledger recorded none of 128–134 and not 137 (138–141 were not on `main`
yet). If it now lists any of them, that file was applied since: skip it below and run only its
**Verify**.

## 0. What applies migrations to production

Nothing in the repo does it automatically.

| Mechanism | What it does |
|---|---|
| `npm run migrate` (`scripts/migrate.mjs`) | Applies **every** `supabase/migrations/*.sql` file not recorded in `public.schema_migrations`, in filename order, then records each one. Runs only when someone runs it with `DATABASE_URL` set. |
| `.github/workflows/ci.yml` | Never applies to production. It proves the chain on an ephemeral Postgres. Its "drift check" is read-only and unarmed (no `DATABASE_URL` secret). |
| Supabase GitHub integration (outside the repo) | Posts the "Supabase Preview" check on PRs. Its `main` branch record read `MIGRATIONS_FAILED`, last updated 2026-09-03 01:35 UTC. |

**What did the integration do when PR #322 merged?** **NOT VERIFIED.** The integration acts on
pushes to `main`, and the merge was one. Its logs are not readable from this session. What can be
read:

- The integration keeps its own ledger (`supabase_migrations.schema_migrations`), separate from
  the repo's `public.schema_migrations`. On 2026-10-04 it held **14 entries**, all
  timestamp-versioned (`20260607…` to `20260817…`).
- The repo's files are versioned `001_…` to `141_…`.

**Likely behaviour (ASSUMPTION, from how the Supabase CLI orders versions):** `001` to `141` all
sort *before* the integration's newest recorded version (`20260817184608`). The CLI refuses to
insert migrations before the last remote one unless told to include them all, so the run fails
before applying anything. If instead it is configured to include all files, it would try to
replay `001…` against a populated database.

**Check before applying anything:** Supabase dashboard → Branches → `main` → the run after the
PR #322 merge (2026-10-05) and its log; then Project Settings → Integrations → GitHub → whether
"deploy to production on merge" is on. If it is on, turn it off (or point it elsewhere) before the
next merge. Then run Step 0b. This runbook assumes you apply the migrations yourself.

### Do not run `npm run migrate` against production for this rollout

`public.schema_migrations` records 131 files but **not 128–134 and not 137–141**, although
128–134's objects appear to exist. `npm run migrate` would therefore:

- re-run 128–134;
- apply 137, which must wait (Section 3);
- apply **139** whenever you run it, whatever is deployed.

Use the per-file steps below instead.

## 1. Read-only: prove each change in 128–134

Each row checks what a file **changes**, not just that a name exists, and everything is filtered
to schema `public`. Run query A first. Run query B only if every row of A is `true` (B reads
columns that A proves exist; on a database without them it errors).

**A — schema (catalog only; it cannot error on a database missing these files):**

```sql
begin read only;
select file, check_name, ok from (values
 ('128','guest_count CHECK 0..10', exists(select 1 from pg_constraint where conrelid='public.workshop_registrations'::regclass and contype='c' and pg_get_constraintdef(oid) like '%guest_count >= 0%' and pg_get_constraintdef(oid) like '%guest_count <= 10%')),
 ('128','idx_wreg_active_email UNIQUE on (workshop_id, lower(email)), partial', exists(select 1 from pg_index i join pg_class c on c.oid=i.indexrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='idx_wreg_active_email' and i.indisunique and i.indpred is not null and pg_get_indexdef(i.indexrelid) like '%lower(email)%')),
 ('128','fn workshop_claim_registration(uuid,uuid,text,text,text,text,text[],text,text,integer)', to_regprocedure('public.workshop_claim_registration(uuid,uuid,text,text,text,text,text[],text,text,integer)') is not null),
 ('128','fn: anon and authenticated cannot execute; service_role can', coalesce((select not has_function_privilege('anon', p, 'execute') and not has_function_privilege('authenticated', p, 'execute') and has_function_privilege('service_role', p, 'execute') from to_regprocedure('public.workshop_claim_registration(uuid,uuid,text,text,text,text,text[],text,text,integer)') p where p is not null), false)),
 ('129','registrations → workshops FK is ON DELETE RESTRICT (and the only one)', (select count(*) = 1 and bool_and(confdeltype = 'r') from pg_constraint where conrelid='public.workshop_registrations'::regclass and confrelid='public.workshops'::regclass and contype='f')),
 ('129','marketing_opt_in / consent_captured_at / consent_form_version columns', (select count(*) = 3 from information_schema.columns where table_schema='public' and table_name='workshop_registrations' and column_name in ('marketing_opt_in','consent_captured_at','consent_form_version'))),
 ('129','workshops.senior_focused / senior_disclosure_config_id', (select count(*) = 2 from information_schema.columns where table_schema='public' and table_name='workshops' and column_name in ('senior_focused','senior_disclosure_config_id'))),
 ('130','publish gate trigger fires BEFORE INSERT and UPDATE, enabled', exists(select 1 from pg_trigger where tgrelid='public.workshops'::regclass and tgname='trg_workshop_publish_gate' and tgenabled <> 'D' and (tgtype & 2) <> 0 and (tgtype & 4) <> 0 and (tgtype & 16) <> 0)),
 ('130','terminality and cancel-cascade triggers, enabled', (select count(*) = 2 from pg_trigger where tgrelid='public.workshops'::regclass and tgname in ('trg_workshop_terminality','trg_workshop_cancel_cascade') and tgenabled <> 'D')),
 ('130','the 3-column unique on workshop_message_log is gone', not exists(select 1 from pg_index i where i.indrelid='public.workshop_message_log'::regclass and i.indisunique and i.indnkeyatts = 3)),
 ('130','idx_wml_claim UNIQUE on (registration_id, channel, kind, cadence_generation)', exists(select 1 from pg_index i join pg_class c on c.oid=i.indexrelid where i.indrelid='public.workshop_message_log'::regclass and c.relname='idx_wml_claim' and i.indisunique and i.indnkeyatts = 4 and pg_get_indexdef(i.indexrelid) like '%(registration_id, channel, kind, cadence_generation)%')),
 ('130','wml_kind_chk and wmt_kind_chk carry the full kind set', (select count(*) = 2 from pg_constraint where conname in ('wml_kind_chk','wmt_kind_chk') and connamespace='public'::regnamespace and pg_get_constraintdef(oid) like '%change_reschedule%' and pg_get_constraintdef(oid) like '%cancel_ack%' and pg_get_constraintdef(oid) like '%nurture_followup%')),
 ('130','session change_kind / change_recorded_at / cadence_generation; registrations.cancelled_at', (select count(*) = 4 from information_schema.columns where table_schema='public' and ((table_name='workshop_sessions' and column_name in ('change_kind','change_recorded_at','cadence_generation')) or (table_name='workshop_registrations' and column_name='cancelled_at')))),
 ('131','workshop_comms_config.nurture_followup_delay_minutes', exists(select 1 from information_schema.columns where table_schema='public' and table_name='workshop_comms_config' and column_name='nurture_followup_delay_minutes')),
 ('132','watt_capture_method_chk allows derived', exists(select 1 from pg_constraint where conrelid='public.workshop_attendance'::regclass and conname='watt_capture_method_chk' and pg_get_constraintdef(oid) like '%derived%')),
 ('132','wreg_marketing_capture_chk exists and is validated', exists(select 1 from pg_constraint where conrelid='public.workshop_registrations'::regclass and conname='wreg_marketing_capture_chk' and convalidated)),
 ('134','idx_opportunities_live_referral UNIQUE (referral_id) where live', exists(select 1 from pg_index i join pg_class c on c.oid=i.indexrelid where i.indrelid='public.opportunities'::regclass and c.relname='idx_opportunities_live_referral' and i.indisunique and pg_get_expr(i.indpred, i.indrelid) like '%referral_id IS NOT NULL%' and pg_get_expr(i.indpred, i.indrelid) like '%deleted_at IS NULL%'))
) v(file, check_name, ok) order by file, check_name;
commit;
```

**B — data (backfills and seeds):**

```sql
begin read only;
select file, check_name, ok from (values
 ('128','no duplicate active (workshop, email) registrations', not exists(select 1 from public.workshop_registrations where email is not null and coalesce(status,'registered') not in ('cancelled','ffs_referred') group by workshop_id, lower(email) having count(*) > 1)),
 ('129','consent backfill: no registration without consent_form_version', not exists(select 1 from public.workshop_registrations where consent_form_version is null)),
 ('130','generation-0 backfill: no one-time kind outside generation 0', not exists(select 1 from public.workshop_message_log where kind in ('confirmation','cancel_ack','nurture_attended','nurture_left_early','nurture_no_show','nurture_registered_no_show','nurture_followup') and cadence_generation <> 0)),
 ('130','7 change/cancel template seeds present', (select count(distinct (kind, channel)) = 7 from public.workshop_message_templates where (kind, channel) in (('change_reschedule','email'),('change_reschedule','sms'),('change_venue','email'),('change_venue','sms'),('event_cancelled','email'),('event_cancelled','sms'),('cancel_ack','email')))),
 ('131','5 cadence template seeds present', (select count(distinct (kind, channel)) = 5 from public.workshop_message_templates where (kind, channel) in (('reminder_3d','email'),('reminder_3d','sms'),('reminder_day_of','sms'),('nurture_followup','email'),('nurture_followup','sms')))),
 ('131','instant-ack gate handle row exists', exists(select 1 from public.comm_templates where id='eeee0000-0000-4000-8000-00000000ac01')),
 ('132','ack handle is not approved without an approver (submitted, or approved with approved_by)', exists(select 1 from public.comm_templates where id='eeee0000-0000-4000-8000-00000000ac01' and (approval_status = 'submitted' or (approval_status = 'approved' and approved_by is not null)))),
 ('133','sender address is set and not the placeholder', exists(select 1 from public.workshop_comms_config where id='global' and sender_physical_address is not null and sender_physical_address not like '[PLACEHOLDER%'))
) v(file, check_name, ok) order by file, check_name;
commit;
```

What the rows prove, by file:

| File | Proven by |
|---|---|
| 128 | the `guest_count` CHECK (0–10); `idx_wreg_active_email` is UNIQUE and partial on `(workshop_id, lower(email))`; `workshop_claim_registration` has the 10-argument signature; `anon` and `authenticated` cannot execute it and `service_role` can; no duplicate active registration survives |
| 129 | the only registrations → workshops FK is `ON DELETE RESTRICT` (`confdeltype = 'r'`); the consent and senior columns; the consent backfill left no row without `consent_form_version` |
| 130 | the publish gate fires `BEFORE INSERT` (the fix) and `UPDATE`; terminality and cancel-cascade triggers are enabled; no 3-column unique remains on `workshop_message_log`; `idx_wml_claim` is UNIQUE on the 4 columns; one-time kinds sit at generation 0; `wml_kind_chk`/`wmt_kind_chk` carry the new kinds; `change_kind`, `change_recorded_at`, `cadence_generation`, `cancelled_at`; its 7 template seeds |
| 131 | `nurture_followup_delay_minutes`; its 5 template seeds; the instant-ack handle row |
| 132 | the ack handle is not "approved" without an approver (132 reverses 131's unattributed approval; a later principal approval stamps `approved_by` and passes); `derived` capture method; `wreg_marketing_capture_chk` exists and is validated |
| 133 | the sender address is set and is not the placeholder |
| 134 | `idx_opportunities_live_referral` is UNIQUE on `referral_id`, partial on live rows |

132's `opportunities.source` column and index are not checked: migration 045 created both, so
132's statements for them are no-ops and cannot prove 132 ran.

**Proven locally (2026-10-05):** on a database with the whole chain, every row of A and B is
`true`. On a database that never ran 128–134 (135–141 applied), every row of A is `false`. The
previous version of this section passed 3 of its checks on that database (`trg_workshop_publish_gate`,
`opportunities.source`, `idx_opportunities_source` — all created by earlier files).

**Production:** the name-only checks passed on 2026-10-04. These definition checks have **not**
been run against production.

## 2. Record 128–134 — or re-apply the file whose checks fail

Handle the files **in filename order**.

**Every row for a file is `true`** → record it (no schema change):

```sql
begin;
insert into schema_migrations (filename) values ('<file>');
commit;
```

**Any row for a file is `false`** → do **not** record it. Read what the file changes (below),
then apply it with the one-transaction command at the top, and run Section 1 again. If a row for
that file is still `false`, the object exists in a different shape that the file's
`if not exists` guards skip. Stop: do not record it; that needs a new, hand-written migration.

| File | What re-applying it changes |
|---|---|
| 128 | Lower-cases stored registration emails. Marks later duplicate active registrations per (workshop, email) `cancelled`, keeping the earliest. Adds `guest_count`, the unique index, and the seat-claim function, and revokes it from `anon`/`authenticated`. |
| 129 | Adds the consent and senior columns. Backfills consent only on rows with no `consent_form_version`. Drops and re-adds the registrations → workshops FK as `ON DELETE RESTRICT` (a short lock on both tables). |
| 130 | Replaces the template kind CHECK and adds `wml_kind_chk`. Adds the generation and change columns. Moves one-time kinds to generation 0. Adds `idx_wml_claim`, then drops the 3-column unique. Adds `cancelled_at`. Re-creates the three workshop triggers. Seeds 7 placeholder templates (`on conflict do nothing`). |
| 131 | Adds the follow-up delay column and moves a config row still on the old default offsets. Seeds 5 placeholder templates. **Inserts the instant-ack handle as `approved` if the row is missing.** If you re-apply 131, re-apply 132 straight after it. |
| 132 | Reverses an approval that has no approver on the ack handle. Re-adds the capture-method CHECK with `derived`. Normalizes marketing capture evidence and adds `wreg_marketing_capture_chk`. |
| 133 | Sets the practice's mailing address where the placeholder still is. |
| 134 | Soft-deletes (`deleted_at`) later duplicate live opportunities per referral, keeping the earliest. Adds the unique index. |

**Verify:**

```sql
select count(*) from schema_migrations where left(filename,3) between '128' and '134';  -- expect 7
```

**Rollback** (ledger rows only; a re-applied file's own changes are not undone by this):

```sql
begin;
delete from schema_migrations where filename in ('128_workshop_registration_integrity.sql','129_workshop_consent_model.sql','130_workshop_lifecycle.sql','131_workshop_cadence.sql','132_workshop_hardening.sql','133_workshop_sender_address.sql','134_opportunity_referral_dedupe.sql');
commit;
```

## 3. 137 — skip until the reminder-timing fix ships

**Do not apply 137 yet (owner).** 137 turns on the 12-hour and 1-hour reminders. The reminder
timing fix (follow-up R6: skip a reminder that would move earlier by more than half its offset,
keep two reminders at least 2 hours apart, respect the floor on the retry pass, resolve a zone
from the area code) is on `fix/automation-followups` and is not deployed. Apply 137 only once a
production deployment contains it (check the commit as in Section 5).

**What waiting costs.** The production code reads the reminder offsets from
`booking_reminder_config` and the `appointment` frequency row. Without 137:

- the row still holds `{1440}`, so only the 24-hour reminder is sent, not 24h + 12h + 1h;
- the appointment caps stay at migration 136's 4 SMS / 8 touches a day.

Nothing is failing because of it. It is a missing feature, not an error.

**When it is time:**

```sh
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -1 -c "set local lock_timeout = '5s'" \
  -f supabase/migrations/137_booking_reminder_cadence.sql \
  -c "insert into schema_migrations (filename) values ('137_booking_reminder_cadence.sql');"
```

**Verify:**

```sql
select offsets_minutes from booking_reminder_config where id='global';                 -- {1440,720,60} (unless operator-edited)
select max_sms_per_day, max_combined_touches_per_day from comm_frequency_policy where id='appointment';  -- 6, 12 (unless edited)
```

**Rollback.** Unlike the block in the file, this resets a value **only if it still holds what 137
set**, so an operator-tuned offset list or cap survives. Proven by
`tests/automation-migrations-rollback.test.mjs`, which runs this exact block.

<!-- rollback:137 -->
```sql
begin;
alter table booking_reminder_config alter column offsets_minutes set default '{1440}';
update booking_reminder_config set offsets_minutes = '{1440}', updated_at = now()
 where id = 'global' and offsets_minutes = '{1440,720,60}';
update comm_frequency_policy set max_sms_per_day = 4, max_combined_touches_per_day = 8
 where id = 'appointment' and max_sms_per_day = 6 and max_combined_touches_per_day = 12;
delete from schema_migrations where filename = '137_booking_reminder_cadence.sql';
commit;
```

## 4. Apply 138, 140, 141 (additive; safe on the deployed code)

The loop **stops at the first failure**, so a failed 138 is never followed by 140 and 141. Each
file and its record are one transaction, so the failed file leaves nothing behind. 138 adds two
columns to `dnc_entries`, which every send reads; the 5-second lock timeout keeps it from queueing
sends behind it.

```sh
for f in 138_dnc_lift_marker 140_automation_switches 141_engine_retry_redispatch_switch; do
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -1 -c "set local lock_timeout = '5s'" \
    -f "supabase/migrations/$f.sql" \
    -c "insert into schema_migrations (filename) values ('$f.sql');" \
    || { echo "STOPPED at $f.sql: nothing from it was applied or recorded. Fix before continuing."; break; }
  echo "applied and recorded $f.sql"
done
```

Check the last line printed. Anything other than `applied and recorded 141_engine_retry_redispatch_switch.sql`
means the run stopped; files before the failed one stay applied and recorded (roll them back with
the steps below if you do not want them on their own).

**Verify:**

```sql
select column_name from information_schema.columns where table_schema='public' and table_name='dnc_entries' and column_name in ('lifted_at','lifted_reason');  -- 2 rows
select key, mode from automation_switches order by key;  -- callback_engine_state off, engine_retry_redispatch off
select relrowsecurity from pg_class where oid='public.automation_switches'::regclass;  -- true
```

`callback_engine_state` is seeded but no longer read: carrier opt-outs now always close
automation (follow-up R13). `consent_population_execute` has no row; a missing row is `off`.

**Rollback, in this order** (141 before 140):

```sql
begin;
delete from automation_switches where key = 'engine_retry_redispatch';             -- 141
drop table if exists automation_switches;                                          -- 140
alter table dnc_entries drop column if exists lifted_reason;                       -- 138
alter table dnc_entries drop column if exists lifted_at;                           -- 138
delete from schema_migrations where filename in ('138_dnc_lift_marker.sql','140_automation_switches.sql','141_engine_retry_redispatch_switch.sql');
commit;
```

- Rolling back 138 after the new code has lifted rows **loses those lifts**. The rows then read
  as active, which is the restrictive direction.
- Without 138, the new code's START and re-consent lifts fail and lift nothing (fail closed).
- Re-applying after a rollback: re-apply 140 **and then 141**. Dropping the table in 140's
  rollback also removes 141's row, and 140 alone does not re-seed it.

## 5. Apply 139 once the deployed commit contains PR #322

**Why it waits.** On code before PR #322, Cross-Sell Life's purpose is invalid, so every
cross-sell send is blocked. 139 makes it valid. If someone unpaused Cross-Sell while pre-#322 code
was live, the old engine could start sending. Both campaigns are paused with 0 enrollments
(2026-10-04).

**Confirm which commit is live** before running it:

1. Vercel dashboard → the FSOS project → **Deployments** → the deployment marked **Production**
   (Current). Note its commit SHA (shown under the branch name), and that its status is Ready.
2. In a checkout of the repo:

   ```sh
   git fetch origin main
   git merge-base --is-ancestor 804222f <live-sha> && echo "contains PR #322" || echo "does NOT contain PR #322 — stop"
   ```

Run 139 only on `contains PR #322`. (The app does not report its own commit, so the dashboard is
the source.)

```sh
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -1 -c "set local lock_timeout = '5s'" \
  -f supabase/migrations/139_campaign_purpose_marketing.sql \
  -c "insert into schema_migrations (filename) values ('139_campaign_purpose_marketing.sql');"
```

**Verify:**

```sql
select purpose, status from life_campaigns;        -- MARKETING, paused
select purpose, status from xsell_life_campaigns;  -- MARKETING, paused
```

**Rollback** (from the file):

```sql
begin;
alter table life_campaigns alter column purpose set default 'POLICY_DEADLINE';
update life_campaigns set purpose = 'POLICY_DEADLINE', updated_at = now() where purpose = 'MARKETING';
alter table xsell_life_campaigns alter column purpose set default 'CLIENT_CARE_CROSS_SELL';
update xsell_life_campaigns set purpose = 'CLIENT_CARE_CROSS_SELL', updated_at = now() where purpose = 'MARKETING';
delete from schema_migrations where filename = '139_campaign_purpose_marketing.sql';
commit;
```

The rollback resets **every** MARKETING row. Production has one of each, so it restores the
seeded state exactly.

## 6. Order on the day

1. Step 0: confirm a recent backup or the PITR window.
2. Section 0: read the integration's run after the merge; confirm it will not deploy on the next
   merge. Then Step 0b.
3. Sections 1 → 2 (prove each of 128–134, then record it, or re-apply it).
4. **Skip Section 3 (137).** The owner applies it only after the reminder-timing fix (R6) is in a
   production deployment.
5. Section 4 (138, 140, 141); it stops at the first failure.
6. Section 5 (139), after confirming the live commit contains PR #322.
7. The canary checks in the audit report (§8), using the verified `comms_test_recipients` entries.
   Leave every switch `off` until they pass.

Each of 138–141 was proven forward → rollback → re-apply on a real Postgres by
`tests/automation-migrations-rollback.test.mjs`, which also runs the guarded 137 rollback above
(including that it leaves operator-tuned values alone) and re-seeds 141 after re-applying 140.

## 7. Optional, not for merge day — close the stale Win-Back threads (owner-approved, round 4)

Run this **before Win-Back is unpaused**, not as part of the rollout. It changes conversation
status only; it deletes nothing and sends nothing. Approved by the owner in round 4.

**What it does.** Of the 143 open threads (read-only, 2026-10-05):

| Set | Count | Change |
|---|---|---|
| Open, no message ever (`last_message_at is null`) | 39 | `status` → `closed` |
| Open, last message outbound and older than 30 days | 104 | `status` → `closed` |
| `ai_autoreply = true` (all 3 are inside the sets above) | 3 | `ai_autoreply` → `false` |

Only threads with no unread inbound message (`unread_count = 0`) are touched; on 2026-10-05 none
had one. A later inbound reply reopens its thread (`conversations.ts` sets `status: 'open'` on
inbound). `comm_conversations` has no triggers, and `closed` is an allowed status.

**Why paused enrollments must be zero first.** Closing a thread is what lets the resume jobs
restart an enrollment paused for that conversation (`resume-paused` resumes on a closed thread;
district nurture resumes when the agent's own thread is no longer open). Closing 143 threads with
paused enrollments present would restart them all at once.

**Before — read-only. Expect 0 in every enrollment row, then 39 / 104 / 3 / 0 / 143:**

```sql
begin read only;
select 'comm_campaign_enrollments' as engine, count(*) from comm_campaign_enrollments where status = 'paused_for_conversation'
union all select 'life_campaign_enrollments', count(*) from life_campaign_enrollments where status = 'paused_for_conversation'
union all select 'pipeline_winback_enrollments', count(*) from pipeline_winback_enrollments where status = 'paused_for_conversation'
union all select 'xsell_life_campaign_enrollments', count(*) from xsell_life_campaign_enrollments where status = 'paused_for_conversation'
union all select 'district_nurture_enrollments', count(*) from district_nurture_enrollments where status = 'paused_for_conversation';

select
  count(*) filter (where status = 'open' and last_message_at is null)                                          as empty_open,
  count(*) filter (where status = 'open' and last_direction = 'outbound' and last_message_at < now() - interval '30 days') as outbound_old_open,
  count(*) filter (where ai_autoreply)                                                                          as armed,
  count(*) filter (where unread_count > 0)                                                                      as unread,
  count(*) filter (where status = 'open' and unread_count = 0
                   and (last_message_at is null
                        or (last_direction = 'outbound' and last_message_at < now() - interval '30 days')))  as eligible
from comm_conversations;
commit;
```

If any enrollment count is not 0, stop. If the thread numbers differ, the data moved since this
was written: note the new `eligible` count in your run log; that is the number to expect below.

**Apply — one transaction, which you commit by hand.** It refuses to start if any enrollment is
paused for a conversation. Each changed thread's prior state is written to the append-only
`audit_log` first; that row is what the rollback reads. The UPDATE repeats the eligibility
predicate (and `unread_count = 0`), so a thread that changed after the audit insert is left open.

```sql
begin;
set local lock_timeout = '5s';
do $$
declare n int;
begin
  select (select count(*) from comm_campaign_enrollments       where status = 'paused_for_conversation')
       + (select count(*) from life_campaign_enrollments       where status = 'paused_for_conversation')
       + (select count(*) from pipeline_winback_enrollments    where status = 'paused_for_conversation')
       + (select count(*) from xsell_life_campaign_enrollments where status = 'paused_for_conversation')
       + (select count(*) from district_nurture_enrollments    where status = 'paused_for_conversation')
    into n;
  if n > 0 then
    raise exception 'STOP: % enrollment(s) are paused_for_conversation; closing threads would let the resume jobs restart them', n;
  end if;
end $$;
insert into audit_log (actor, action, entity, entity_id, diff)
select 'owner:thread-disposition-2026-10', 'entity.updated', 'comm_conversation', id::text,
       jsonb_build_object('status_before', status, 'ai_autoreply_before', ai_autoreply,
                          'status_after', 'closed', 'ai_autoreply_after', false)
from comm_conversations
where status = 'open'
  and unread_count = 0
  and (last_message_at is null
       or (last_direction = 'outbound' and last_message_at < now() - interval '30 days'));
update comm_conversations c
set status = 'closed', ai_autoreply = false, updated_at = now()
from audit_log a
where a.actor = 'owner:thread-disposition-2026-10'
  and a.entity = 'comm_conversation'
  and a.entity_id = c.id::text
  and a.at = now()
  and c.status = 'open'
  and c.unread_count = 0
  and (c.last_message_at is null
       or (c.last_direction = 'outbound' and c.last_message_at < now() - interval '30 days'));
select
  (select count(*) from audit_log where actor = 'owner:thread-disposition-2026-10' and at = now()) as audited,
  (select count(*) from comm_conversations c join audit_log a on a.entity_id = c.id::text
    where a.actor = 'owner:thread-disposition-2026-10' and a.at = now() and c.status = 'closed' and c.updated_at = now()) as closed;
```

The last query prints `audited | closed`. **Both must equal the `eligible` count from Before**
(143 on 2026-10-05). If they do, type `commit;`. If either differs, type `rollback;` and stop:
nothing is changed and no audit row is kept.

**Verify:**

```sql
begin read only;
select count(*) from audit_log where actor = 'owner:thread-disposition-2026-10';   -- the eligible count
select count(*) from comm_conversations where status = 'open';                     -- open threads not eligible (0 on 2026-10-05, unless a reply arrived since)
select count(*) from comm_conversations where ai_autoreply;                        -- 0
commit;
```

**Rollback** — restores a thread's prior status and AI setting from its latest disposition audit
row (`distinct on (entity_id)`), but only when:

- the thread is still `closed` **and** its `updated_at` still equals that audit row's `at`, i.e.
  nothing has touched it since the disposition (a reply that reopened it, or any other write,
  leaves it as it is); and
- it has no `:rollback` audit row yet, so running the rollback twice restores nothing twice.

The restore and its audit row are written by one statement.

```sql
begin;
set local lock_timeout = '5s';
with pick as (
  select distinct on (a.entity_id) a.entity_id, a.at, a.diff
  from audit_log a
  where a.actor = 'owner:thread-disposition-2026-10' and a.entity = 'comm_conversation'
  order by a.entity_id, a.at desc
), todo as (
  select p.entity_id, p.at, p.diff
  from pick p
  join comm_conversations c on c.id::text = p.entity_id
  where c.status = 'closed'
    and c.updated_at = p.at
    and not exists (select 1 from audit_log r
                    where r.actor = 'owner:thread-disposition-2026-10:rollback'
                      and r.entity = 'comm_conversation' and r.entity_id = p.entity_id)
), restored as (
  update comm_conversations c
  set status = t.diff->>'status_before',
      ai_autoreply = (t.diff->>'ai_autoreply_before')::boolean,
      updated_at = now()
  from todo t
  where c.id::text = t.entity_id and c.status = 'closed' and c.updated_at = t.at
  returning c.id, t.diff
)
insert into audit_log (actor, action, entity, entity_id, diff)
select 'owner:thread-disposition-2026-10:rollback', 'entity.updated', 'comm_conversation', r.id::text,
       jsonb_build_object('status_before', 'closed', 'status_after', r.diff->>'status_before',
                          'ai_autoreply_after', (r.diff->>'ai_autoreply_before')::boolean)
from restored r;
commit;
```

`INSERT 0 n` reports the threads restored. Re-arming `ai_autoreply` on rollback restores AI
auto-replies on those 3 threads; leave them `false` unless the FSA wants them live (edit the
`ai_autoreply` line to `false`).

**Proven locally (2026-10-05)** on five seeded threads: apply closed the empty one and the two old
outbound ones, and left the one with an unread message and the recent inbound one open; after one
closed thread was reopened by a reply and another was touched, the rollback restored only the
untouched one; a second rollback restored nothing; with one district-nurture enrollment paused,
apply stopped at the guard and changed nothing.
