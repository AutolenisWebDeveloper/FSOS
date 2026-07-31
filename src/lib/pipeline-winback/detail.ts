// src/lib/pipeline-winback/detail.ts
// Read-only assembler for the full Pipeline Win-Back campaign detail view (§12). Returns the
// complete campaign configuration, the 24-touch schedule joined to its templates (with approval
// status), and the seeded assets grouped by channel — so the whole campaign is inspectable in
// one place (config, schedule, assets, workflows, analytics, settings, controls). All reads
// through getDb(); no mutation.
import { getDb } from '@/lib/supabase/client'

export interface CampaignFullConfig {
  id: string
  name: string
  status: string
  purpose: string | null
  is_assumption: boolean
  simulated_at: string | null
  daily_enrollment_limit: number
  stale_min_days: number
  reenroll_cooldown_days: number
  resume_cooling_off_days: number
  advisor_due_hours: number
  advisor_overdue_escalate_hours: number
  advisor_reassign_after_hours: number
  conversation_timeout_hours: number
  advisor_hold_behavior: string
  created_at: string
}

export interface TouchDetail {
  touch_no: number
  day_offset: number
  kind: string
  asset_label: string | null
  template: { id: string; name: string; channel: string; approval_status: string } | null
}

export interface AssetTemplate {
  id: string
  name: string
  channel: string
  category: string
  approval_status: string
  body: string
}

export interface CampaignDetail {
  config: CampaignFullConfig
  touches: TouchDetail[]
  assets: AssetTemplate[]
  /** Assets not yet approved — the campaign cannot dispatch these until approved (ADR-023). */
  unapprovedCount: number
}

export async function loadCampaignDetail(campaignId: string): Promise<CampaignDetail | null> {
  const db = getDb()
  const { data: config } = await db
    .from('pipeline_winback_campaigns')
    .select(
      'id, name, status, purpose, is_assumption, simulated_at, daily_enrollment_limit, stale_min_days, reenroll_cooldown_days, resume_cooling_off_days, advisor_due_hours, advisor_overdue_escalate_hours, advisor_reassign_after_hours, conversation_timeout_hours, advisor_hold_behavior, created_at',
    )
    .eq('id', campaignId)
    .maybeSingle()
  if (!config) return null

  const { data: touchRows } = await db
    .from('pipeline_winback_touches')
    .select('touch_no, day_offset, kind, asset_label, template:comm_templates(id, name, channel, approval_status)')
    .eq('campaign_id', campaignId)
    .order('touch_no', { ascending: true })

  // Supabase returns an embedded to-one relation as an object (or array in some typings) — normalize.
  const touches: TouchDetail[] = (touchRows ?? []).map((t) => {
    const raw = (t as { template?: unknown }).template
    const tpl = Array.isArray(raw) ? raw[0] : raw
    return {
      touch_no: t.touch_no as number,
      day_offset: t.day_offset as number,
      kind: t.kind as string,
      asset_label: (t.asset_label as string | null) ?? null,
      template: tpl
        ? {
            id: (tpl as { id: string }).id,
            name: (tpl as { name: string }).name,
            channel: (tpl as { channel: string }).channel,
            approval_status: (tpl as { approval_status: string }).approval_status,
          }
        : null,
    }
  })

  const { data: assetRows } = await db
    .from('comm_templates')
    .select('id, name, channel, category, approval_status, body')
    .in('category', ['pipeline_winback', 'pipeline_winback_ai'])
    .order('category', { ascending: true })
    .order('name', { ascending: true })
  const assets = (assetRows ?? []) as AssetTemplate[]
  const unapprovedCount = assets.filter((a) => a.approval_status !== 'approved').length

  return { config: config as CampaignFullConfig, touches, assets, unapprovedCount }
}
