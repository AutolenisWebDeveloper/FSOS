// src/lib/life-campaign/detail.ts
// Read-only loader for the full Life Conversion Campaign detail view (§4b/§5/§14/§15). Pulls
// the complete campaign configuration, the 20-touch schedule joined to each touch's template
// (name/channel/approval status/body), so the detail page can present configuration, schedule,
// assets, workflows, settings, and controls in one place. All reads through getDb().
import { getDb } from '@/lib/supabase/client'
import { PLAYBOOKS, ADVISOR_SCRIPTS } from './playbooks'

export interface CampaignSettings {
  id: string
  name: string
  status: string
  purpose: string | null
  represented_agency_owner_id: string | null
  delegation_id: string | null
  daily_enrollment_limit: number
  reenroll_cooldown_days: number
  resume_cooling_off_days: number
  advisor_due_hours: number
  advisor_overdue_escalate_hours: number
  advisor_reassign_after_hours: number
  conversation_timeout_hours: number
  early_enrollment_buffer_days: number
  advisor_hold_behavior: string
  is_assumption: boolean
  simulated_at: string | null
  created_by: string | null
  created_at: string
}

export interface TouchDetail {
  touch_no: number
  day_offset: number
  kind: string
  asset_label: string | null
  template: { id: string; name: string; channel: string; approval_status: string; body: string } | null
}

export interface CampaignDetail {
  settings: CampaignSettings
  touches: TouchDetail[]
  /** Static AI-conversation playbooks + advisor scripts, from the pure module so the
   *  page always matches what the engine actually grounds on. */
  playbooks: typeof PLAYBOOKS
  advisorScripts: typeof ADVISOR_SCRIPTS
}

const SETTINGS_COLUMNS =
  'id, name, status, purpose, represented_agency_owner_id, delegation_id, daily_enrollment_limit, reenroll_cooldown_days, resume_cooling_off_days, advisor_due_hours, advisor_overdue_escalate_hours, advisor_reassign_after_hours, conversation_timeout_hours, early_enrollment_buffer_days, advisor_hold_behavior, is_assumption, simulated_at, created_by, created_at'

export async function loadCampaignDetail(campaignId: string): Promise<CampaignDetail | null> {
  const db = getDb()
  const { data: settings } = await db.from('life_campaigns').select(SETTINGS_COLUMNS).eq('id', campaignId).maybeSingle()
  if (!settings) return null

  const { data: rows } = await db
    .from('life_campaign_touches')
    .select('touch_no, day_offset, kind, asset_label, template:template_id (id, name, channel, approval_status, body)')
    .eq('campaign_id', campaignId)
    .order('touch_no', { ascending: true })

  const touches: TouchDetail[] = (rows ?? []).map((r) => {
    // PostgREST returns an embedded to-one as an object (or null); normalize defensively.
    const t = r.template as unknown
    const template = Array.isArray(t) ? (t[0] ?? null) : (t ?? null)
    return {
      touch_no: r.touch_no as number,
      day_offset: r.day_offset as number,
      kind: r.kind as string,
      asset_label: (r.asset_label as string | null) ?? null,
      template: template as TouchDetail['template'],
    }
  })

  return {
    settings: settings as unknown as CampaignSettings,
    touches,
    playbooks: PLAYBOOKS,
    advisorScripts: ADVISOR_SCRIPTS,
  }
}
