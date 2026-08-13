-- 115: Agent-level & Client-level Communication Suppression (BUSINESS suppression).
--
-- A NEW, SEPARATE policy layer that lets the FSA exclude an agent's entire book, or
-- individual/bulk clients, from applicable NON-transactional FSOS outreach (marketing,
-- campaigns, nurture, promotional, AI-initiated outreach). It is deliberately DISTINCT
-- from the regulatory suppression already in place:
--   • dnc_entries        — SMS STOP / DNC / email unsubscribe / bounce / complaint
--   • consents           — channel/purpose consent grant & revoke
--   • comm_contact_consents — public-intake TCPA/A2P consent evidence
-- Business suppression NEVER writes to, reads as, or overwrites any of those. Unblocking
-- an agent or a client here can therefore never reactivate a regulatory prohibition — the
-- regulatory layers are evaluated independently at the send gate (gate.ts steps consent/dnc)
-- and are untouched by this feature (master build instruction: "Preserve regulatory controls").
--
-- Design (no physical duplication): agent-level suppression is a POLICY ROW on the agency,
-- not a copy onto every client. Effective suppression for a contact is COMPUTED at send time
-- from the layers (individual → agent/book), so a client newly assigned to a blocked agent
-- inherits the restriction automatically, and a client reassigned to an active agent
-- recalculates automatically — no per-client backfill, no stale copies.
--
-- The "agent" in FSOS is the agency partner's agency owner; the BOOK of clients is grouped by
-- the agency partnership (contacts.agency_partnership_id / households.referring_agency_id →
-- agency_partnerships). So agent-level suppression keys on agency_partnerships.id.
--
-- Safety: no rows are created here, so every existing agent and client stays effectively
-- 'active' by default — this migration cannot suppress the existing book of business.

begin;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) Agent-level (book) suppression — one policy row per agency partnership.
--    Presence of a row with status='blocked' suppresses the whole book; 'active'
--    (or no row) means not suppressed. The row also carries the audit trail fields
--    for the profile UI (who/when/why + affected-client snapshot).
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists comm_agency_suppressions (
  agency_id      uuid primary key references agency_partnerships(id) on delete cascade,
  status         text not null default 'active' check (status in ('active', 'blocked')),
  reason         text,
  blocked_by     text,          -- actor (auth user id) who last blocked
  blocked_at     timestamptz,
  unblocked_by   text,          -- actor who last unblocked
  unblocked_at   timestamptz,
  affected_count integer,       -- book size snapshot at the last block (for display/audit)
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- Fast "is this agency blocked?" lookup at send time (only blocked rows are interesting).
create index if not exists idx_agency_suppr_blocked
  on comm_agency_suppressions (agency_id)
  where status = 'blocked';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) Client-level (individual) suppression — one policy row per contact. Keyed on
--    contacts.id (the Contact Center identity the UI selects). At send time a member
--    resolves to its contact via household_members.source_contact_id (and, failing that,
--    a tolerant phone/email match), so an individually-blocked client stays blocked
--    regardless of which agent they are assigned to.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists comm_client_suppressions (
  contact_id    uuid primary key references contacts(id) on delete cascade,
  status        text not null default 'active' check (status in ('active', 'blocked')),
  reason        text,
  blocked_by    text,
  blocked_at    timestamptz,
  unblocked_by  text,
  unblocked_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists idx_client_suppr_blocked
  on comm_client_suppressions (contact_id)
  where status = 'blocked';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) RLS. App writes go through the service-role client AFTER the app-layer RBAC gate
--    (requireApiRole + requirePermission), so these tables get RLS enabled with a
--    staff READ policy and NO write policy (writes are service-role only, matching
--    comm_contact_consents / dnc_entries). Reads are limited to the roles that may see
--    compliance/communications oversight.
-- ─────────────────────────────────────────────────────────────────────────────
alter table comm_agency_suppressions enable row level security;
alter table comm_client_suppressions enable row level security;

drop policy if exists agency_suppr_staff_read on comm_agency_suppressions;
create policy agency_suppr_staff_read on comm_agency_suppressions for select using (
  is_super() or has_role('compliance') or has_role('supervisor')
  or has_role('fsa') or has_role('licensed_staff')
);

drop policy if exists client_suppr_staff_read on comm_client_suppressions;
create policy client_suppr_staff_read on comm_client_suppressions for select using (
  is_super() or has_role('compliance') or has_role('supervisor')
  or has_role('fsa') or has_role('licensed_staff')
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) Atomic mutation + audit RPC. FSOS app code has no BEGIN/COMMIT helper and
--    writeAudit() is a separate best-effort call, so a mutation could commit while its
--    audit row is lost. This feature REQUIRES the suppression mutation and its audit
--    record to be atomic: if the audit_log insert fails, the whole operation must roll
--    back (master build instruction: "Audit atomicity"). A SECURITY DEFINER function is
--    one implicit transaction, so any exception here — a bad FK, a missing agency, an
--    audit failure — rolls back the state change too. (This also avoids the class of
--    silent-FK-failure that cost campaign sends their message-of-record: any failure
--    RAISES and the calling route surfaces it, never a silent swallow.)
--
--    Returns a summary jsonb the route echoes back to the UI (previous/new state +
--    affected count). Raises on any invalid input.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.comm_suppression_apply(
  p_scope       text,       -- 'agency' | 'client'
  p_status      text,       -- 'blocked' | 'active'
  p_actor       text,       -- acting user id (audit actor)
  p_reason      text default null,
  p_agency_id   uuid default null,     -- required when p_scope = 'agency'
  p_contact_ids uuid[] default null    -- required when p_scope = 'client'
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prev_status  text;
  v_affected     integer := 0;
  v_valid_ids    uuid[];
  v_now          timestamptz := now();
begin
  if p_actor is null or length(trim(p_actor)) = 0 then
    raise exception 'comm_suppression_apply: actor is required';
  end if;
  if p_status not in ('blocked', 'active') then
    raise exception 'comm_suppression_apply: invalid status %', p_status;
  end if;

  -- ── Agent-level (whole book) ──────────────────────────────────────────────
  if p_scope = 'agency' then
    if p_agency_id is null then
      raise exception 'comm_suppression_apply: agency_id required for agency scope';
    end if;
    -- The agency must exist — a missing/invalid agency relationship must fail (not
    -- silently no-op), so an orphaned mutation can never masquerade as success.
    if not exists (select 1 from agency_partnerships where id = p_agency_id) then
      raise exception 'comm_suppression_apply: agency % not found', p_agency_id;
    end if;

    select status into v_prev_status from comm_agency_suppressions where agency_id = p_agency_id;
    v_prev_status := coalesce(v_prev_status, 'active');

    -- Book size = the Contact Center clients assigned to this agency (excludes the
    -- agency owner's own contact row and soft-deleted rows). Snapshotted on block.
    select count(*) into v_affected
    from contacts
    where agency_partnership_id = p_agency_id
      and deleted_at is null
      and contact_type <> 'agency_owner';

    insert into comm_agency_suppressions as s (
      agency_id, status, reason, blocked_by, blocked_at, unblocked_by, unblocked_at,
      affected_count, created_at, updated_at
    ) values (
      p_agency_id, p_status, p_reason,
      case when p_status = 'blocked' then p_actor end,
      case when p_status = 'blocked' then v_now end,
      case when p_status = 'active' then p_actor end,
      case when p_status = 'active' then v_now end,
      v_affected, v_now, v_now
    )
    on conflict (agency_id) do update set
      status         = excluded.status,
      reason         = excluded.reason,
      blocked_by     = case when excluded.status = 'blocked' then p_actor else s.blocked_by end,
      blocked_at     = case when excluded.status = 'blocked' then v_now else s.blocked_at end,
      unblocked_by   = case when excluded.status = 'active' then p_actor else s.unblocked_by end,
      unblocked_at   = case when excluded.status = 'active' then v_now else s.unblocked_at end,
      affected_count = excluded.affected_count,
      updated_at     = v_now;

    -- Atomic audit — a failure here rolls the mutation back.
    insert into audit_log (actor, action, entity, entity_id, diff)
    values (
      p_actor, 'config.changed', 'comm_agency_suppression', p_agency_id::text,
      jsonb_build_object(
        'feature', 'communication_suppression',
        'scope', 'agent_book',
        'agency_id', p_agency_id,
        'previous_status', v_prev_status,
        'new_status', p_status,
        'reason', p_reason,
        'affected_client_count', v_affected
      )
    );

    return jsonb_build_object(
      'scope', 'agency',
      'agency_id', p_agency_id,
      'previous_status', v_prev_status,
      'new_status', p_status,
      'affected_count', v_affected
    );

  -- ── Client-level (individual / bulk) ──────────────────────────────────────
  elsif p_scope = 'client' then
    if p_contact_ids is null or array_length(p_contact_ids, 1) is null then
      raise exception 'comm_suppression_apply: contact_ids required for client scope';
    end if;

    -- Only operate on contact ids that actually exist and are not soft-deleted; this
    -- keeps the FK honest and makes the affected count truthful.
    select array_agg(id) into v_valid_ids
    from contacts
    where id = any (p_contact_ids) and deleted_at is null;

    if v_valid_ids is null or array_length(v_valid_ids, 1) is null then
      raise exception 'comm_suppression_apply: no valid contacts in selection';
    end if;

    insert into comm_client_suppressions as s (
      contact_id, status, reason, blocked_by, blocked_at, unblocked_by, unblocked_at,
      created_at, updated_at
    )
    select
      cid, p_status, p_reason,
      case when p_status = 'blocked' then p_actor end,
      case when p_status = 'blocked' then v_now end,
      case when p_status = 'active' then p_actor end,
      case when p_status = 'active' then v_now end,
      v_now, v_now
    from unnest(v_valid_ids) as cid
    on conflict (contact_id) do update set
      status       = excluded.status,
      reason       = excluded.reason,
      blocked_by   = case when excluded.status = 'blocked' then p_actor else s.blocked_by end,
      blocked_at   = case when excluded.status = 'blocked' then v_now else s.blocked_at end,
      unblocked_by = case when excluded.status = 'active' then p_actor else s.unblocked_by end,
      unblocked_at = case when excluded.status = 'active' then v_now else s.unblocked_at end,
      updated_at   = v_now;

    v_affected := array_length(v_valid_ids, 1);

    insert into audit_log (actor, action, entity, entity_id, diff)
    values (
      p_actor, 'config.changed', 'comm_client_suppression',
      case when v_affected = 1 then v_valid_ids[1]::text else null end,
      jsonb_build_object(
        'feature', 'communication_suppression',
        'scope', case when v_affected = 1 then 'individual' else 'client_bulk' end,
        'new_status', p_status,
        'reason', p_reason,
        'affected_client_count', v_affected,
        'contact_ids', to_jsonb(v_valid_ids)
      )
    );

    return jsonb_build_object(
      'scope', 'client',
      'new_status', p_status,
      'affected_count', v_affected,
      'contact_ids', to_jsonb(v_valid_ids)
    );
  else
    raise exception 'comm_suppression_apply: invalid scope %', p_scope;
  end if;
end;
$$;

-- The RPC is called only by the service-role client (after the app RBAC gate). Lock down
-- direct EXECUTE so an authenticated/anon session cannot invoke it to self-serve a mutation.
revoke all on function public.comm_suppression_apply(text, text, text, text, uuid, uuid[]) from public;
revoke all on function public.comm_suppression_apply(text, text, text, text, uuid, uuid[]) from anon, authenticated;

commit;
