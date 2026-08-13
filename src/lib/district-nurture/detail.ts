// src/lib/district-nurture/detail.ts
// Read-only assembler for the full District Agent FS Nurture detail view (ADR-038). Returns
// the campaign config, the 40-touch schedule joined to its templates (with approval status
// and curriculum module), and the seeded assets — so the whole campaign is inspectable in
// one place. All reads through getDb(); no mutation.
import { getDb } from '@/lib/supabase/client'

export interface CampaignFullConfig {
  id: string
  name: string
  status: string
  purpose: string | null
  start_date: string | null
  is_assumption: boolean
  simulated_at: string | null
  daily_enrollment_limit: number
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
  module_no: number | null
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
    .from('district_nurture_campaigns')
    .select(
      'id, name, status, purpose, start_date, is_assumption, simulated_at, daily_enrollment_limit, reenroll_cooldown_days, resume_cooling_off_days, advisor_due_hours, advisor_overdue_escalate_hours, advisor_reassign_after_hours, conversation_timeout_hours, advisor_hold_behavior, created_at',
    )
    .eq('id', campaignId)
    .maybeSingle()
  if (!config) return null

  const { data: touchRows } = await db
    .from('district_nurture_touches')
    .select('touch_no, module_no, day_offset, kind, asset_label, template:comm_templates(id, name, channel, approval_status)')
    .eq('campaign_id', campaignId)
    .order('touch_no', { ascending: true })

  const touches: TouchDetail[] = (touchRows ?? []).map((t) => {
    const raw = (t as { template?: unknown }).template
    const tpl = Array.isArray(raw) ? raw[0] : raw
    return {
      touch_no: t.touch_no as number,
      module_no: (t.module_no as number | null) ?? null,
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
    .in('category', ['district_nurture', 'district_nurture_ai'])
    .order('name', { ascending: true })
  const assets = (assetRows ?? []) as AssetTemplate[]
  const unapprovedCount = assets.filter((a) => a.approval_status !== 'approved').length

  return { config: config as CampaignFullConfig, touches, assets, unapprovedCount }
}
