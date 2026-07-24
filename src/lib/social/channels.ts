// Social channels service (ADR-025). Domain logic for connected accounts.
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
