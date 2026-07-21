-- ─────────────────────────────────────────────────────────
-- Migration: 042_legacy_customer_pii_firewall
--
-- Enterprise-audit Initiative A (findings C-2 + C-1 source column). Additive and
-- idempotent, EXCEPT the intended `drop column customers.dob` after backfill.
--
-- C-2 — Encrypt/retire the legacy plaintext `customers.dob` (CLAUDE.md §5). Mirrors
-- the spine's household_members DOB pattern (mig 010/011): pgcrypto column encryption
-- with an app-held key (env DOB_ENCRYPTION_KEY), NEVER stored in the DB. DOB is now:
--   • encrypted at rest in `dob_enc bytea` (backfilled from the plaintext column);
--   • read/written ONLY through SECURITY DEFINER RPCs whose EXECUTE is revoked from
--     PUBLIC/anon (this also fixes audit M7 on the legacy side);
--   • non-PII birthday parts (`birth_month`/`birth_day`, no year → not age/identity) are
--     kept in the clear so the renewals birthday feature keeps working without decrypt;
--   • `age` is maintained at write time by the RPC (the old dob-reading trigger + the
--     pg_cron age-from-dob refresh are removed — pg_cron cannot decrypt, the key is
--     app-side only).
-- The plaintext `dob` column is then dropped. The backfill REQUIRES the key (passed as
-- the `app.dob_key` GUC by scripts/migrate.mjs); if it is absent the migration RAISES —
-- it never drops plaintext that has not been encrypted.
--
-- C-1 — Add `customers.is_security` (default false), the DB source the campaign runner
-- reads at the send boundary so an is_security customer is excluded by the gate firewall
-- (never a caller literal). Mirrors the spine's `is_security boolean not null default
-- false`. A conservative backfill flags customers who have an OPRA/FFS securities case.
-- ─────────────────────────────────────────────────────────

-- 1. Additive columns on the legacy customers table.
alter table customers add column if not exists dob_enc     bytea;
alter table customers add column if not exists is_security boolean not null default false;
alter table customers add column if not exists birth_month smallint;
alter table customers add column if not exists birth_day   smallint;

comment on column customers.dob_enc     is 'DOB encrypted at rest (pgcrypto, app-held DOB_ENCRYPTION_KEY). Read via customer_dob_get.';
comment on column customers.is_security is 'Securities firewall flag — excluded from the automated comms engine (CLAUDE.md §2.1).';
comment on column customers.birth_month is 'Non-PII birthday month (no year) for the renewals birthday feature.';
comment on column customers.birth_day   is 'Non-PII birthday day (no year) for the renewals birthday feature.';

-- 2. SECURITY DEFINER DOB accessors, mirroring member_dob/member_update (mig 011) but
--    with EXECUTE revoked from PUBLIC/anon (audit M7). The app gates by role before
--    calling and audits after. `age`/`birth_*` are maintained here from plaintext DOB.
create or replace function customer_dob_set(p_id uuid, p_dob date, p_key text)
returns void language plpgsql security definer as $$
begin
  update customers set
    dob_enc     = case when p_dob is null then null else encrypt_dob(p_dob, p_key) end,
    age         = case when p_dob is null then null else date_part('year', age(p_dob))::integer end,
    birth_month = case when p_dob is null then null else extract(month from p_dob)::smallint end,
    birth_day   = case when p_dob is null then null else extract(day   from p_dob)::smallint end
  where customer_id = p_id;
end;
$$;

create or replace function customer_dob_get(p_id uuid, p_key text)
returns date language sql stable security definer as $$
  select case when dob_enc is null then null else decrypt_dob(dob_enc, p_key) end
  from customers where customer_id = p_id;
$$;

revoke execute on function customer_dob_set(uuid, date, text) from public;
revoke execute on function customer_dob_get(uuid, text)       from public;
-- `anon` is a Supabase-managed role (absent in a bare Postgres); revoke only if present.
do $r$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke execute on function customer_dob_set(uuid, date, text) from anon';
    execute 'revoke execute on function customer_dob_get(uuid, text) from anon';
  end if;
end $r$;

-- 3. Backfill: encrypt existing plaintext dob → dob_enc, and derive age + birth parts.
--    The key (app.dob_key GUC, passed by scripts/migrate.mjs from DOB_ENCRYPTION_KEY)
--    is REQUIRED only when there is actually plaintext to encrypt — so this never drops
--    un-encrypted plaintext, yet a keyless environment with no plaintext rows (e.g. a
--    fresh Supabase preview branch) proceeds cleanly. Guarded on the column still
--    existing so the migration is safely re-runnable.
do $mig$
declare k text := current_setting('app.dob_key', true);
begin
  if exists (select 1 from information_schema.columns where table_name = 'customers' and column_name = 'dob')
     and exists (select 1 from customers where dob is not null) then
    if k is null or k = '' then
      raise exception 'Migration 042: customers.dob has plaintext rows but no DOB encryption key. Run `npm run migrate` with DOB_ENCRYPTION_KEY set (the app.dob_key GUC) so DOB is encrypted before the column is dropped.';
    end if;
    update customers
       set dob_enc     = encrypt_dob(dob, k),
           age         = date_part('year', age(dob))::integer,
           birth_month = extract(month from dob)::smallint,
           birth_day   = extract(day   from dob)::smallint
     where dob is not null and dob_enc is null;
  end if;
end $mig$;

-- 4. Conservative securities firewall backfill: a customer with an OPRA/FFS case is a
--    securities client → exclude from the automated comms engine. Guarded on the table
--    existing (absent in focused test fixtures). Over-exclusion is the safe direction.
do $sec$
begin
  if to_regclass('public.opra_cases') is not null then
    update customers set is_security = true
     where is_security = false
       and customer_id in (select customer_id from opra_cases where customer_id is not null);
  end if;
end $sec$;

-- 5. Retire the plaintext-dob machinery: the trigger that read dob, and the age-from-dob
--    refresh inside run_nightly_scoring (age is now maintained by customer_dob_set).
drop trigger if exists customers_set_age on customers;

do $fix$
begin
  -- Only patch run_nightly_scoring if it exists (it does in prod via 001; not in focused
  -- fixtures that create their own). Remove the leading `update customers set age =
  -- date_part(... age(dob) ...)` block that reads the now-dropped dob column.
  if to_regprocedure('run_nightly_scoring()') is not null then
    execute $body$
      create or replace function run_nightly_scoring() returns void language plpgsql as $$
      begin
        -- (age-from-dob refresh removed: dob is encrypted; age is set at write time by
        --  customer_dob_set. See migration 042.)
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

-- 6. Drop the plaintext DOB column. All existing data was encrypted into dob_enc above
--    (or the migration already raised). Idempotent.
alter table customers drop column if exists dob;

create index if not exists idx_customers_is_security on customers(is_security) where is_security = true;
create index if not exists idx_customers_birthday    on customers(birth_month, birth_day) where birth_month is not null;
