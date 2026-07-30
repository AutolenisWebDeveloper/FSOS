-- ─────────────────────────────────────────────────────────
-- Migration: 077_audit_log_lockdown
--
-- Close two audit_log tamper vectors left open by migration 010 (which correctly made
-- the log append-only against UPDATE/DELETE). Owner-approved (god-mode audit).
--
-- VECTOR 1 — forged INSERTs. Migration 010's insert policy is
--   create policy audit_insert on audit_log for insert to authenticated with check (true);
-- so ANY authenticated principal (anon key + a session) could POST rows to PostgREST
-- with an arbitrary actor/action/entity, defeating the tamper-evident/attributable
-- property. The ONLY real writer is src/lib/audit/log.ts via the service role, which
-- BYPASSES RLS and retains INSERT through ownership — so removing the authenticated
-- insert path changes no real caller's outcome (verified: 0 authenticated-insert tests,
-- 1 app writer, all service-role).
--
-- VECTOR 2 — TRUNCATE. The append-only trigger fired BEFORE UPDATE OR DELETE but NOT
-- TRUNCATE, and `revoke update, delete` didn't cover TRUNCATE. Nothing in the app, jobs,
-- tests, or migrations TRUNCATEs audit_log, so blocking it removes only an abuse path.
--
-- No explicit BEGIN/COMMIT: the migration runner (scripts/migrate.mjs --single-transaction
-- and the Supabase branching pipeline) already applies each file atomically. All
-- statements below are transaction-safe. Idempotent (drop … if exists / create or replace).
-- ─────────────────────────────────────────────────────────

-- Vector 1: drop the permissive authenticated insert path + revoke the grant. Writes
-- continue via the service role (audit/log.ts). RLS stays enabled + append-only.
drop policy if exists audit_insert on audit_log;
revoke insert on audit_log from authenticated, anon;

-- Vector 2: block TRUNCATE (statement-level) and revoke the privilege from public.
revoke truncate on audit_log from public;

create or replace function audit_log_block_truncate() returns trigger
  language plpgsql as $$
begin
  raise exception 'audit_log is append-only (TRUNCATE not permitted)';
end $$;

drop trigger if exists trg_audit_log_no_truncate on audit_log;
create trigger trg_audit_log_no_truncate
  before truncate on audit_log
  for each statement execute function audit_log_block_truncate();

-- ── ROLLBACK (manual) ───────────────────────────────────────────────────────
--   drop trigger if exists trg_audit_log_no_truncate on audit_log;
--   drop function if exists audit_log_block_truncate();
--   -- Restoring the forgeable insert policy is intentionally omitted (re-opens the
--   -- vector). If an authenticated insert path is ever needed, bind actor to auth.uid():
--   --   create policy audit_insert on audit_log for insert to authenticated
--   --     with check (actor = auth.uid()::text);
