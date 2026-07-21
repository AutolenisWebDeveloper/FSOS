-- ─────────────────────────────────────────────────────────
-- Migration: 044_revert_customer_dob_encryption
--
-- Owner decision: reverse migration 042's DOB ENCRYPTION for the LEGACY `customers`
-- table. `customers` is a personal-use dataset and DOB must be plainly readable/editable
-- in the app. This restores a plain, directly-selectable `customers.dob date` column and
-- removes the encryption artifacts.
--
-- Runs with a plain `npm run migrate` (or the SQL editor) with NO DOB key set — there is
-- NO key requirement and NO fail-closed guard. If DOB_ENCRYPTION_KEY happens to be set
-- (passed as the app.dob_key GUC by scripts/migrate.mjs), existing encrypted values in
-- dob_enc are RECOVERED into the plain column; without the key (or with no dob_enc rows)
-- the recovery is a no-op and the migration still completes.
--
-- KEEPS everything else: is_security (C-1 firewall source), birth_month/birth_day, age,
-- and the firewall/birthday indexes. Does NOT touch the SPINE's household_members DOB
-- encryption (migration 011 / member_dob RPCs) — that is a separate subsystem.
--
-- Additive except the intended drops of 042's DOB artifacts (customer_dob_set/get, dob_enc).
-- ─────────────────────────────────────────────────────────

-- 1. Restore the plain dob column (nullable).
alter table customers add column if not exists dob date;
comment on column customers.dob is 'Date of birth (plain, staff-readable). Reverted from dob_enc encryption per owner decision (mig 044).';

-- 2. Recover existing encrypted values into plaintext IF the key is available for this run
--    (app.dob_key GUC). No key or no dob_enc column → no-op; never raises. decrypt_dob is
--    from migration 010 (still present; used by the spine).
do $recover$
declare k text := current_setting('app.dob_key', true);
begin
  if k is not null and k <> ''
     and exists (select 1 from information_schema.columns where table_name = 'customers' and column_name = 'dob_enc') then
    update customers set dob = decrypt_dob(dob_enc, k) where dob_enc is not null and dob is null;
  end if;
end $recover$;

-- 3. Restore the plain-dob trigger: maintain age + birth_month/birth_day from dob on write
--    (042 had dropped this trigger and moved the work into customer_dob_set).
create or replace function set_customer_age() returns trigger language plpgsql as $$
begin
  new.age         := case when new.dob is null then null else date_part('year', age(new.dob))::integer end;
  new.birth_month := case when new.dob is null then null else extract(month from new.dob)::smallint end;
  new.birth_day   := case when new.dob is null then null else extract(day   from new.dob)::smallint end;
  return new;
end;
$$;
drop trigger if exists customers_set_age on customers;
create trigger customers_set_age
  before insert or update of dob on customers
  for each row execute function set_customer_age();

-- 4. Backfill age + birth parts for any rows recovered above (the trigger only fires on write).
update customers
   set age         = date_part('year', age(dob))::integer,
       birth_month = extract(month from dob)::smallint,
       birth_day   = extract(day   from dob)::smallint
 where dob is not null;

-- 5. Restore run_nightly_scoring's age/birthday refresh from the plain dob column (042
--    removed it because pg_cron could not decrypt; with a plain column it works again).
do $fix$
begin
  if to_regprocedure('run_nightly_scoring()') is not null then
    execute $body$
      create or replace function run_nightly_scoring() returns void language plpgsql as $$
      begin
        -- Keep age + birthday parts current from the plain dob before scoring.
        update customers
           set age         = date_part('year', age(dob))::integer,
               birth_month = extract(month from dob)::smallint,
               birth_day   = extract(day   from dob)::smallint
         where dob is not null;

        insert into scores (customer_id, opra_score, conversion_score, life_score, retirement_score, business_score, updated_at)
        select
          c.customer_id,
          score_opra(c.customer_id),
          score_conversion(c.customer_id),
          score_life(c.customer_id),
          score_retirement(c.customer_id),
          score_business(c.customer_id),
          now()
        from customers c
        on conflict (customer_id) do update set
          opra_score       = excluded.opra_score,
          conversion_score = excluded.conversion_score,
          life_score       = excluded.life_score,
          retirement_score = excluded.retirement_score,
          business_score   = excluded.business_score,
          updated_at       = now();
      end;
      $$;
    $body$;
  end if;
end $fix$;

-- 6. Drop the encryption artifacts (recovery above already read dob_enc).
drop function if exists customer_dob_set(uuid, date, text);
drop function if exists customer_dob_get(uuid, text);
alter table customers drop column if exists dob_enc;

-- (is_security, birth_month, birth_day, idx_customers_is_security, idx_customers_birthday
--  are intentionally KEPT. The spine's household_members.dob_enc / member_dob is untouched.)
