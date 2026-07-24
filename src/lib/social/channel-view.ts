// Pure channel view-mapping (ADR-026). No data-access imports so it is unit
// testable in isolation. The critical security property lives here: secret_enc is
// NEVER part of the selected columns or the returned view — token material never
// leaves Postgres and never reaches the browser (build instruction §9).

import { capabilitiesFor, type PublisherCapabilities, type SocialPlatform } from './adapters'

// Explicit column list — NOTE: secret_enc is intentionally ABSENT. We select a
// boolean presence expression (has_credential) instead of the ciphertext.
export const CHANNEL_COLUMNS =
  'id, platform, external_account_id, display_name, status, token_ref, token_expires_at, ' +
  'scopes, can_post, can_read_engagement, can_read_analytics, connected_by, connected_at, ' +
  'last_verified_at, last_error, created_at, updated_at, (secret_enc is not null) as has_credential'

export interface ChannelRow {
  id: string
  platform: SocialPlatform
  external_account_id: string | null
  display_name: string | null
  status: string
  token_ref: string | null
  token_expires_at: string | null
  scopes: string[] | null
  connected_by: string | null
  connected_at: string | null
  last_verified_at: string | null
  last_error: string | null
  has_credential: boolean | null
  created_at: string
  updated_at: string
}

// The safe, client-exposable view of a channel — no secret material.
export interface ChannelView {
  id: string
  platform: SocialPlatform
  external_account_id: string | null
  display_name: string | null
  status: string
  has_credential: boolean
  token_expires_at: string | null
  scopes: string[]
  connected_by: string | null
  connected_at: string | null
  last_verified_at: string | null
  last_error: string | null
  capabilities: PublisherCapabilities
  created_at: string
  updated_at: string
}

export function toChannelView(row: ChannelRow): ChannelView {
  const hasCredential = !!row.has_credential
  const capabilities = capabilitiesFor({
    platform: row.platform,
    externalAccountId: row.external_account_id,
    hasCredential,
    tokenExpiresAt: row.token_expires_at,
  })
  return {
    id: row.id,
    platform: row.platform,
    external_account_id: row.external_account_id,
    display_name: row.display_name,
    status: row.status,
    has_credential: hasCredential,
    token_expires_at: row.token_expires_at,
    scopes: Array.isArray(row.scopes) ? row.scopes : [],
    connected_by: row.connected_by,
    connected_at: row.connected_at,
    last_verified_at: row.last_verified_at,
    last_error: row.last_error,
    capabilities,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}
