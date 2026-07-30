-- ⚠️  DRAFT — NOT APPLIED. Deliberately outside supabase/migrations/ so
--     `npm run migrate` will NOT pick it up. Review, then (on approval) move to
--     supabase/migrations/078_audit_log_lockdown.sql to apply. See EVIDENCE.md.
--
-- Proposed forward migration: close two audit_log tamper vectors left open by
-- migration 010 (which correctly made the log append-only against UPDATE/DELETE).
--
-- VECTOR 1 — forged INSERTs. The current insert policy is
--   create policy audit_insert on audit_log for insert to authenticated with check (true);
-- so ANY authenticated principal (anon key + a session) can POST rows to PostgREST with
-- an arbitrary actor/action/entity, defeating the "tamper-evident / attributable"
-- property (false attribution, log flooding).
--
-- VECTOR 2 — TRUNCATE. The append-only trigger fires BEFORE UPDATE OR DELETE but NOT
-- TRUNCATE, and `revoke update, delete` did not cover TRUNCATE, so a TRUNCATE grant
-- could wipe the whole trail.
--
-- BLAST RADIUS: pure hardening. The ONLY writer of audit_log in the codebase is
-- src/lib/audit/log.ts (getDb() → service role), which BYPASSES RLS and retains INSERT
-- via ownership — so audit writes are unaffected. Verified: 0 app UPDATE/DELETE/TRUNCATE
-- of audit_log; 0 tests or migrations TRUNCATE/DELETE it; no test asserts an
-- authenticated INSERT. Removing the authenticated insert path therefore changes no
-- real caller's outcome — it only removes the forgery vector.

begin;

-- Vector 1: drop the permissive authenticated insert path; revoke the grant. Writes
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

commit;

-- ── ROLLBACK ────────────────────────────────────────────────────────────────
-- begin;
-- drop trigger if exists trg_audit_log_no_truncate on audit_log;
-- drop function if exists audit_log_block_truncate();
-- -- Restoring the forgeable insert policy is intentionally omitted (it re-opens the
-- --  vector). If an authenticated insert path is ever genuinely required, prefer a
-- --  policy that binds actor to auth.uid():
-- --   create policy audit_insert on audit_log for insert to authenticated
-- --     with check (actor = auth.uid()::text);
-- commit;
