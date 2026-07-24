-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: 068_social_media_library  (ADR-026, operational depth item 2)
--
-- Reusable image/video assets for social posts. Files live in the EXISTING private
-- `documents` storage bucket (never a public bucket) under social-media/; this table
-- holds only metadata + a storage_ref path. Signed URLs are minted on demand at read
-- time — an asset URL is never persisted or exposed publicly. Additive · idempotent ·
-- forward-only. Reuses is_super()/has_role() (mig 010) + update_updated_at() and the
-- social_* RLS shape (mig 063). Back-office only (no client/partner policy → default-deny).
-- ─────────────────────────────────────────────────────────────────────────────

do $$ begin
  create type social_media_kind as enum ('image', 'video');
exception when duplicate_object then null; end $$;

create table if not exists social_media_assets (
  id               uuid primary key default gen_random_uuid(),
  kind             social_media_kind not null,
  -- Path inside the private `documents` bucket (e.g. social-media/2026/uuid-name.png).
  storage_ref      text not null,
  file_name        text not null,
  mime_type        text not null,
  byte_size        bigint not null default 0,
  width            integer,
  height           integer,
  duration_seconds numeric,                 -- video only
  alt_text         text,
  usage_count      integer not null default 0,
  uploaded_by      text,
  created_by       text,
  updated_by       text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz
);
create index if not exists idx_social_media_kind    on social_media_assets(kind)       where deleted_at is null;
create index if not exists idx_social_media_created on social_media_assets(created_at)  where deleted_at is null;

-- Atomic usage-count bump so concurrent references don't lose increments.
create or replace function social_media_increment_usage(p_id uuid, p_delta integer default 1)
returns integer language sql volatile security definer as $$
  update social_media_assets
     set usage_count = greatest(0, usage_count + p_delta)
   where id = p_id and deleted_at is null
  returning usage_count;
$$;

-- updated_at trigger (reuse the shared function; create if absent).
create or replace function update_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

drop trigger if exists trg_social_media_assets_updated on social_media_assets;
create trigger trg_social_media_assets_updated
  before update on social_media_assets
  for each row execute function update_updated_at();

-- RLS: back-office only (same role shape as the other social_* tables, mig 063).
do $$
declare
  read_roles  text := 'is_super() or has_role(''compliance'') or has_role(''supervisor'') or has_role(''fsa'') or has_role(''licensed_staff'') or has_role(''admin'') or has_role(''ops'')';
  write_roles text := 'is_super() or has_role(''fsa'') or has_role(''licensed_staff'') or has_role(''admin'')';
begin
  execute 'alter table social_media_assets enable row level security';
  execute 'drop policy if exists social_media_assets_read on social_media_assets';
  execute format('create policy social_media_assets_read on social_media_assets for select using (%s)', read_roles);
  execute 'drop policy if exists social_media_assets_write on social_media_assets';
  execute format('create policy social_media_assets_write on social_media_assets for all using (%s) with check (%s)', write_roles, write_roles);
end $$;

comment on table social_media_assets is 'Reusable social image/video assets (ADR-026). File in the private documents bucket (storage_ref); signed URLs minted on demand, never public. Back-office RLS.';
