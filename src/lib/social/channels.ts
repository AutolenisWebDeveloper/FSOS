// Social channels service (ADR-026). Domain logic for connected accounts.
//
// Thin routes call these; getDb() is resolved INSIDE each function (never at module
// level). Audit is written by the route (single writeAudit path), not here.
//
// SECURITY: secret_enc (the encrypted OAuth material) is NEVER selected into any
// returned shape — the service only ever exposes a token_ref pointer, expiry, and
// capability flags. Token material never reaches the browser (build instruction §9).

import { getDb } from '@/lib/supabase/client'
import { CHANNEL_COLUMNS, toChannelView, type ChannelRow, type ChannelView } from './channel-view'
import type { ChannelConnect, ChannelUpdate } from './schema'
import { socialTokenKey } from './secrets'
import { platformSupport, type SocialPlatform } from './adapters'
import type { OAuthPlatform } from './oauth'

export { CHANNEL_COLUMNS, toChannelView }
export type { ChannelRow, ChannelView }

export type StoreResult<T> =
  | { ok: true; data: T }
  | { ok: false; kind: 'not_found' | 'invalid' | 'error'; message: string }

export async function listChannels(): Promise<StoreResult<ChannelView[]>> {
  const { data, error } = await getDb()
    .from('social_channels')
    .select(CHANNEL_COLUMNS)
    .is('deleted_at', null)
    .order('platform', { ascending: true })
  if (error) return { ok: false, kind: 'error', message: error.message }
  return { ok: true, data: (data as unknown as ChannelRow[]).map(toChannelView) }
}

export async function getChannel(id: string): Promise<StoreResult<ChannelView>> {
  const { data, error } = await getDb()
    .from('social_channels')
    .select(CHANNEL_COLUMNS)
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle()
  if (error) return { ok: false, kind: 'error', message: error.message }
  if (!data) return { ok: false, kind: 'not_found', message: 'Channel not found' }
  return { ok: true, data: toChannelView(data as unknown as ChannelRow) }
}

export async function connectChannel(
  input: ChannelConnect,
  actor: string,
): Promise<StoreResult<ChannelView>> {
  // Slice 1 registers the account; live OAuth (which populates secret_enc via the
  // social_channel_set_secret RPC) lands with each platform's activation slice.
  // Until a credential is stored the channel is deliberately not_configured.
  const { data, error } = await getDb()
    .from('social_channels')
    .insert({
      platform: input.platform,
      external_account_id: input.external_account_id ?? null,
      display_name: input.display_name ?? null,
      scopes: input.scopes ?? [],
      status: 'not_configured',
      connected_by: actor,
      created_by: actor,
      updated_by: actor,
    })
    .select(CHANNEL_COLUMNS)
    .maybeSingle()
  if (error) return { ok: false, kind: 'error', message: error.message }
  if (!data) return { ok: false, kind: 'error', message: 'Failed to register channel' }
  return { ok: true, data: toChannelView(data as unknown as ChannelRow) }
}

export async function updateChannel(
  id: string,
  input: ChannelUpdate,
  actor: string,
): Promise<StoreResult<ChannelView>> {
  const patch: Record<string, unknown> = { updated_by: actor }
  if (input.display_name !== undefined) patch.display_name = input.display_name
  if (input.status !== undefined) patch.status = input.status
  if (input.scopes !== undefined) patch.scopes = input.scopes
  if (input.can_post !== undefined) patch.can_post = input.can_post
  if (input.can_read_engagement !== undefined) patch.can_read_engagement = input.can_read_engagement
  if (input.can_read_analytics !== undefined) patch.can_read_analytics = input.can_read_analytics

  const { data, error } = await getDb()
    .from('social_channels')
    .update(patch)
    .eq('id', id)
    .is('deleted_at', null)
    .select(CHANNEL_COLUMNS)
    .maybeSingle()
  if (error) return { ok: false, kind: 'error', message: error.message }
  if (!data) return { ok: false, kind: 'not_found', message: 'Channel not found' }
  return { ok: true, data: toChannelView(data as unknown as ChannelRow) }
}

// ── OAuth connect path (ADR-026) ─────────────────────────────────────────────
// Store the encrypted credential via the pgcrypto RPC. The plaintext secret is
// passed straight into Postgres and encrypted there — it is never written to a
// column the service selects and never returned to any caller.
export async function storeChannelSecret(channelId: string, secretText: string): Promise<StoreResult<{ id: string }>> {
  const { error } = await getDb().rpc('social_channel_set_secret', {
    p_channel: channelId,
    p_secret: secretText,
    p_key: socialTokenKey(),
  })
  if (error) return { ok: false, kind: 'error', message: error.message }
  return { ok: true, data: { id: channelId } }
}

export interface OAuthUpsert {
  platform: OAuthPlatform
  externalAccountId: string
  displayName: string | null
  scopes: string[]
  tokenExpiresAt: string | null
}

// Create-or-reactivate the channel row for a completed OAuth connection. Idempotent
// on (platform, external_account_id): reconnecting the same account updates it in
// place rather than spawning a duplicate. Capability flags are seeded from the
// platform's static API support. Returns the id only — never the secret.
export async function upsertConnectedChannel(input: OAuthUpsert, actor: string): Promise<StoreResult<{ id: string }>> {
  const db = getDb()
  const support = platformSupport(input.platform as SocialPlatform)
  const nowIso = new Date().toISOString()
  const base = {
    platform: input.platform,
    external_account_id: input.externalAccountId,
    display_name: input.displayName,
    scopes: input.scopes,
    status: 'connected' as const,
    token_ref: `pgcrypto:${input.platform}`,
    token_expires_at: input.tokenExpiresAt,
    can_post: support.canPost,
    can_read_engagement: support.canReadEngagement,
    can_read_analytics: support.canReadAnalytics,
    connected_by: actor,
    connected_at: nowIso,
    last_verified_at: nowIso,
    last_error: null as string | null,
    deleted_at: null as string | null,
    updated_by: actor,
  }

  // Reconnect resolves to a single row: prefer a live (non-deleted) row, else the
  // most recent soft-deleted one (reactivated by base.deleted_at = null). Ordering
  // avoids maybeSingle() throwing when several soft-deleted rows share the account.
  const { data: matches, error: findErr } = await db
    .from('social_channels')
    .select('id')
    .eq('platform', input.platform)
    .eq('external_account_id', input.externalAccountId)
    .order('deleted_at', { ascending: true, nullsFirst: true })
    .order('created_at', { ascending: false })
    .limit(1)
  if (findErr) return { ok: false, kind: 'error', message: findErr.message }
  const existing = Array.isArray(matches) && matches.length > 0 ? (matches[0] as { id: string }) : null

  if (existing) {
    const { data, error } = await db
      .from('social_channels')
      .update(base)
      .eq('id', existing.id)
      .select('id')
      .maybeSingle()
    if (error) return { ok: false, kind: 'error', message: error.message }
    return { ok: true, data: { id: (data as { id: string }).id } }
  }

  const { data, error } = await db
    .from('social_channels')
    .insert({ ...base, created_by: actor })
    .select('id')
    .maybeSingle()
  if (error) return { ok: false, kind: 'error', message: error.message }
  if (!data) return { ok: false, kind: 'error', message: 'Failed to connect channel' }
  return { ok: true, data: { id: (data as { id: string }).id } }
}

// Server-only credential context for health checks / refresh. Decrypts the secret
// via the pgcrypto RPC; the returned value is used in-process and never serialized
// to a client response.
export interface ChannelSecretContext {
  id: string
  platform: SocialPlatform
  externalAccountId: string | null
  tokenExpiresAt: string | null
  secret: string | null
}

export async function readChannelSecretContext(id: string): Promise<StoreResult<ChannelSecretContext>> {
  const db = getDb()
  const { data, error } = await db
    .from('social_channels')
    .select('id, platform, external_account_id, token_expires_at')
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle()
  if (error) return { ok: false, kind: 'error', message: error.message }
  if (!data) return { ok: false, kind: 'not_found', message: 'Channel not found' }
  const row = data as { id: string; platform: SocialPlatform; external_account_id: string | null; token_expires_at: string | null }
  const { data: secret } = await db.rpc('social_channel_secret', { p_channel: id, p_key: socialTokenKey() })
  return {
    ok: true,
    data: {
      id: row.id,
      platform: row.platform,
      externalAccountId: row.external_account_id,
      tokenExpiresAt: row.token_expires_at,
      secret: (secret as string | null) ?? null,
    },
  }
}

export interface ChannelHealthPatch {
  status: 'connected' | 'expired' | 'error'
  lastError: string | null
  displayName?: string | null
  tokenExpiresAt?: string | null
}

export async function markChannelHealth(id: string, patch: ChannelHealthPatch, actor: string): Promise<StoreResult<ChannelView>> {
  const update: Record<string, unknown> = {
    status: patch.status,
    last_error: patch.lastError,
    last_verified_at: new Date().toISOString(),
    updated_by: actor,
  }
  if (patch.displayName !== undefined) update.display_name = patch.displayName
  if (patch.tokenExpiresAt !== undefined) update.token_expires_at = patch.tokenExpiresAt
  const { data, error } = await getDb()
    .from('social_channels')
    .update(update)
    .eq('id', id)
    .is('deleted_at', null)
    .select(CHANNEL_COLUMNS)
    .maybeSingle()
  if (error) return { ok: false, kind: 'error', message: error.message }
  if (!data) return { ok: false, kind: 'not_found', message: 'Channel not found' }
  return { ok: true, data: toChannelView(data as unknown as ChannelRow) }
}

export async function disconnectChannel(id: string, actor: string): Promise<StoreResult<{ id: string }>> {
  const nowIso = new Date().toISOString()
  const { data, error } = await getDb()
    .from('social_channels')
    .update({ status: 'revoked', deleted_at: nowIso, updated_by: actor })
    .eq('id', id)
    .is('deleted_at', null)
    .select('id')
    .maybeSingle()
  if (error) return { ok: false, kind: 'error', message: error.message }
  if (!data) return { ok: false, kind: 'not_found', message: 'Channel not found' }
  return { ok: true, data: { id: (data as { id: string }).id } }
}
