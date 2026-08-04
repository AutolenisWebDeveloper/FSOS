-- 097_winback_life_household_reachability.sql
-- Data repair (forward-only, idempotent). Companion to 091/092 (in-force + conversion cohorts).
-- The Life Win-Back import (src/app/api/app/winback/import) inserts `contacts` rows with
-- source='winback_life', contact_type='prospect', but — unlike the general contacts importer —
-- historically never materialized them into the household spine, so they sit with
-- household_id IS NULL. That makes the entire book UNREACHABLE:
--   * the Life Win-Back agent (ADR-034, lib/ai/workforce.ts `lifeWinbackCandidates`) resolves its
--     recipient + consent through a household MEMBER and skips any contact with no household;
--   * the consent-group backfill (lib/comms/consent-group-backfill-run.ts) keys consent on
--     household_members.source_contact_id, so an un-materialized contact is "contactsWithoutMember"
--     and can never be granted consent.
-- Net effect: an ACTIVE win-back campaign/agent enrolls nobody. The importer is fixed going
-- forward (it now calls materializeContact); this migration backfills the EXISTING cohort so it
-- becomes reachable immediately instead of waiting on the bounded daily data-quality drain.
--
-- WHY SQL is faithful here (no second materialization path, §6): the win-back importer stores
-- name + state/zip but NO street address, so every winback_life contact resolves to a SOLO
-- household under householdMaterialize.ts — origin_key = 'hh:solo:<contact.id>', a single member
-- with relationship='primary'. This migration reproduces exactly that solo shape. Contacts that
-- somehow carry a street address are LEFT OUT (address filter) and handled by the TS materializer's
-- daily backfill, which does the address-based grouping correctly — this SQL never guesses grouping.
--
-- Idempotent: only touches contacts with household_id IS NULL and no member linked via
-- source_contact_id; households use the unique origin_key (071), members the unique
-- source_contact_id (071). A re-run creates/links 0. Reversible: soft-delete members created here
-- (relationship='primary', source_contact_id → a winback_life contact) + the solo households whose
-- origin_key is 'hh:solo:<that contact id>', and clear those contacts.household_id.
-- Audited: one append-only audit_log row (action 'import.committed', §13.9), matching 091/092/093.
--
-- NOT in scope: consent. Materialization creates the household/member SPINE only. Prior express
-- consent for this now-reachable cohort is granted SEPARATELY as an attested, audited operation
-- (the win_back consent-group backfill; consent-groups.ts). The send gate still blocks any member
-- without granted consent, outside quiet hours, on DNC, or securities-flagged (§4.1/§4.2/§12).

do $$
declare
  v_hh     integer := 0;
  v_mem    integer := 0;
  v_linked integer := 0;
begin
  ------------------------------------------------------------------
  -- 1. Create a solo household per orphan winback_life contact.
  ------------------------------------------------------------------
  with cand as (
    select c.id, c.full_name, c.state, c.zip, c.owner_scope, c.agency_partnership_id,
           'hh:solo:' || c.id::text as origin_key
    from contacts c
    where c.source = 'winback_life'
      and c.deleted_at is null
      and c.household_id is null
      and (c.address is null or btrim(c.address) = '')
      and not exists (select 1 from household_members hm where hm.source_contact_id = c.id)
  ),
  ins as (
    insert into households (primary_name, state, zip, owner_scope, referring_agency_id, origin_key)
    select coalesce(nullif(btrim(full_name), ''), 'Household'),
           coalesce(nullif(btrim(state), ''), 'TX'),
           zip, owner_scope, agency_partnership_id, origin_key
    from cand
    on conflict (origin_key) where origin_key is not null do nothing
    returning id
  )
  select count(*) into v_hh from ins;

  ------------------------------------------------------------------
  -- 2. Create the PRIMARY member for each still-memberless orphan, linked via
  --    source_contact_id (the anchor the consent-group backfill resolves on).
  --    Resolve the target household by its solo origin_key (repairs a partial
  --    "household exists, no member" state too, since step 1 may have no-op'd).
  ------------------------------------------------------------------
  with cand as (
    select c.id as contact_id, c.full_name, c.email, c.phone,
           'hh:solo:' || c.id::text as origin_key
    from contacts c
    where c.source = 'winback_life'
      and c.deleted_at is null
      and c.household_id is null
      and (c.address is null or btrim(c.address) = '')
      and not exists (select 1 from household_members hm where hm.source_contact_id = c.id)
  ),
  ins as (
    insert into household_members (household_id, full_name, relationship, email, phone, source_contact_id)
    select h.id,
           coalesce(nullif(btrim(cand.full_name), ''), 'Unnamed contact'),
           'primary', cand.email, cand.phone, cand.contact_id
    from cand
    join households h on h.origin_key = cand.origin_key
    returning id
  )
  select count(*) into v_mem from ins;

  ------------------------------------------------------------------
  -- 3. Link each orphan contact to its solo household (only if still unlinked).
  ------------------------------------------------------------------
  with upd as (
    update contacts c
    set household_id = h.id, updated_at = now()
    from households h
    where h.origin_key = 'hh:solo:' || c.id::text
      and c.source = 'winback_life'
      and c.deleted_at is null
      and c.household_id is null
      and (c.address is null or btrim(c.address) = '')
    returning c.id
  )
  select count(*) into v_linked from upd;

  ------------------------------------------------------------------
  -- Audit (append-only)
  ------------------------------------------------------------------
  if to_regclass('public.audit_log') is not null then
    insert into audit_log (actor, action, entity, entity_id, diff)
    values (
      'system', 'import.committed', 'households', null,
      jsonb_build_object(
        'event', 'winback_life_household_reachability_repair',
        'migration', '097_winback_life_household_reachability',
        'households_created', v_hh,
        'members_created', v_mem,
        'contacts_linked', v_linked,
        'scope', 'contacts source=winback_life, household_id IS NULL, no street address, no member linked via source_contact_id',
        'method', 'solo household (origin_key hh:solo:<id>) + primary member; faithful to householdMaterialize.ts solo path (§6)',
        'consent', 'NOT granted here — attested win_back consent-group backfill grants consent; send gate still enforces consent/quiet-hours/DNC/firewall',
        'reversible', 'soft-delete primary members + solo households created here (source_contact_id/origin_key → winback_life contact) and clear those contacts.household_id'
      )
    );
  end if;

  raise notice 'Win-back reachability 097: % households created, % members created, % contacts linked.', v_hh, v_mem, v_linked;
end $$;
