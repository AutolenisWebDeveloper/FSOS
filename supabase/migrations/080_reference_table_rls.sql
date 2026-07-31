-- ─────────────────────────────────────────────────────────
-- Migration: 080_reference_table_rls
--
-- Close the "public table without RLS" gap on the last reference/ops tables the audit
-- flagged: carriers, products, districts, regions, job_runs. Under Supabase's default
-- PostgREST grants, anon/authenticated could read (and job_runs.error could leak internal
-- detail) or write these directly.
--
-- PURE HARDENING: every read/write in the app goes through getDb() (service role, which
-- BYPASSES RLS) — verified: 0 getBrowserDb/anon reads of any of these tables. Enabling
-- RLS deny-by-default (RLS on, no permissive policy) plus revoking anon/authenticated
-- writes changes no real caller's outcome; it only removes direct anon/authenticated
-- PostgREST access. No client PII is involved.
--
-- Idempotent; transaction-safe (runs inside the runner's per-file txn).
-- ─────────────────────────────────────────────────────────

do $$
declare t text;
begin
  foreach t in array array['carriers','products','districts','regions','job_runs'] loop
    if exists (select 1 from information_schema.tables where table_schema='public' and table_name=t) then
      execute format('alter table %I enable row level security', t);
      execute format('revoke insert, update, delete on %I from anon, authenticated', t);
    end if;
  end loop;
end $$;

-- ── ROLLBACK (manual) ───────────────────────────────────────────────────────
--   alter table carriers  disable row level security;  (repeat per table)
--   -- Re-granting anon/authenticated writes is intentionally omitted (re-opens the gap).
