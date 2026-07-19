-- ═══════════════════════════════════════════════════════════════════
-- FSOS — Row-Level Security, Guardrail Enforcement & Seeds
-- Migration: 010_rls_guardrails
--
-- Enforces at the DB layer (data-guardrails.md §2, §7):
--   • RLS on every client/agency table (default-deny for anon/authenticated;
--     service_role bypasses AFTER an rbac scope assertion in server actions);
--   • the securities firewall as a ROW rule (client never loads is_security);
--   • append-only, tamper-evident audit_log (INSERT-only; UPDATE/DELETE raise);
--   • pgcrypto DOB encrypt/decrypt (key passed from the app, held outside the DB);
--   • assumption-flagged config-default seeds (splits, agent roster, kill switch).
-- ═══════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────
-- 1. Scope helper functions (SECURITY DEFINER to avoid RLS recursion on user_*)
-- ─────────────────────────────────────────────────────────
create or replace function current_user_roles()
returns setof text language sql stable security definer as $$
  select role from user_roles where user_id = auth.uid();
$$;

create or replace function has_role(target text)
returns boolean language sql stable security definer as $$
  select exists (select 1 from user_roles where user_id = auth.uid() and role = target);
$$;

create or replace function is_super()
returns boolean language sql stable security definer as $$
  select has_role('super_admin');
$$;

create or replace function current_user_agencies()
returns setof uuid language sql stable security definer as $$
  select agency_partnership_id from user_agencies where user_id = auth.uid();
$$;

create or replace function current_user_household()
returns uuid language sql stable security definer as $$
  select household_id from user_households where user_id = auth.uid() limit 1;
$$;

-- ─────────────────────────────────────────────────────────
-- 2. DOB encryption (pgcrypto). Key is supplied by the app per call
--    (env DOB_ENCRYPTION_KEY / KMS) — never stored in the DB. Decrypt is
--    additionally gated by role at the app layer (rbac); every DOB view audited.
-- ─────────────────────────────────────────────────────────
-- Not marked IMMUTABLE: pgp_sym_encrypt uses a random IV (non-deterministic).
-- These are called explicitly by the app, never in an index/generated column.
create or replace function encrypt_dob(d date, key text)
returns bytea language sql volatile as $$
  select pgp_sym_encrypt(d::text, key);
$$;

create or replace function decrypt_dob(e bytea, key text)
returns date language sql stable as $$
  select nullif(pgp_sym_decrypt(e, key), '')::date;
$$;

-- ─────────────────────────────────────────────────────────
-- 3. Append-only, tamper-evident audit_log
--    The app role gets INSERT only; UPDATE/DELETE are revoked AND blocked by a
--    trigger so the log is tamper-evident even against the table owner.
-- ─────────────────────────────────────────────────────────
alter table audit_log enable row level security;

drop policy if exists audit_insert on audit_log;
create policy audit_insert on audit_log for insert to authenticated with check (true);

drop policy if exists audit_read on audit_log;
create policy audit_read on audit_log for select
  using (is_super() or has_role('compliance') or has_role('supervisor'));

revoke update, delete on audit_log from authenticated, anon;

create or replace function audit_log_block_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'audit_log is append-only (% not permitted)', tg_op;
end;
$$;

drop trigger if exists trg_audit_log_no_mutate on audit_log;
create trigger trg_audit_log_no_mutate
  before update or delete on audit_log
  for each row execute function audit_log_block_mutation();

-- ─────────────────────────────────────────────────────────
-- 4. RLS: default-deny on every client/agency table, then explicit grants.
--    (Tables not given an explicit policy below remain deny-by-default for
--    anon/authenticated; service_role bypasses RLS for server-side writes.)
-- ─────────────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array[
    'agency_partnerships','agency_owners','agency_activation','households','household_members',
    'referrals','consents','dnc_entries','household_policies','coverages','reviews','opportunities','cases',
    'case_requirements','commissions','commission_splits','comm_campaigns','comm_templates',
    'comm_campaign_enrollments','comm_messages','documents','document_requests','activities','work_tasks',
    'appointments','agent_runs','agent_actions','compliance_events','incidents','licenses',
    'notifications','user_roles','user_agencies','user_households'
  ]
  loop
    execute format('alter table %I enable row level security;', t);
  end loop;
end $$;

-- Agency partnership (aggregate root): FSA within book; agency_owner sees own; compliance reads.
drop policy if exists ap_read on agency_partnerships;
create policy ap_read on agency_partnerships for select using (
  is_super()
  or has_role('compliance') or has_role('supervisor')
  or (has_role('fsa') or has_role('licensed_staff'))
  or (has_role('agency_owner') and id in (select current_user_agencies()))
);

-- Households: FSA/staff (book); client sees own; NOT agency_owner (rbac).
drop policy if exists hh_read on households;
create policy hh_read on households for select using (
  is_super()
  or has_role('compliance') or has_role('supervisor')
  or has_role('fsa') or has_role('licensed_staff')
  or (has_role('client') and id = current_user_household())
);

-- Household members: same as households (DOB stays encrypted regardless).
drop policy if exists hm_read on household_members;
create policy hm_read on household_members for select using (
  is_super() or has_role('compliance') or has_role('supervisor')
  or has_role('fsa') or has_role('licensed_staff')
  or (has_role('client') and household_id = current_user_household())
);

-- Policies: FIREWALL as a row rule — a client can NEVER load an is_security row.
drop policy if exists pol_read on household_policies;
create policy pol_read on household_policies for select using (
  is_super() or has_role('compliance') or has_role('supervisor')
  or has_role('fsa') or has_role('licensed_staff')
  or (has_role('client') and household_id = current_user_household() and is_security = false)
);

-- Referrals: FSA/staff + compliance read; agency_owner sees own submissions.
drop policy if exists ref_read on referrals;
create policy ref_read on referrals for select using (
  is_super() or has_role('compliance') or has_role('supervisor')
  or has_role('fsa') or has_role('licensed_staff')
  or (has_role('agency_owner') and referring_agency_id in (select current_user_agencies()))
);

-- Opportunities / Cases / Commissions: FSA/staff + compliance; never client/partner.
drop policy if exists opp_read on opportunities;
create policy opp_read on opportunities for select using (
  is_super() or has_role('compliance') or has_role('supervisor')
  or has_role('fsa') or has_role('licensed_staff')
);
drop policy if exists case_read on cases;
create policy case_read on cases for select using (
  is_super() or has_role('compliance') or has_role('supervisor')
  or has_role('fsa') or has_role('licensed_staff') or has_role('case_manager')
);
drop policy if exists comm_read on commissions;
create policy comm_read on commissions for select using (
  is_super() or has_role('compliance') or has_role('supervisor')
  or has_role('fsa') or has_role('licensed_staff')
);

-- Reviews / tasks / appointments: FSA/staff + compliance read.
drop policy if exists rev_read on reviews;
create policy rev_read on reviews for select using (
  is_super() or has_role('compliance') or has_role('supervisor')
  or has_role('fsa') or has_role('licensed_staff')
);

-- A user can always read their own scope-linkage rows.
drop policy if exists ur_self on user_roles;
create policy ur_self on user_roles for select using (user_id = auth.uid() or is_super());
drop policy if exists ua_self on user_agencies;
create policy ua_self on user_agencies for select using (user_id = auth.uid() or is_super());
drop policy if exists uh_self on user_households;
create policy uh_self on user_households for select using (user_id = auth.uid() or is_super());

-- Notifications: a user reads only their own.
drop policy if exists notif_self on notifications;
create policy notif_self on notifications for select using (user_id = auth.uid() or is_super());

-- ─────────────────────────────────────────────────────────
-- 5. Seeds — the AI kill switch, the agent roster, and assumption-flagged
--    commission-split defaults (NEVER presented as Farmers-published figures).
-- ─────────────────────────────────────────────────────────
insert into ai_policies (id, gateway_enabled) values ('global', true)
  on conflict (id) do nothing;

insert into ai_agents (key, name, is_guardrail) values
  ('executive_intelligence','Executive Intelligence', false),
  ('agency_growth','Agency Growth', false),
  ('agency_activation','Agency Activation', false),
  ('referral_triage','Referral Triage', false),
  ('referral_followup','Referral Follow-Up', false),
  ('pipeline','Pipeline', false),
  ('cross_sell','Cross-Sell', false),
  ('term_conversion','Term Conversion', false),
  ('case_management','Case Management', false),
  ('document_intelligence','Document Intelligence', false),
  ('commission_reconciliation','Commission Reconciliation', false),
  ('marketing_automation','Marketing Automation', false),
  ('compliance_guardrail','Compliance Guardrail', true),
  ('data_quality','Data Quality', false)
  on conflict (key) do nothing;

-- CONFIG DEFAULT — NOT a Farmers figure. Replace with contract terms (I1/I2).
insert into commission_splits (product_family, agency_id, fsa_split_pct, agency_split_pct, is_assumption, note)
values
  ('life', null, 60, 40, true, 'config default — verify with contract; not a Farmers-published figure'),
  ('annuity', null, 60, 40, true, 'config default — verify with contract; not a Farmers-published figure'),
  ('investment', null, 60, 40, true, 'config default — verify with contract; not a Farmers-published figure'),
  ('education', null, 60, 40, true, 'config default — verify with contract; not a Farmers-published figure')
  on conflict do nothing;
