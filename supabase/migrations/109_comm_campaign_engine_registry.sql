-- 109: Register campaign-engine campaigns in comm_campaigns (message-of-record fix).
--
-- comm_messages.campaign_id carries an FK to comm_campaigns(id) (ADR-013 canonical model),
-- but the three multi-channel engine campaigns (Life Conversion ADR-029, Pipeline Win-Back
-- ADR-031, Cross-Sell Life ADR-032) live in their own tables. Every engine send therefore
-- failed the comm_messages pre-insert on FK 23503 — silently, because the insert was
-- best-effort — leaving campaign sends with NO message-of-record (no body snapshot, no
-- consent_at_send, no delivery status). Audit: docs/audit/outbound-campaigns-2026-08-07.md.
--
-- Fix: mirror every engine campaign into comm_campaigns as an inert registry row so the FK
-- holds. Registry rows are invisible and inoperable in the console: archived_at is set (all
-- list queries filter `archived_at is null`), status stays 'paused' (broadcast/drip
-- processors act on 'active' only), and category 'engine_registry' marks provenance.
-- A trigger on each engine table keeps the registry in sync for future campaign rows
-- (version resets create new campaign UUIDs), so this cannot regress silently.

-- 1) Sync function: upsert the registry row for an engine campaign.
create or replace function public.sync_engine_campaign_registry()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.comm_campaigns (id, name, status, type, category, archived_at)
  values (new.id, new.name || ' (engine registry)', 'paused', 'drip', 'engine_registry', now())
  on conflict (id) do update
    set name = excluded.name,
        updated_at = now()
    where public.comm_campaigns.category = 'engine_registry';
  return new;
end;
$$;

-- 2) Triggers on the three engine tables (insert + rename).
drop trigger if exists trg_life_campaigns_registry on public.life_campaigns;
create trigger trg_life_campaigns_registry
  after insert or update of name on public.life_campaigns
  for each row execute function public.sync_engine_campaign_registry();

drop trigger if exists trg_xsell_life_campaigns_registry on public.xsell_life_campaigns;
create trigger trg_xsell_life_campaigns_registry
  after insert or update of name on public.xsell_life_campaigns
  for each row execute function public.sync_engine_campaign_registry();

drop trigger if exists trg_pipeline_winback_campaigns_registry on public.pipeline_winback_campaigns;
create trigger trg_pipeline_winback_campaigns_registry
  after insert or update of name on public.pipeline_winback_campaigns
  for each row execute function public.sync_engine_campaign_registry();

-- 3) Backfill registry rows for every existing engine campaign (including archived
--    versions, so historical message rows can also link).
insert into public.comm_campaigns (id, name, status, type, category, archived_at)
select c.id, c.name || ' (engine registry)', 'paused', 'drip', 'engine_registry', now()
from (
  select id, name from public.life_campaigns
  union all
  select id, name from public.xsell_life_campaigns
  union all
  select id, name from public.pipeline_winback_campaigns
) c
on conflict (id) do nothing;
