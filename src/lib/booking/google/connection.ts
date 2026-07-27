// Native booking — Google Calendar connection service (Slice 7). Impure DB layer for the
// per-host read-only calendar connection (mig 072). Thin routes call these; persistence +
// audit live here. Reads run service-role AFTER an rbac assertion (RLS is default-deny).
//
// The encrypted credential (secret_enc) is written/read ONLY through the pgcrypto RPCs
// (booking_calendar_set_secret / booking_calendar_secret) with the env-held key. It is
// NEVER selected into a client-facing shape and never logged.

import { getDb } from '@/lib/supabase/client'
import { writeAudit } from '@/lib/audit/log'
import { calendarTokenKey, parseCredential, type CredentialEnvelope } from './oauth'

export type ConnResult<T> =
  | { ok: true; data: T }
  | { ok: false; kind: 'not_found' | 'error'; message: string }

export type ConnectionStatus = 'not_configured' | 'connected' | 'error' | 'revoked'

/** Client-safe connection shape — NEVER carries token material. */
export interface SafeConnection {
  id: string
  status: ConnectionStatus
  googleAccountEmail: string | null
  calendarId: string
  scopes: string[]
  tokenExpiresAt: string | null
  lastSyncedAt: string | null
  lastError: string | null
  connectedAt: string | null
}

// Columns safe to read into any shape — secret_enc is deliberately excluded.
const SAFE_COLUMNS =
  'id, host_user_id, provider, google_account_email, calendar_id, status, scopes, token_expires_at, last_synced_at, last_error, connected_at'

type Row = {
  id: string
  status: ConnectionStatus
  google_account_email: string | null
  calendar_id: string
  scopes: unknown
  token_expires_at: string | null
  last_synced_at: string | null
  last_error: string | null
  connected_at: string | null
}

function toSafe(r: Row): SafeConnection {
  return {
    id: r.id,
    status: r.status,
    googleAccountEmail: r.google_account_email,
    calendarId: r.calendar_id || 'primary',
    scopes: Array.isArray(r.scopes) ? (r.scopes as string[]) : [],
    tokenExpiresAt: r.token_expires_at,
    lastSyncedAt: r.last_synced_at,
    lastError: r.last_error,
    connectedAt: r.connected_at,
  }
}

function hostFilter<Q extends { eq: (c: string, v: string) => Q; is: (c: string, v: null) => Q }>(
  q: Q,
  hostUserId: string | null,
): Q {
  return hostUserId ? q.eq('host_user_id', hostUserId) : q.is('host_user_id', null)
}

/** The active (non-deleted) connection for a host, or null if none. Client-safe shape. */
export async function getConnection(hostUserId: string | null): Promise<ConnResult<SafeConnection | null>> {
  const base = getDb().from('booking_calendar_connections').select(SAFE_COLUMNS).is('deleted_at', null)
  const { data, error } = await hostFilter(base, hostUserId).maybeSingle()
  if (error) return { ok: false, kind: 'error', message: error.message }
  return { ok: true, data: data ? toSafe(data as Row) : null }
}

/** Internal: the active connection's id + calendar for the busy reader (no secret). */
export async function getConnectionRef(
  hostUserId: string | null,
): Promise<ConnResult<{ id: string; calendarId: string; status: ConnectionStatus } | null>> {
  const base = getDb()
    .from('booking_calendar_connections')
    .select('id, calendar_id, status')
    .is('deleted_at', null)
  const { data, error } = await hostFilter(base, hostUserId).maybeSingle()
  if (error) return { ok: false, kind: 'error', message: error.message }
  if (!data) return { ok: true, data: null }
  const row = data as { id: string; calendar_id: string; status: ConnectionStatus }
  return { ok: true, data: { id: row.id, calendarId: row.calendar_id || 'primary', status: row.status } }
}

/** Create-or-update the host's connection row (identity/status/scopes), returning its id.
 *  The encrypted credential is stored separately via storeConnectionSecret. */
export async function upsertConnection(
  actor: string,
  hostUserId: string | null,
  fields: { accountEmail: string | null; calendarId?: string; scopes: string[]; tokenExpiresAt: string | null },
): Promise<ConnResult<{ id: string }>> {
  const db = getDb()
  const existing = await getConnectionRef(hostUserId)
  if (!existing.ok) return existing
  const nowIso = new Date().toISOString()
  const common = {
    google_account_email: fields.accountEmail,
    calendar_id: fields.calendarId || 'primary',
    scopes: fields.scopes,
    token_expires_at: fields.tokenExpiresAt,
    status: 'connected' as ConnectionStatus,
    last_error: null,
    connected_by: actor,
    connected_at: nowIso,
    updated_by: actor,
  }
  if (existing.data) {
    const { error } = await db.from('booking_calendar_connections').update(common).eq('id', existing.data.id)
    if (error) return { ok: false, kind: 'error', message: error.message }
    return { ok: true, data: { id: existing.data.id } }
  }
  const { data, error } = await db
    .from('booking_calendar_connections')
    .insert({ ...common, host_user_id: hostUserId, provider: 'google', created_by: actor })
    .select('id')
    .maybeSingle()
  if (error || !data) return { ok: false, kind: 'error', message: error?.message ?? 'Insert failed.' }
  return { ok: true, data: { id: (data as { id: string }).id } }
}

/** Encrypt + store the credential envelope at rest (pgcrypto). */
export async function storeConnectionSecret(id: string, serialized: string): Promise<ConnResult<{ id: string }>> {
  const { error } = await getDb().rpc('booking_calendar_set_secret', {
    p_id: id,
    p_secret: serialized,
    p_key: calendarTokenKey(),
  })
  if (error) return { ok: false, kind: 'error', message: error.message }
  return { ok: true, data: { id } }
}

/** Decrypt the stored credential (server-only). Returns null if absent/unparseable. */
export async function readConnectionCredential(id: string): Promise<CredentialEnvelope | null> {
  const { data, error } = await getDb().rpc('booking_calendar_secret', { p_id: id, p_key: calendarTokenKey() })
  if (error) return null
  return parseCredential(typeof data === 'string' ? data : null)
}

/** Update status + housekeeping fields (last error/sync/expiry). Never touches the secret. */
export async function markConnectionStatus(
  id: string,
  status: ConnectionStatus,
  extra: { lastError?: string | null; lastSyncedAt?: string | null; tokenExpiresAt?: string | null } = {},
): Promise<void> {
  const patch: Record<string, unknown> = { status }
  if ('lastError' in extra) patch.last_error = extra.lastError ?? null
  if ('lastSyncedAt' in extra) patch.last_synced_at = extra.lastSyncedAt ?? null
  if ('tokenExpiresAt' in extra) patch.token_expires_at = extra.tokenExpiresAt ?? null
  await getDb().from('booking_calendar_connections').update(patch).eq('id', id)
}

/** Disconnect: soft-delete, clear the encrypted secret, mark revoked. Audited. */
export async function disconnectConnection(actor: string, hostUserId: string | null): Promise<ConnResult<{ id: string } | null>> {
  const ref = await getConnectionRef(hostUserId)
  if (!ref.ok) return ref
  if (!ref.data) return { ok: true, data: null }
  const { error } = await getDb()
    .from('booking_calendar_connections')
    .update({ deleted_at: new Date().toISOString(), status: 'revoked', secret_enc: null, updated_by: actor })
    .eq('id', ref.data.id)
  if (error) return { ok: false, kind: 'error', message: error.message }
  await writeAudit({
    actor,
    action: 'config.changed',
    entity: 'booking_calendar_connection',
    entityId: ref.data.id,
    diff: { event: 'calendar.disconnected' },
  })
  return { ok: true, data: { id: ref.data.id } }
}
