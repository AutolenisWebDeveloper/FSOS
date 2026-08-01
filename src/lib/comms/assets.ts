// src/lib/comms/assets.ts
// Communications Command Console — cross-campaign asset catalog resolver (spec §B2/§4).
//
// The console lets an operator reuse ANY sendable communication asset from ANY campaign.
// The single source of truth is the read-only `comm_sendable_assets` view (migration 087),
// which normalizes every campaign's touch rows + the standalone template library to one
// shape. This module:
//   • listSendableAssets()   — the picker feed (GET /api/comms/assets), with filters
//   • resolveAssetPayload()  — turn a chosen catalog row into the EXACT renderable +
//                              gate-satisfying payload the production send path consumes
//                              (body/subject + the approved comm_template that satisfies
//                              gate step 4). It NEVER sends — it only resolves content.
//
// A resolved asset carries `templateId` (the approved comm_template render/gate handle);
// the send path re-checks that template's approval at send time, so a draft or archived
// asset simply blocks at the gate rather than here.

import { getDb } from '@/lib/supabase/client'
import { isSendableKind } from './console'

export interface SendableAssetRow {
  asset_id: string
  source_table: string
  campaign_key: string | null
  channel: string | null
  kind: string
  name: string | null
  version: number | null
  category: string | null
  template_id: string | null
  playbook_key: string | null
  approval_status: string | null
}

export interface AssetFilters {
  channel?: 'sms' | 'email' | null
  campaign?: string | null
  /** free-text search over name (case-insensitive). */
  q?: string | null
  limit?: number
}

/** Human labels for the campaign groupings the picker renders (spec §5). */
export const CAMPAIGN_LABELS: Record<string, string> = {
  life_conversion: 'Life Conversion',
  cross_sell_life: 'Cross-Sell Life',
  pipeline_winback: 'Pipeline Win-Back',
  workshops: 'Workshops',
  __library: 'Template Library',
}

/** The stable label for a catalog row's campaign grouping. */
export function campaignLabel(campaignKey: string | null): string {
  return campaignKey ? (CAMPAIGN_LABELS[campaignKey] ?? campaignKey) : CAMPAIGN_LABELS.__library
}

/**
 * List sendable assets from the cross-campaign catalog, filtered by channel/campaign/search.
 * advisor_outreach rows are already excluded by the view; we defensively drop any non-
 * sendable kind too. Returns [] on any error (the picker degrades to empty, never crashes).
 */
export async function listSendableAssets(filters: AssetFilters = {}): Promise<SendableAssetRow[]> {
  try {
    const db = getDb()
    let query = db
      .from('comm_sendable_assets')
      .select('asset_id, source_table, campaign_key, channel, kind, name, version, category, template_id, playbook_key, approval_status')
    if (filters.channel) query = query.eq('channel', filters.channel)
    if (filters.campaign) query = query.eq('campaign_key', filters.campaign)
    if (filters.q && filters.q.trim()) query = query.ilike('name', `%${filters.q.trim()}%`)
    const { data, error } = await query.limit(Math.min(Math.max(filters.limit ?? 500, 1), 1000))
    if (error) return []
    return (data ?? []).filter((r: SendableAssetRow) => isSendableKind(r.kind))
  } catch {
    return []
  }
}

export interface ResolvedAssetPayload {
  assetId: string
  sourceTable: string
  campaignKey: string | null
  kind: string
  channel: 'sms' | 'email'
  /** The approved comm_template that satisfies gate step 4 at send time (render/gate handle). */
  templateId: string | null
  name: string | null
  category: string | null
  approvalStatus: string | null
  /** ai_conversation playbook key (xsell), if any. */
  playbookKey: string | null
  /** The renderable body (template body). */
  body: string
  /** Email plaintext part, if the asset stores one (ADR-025). */
  bodyText: string | null
  /** Email subject if the asset carries one (workshops do; comm_templates do not). */
  subject: string | null
}

/**
 * Resolve a chosen catalog row to its EXACT renderable + gate-satisfying payload. Looks the
 * asset up in the view (authoritative for kind/channel/campaign/template_id), then fetches
 * the render source:
 *   • workshop_message_templates → its own body/subject; gate handle = comm_template_id.
 *   • everything else            → the referenced comm_template's body/body_text; the
 *                                  comm_template id IS the gate handle.
 * Returns null when the asset can't be found or has no renderable body. NEVER sends.
 */
export async function resolveAssetPayload(assetId: string, sourceTable: string): Promise<ResolvedAssetPayload | null> {
  try {
    const db = getDb()
    const { data: row } = await db
      .from('comm_sendable_assets')
      .select('asset_id, source_table, campaign_key, channel, kind, name, version, category, template_id, playbook_key, approval_status')
      .eq('asset_id', assetId)
      .eq('source_table', sourceTable)
      .maybeSingle()
    if (!row) return null
    const r = row as SendableAssetRow

    // Workshop templates carry their own body/subject inline.
    if (r.source_table === 'workshop_message_templates') {
      const { data: wt } = await db
        .from('workshop_message_templates')
        .select('body, subject, channel, comm_template_id, status')
        .eq('id', assetId)
        .maybeSingle()
      if (!wt || !wt.body) return null
      const channel = (wt.channel as 'sms' | 'email') ?? (r.channel as 'sms' | 'email')
      if (channel !== 'sms' && channel !== 'email') return null
      return {
        assetId,
        sourceTable: r.source_table,
        campaignKey: r.campaign_key,
        kind: r.kind,
        channel,
        templateId: wt.comm_template_id ?? null,
        name: r.name,
        category: r.category,
        approvalStatus: wt.status ?? r.approval_status,
        playbookKey: r.playbook_key,
        body: wt.body,
        bodyText: null,
        subject: wt.subject ?? null,
      }
    }

    // Everything else renders from the referenced comm_template.
    if (!r.template_id) return null
    const { data: t } = await db
      .from('comm_templates')
      .select('body, body_text, channel, name, category, approval_status')
      .eq('id', r.template_id)
      .maybeSingle()
    if (!t || !t.body) return null
    const channel = (t.channel as 'sms' | 'email') ?? (r.channel as 'sms' | 'email')
    if (channel !== 'sms' && channel !== 'email') return null
    return {
      assetId,
      sourceTable: r.source_table,
      campaignKey: r.campaign_key,
      kind: r.kind,
      channel,
      templateId: r.template_id,
      name: r.name ?? t.name,
      category: r.category ?? t.category,
      approvalStatus: r.approval_status ?? t.approval_status,
      playbookKey: r.playbook_key,
      body: t.body,
      bodyText: t.body_text ?? null,
      subject: null,
    }
  } catch {
    return null
  }
}

/** Fetch a single ad-hoc/manual approved template id for blank compose on a channel (§5). */
export async function adHocTemplateId(channel: 'sms' | 'email'): Promise<string | null> {
  try {
    const { data } = await getDb()
      .from('comm_templates')
      .select('id')
      .eq('category', 'ad_hoc')
      .eq('channel', channel)
      .is('archived_at', null)
      .eq('approval_status', 'approved')
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle()
    return data?.id ?? null
  } catch {
    return null
  }
}
