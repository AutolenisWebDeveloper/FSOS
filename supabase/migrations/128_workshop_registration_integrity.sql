-- 128_workshop_registration_integrity.sql
-- Batch 2 (Gate 1 approval): registration integrity — duplicates, capacity, guests.
--   WS-003  duplicate registration unconstrained → partial UNIQUE on (workshop, email)
--   WS-004  capacity was a read-then-insert race with nothing behind it → atomic claim fn
--   WS-060  capacity counted workshop-wide but bound per-session → per-SESSION counting
--   D-7     per-session, per-mode capacity: in-person = room constraint (fallback to the
--           legacy workshops.max_attendees), virtual nullable = unbounded; NEW guest
--           (plus-one) count consumes IN-PERSON capacity only
--   WS-037  past events accepted registrations → the claim refuses a started session
--   WS-048  client-supplied session never checked → the claim verifies it belongs
-- ADDITIVE ONLY: no drop/truncate. The duplicate cleanup marks later duplicates
-- status='cancelled' (soft, auditable) — it deletes nothing.

-- ── 1. Guest / plus-one count (D-7) ─────────────────────────────────────────────
alter table workshop_registrations
  add column if not exists guest_count integer not null default 0
    check (guest_count >= 0 and guest_count <= 10);

-- ── 2. Normalize stored emails (the gated route stored mixed case; WS-B §12) ────
update workshop_registrations set email = lower(email) where email is distinct from lower(email);

-- ── 3. Collapse existing duplicates BEFORE the unique index (keep the earliest
--       active registration per (workshop, email); later ones become 'cancelled') ─
with ranked as (
  select reg_id,
         row_number() over (
           partition by workshop_id, lower(email)
           order by registered_at asc nulls last, reg_id
         ) as rn
  from workshop_registrations
  where email is not null
    and coalesce(status, 'registered') not in ('cancelled', 'ffs_referred')
)
update workshop_registrations r
set status = 'cancelled'
from ranked
where ranked.reg_id = r.reg_id and ranked.rn > 1;

-- ── 4. The duplicate guard itself (WS-003). Partial: cancelled/FFS rows do not
--       block a genuine re-registration after a cancel. ─────────────────────────
create unique index if not exists idx_wreg_active_email
  on workshop_registrations (workshop_id, lower(email))
  where email is not null and status not in ('cancelled', 'ffs_referred');

-- ── 5. Atomic seat claim (WS-004/WS-060/WS-037/WS-048 + D-7) ────────────────────
-- Locks the SESSION row, so concurrent claims for the last seat serialize: exactly one
-- wins, the loser re-counts against the committed row and is refused. The INSERT happens
-- inside the same function so no seat can be counted and taken in different transactions.
-- SECURITY DEFINER (service-role usage only — the public route runs with the service
-- client; execute is revoked from anon/authenticated).
create or replace function workshop_claim_registration(
  p_workshop uuid,
  p_session uuid,
  p_name text,
  p_email text,
  p_phone text,
  p_chosen_delivery text,
  p_consent_channels text[],
  p_lead_source text,
  p_join_token text,
  p_guest_count integer default 0
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_workshop workshops%rowtype;
  v_session workshop_sessions%rowtype;
  v_mode text;
  v_cap integer;
  v_used integer;
  v_party integer;
  v_reg_id uuid;
begin
  if p_guest_count is null or p_guest_count < 0 or p_guest_count > 10 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_guest_count');
  end if;

  select * into v_workshop from workshops where workshop_id = p_workshop;
  if not found or v_workshop.status <> 'published' then
    return jsonb_build_object('ok', false, 'reason', 'not_published');
  end if;

  -- Lock the session row: the capacity count below is serialized on this lock.
  select * into v_session from workshop_sessions where id = p_session for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'session_not_found');
  end if;
  -- WS-048: a session id must belong to the workshop being registered for.
  if v_session.workshop_id <> p_workshop then
    return jsonb_build_object('ok', false, 'reason', 'session_mismatch');
  end if;
  if v_session.status = 'cancelled' then
    return jsonb_build_object('ok', false, 'reason', 'session_cancelled');
  end if;
  -- WS-037: no registration once the session has started.
  if v_session.starts_at <= now() then
    return jsonb_build_object('ok', false, 'reason', 'past_event');
  end if;

  -- Effective attendance mode for capacity: the registrant's choice on a hybrid
  -- session, else the session's own delivery mode.
  v_mode := case
    when coalesce(p_chosen_delivery, '') = 'virtual' then 'virtual'
    when coalesce(p_chosen_delivery, '') = 'in_person' then 'in_person'
    when v_session.delivery_mode = 'virtual' then 'virtual'
    else 'in_person'
  end;

  if v_mode = 'in_person' then
    -- D-7: the room is the constraint. Session capacity wins; legacy workshop-wide
    -- max_attendees is the fallback so existing data keeps a limit. Guests consume seats.
    v_cap := coalesce(v_session.capacity_in_person, v_workshop.max_attendees);
    v_party := 1 + p_guest_count;
    if v_cap is not null then
      select coalesce(sum(1 + coalesce(r.guest_count, 0)), 0) into v_used
      from workshop_registrations r
      where r.session_id = p_session
        and coalesce(r.status, 'registered') not in ('cancelled', 'ffs_referred')
        and coalesce(r.chosen_delivery, case when v_session.delivery_mode = 'virtual' then 'virtual' else 'in_person' end) <> 'virtual';
      if v_used + v_party > v_cap then
        return jsonb_build_object('ok', false, 'reason', 'full', 'seats_left', greatest(v_cap - v_used, 0));
      end if;
    end if;
  else
    -- Virtual: nullable capacity = unbounded (Zoom plan is the real ceiling); a virtual
    -- registrant never consumes a chair and guests are not counted (D-7).
    v_cap := v_session.capacity_virtual;
    v_party := 1;
    if v_cap is not null then
      select count(*) into v_used
      from workshop_registrations r
      where r.session_id = p_session
        and coalesce(r.status, 'registered') not in ('cancelled', 'ffs_referred')
        and coalesce(r.chosen_delivery, case when v_session.delivery_mode = 'virtual' then 'virtual' else 'in_person' end) = 'virtual';
      if v_used + v_party > v_cap then
        return jsonb_build_object('ok', false, 'reason', 'full', 'seats_left', greatest(v_cap - v_used, 0));
      end if;
    end if;
  end if;

  begin
    insert into workshop_registrations
      (workshop_id, session_id, name, email, phone, chosen_delivery, consent_channels,
       lead_source, join_token, guest_count, status)
    values
      (p_workshop, p_session, p_name, lower(p_email), p_phone, p_chosen_delivery,
       coalesce(p_consent_channels, '{}'), p_lead_source, p_join_token, p_guest_count, 'registered')
    returning reg_id into v_reg_id;
  exception when unique_violation then
    -- WS-003/WS-024: the same email already holds an active registration for this
    -- workshop — a distinct outcome, never a second row.
    return jsonb_build_object('ok', false, 'reason', 'duplicate');
  end;

  return jsonb_build_object('ok', true, 'reg_id', v_reg_id);
end;
$$;

revoke all on function workshop_claim_registration(uuid, uuid, text, text, text, text, text[], text, text, integer) from public;
revoke all on function workshop_claim_registration(uuid, uuid, text, text, text, text, text[], text, text, integer) from anon;
revoke all on function workshop_claim_registration(uuid, uuid, text, text, text, text, text[], text, text, integer) from authenticated;
grant execute on function workshop_claim_registration(uuid, uuid, text, text, text, text, text[], text, text, integer) to service_role;
