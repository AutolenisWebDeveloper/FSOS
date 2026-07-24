// Social media asset service (ADR-026, item 2). Domain logic for the reusable-asset
// library. Files live in the EXISTING private `documents` bucket (never public); this
// layer stores metadata + a storage_ref and mints short-lived signed URLs on demand.
// Thin routes call these; getDb() resolves inside each function; audit is written by
// the route. secret/URL material is never persisted — a preview URL is always fresh.

import { getDb, ConfigError } from '@/lib/supabase/client'
import { platformCompatibility, type MediaKind } from './media'
import type { SocialPlatform } from './adapters/types'

const BUCKET = 'documents'
const PREFIX = 'social-media'
const SIGNED_TTL_SECONDS = 60 * 60

export const MEDIA_COLUMNS =
  'id, kind, storage_ref, file_name, mime_type, byte_size, width, height, duration_seconds, alt_text, usage_count, uploaded_by, created_at, updated_at'

export interface MediaAssetRow {
  id: string
  kind: MediaKind
  storage_ref: string
  file_name: string
  mime_type: string
  byte_size: number
  width: number | null
  height: number | null
  duration_seconds: number | null
  alt_text: string | null
  usage_count: number
  uploaded_by: string | null
  created_at: string
  updated_at: string
}

// Client-safe view: NO storage_ref path is exposed as a raw value the browser could
// reuse — only a freshly-minted, short-lived signed preview URL and derived compat.
export interface MediaAssetView {
  id: string
  kind: MediaKind
  file_name: string
  mime_type: string
  byte_size: number
  width: number | null
  height: number | null
  duration_seconds: number | null
  alt_text: string | null
  usage_count: number
  uploaded_by: string | null
  created_at: string
  compatibility: SocialPlatform[]
  preview_url: string | null
}

export type MediaResult<T> =
  | { ok: true; data: T }
  | { ok: false; kind: 'not_found' | 'invalid' | 'error' | 'not_configured'; message: string }

export function storagePathFor(fileName: string): string {
  const safe = (fileName || 'asset').replace(/[^a-z0-9._-]/gi, '_').slice(0, 120)
  // No Math.random/Date collision concerns beyond practical uniqueness here.
  return `${PREFIX}/${Date.now()}-${safe}`
}

export async function uploadMediaBuffer(path: string, buffer: Buffer, contentType: string): Promise<{ ok: boolean; message?: string }> {
  const { error } = await getDb()
    .storage.from(BUCKET)
    .upload(path, buffer, { contentType: contentType || 'application/octet-stream', upsert: false })
  if (error) return { ok: false, message: error.message }
  return { ok: true }
}

export async function signMediaUrl(path: string | null): Promise<string | null> {
  if (!path) return null
  const { data } = await getDb().storage.from(BUCKET).createSignedUrl(path, SIGNED_TTL_SECONDS)
  return data?.signedUrl ?? null
}

function compatOf(row: MediaAssetRow): SocialPlatform[] {
  return platformCompatibility({
    kind: row.kind,
    mime: row.mime_type,
    byteSize: row.byte_size,
    width: row.width,
    height: row.height,
    durationSeconds: row.duration_seconds,
  })
}

async function toView(row: MediaAssetRow): Promise<MediaAssetView> {
  const preview_url = await signMediaUrl(row.storage_ref)
  const { storage_ref: _omit, updated_at: _u, ...rest } = row
  void _omit
  void _u
  return { ...rest, compatibility: compatOf(row), preview_url }
}

export interface CreateMediaInput {
  kind: MediaKind
  storage_ref: string
  file_name: string
  mime_type: string
  byte_size: number
  width: number | null
  height: number | null
  duration_seconds: number | null
  alt_text: string | null
}

export async function createMediaAsset(input: CreateMediaInput, actor: string): Promise<MediaResult<MediaAssetView>> {
  const { data, error } = await getDb()
    .from('social_media_assets')
    .insert({ ...input, uploaded_by: actor, created_by: actor, updated_by: actor })
    .select(MEDIA_COLUMNS)
    .maybeSingle()
  if (error) return { ok: false, kind: 'error', message: error.message }
  if (!data) return { ok: false, kind: 'error', message: 'Failed to save the asset' }
  return { ok: true, data: await toView(data as unknown as MediaAssetRow) }
}

export async function listMediaAssets(opts: { kind?: MediaKind } = {}): Promise<MediaResult<MediaAssetView[]>> {
  try {
    let q = getDb().from('social_media_assets').select(MEDIA_COLUMNS).is('deleted_at', null)
    if (opts.kind) q = q.eq('kind', opts.kind)
    const { data, error } = await q.order('created_at', { ascending: false }).limit(200)
    if (error) return { ok: false, kind: 'error', message: error.message }
    const rows = (data ?? []) as unknown as MediaAssetRow[]
    const views = await Promise.all(rows.map(toView))
    return { ok: true, data: views }
  } catch (e) {
    if (e instanceof ConfigError) return { ok: false, kind: 'not_configured', message: e.message }
    throw e
  }
}

export async function getMediaAsset(id: string): Promise<MediaResult<MediaAssetView>> {
  const { data, error } = await getDb().from('social_media_assets').select(MEDIA_COLUMNS).eq('id', id).is('deleted_at', null).maybeSingle()
  if (error) return { ok: false, kind: 'error', message: error.message }
  if (!data) return { ok: false, kind: 'not_found', message: 'Asset not found' }
  return { ok: true, data: await toView(data as unknown as MediaAssetRow) }
}

export async function softDeleteMediaAsset(id: string, actor: string): Promise<MediaResult<{ id: string }>> {
  const { data, error } = await getDb()
    .from('social_media_assets')
    .update({ deleted_at: new Date().toISOString(), updated_by: actor })
    .eq('id', id)
    .is('deleted_at', null)
    .select('id')
    .maybeSingle()
  if (error) return { ok: false, kind: 'error', message: error.message }
  if (!data) return { ok: false, kind: 'not_found', message: 'Asset not found' }
  return { ok: true, data: { id: (data as { id: string }).id } }
}

/** Atomic usage bump via the migration-068 RPC (+1 on attach, -1 on detach). */
export async function incrementMediaUsage(id: string, delta = 1): Promise<void> {
  await getDb().rpc('social_media_increment_usage', { p_id: id, p_delta: delta })
}
