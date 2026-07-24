// src/lib/comms/campaign-config.ts
// Slice 7 (§15/§16) — Campaign + sequence builder config, PURE.
//
// The builder now stores the gate-relevant config that earlier slices deferred (ADR-021):
// a message `purpose` (§9/§10) and an optional delegated-sender pairing
// (represented agency owner + the delegation that authorizes the on-behalf-of send, §7).
// This module maps a stored campaign/sequence row → the SendContext pieces the gate reads,
// with NO DB and NO clock — so it is unit-tested offline. The DB resolution of the actual
// delegation row happens in dispatch (ownership.ts); this module only decides *whether* a
// campaign is delegated and assembles the ctx from already-resolved pieces.
//
// Default-permissive: a campaign with no purpose / no delegation returns undefined for those
// fields, so an existing campaign dispatches exactly as before (the gate steps are no-ops).
import { MESSAGE_PURPOSES, type MessagePurpose } from './purpose'

/** The subset of a campaign row this module reads (kept loose — callers pass the DB row). */
export interface CampaignConfigRow {
  purpose?: string | null
  delegation_id?: string | null
  represented_agency_owner_id?: string | null
}

export interface CampaignSendConfig {
  /** A valid stored MessagePurpose, or undefined (unknown/absent → no purpose governance). */
  purpose?: MessagePurpose
  /** True only when BOTH a delegation and a represented agency owner are configured. */
  delegated: boolean
  delegationId?: string
  representedAgencyOwnerId?: string
}

function coercePurpose(value: unknown): MessagePurpose | undefined {
  return typeof value === 'string' && (MESSAGE_PURPOSES as string[]).includes(value)
    ? (value as MessagePurpose)
    : undefined
}

/**
 * Map a stored campaign row to the gate-relevant send config. A partially-configured
 * delegation (only one of the two fields) is NOT treated as delegated — the send stays a
 * plain (non-on-behalf-of) send rather than acting on incomplete authority.
 */
export function campaignSendConfig(row: CampaignConfigRow): CampaignSendConfig {
  const delegationId = row.delegation_id || undefined
  const representedAgencyOwnerId = row.represented_agency_owner_id || undefined
  const delegated = Boolean(delegationId && representedAgencyOwnerId)
  return {
    purpose: coercePurpose(row.purpose),
    delegated,
    delegationId: delegated ? delegationId : undefined,
    representedAgencyOwnerId: delegated ? representedAgencyOwnerId : undefined,
  }
}

export interface DelegatedConfigInput {
  delegationId?: string | null
  representedAgencyOwnerId?: string | null
}
export type DelegatedConfigResult = { ok: true } | { ok: false; error: string }

/**
 * Create-time validation: a delegation and a represented owner must be set TOGETHER.
 * You cannot claim to send on behalf of an owner with no authorizing delegation, and a
 * delegation with no named represented owner is meaningless. No delegation at all is fine.
 */
export function validateDelegatedConfig(input: DelegatedConfigInput): DelegatedConfigResult {
  const hasDelegation = Boolean(input.delegationId)
  const hasOwner = Boolean(input.representedAgencyOwnerId)
  if (hasDelegation && !hasOwner) return { ok: false, error: 'represented_agency_owner_required' }
  if (hasOwner && !hasDelegation) return { ok: false, error: 'delegation_required' }
  return { ok: true }
}

/** A delegation row after DB resolution (dispatch supplies this from ownership.ts). */
export interface ResolvedDelegation {
  agencyId: string
  representativeUserId: string | null
  representedAgencyOwnerId: string | null
  delegationId: string
}

/**
 * Assemble the SendContext delegation + ownership pieces from a resolved delegation row.
 * Keeps the ACTUAL sender (senderUserId) and the REPRESENTED party (agency / owner) on
 * distinct fields — never one ambiguous "sender" field (§7, ADR-015).
 */
export function delegationSendContext(
  resolved: ResolvedDelegation,
  opts: { campaignType?: string | null } = {},
): {
  delegation: { agencyId: string; campaignType?: string | null; senderUserId?: string | null }
  ownership: { representedAgencyId: string; representedAgencyOwnerId: string | null; delegationId: string }
} {
  return {
    delegation: {
      agencyId: resolved.agencyId,
      campaignType: opts.campaignType ?? null,
      senderUserId: resolved.representativeUserId,
    },
    ownership: {
      representedAgencyId: resolved.agencyId,
      representedAgencyOwnerId: resolved.representedAgencyOwnerId,
      delegationId: resolved.delegationId,
    },
  }
}
