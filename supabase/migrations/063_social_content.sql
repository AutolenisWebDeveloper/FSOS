-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: 063_social_content  (Social Content Module — Slice 1, ADR-026)
--
-- There is NO existing Social Engine (repo-wide search confirms only footer icons
-- and the legacy command center match "social"). This is a greenfield module INSIDE
-- FSOS. This slice adds the additive `social_*` family: connected accounts (channels),
-- content + IMMUTABLE approved versions, approvals, schedule entries, an APPEND-ONLY
-- publish log, inbound engagement, and analytics snapshots — plus the DB-level
-- approval gate (only an APPROVED version may be scheduled/published).
--
-- Social is a SEPARATE channel with a SEPARATE publishing path — it does NOT touch
-- lib/comms or /app/comms (SMS/email). Social leads resolve to existing contacts /
-- households (ADR-001) — never a parallel person record; resolved_contact_id is a
-- plain uuid here (the contacts FK + resolution logic land in the engagement slice).
--
-- Additive · idempotent · forward-only. Reuses is_super()/has_role() (mig 010),
-- update_updated_at() (mig 001/012), pgcrypto (mig 009), and the append-only
-- audit_log via app-level writeAudit — no new audit table (CLAUDE.md §6). Guardrails:
-- securities firewall (§4.1) preserved (no securities account/order/holdings columns;
-- content is checked for individualized recommendations at the app layer); OAuth
-- tokens are NEVER stored plaintext — a channel keeps a token_ref pointer and an
-- encrypted secret_enc bytea (pgp_sym_encrypt, app-supplied key), never client-exposed.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Enums (idempotent) ───────────────────────────────────────────────────────
do $$ begin
  create type social_platform as enum (
    'youtube','facebook_page','instagram','linkedin_company','x','tiktok'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type social_channel_status as enum (
    'not_configured','connected','expired','revoked','error'
  );
exception when duplicate_object then null; end $$;

-- The content lifecycle (build instruction §3):
--   DRAFT → IN_REVIEW → APPROVED → SCHEDULED → PUBLISHING → PUBLISHED → FAILED → ARCHIVED
do $$ begin
  create type social_content_status as enum (
    'DRAFT','IN_REVIEW','APPROVED','SCHEDULED','PUBLISHING','PUBLISHED','FAILED','ARCHIVED'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type social_version_status as enum (
    'IN_REVIEW','APPROVED','PUBLISHED','SUPERSEDED'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type social_author_kind as enum ('human','ai');
exception when duplicate_object then null; end $$;

do $$ begin
  create type social_content_type as enum ('text','image','video','link');
exception when duplicate_object then null; end $$;

do $$ begin
  create type social_approval_decision as enum ('approved','changes_requested','rejected');
exception when duplicate_object then null; end $$;

do $$ begin
  create type social_schedule_status as enum (
    'pending','publishing','published','failed','cancelled'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type social_publish_outcome as enum ('success','failure');
exception when duplicate_object then null; end $$;

do $$ begin
  create type social_engagement_type as enum ('comment','mention','reaction','message');
exception when duplicate_object then null; end $$;

-- ── 1. social_channels — a connected platform account ────────────────────────
-- Tokens are NEVER stored in plaintext and NEVER exposed to the browser. A channel
-- keeps a token_ref (a pointer/handle into the server-side secret store) and an
-- encrypted secret_enc bytea (pgcrypto, app-supplied key, DOB precedent). The
-- service layer never selects secret_enc into any client-facing shape.
create table if not exists social_channels (
  id                    uuid primary key default gen_random_uuid(),
  platform              social_platform not null,
  external_account_id   text,
  display_name          text,
  status                social_channel_status not null default 'not_configured',
  token_ref             text,
  secret_enc            bytea,
  token_expires_at      timestamptz,
  scopes                jsonb not null default '[]'::jsonb,
  -- Capability discovery flags (the SocialPublisher.capabilities() contract).
  can_post              boolean not null default false,
  can_read_engagement   boolean not null default false,
  can_read_analytics    boolean not null default false,
  connected_by          text,
  connected_at          timestamptz,
  last_verified_at      timestamptz,
  last_error            text,
  created_by            text,
  updated_by            text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  deleted_at            timestamptz
);
-- One active (non-deleted) channel per platform+account.
create unique index if not exists uq_social_channels_platform_account
  on social_channels(platform, external_account_id) where deleted_at is null and external_account_id is not null;
create index if not exists idx_social_channels_platform on social_channels(platform) where deleted_at is null;
create index if not exists idx_social_channels_status   on social_channels(status)   where deleted_at is null;

-- ── 2. social_content — the editable content item ────────────────────────────
create table if not exists social_content (
  id                 uuid primary key default gen_random_uuid(),
  title              text,
  body               text not null default '',
  content_type       social_content_type not null default 'text',
  -- Target platforms for this content (array of social_platform values as jsonb).
  platforms          jsonb not null default '[]'::jsonb,
  media              jsonb not null default '[]'::jsonb,
  link               text,
  campaign_tag       text,
  topic_tag          text,
  author_kind        social_author_kind not null default 'human',
  status             social_content_status not null default 'DRAFT',
  -- Pointer to the latest frozen version (set once a version is created).
  current_version_id uuid,
  -- A social lead may relate to a household (ADR-001); optional, aggregate-root spine.
  household_id       uuid references households(id) on delete set null,
  -- Securities-firewall marker for content flagged as touching a security topic;
  -- such content is routed to human handling and never AI-auto-processed (§4.1).
  is_security        boolean not null default false,
  created_by         text,
  updated_by         text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  deleted_at         timestamptz
);
create index if not exists idx_social_content_status   on social_content(status)       where deleted_at is null;
create index if not exists idx_social_content_house    on social_content(household_id)  where household_id is not null;
create index if not exists idx_social_content_campaign on social_content(campaign_tag)  where campaign_tag is not null;

-- ── 3. social_content_versions — IMMUTABLE frozen snapshot ───────────────────
-- Approving freezes a version; editing content creates a NEW version. Snapshot
-- columns are immutable; only `status` may change; a PUBLISHED version cannot be
-- deleted (enforced by trigger below).
create table if not exists social_content_versions (
  id            uuid primary key default gen_random_uuid(),
  content_id    uuid not null references social_content(id) on delete cascade,
  version_no    integer not null,
  status        social_version_status not null default 'IN_REVIEW',
  -- Frozen copy of every content field at snapshot time — the record of exactly
  -- what was approved/published.
  snapshot      jsonb not null default '{}'::jsonb,
  created_by    text,
  created_at    timestamptz not null default now(),
  unique (content_id, version_no)
);
create index if not exists idx_social_versions_content on social_content_versions(content_id);
create index if not exists idx_social_versions_status  on social_content_versions(status);

-- ── 4. social_approvals — the approval record (append-only) ──────────────────
create table if not exists social_approvals (
  id          uuid primary key default gen_random_uuid(),
  content_id  uuid not null references social_content(id) on delete cascade,
  version_id  uuid not null references social_content_versions(id) on delete cascade,
  decision    social_approval_decision not null,
  approver    text not null,
  notes       text,
  created_at  timestamptz not null default now()
);
create index if not exists idx_social_approvals_content on social_approvals(content_id);
create index if not exists idx_social_approvals_version on social_approvals(version_id);

-- ── 5. social_schedule_entries — a version queued to a channel ───────────────
-- Only an APPROVED version may be scheduled (DB gate below). idempotency_key makes
-- a scheduled item publish EXACTLY ONCE on the job path.
create table if not exists social_schedule_entries (
  id              uuid primary key default gen_random_uuid(),
  version_id      uuid not null references social_content_versions(id) on delete cascade,
  channel_id      uuid not null references social_channels(id) on delete cascade,
  scheduled_at    timestamptz not null,
  timezone        text not null default 'America/Chicago',
  status          social_schedule_status not null default 'pending',
  idempotency_key text not null,
  attempts        integer not null default 0,
  last_error      text,
  created_by      text,
  updated_by      text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz
);
create unique index if not exists uq_social_schedule_idem on social_schedule_entries(idempotency_key);
create index if not exists idx_social_schedule_status on social_schedule_entries(status)       where deleted_at is null;
create index if not exists idx_social_schedule_due    on social_schedule_entries(scheduled_at) where deleted_at is null;
create index if not exists idx_social_schedule_channel on social_schedule_entries(channel_id)  where deleted_at is null;

-- ── 6. social_publish_log — immutable attempt log ────────────────────────────
create table if not exists social_publish_log (
  id                uuid primary key default gen_random_uuid(),
  schedule_entry_id uuid references social_schedule_entries(id) on delete set null,
  version_id        uuid references social_content_versions(id) on delete set null,
  channel_id        uuid references social_channels(id) on delete set null,
  attempt           integer not null default 1,
  outcome           social_publish_outcome not null,
  platform_post_id  text,
  platform_response jsonb,
  failure_reason    text,
  published_at      timestamptz,
  created_at        timestamptz not null default now()
);
create index if not exists idx_social_publish_schedule on social_publish_log(schedule_entry_id);
create index if not exists idx_social_publish_channel  on social_publish_log(channel_id);

-- ── 7. social_engagement — inbound engagement, resolves to a contact ─────────
-- resolved_contact_id is a plain uuid here (no FK) — the contacts FK + resolution
-- logic land in the engagement slice; contacts (mig 026) is not in the RLS-proof
-- migration set, so a hard FK here would couple this slice to it.
create table if not exists social_engagement (
  id                  uuid primary key default gen_random_uuid(),
  channel_id          uuid references social_channels(id) on delete set null,
  platform            social_platform not null,
  post_ref            text,
  engagement_type     social_engagement_type not null,
  author_handle       text,
  author_platform_id  text,
  body                text,
  received_at         timestamptz not null default now(),
  resolved_contact_id uuid,
  resolution_status   text not null default 'unmatched',
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index if not exists idx_social_engagement_channel  on social_engagement(channel_id);
create index if not exists idx_social_engagement_status   on social_engagement(resolution_status);
create index if not exists idx_social_engagement_contact  on social_engagement(resolved_contact_id) where resolved_contact_id is not null;

-- ── 8. social_analytics_snapshots — platform metrics over time ───────────────
create table if not exists social_analytics_snapshots (
  id          uuid primary key default gen_random_uuid(),
  channel_id  uuid references social_channels(id) on delete cascade,
  platform    social_platform not null,
  post_ref    text,
  metrics     jsonb not null default '{}'::jsonb,
  source      text not null default 'platform',
  captured_at timestamptz not null default now(),
  created_at  timestamptz not null default now()
);
create index if not exists idx_social_analytics_channel on social_analytics_snapshots(channel_id);
create index if not exists idx_social_analytics_captured on social_analytics_snapshots(captured_at);

-- ─────────────────────────────────────────────────────────────────────────────
-- OAuth secret encryption (pgcrypto, app-supplied key — DOB precedent, mig 010).
-- The key is NEVER stored in the DB; the app passes it per-call from env
-- (SOCIAL_TOKEN_KEY). secret_enc is never selected into any client-facing shape.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function social_channel_set_secret(p_channel uuid, p_secret text, p_key text)
returns void language sql volatile security definer as $$
  update social_channels set secret_enc = pgp_sym_encrypt(p_secret, p_key) where id = p_channel;
$$;

create or replace function social_channel_secret(p_channel uuid, p_key text)
returns text language sql stable security definer as $$
  select nullif(pgp_sym_decrypt(secret_enc, p_key), '') from social_channels where id = p_channel;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Approval gate (DB guard): a schedule entry may ONLY reference an APPROVED
-- version. Enforced here in addition to the service layer (build instruction §3,
-- §0.B ERROR severity: publishing unapproved content). Blocks on insert/update.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function social_schedule_require_approved() returns trigger
language plpgsql as $$
declare v_status social_version_status;
begin
  select status into v_status from social_content_versions where id = new.version_id;
  if v_status is null then
    raise exception 'social_schedule_entries: version % does not exist', new.version_id;
  end if;
  if v_status not in ('APPROVED','PUBLISHED') then
    raise exception 'social_schedule_entries: only an APPROVED version may be scheduled (version % is %)', new.version_id, v_status;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_social_schedule_require_approved on social_schedule_entries;
create trigger trg_social_schedule_require_approved
  before insert or update of version_id on social_schedule_entries
  for each row execute function social_schedule_require_approved();

-- ─────────────────────────────────────────────────────────────────────────────
-- Immutability: social_content_versions is a frozen snapshot. Snapshot columns
-- cannot change; only `status` may transition; a PUBLISHED version cannot be
-- deleted (fna_versions precedent, mig 060).
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function social_versions_guard_immutable() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if old.status = 'PUBLISHED' then
      raise exception 'social_content_versions: a PUBLISHED version is immutable and cannot be deleted (id=%)', old.id;
    end if;
    return old;
  end if;
  if new.content_id  is distinct from old.content_id
     or new.version_no is distinct from old.version_no
     or new.snapshot   is distinct from old.snapshot
     or new.created_at is distinct from old.created_at
     or new.created_by is distinct from old.created_by then
    raise exception 'social_content_versions: snapshot columns are immutable (id=%); only status may change', old.id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_social_versions_immutable on social_content_versions;
create trigger trg_social_versions_immutable
  before update or delete on social_content_versions
  for each row execute function social_versions_guard_immutable();

-- ─────────────────────────────────────────────────────────────────────────────
-- Append-only: social_approvals and social_publish_log are records. Block
-- UPDATE/DELETE (audit_log precedent, mig 010).
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function social_append_only_block_mutation() returns trigger
language plpgsql as $$
begin
  raise exception '% is append-only (% not permitted)', tg_table_name, tg_op;
end;
$$;

drop trigger if exists trg_social_approvals_append_only on social_approvals;
create trigger trg_social_approvals_append_only
  before update or delete on social_approvals
  for each row execute function social_append_only_block_mutation();

drop trigger if exists trg_social_publish_log_append_only on social_publish_log;
create trigger trg_social_publish_log_append_only
  before update or delete on social_publish_log
  for each row execute function social_append_only_block_mutation();

-- ── updated_at triggers on mutable tables ────────────────────────────────────
create or replace function update_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array['social_channels','social_content','social_schedule_entries','social_engagement']
  loop
    execute format('drop trigger if exists %I on %I;', 'trg_'||t||'_updated', t);
    execute format('create trigger %I before update on %I for each row execute function update_updated_at();', 'trg_'||t||'_updated', t);
  end loop;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS: every social_* table is BACK-OFFICE only (FSA / licensed_staff / admin /
-- ops / compliance / supervisor / super). No client or partner policy → a client
-- sees ZERO rows (default-deny). service_role bypasses for server-side writes
-- after the app-layer RBAC assertion. secret_enc is additionally never selected.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare
  t text;
  read_roles  text := 'is_super() or has_role(''compliance'') or has_role(''supervisor'') or has_role(''fsa'') or has_role(''licensed_staff'') or has_role(''admin'') or has_role(''ops'')';
  write_roles text := 'is_super() or has_role(''fsa'') or has_role(''licensed_staff'') or has_role(''admin'')';
begin
  foreach t in array array[
    'social_channels','social_content','social_content_versions','social_approvals',
    'social_schedule_entries','social_publish_log','social_engagement','social_analytics_snapshots'
  ]
  loop
    execute format('alter table %I enable row level security;', t);
    execute format('drop policy if exists %I on %I;', t || '_read', t);
    execute format('create policy %I on %I for select using (%s);', t || '_read', t, read_roles);
    execute format('drop policy if exists %I on %I;', t || '_write', t);
    execute format('create policy %I on %I for all using (%s) with check (%s);', t || '_write', t, write_roles, write_roles);
  end loop;
end $$;

comment on table social_channels is 'Connected social platform accounts (ADR-026). Tokens never plaintext: token_ref pointer + encrypted secret_enc; never client-exposed.';
comment on table social_content_versions is 'Immutable frozen content snapshots (ADR-026). Approving freezes a version; edits create a new one.';
comment on table social_publish_log is 'Append-only social publish attempt log (ADR-026).';
