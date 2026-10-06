# Migration runbook — `fix/automation-e2e` (137 → 141), then 142 → 143

For the owner to run by hand. **This document contains no PII.** Every query in it is either
read-only (`begin read only … commit`) or a step you choose to run. Nothing here was run against
production by Claude except the read-only checks whose results are quoted (2026-10-04).

Connect with a role that can write DDL. Use `psql "$DATABASE_URL"`, and never paste the URL into a
shared place.

**How each file is applied (owner, round 4).** A file and its ledger record go in **one
transaction**:

```sh
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -1 -f <file> -c "insert into schema_migrations (filename) values ('<file>');"
```

- `-1` wraps the `-f` file and the `-c` insert in a single `BEGIN … COMMIT`; `ON_ERROR_STOP` makes
  any error roll back both. A file is never applied without being recorded, or recorded without
  being applied.
- The insert has **no `on conflict do nothing`**: a file that is already recorded fails loudly,
  and its statements roll back with it.
- None of 137–141 contains its own `BEGIN`/`COMMIT`, which would break the single transaction.
- Proven on a throwaway local Postgres with psql 16 (2026-10-05): a good file + record commits
  both; an already-recorded file exits 1 and leaves its table uncreated; a failing file leaves
  neither its objects nor a record. Use psql 15 or later (**ASSUMPTION**: older clients may not
  wrap a mixed `-f`/`-c` run in one transaction; only 16 was tested).

## Step 0 — Confirm you can restore (do this first)

In the Supabase dashboard → **Database → Backups**, confirm before any write below:

- the most recent daily backup completed within the last 24 hours, **or**
- Point-in-Time Recovery is enabled and its window covers now.

Note the backup time (or the PITR window) in your run log. If neither holds, stop and take a
backup first. Every step below has a SQL rollback, but a restore is the backstop if a rollback
itself goes wrong.

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
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -1 -f supabase/migrations/137_booking_reminder_cadence.sql \
  -c "insert into schema_migrations (filename) values ('137_booking_reminder_cadence.sql');"
```

A non-zero exit means nothing was applied or recorded. Stop and read the error.

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

The loop **stops at the first failure**, so a failed 138 is never followed by 140 and 141. Each
file and its record are one transaction, so the failed file leaves nothing behind.

```sh
for f in 138_dnc_lift_marker 140_automation_switches 141_engine_retry_redispatch_switch; do
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -1 -f "supabase/migrations/$f.sql" \
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
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -1 -f supabase/migrations/139_campaign_purpose_marketing.sql \
  -c "insert into schema_migrations (filename) values ('139_campaign_purpose_marketing.sql');"
```

A non-zero exit means nothing was applied or recorded.

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

1. Step 0: confirm a recent backup or the PITR window.
2. Section 0 check: confirm the Supabase integration will not deploy on merge.
3. Sections 1 → 2 (prove, then record 128–134).
4. Section 3 (137).
5. Section 4 (138, 140, 141); it stops at the first failure.
6. Merge and deploy. `CRON_SECRET` and `SMS_A2P_APPROVED` are already set (owner).
7. Section 5 (139).
8. The canary checks in the audit report (§8), using the verified `comms_test_recipients` entries.
   Leave both switches `off` until they pass.

Each file is additive or a config row, and each was proven forward → rollback → re-apply on a
real Postgres by `tests/automation-migrations-rollback.test.mjs` (138–141). 137's rollback is the
one written in its own file and is not part of that test.

## 7. Optional, not for merge day — close the stale Win-Back threads (owner-approved, round 4)

Run this **before Win-Back is unpaused**, not as part of the merge. It changes conversation status
only; it deletes nothing and sends nothing. Approved by the owner in round 4.

**What it does.** Of the 143 open threads (read-only, 2026-10-05):

| Set | Count | Change |
|---|---|---|
| Open, no message ever (`last_message_at is null`) | 39 | `status` → `closed` |
| Open, last message outbound and older than 30 days | 104 | `status` → `closed` |
| `ai_autoreply = true` (all 3 are inside the sets above) | 3 | `ai_autoreply` → `false` |

None has an unread inbound message (`unread_count > 0`: 0). A later inbound reply reopens its thread
(`conversations.ts` sets `status: 'open'` on inbound). `comm_conversations` has no triggers, and
`closed` is an allowed status.

**Before — read-only, expect 39 / 104 / 3 / 0:**

```sql
begin read only;
select
  count(*) filter (where status = 'open' and last_message_at is null)                                          as empty_open,
  count(*) filter (where status = 'open' and last_direction = 'outbound' and last_message_at < now() - interval '30 days') as outbound_old_open,
  count(*) filter (where ai_autoreply)                                                                          as armed,
  count(*) filter (where unread_count > 0)                                                                      as unread
from comm_conversations;
commit;
```

If the numbers differ, stop: the data moved since this was written. Re-read and adjust the counts
in your run log before continuing.

**Apply — one transaction.** Each changed thread's prior state is written to the append-only
`audit_log` first; that row is what the rollback reads.

```sql
begin;
with target as (
  select id, status, ai_autoreply from comm_conversations
  where status = 'open'
    and (last_message_at is null
         or (last_direction = 'outbound' and last_message_at < now() - interval '30 days'))
)
insert into audit_log (actor, action, entity, entity_id, diff)
select 'owner:thread-disposition-2026-10', 'entity.updated', 'comm_conversation', id::text,
       jsonb_build_object('status_before', status, 'ai_autoreply_before', ai_autoreply,
                          'status_after', 'closed', 'ai_autoreply_after', false)
from target;

update comm_conversations c
set status = 'closed', ai_autoreply = false, updated_at = now()
from audit_log a
where a.actor = 'owner:thread-disposition-2026-10'
  and a.entity = 'comm_conversation'
  and a.entity_id = c.id::text
  and a.at = now()          -- only this transaction's rows: a re-run never re-closes a reopened thread
  and c.status = 'open';
-- psql prints UPDATE n — expect 143
commit;
```

**Verify:**

```sql
begin read only;
select count(*) from audit_log where actor = 'owner:thread-disposition-2026-10';   -- 143
select count(*) from comm_conversations where status = 'open';                     -- 0 (unless a reply arrived since)
select count(*) from comm_conversations where ai_autoreply;                        -- 0
commit;
```

**Rollback** — restores each thread's prior status and AI setting from its audit row, but **only
while the thread is still `closed`**: a thread an inbound reply has reopened since is left as it is.
The rollback itself is audited.

```sql
begin;
insert into audit_log (actor, action, entity, entity_id, diff)
select 'owner:thread-disposition-2026-10:rollback', 'entity.updated', 'comm_conversation', a.entity_id,
       jsonb_build_object('status_before', c.status, 'status_after', a.diff->>'status_before',
                          'ai_autoreply_after', (a.diff->>'ai_autoreply_before')::boolean)
from audit_log a join comm_conversations c on c.id::text = a.entity_id
where a.actor = 'owner:thread-disposition-2026-10' and c.status = 'closed';

update comm_conversations c
set status = a.diff->>'status_before',
    ai_autoreply = (a.diff->>'ai_autoreply_before')::boolean,
    updated_at = now()
from audit_log a
where a.actor = 'owner:thread-disposition-2026-10'
  and a.entity_id = c.id::text
  and c.status = 'closed';
commit;
```

Re-arming `ai_autoreply` on rollback restores AI auto-replies on those 3 threads; leave them `false`
unless the FSA wants them live (edit the rollback's `ai_autoreply` line to keep `false`).

## 8. Apply 142 and 143 (live-audit residual gaps and security-advisor hardening)

Added 2026-10-06. Same procedure as above: Step 0 first (backup or PITR window), then one file and
its ledger row per transaction, 142 before 143, connected as `postgres` (the owner of every function
and view these files touch, checked 2026-10-06; a REVOKE by a non-owner only warns and changes
nothing). Precondition: the ledger records every file through 141, including 128–134, so that no
later `npm run migrate` re-runs a file that re-creates a function without its pin (checked
2026-10-06: 143 rows, max 141). Neither file depends on a deploy: the app reads every affected
table, view and function through the service role (`getDb()`), which these files leave unchanged.

**What changes.**

| File | Change | Visible effect |
|---|---|---|
| 142 | Creates `idx_form_submissions_pending`, `idx_opra_uncontacted` (from 001) and `v_contact_by_source` (from 070, `security_invoker`) | None for users. Closes the ledger's three residual gaps |
| 143 | Revokes EXECUTE from PUBLIC, anon and authenticated on the 12 flagged SECURITY DEFINER functions (the service role keeps it); `comm_sendable_assets` becomes `security_invoker`; pins `search_path = public, extensions, pg_temp` on 47 functions, which repairs `has_role()` | None in the app. Direct `/rest/v1` reads with the public anon key, signed in or not, of the ~120 tables whose policies call `is_super()`/`has_role()` fail with 42501 instead of today's 42P01 (see below) |

**`has_role()` is broken in production today.** It carries `search_path=""` (set by hand; no
migration did it) while its body names `user_roles` unqualified, so every call fails with
`42P01 relation "user_roles" does not exist`. So do `is_super()` and every RLS policy that calls
either one, for any role RLS applies to. Nothing user-facing shows it because the app reads only
through the service role, which bypasses RLS. 143 re-pins it.

**Why the helpers are revoked from signed-in users too.** Today the broken `has_role()` happens to
block a signed-in user's JWT from reading those ~120 tables directly through `/rest/v1`. Repairing
it while signed-in users keep EXECUTE would open that path per the RLS policies (staff roles read
the book and write the `FOR ALL` tables), with no MFA check (no policy tests `aal`) and none of the
app's step-up, validation or audit. No FSOS code queries as a signed-in user, so 143 revokes the
helpers from `authenticated` as well: the posture stays closed, now on purpose. If direct
client-side RLS reads are ever wanted, re-grant them together with an `aal2` check in the policies.

**Read-only check before applying (2026-10-06 values in comments):**

```sql
begin read only;
select count(*) from schema_migrations where filename in ('142_residual_schema_gaps.sql','143_security_advisor_hardening.sql');  -- 0
select to_regclass('public.v_contact_by_source');                                                                                  -- null
select count(*) from pg_indexes where indexname in ('idx_form_submissions_pending','idx_opra_uncontacted');                       -- 0
select column_name from information_schema.columns where table_name = 'contacts' and column_name in ('source','household_id','deleted_at');  -- 3 rows
set local role service_role;
select count(*) from comm_sendable_assets;   -- note this number (as the app's role); it must be the same after 143
commit;
```

**Apply** (stops at the first failure; each file and its row commit together or not at all):

```sh
for f in 142_residual_schema_gaps 143_security_advisor_hardening; do
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -1 -f "supabase/migrations/$f.sql" \
    -c "insert into schema_migrations (filename) values ('$f.sql');" \
    || { echo "STOPPED at $f.sql: nothing from it was applied or recorded."; break; }
  echo "applied and recorded $f.sql"
done
```

**Verify:**

```sql
begin read only;
select public.has_role('super_admin');   -- false (no error; was 42P01)
set local role service_role;
select count(*) from comm_sendable_assets;   -- same number as before, read as the app's role
reset role;
-- SECURITY DEFINER functions anon can execute: expect 0
select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prosecdef
  and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  and has_function_privilege('anon', p.oid, 'EXECUTE');
-- ...and authenticated: expect 0
select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prosecdef
  and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  and has_function_privilege('authenticated', p.oid, 'EXECUTE');
-- functions without a pinned search_path: expect 0
select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
  and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%');
select reloptions from pg_class where oid = 'public.comm_sendable_assets'::regclass;   -- {security_invoker=true}
select count(*) from pg_indexes where indexname in ('idx_form_submissions_pending','idx_opra_uncontacted');   -- 2
commit;
```

Then re-run the Supabase security advisor. Expect no `security_definer_view`, no
`anon_security_definer_function_executable`, no `authenticated_security_definer_function_executable`
and no `function_search_path_mutable`. Still open and not closable by a migration: leaked-password
protection, `vector`/`btree_gist` in `public`, and the 38 INFO "RLS enabled, no policy" tables
(service-role only by design).

**Leaked-password protection (dashboard, not SQL):** Authentication → Sign In / Providers → Email
(`/dashboard/project/_/auth/providers?provider=Email`) → turn on "Prevent use of leaked passwords"
(HaveIBeenPwned). Supabase documents it as Pro plan and above
(https://supabase.com/docs/guides/auth/password-security); this project's plan was not checked.

**Rollback** (each file's `-- ROLLBACK:` block, 143 before 142). Both are proven forward → rollback →
re-apply by `tests/security-advisor-hardening.test.mjs`. 143's rollback restores production's exact
prior grants and settings, including `has_role`'s broken `search_path=""`, so restoring the
signed-in grants re-opens nothing.

```sh
# 143 then 142: paste each file's ROLLBACK block into psql inside begin … commit, then
psql "$DATABASE_URL" -c "delete from schema_migrations where filename in ('143_security_advisor_hardening.sql','142_residual_schema_gaps.sql');"
```
