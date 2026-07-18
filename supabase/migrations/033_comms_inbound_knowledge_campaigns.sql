-- ═══════════════════════════════════════════════════════════════════
-- FSOS — Two-way comms, AI Knowledge Library, and campaign management
-- Migration: 033_comms_inbound_knowledge_campaigns
--
-- Completes the Twilio (SMS) + Resend (email) integration end-to-end and adds the
-- three requested subsystems, all on the aggregate-root spine (households/members):
--
--   1. Conversation threading + full history. comm_conversations groups every
--      inbound/outbound message on a channel with ONE contact, auto-associated to
--      member → household → agency (+ optional policy). comm_messages gains the
--      linkage + delivery-lifecycle columns (delivered/opened/clicked/failed) and a
--      per-message event ledger (comm_message_events) for delivery/open/click/reply
--      tracking and campaign analytics.
--
--   2. AI Knowledge Library. knowledge_documents stores documents, FAQs, policies,
--      procedures, templates, and business info, indexed with a Postgres full-text
--      search vector so the AI can retrieve relevant context when responding to a
--      contact. Farmers-specific values remain assumption-flagged (Guardrail 3).
--
--   3. Campaign management. comm_campaigns gains type (broadcast|drip), A/B variants,
--      per-send subject/personalization, sequence linkage, and rolled-up metrics;
--      comm_campaign_enrollments gains drip-step cursor + variant assignment.
--
-- Every send still passes the existing 7-step gate (nothing here weakens a
-- guardrail). Idempotent: safe to re-run.
-- ═══════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────
-- 1. Conversations — one thread per (channel, contact), auto-associated.
-- ─────────────────────────────────────────────────────────
create table if not exists comm_conversations (
  id            uuid primary key default gen_random_uuid(),
  channel       text not null check (channel in ('sms','email')),
  -- Normalized contact address on this channel (E.164 phone or lowercased email).
  contact       text not null,
  member_id     uuid references household_members(id) on delete set null,
  household_id  uuid references households(id) on delete set null,
  agency_id     uuid references agency_partnerships(id) on delete set null,
  subject       text,
  status        text not null default 'open' check (status in ('open','snoozed','closed')),
  is_security   boolean not null default false,   -- firewall: never auto-reply
  assigned_user uuid,
  ai_autoreply  boolean not null default false,   -- opt-in per-thread AI auto-reply
  last_message_at   timestamptz,
  last_direction    text check (last_direction in ('inbound','outbound')),
  unread_count  integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (channel, contact)
);

create index if not exists idx_conv_member on comm_conversations(member_id);
create index if not exists idx_conv_household on comm_conversations(household_id);
create index if not exists idx_conv_last on comm_conversations(last_message_at desc);

-- ─────────────────────────────────────────────────────────
-- 2. comm_messages — thread linkage + delivery lifecycle + auto-association.
-- ─────────────────────────────────────────────────────────
alter table comm_messages add column if not exists conversation_id uuid references comm_conversations(id) on delete set null;
alter table comm_messages add column if not exists member_id       uuid references household_members(id) on delete set null;
alter table comm_messages add column if not exists agency_id       uuid references agency_partnerships(id) on delete set null;
alter table comm_messages add column if not exists policy_id       uuid references household_policies(id) on delete set null;
alter table comm_messages add column if not exists subject         text;
alter table comm_messages add column if not exists sender          text;              -- inbound: the sender address
alter table comm_messages add column if not exists provider        text;              -- twilio | resend
alter table comm_messages add column if not exists provider_status text;              -- raw provider status token
alter table comm_messages add column if not exists ai_generated    boolean not null default false;
alter table comm_messages add column if not exists campaign_variant text;             -- A/B variant key this send used
alter table comm_messages add column if not exists sequence_step   integer;           -- drip step index, if any
alter table comm_messages add column if not exists queued_at       timestamptz;
alter table comm_messages add column if not exists sent_at         timestamptz;
alter table comm_messages add column if not exists delivered_at    timestamptz;
alter table comm_messages add column if not exists opened_at       timestamptz;
alter table comm_messages add column if not exists clicked_at      timestamptz;
alter table comm_messages add column if not exists failed_at       timestamptz;
alter table comm_messages add column if not exists error           text;

create index if not exists idx_comm_messages_conversation on comm_messages(conversation_id, created_at);
create index if not exists idx_comm_messages_member on comm_messages(member_id);
create index if not exists idx_comm_messages_provider_id on comm_messages(provider_id);
create index if not exists idx_comm_messages_campaign on comm_messages(campaign_id);

-- delivery_status gains richer lifecycle tokens without dropping the existing check.
do $$
begin
  alter table comm_messages drop constraint if exists comm_messages_delivery_status_check;
exception when others then null;
end $$;
alter table comm_messages
  add constraint comm_messages_delivery_status_check
  check (delivery_status in ('queued','sent','delivered','failed','blocked','received','bounced','complained'));

-- ─────────────────────────────────────────────────────────
-- 3. Per-message event ledger (delivery / open / click / reply tracking).
-- ─────────────────────────────────────────────────────────
create table if not exists comm_message_events (
  id            uuid primary key default gen_random_uuid(),
  message_id    uuid references comm_messages(id) on delete cascade,
  conversation_id uuid references comm_conversations(id) on delete set null,
  campaign_id   uuid references comm_campaigns(id) on delete set null,
  event         text not null check (event in
                  ('queued','sent','delivered','failed','bounced','complained','opened','clicked','replied','unsubscribed')),
  channel       text,
  detail        text,                -- clicked URL, bounce reason, etc.
  provider_id   text,
  created_at    timestamptz not null default now()
);
create index if not exists idx_msg_events_message on comm_message_events(message_id);
create index if not exists idx_msg_events_campaign on comm_message_events(campaign_id, event);
create index if not exists idx_msg_events_kind on comm_message_events(event, created_at desc);

-- ─────────────────────────────────────────────────────────
-- 4. Campaign management — type, A/B variants, drip, personalization, metrics.
-- ─────────────────────────────────────────────────────────
alter table comm_campaigns add column if not exists type          text not null default 'broadcast'
  check (type in ('broadcast','drip'));
alter table comm_campaigns add column if not exists subject        text;                -- email subject (personalizable)
alter table comm_campaigns add column if not exists sequence_id    uuid references comm_sequences(id) on delete set null;
-- A/B variants: [{key, template_id, weight, subject}]. Empty = single-template send.
alter table comm_campaigns add column if not exists variants       jsonb not null default '[]';
alter table comm_campaigns add column if not exists ab_enabled     boolean not null default false;
alter table comm_campaigns add column if not exists metrics        jsonb not null default '{}';
alter table comm_campaigns add column if not exists metrics_at     timestamptz;

alter table comm_campaign_enrollments add column if not exists variant        text;
alter table comm_campaign_enrollments add column if not exists current_step   integer not null default 0;
alter table comm_campaign_enrollments add column if not exists next_send_at   timestamptz;
alter table comm_campaign_enrollments add column if not exists agency_id      uuid references agency_partnerships(id) on delete set null;

create index if not exists idx_enroll_next on comm_campaign_enrollments(next_send_at) where status = 'enrolled';

-- ─────────────────────────────────────────────────────────
-- 5. AI Knowledge Library — documents/FAQs/policies/procedures/templates/business.
--    Indexed with a generated full-text search vector for retrieval.
-- ─────────────────────────────────────────────────────────
create table if not exists knowledge_documents (
  id            uuid primary key default gen_random_uuid(),
  title         text not null,
  kind          text not null default 'document'
                  check (kind in ('document','faq','policy','procedure','template','business_info')),
  category      text,
  summary       text,
  content       text not null default '',
  tags          text[] not null default '{}',
  source        text,                -- upload | manual | import | url
  source_ref    text,                -- document id / url / storage path
  status        text not null default 'published'
                  check (status in ('draft','published','archived')),
  -- Farmers-specific facts stay assumption-flagged (Guardrail 3): renders the
  -- "config default — verify" badge and is surfaced but never asserted as fact.
  is_assumption boolean not null default false,
  visibility    text not null default 'internal' check (visibility in ('internal','client_safe')),
  -- Full-text index over title + summary + content + tags for AI retrieval.
  search_tsv    tsvector generated always as (
                  setweight(to_tsvector('english', coalesce(title,'')), 'A') ||
                  setweight(to_tsvector('english', coalesce(summary,'')), 'B') ||
                  setweight(to_tsvector('english', coalesce(array_to_string(tags,' '),'')), 'B') ||
                  setweight(to_tsvector('english', coalesce(content,'')), 'C')
                ) stored,
  usage_count   integer not null default 0,
  created_by    text,
  updated_by    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists idx_knowledge_tsv on knowledge_documents using gin(search_tsv);
create index if not exists idx_knowledge_kind on knowledge_documents(kind, status);
create index if not exists idx_knowledge_tags on knowledge_documents using gin(tags);

-- Audit which knowledge a given AI run/message actually used (retrieval provenance).
create table if not exists knowledge_citations (
  id            uuid primary key default gen_random_uuid(),
  document_id   uuid references knowledge_documents(id) on delete cascade,
  message_id    uuid references comm_messages(id) on delete set null,
  run_id        uuid,                -- agent_runs.id (no hard FK: run may be pruned)
  rank          real,
  created_at    timestamptz not null default now()
);
create index if not exists idx_kcite_document on knowledge_citations(document_id);

-- ─────────────────────────────────────────────────────────
-- 6. RLS — default-deny; internal staff read/write (writes run under the service
--    role AFTER lib/auth/api gating, same pattern as 010/012/013).
-- ─────────────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array[
    'comm_conversations','comm_message_events','knowledge_documents','knowledge_citations'
  ]
  loop
    execute format('alter table %I enable row level security;', t);
  end loop;
end $$;

drop policy if exists conv_rw on comm_conversations;
create policy conv_rw on comm_conversations for all using (
  is_super() or has_role('compliance') or has_role('supervisor')
  or has_role('fsa') or has_role('licensed_staff') or has_role('admin')
) with check (
  is_super() or has_role('fsa') or has_role('licensed_staff') or has_role('admin')
);

drop policy if exists mevt_read on comm_message_events;
create policy mevt_read on comm_message_events for select using (
  is_super() or has_role('compliance') or has_role('supervisor')
  or has_role('fsa') or has_role('licensed_staff') or has_role('admin')
);

drop policy if exists kd_read on knowledge_documents;
create policy kd_read on knowledge_documents for select using (
  is_super() or has_role('compliance') or has_role('supervisor')
  or has_role('fsa') or has_role('licensed_staff') or has_role('admin') or has_role('ops')
  or (has_role('client') and visibility = 'client_safe' and status = 'published')
);
drop policy if exists kd_write on knowledge_documents;
create policy kd_write on knowledge_documents for all using (
  is_super() or has_role('fsa') or has_role('licensed_staff') or has_role('admin')
) with check (
  is_super() or has_role('fsa') or has_role('licensed_staff') or has_role('admin')
);

drop policy if exists kcite_read on knowledge_citations;
create policy kcite_read on knowledge_citations for select using (
  is_super() or has_role('compliance') or has_role('supervisor')
  or has_role('fsa') or has_role('licensed_staff') or has_role('admin')
);

-- ─────────────────────────────────────────────────────────
-- 7. Conversation analytics view (DB-derived; feeds /app/comms/analytics).
-- ─────────────────────────────────────────────────────────
create or replace view v_campaign_metrics
  with (security_invoker = on) as
select
  c.id                                                              as campaign_id,
  c.name,
  c.channel,
  c.type,
  count(m.*)                                                        as messages,
  count(m.*) filter (where m.delivery_status in ('sent','delivered')) as sent,
  count(m.*) filter (where m.delivery_status = 'delivered')          as delivered,
  count(m.*) filter (where m.delivery_status = 'blocked')            as blocked,
  count(m.*) filter (where m.delivery_status in ('failed','bounced')) as failed,
  count(m.*) filter (where m.opened_at is not null)                  as opened,
  count(m.*) filter (where m.clicked_at is not null)                 as clicked
from comm_campaigns c
left join comm_messages m on m.campaign_id = c.id and m.direction = 'outbound'
where c.archived_at is null
group by c.id, c.name, c.channel, c.type;

-- ─────────────────────────────────────────────────────────
-- 8. AI conversation agent — the green-zone responder that drafts replies to
--    inbound contact messages (every draft still passes the gate before sending).
-- ─────────────────────────────────────────────────────────
insert into ai_agents (key, name, is_guardrail) values
  ('conversation','Conversation Responder', false)
  on conflict (key) do nothing;

-- ─────────────────────────────────────────────────────────
-- 9. Seed the Knowledge Library with clearly-labeled config-default starters.
--    Farmers-specific figures are assumption-flagged (never asserted as fact).
-- ─────────────────────────────────────────────────────────
insert into knowledge_documents (title, kind, category, summary, content, tags, source, status, is_assumption, visibility)
values
  ('FSOS Communication Compliance — quiet hours & consent',
   'policy', 'compliance',
   'Automated SMS/email only sends inside 9am–8pm recipient-local, with valid channel consent, off DNC, using an approved template.',
   'Every automated message passes the 7-step gate in order: (1) valid channel consent on file, (2) within 9:00–20:00 recipient-local quiet hours, (3) not on internal/external DNC, (4) approved template or approved AI policy, (5) no individualized recommendation/call-to-action, (6) not securities-flagged, (7) no other FFS/Farmers/carrier/state/federal block. A blocked send is logged and escalated to the human FSA — never silently dropped, never force-sent.',
   '{compliance,consent,quiet-hours,dnc,gate}', 'manual', 'published', false, 'internal'),
  ('AI green-zone vs red-line',
   'policy', 'compliance',
   'The AI may identify, educate, invite, schedule, remind, follow up, and log. It may never make an individualized product/investment/replacement recommendation or a securities call-to-action.',
   'Green zone (allowed): identify, educate at a category level, invite to a review, schedule, remind, follow up on consented outreach, assemble internal materials, and log. Red line (never): recommend a specific product/policy/investment/allocation/transaction, make a suitability or replacement determination, or issue a securities call-to-action. When a contact asks for advice or a recommendation, escalate to the licensed FSA.',
   '{compliance,ai,green-zone,escalation}', 'manual', 'published', false, 'internal'),
  ('Term conversion — educational overview (config — verify)',
   'faq', 'products',
   'Term policies may have a conversion window during which term coverage can convert to permanent coverage without new underwriting. Windows are carrier-specific — verify.',
   'Educational only: many term life policies include a conversion privilege allowing conversion to a permanent policy without re-qualifying medically, within a defined window. The exact window, eligible products, and deadlines are carrier-specific and NOT publicly standardized — always verify against the carrier and the client''s policy before discussing specifics. This is general education, not a recommendation to convert.',
   '{term-conversion,life,education}', 'manual', 'published', true, 'internal'),
  ('Scheduling a financial review',
   'procedure', 'operations',
   'How the AI invites a consented contact to book a review and hands off to the calendar.',
   'When a consented contact expresses interest in a review: (1) confirm the best contact channel and consent, (2) share the scheduling link or offered times, (3) create/confirm the appointment, (4) send a reminder inside quiet hours, (5) log the activity on the household timeline. Never provide product advice during scheduling — keep it logistical and educational.',
   '{scheduling,review,appointment,procedure}', 'manual', 'published', false, 'internal')
  on conflict do nothing;
