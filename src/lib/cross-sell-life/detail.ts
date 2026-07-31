// src/lib/cross-sell-life/detail.ts
// Read-only loader for the full Cross-Sell Life Campaign management view (§ Management Interface).
// Pulls the complete campaign configuration + the 35-touch schedule joined to each touch's template
// (name/channel/approval status/body), so the detail page can present configuration, schedule,
// assets, playbooks, advisor scripts, workflows, settings, and controls in one place. Static asset
// definitions (playbooks + advisor scripts) come from the pure modules so the page always matches
// the runner. All reads through getDb().
import { getDb } from '@/lib/supabase/client'
import { PLAYBOOKS } from './playbooks'
import { ADVISOR_SCRIPTS } from './advisor-scripts'

export interface CampaignSettings {
  id: string
  family_key: string
  version: number
  name: string
  description: string | null
  objective: string | null
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
  advisor_hold_behavior: string
  intent_confidence_threshold: number
  send_on_weekends: boolean
  send_on_holidays: boolean
  holiday_calendar: unknown
  resume_behavior: string
  replay_policy: string
  is_assumption: boolean
  simulated_at: string | null
  activated_at: string | null
  archived_at: string | null
  emergency_stopped_at: string | null
  created_by: string | null
  created_at: string
}

export interface TouchDetail {
  touch_no: number
  day_offset: number
  kind: string
  playbook_key: string | null
  asset_label: string | null
  template: { id: string; name: string; channel: string; approval_status: string; body: string } | null
}

export interface CampaignDetail {
  settings: CampaignSettings
  touches: TouchDetail[]
  playbooks: typeof PLAYBOOKS
  advisorScripts: typeof ADVISOR_SCRIPTS
  versions: { id: string; version: number; status: string; created_at: string }[]
}

const SETTINGS_COLUMNS =
  'id, family_key, version, name, description, objective, status, purpose, represented_agency_owner_id, delegation_id, daily_enrollment_limit, reenroll_cooldown_days, resume_cooling_off_days, advisor_due_hours, advisor_overdue_escalate_hours, advisor_reassign_after_hours, conversation_timeout_hours, advisor_hold_behavior, intent_confidence_threshold, send_on_weekends, send_on_holidays, holiday_calendar, resume_behavior, replay_policy, is_assumption, simulated_at, activated_at, archived_at, emergency_stopped_at, created_by, created_at'

export async function loadCampaignDetail(campaignId: string): Promise<CampaignDetail | null> {
  const db = getDb()
  const { data: settings } = await db.from('xsell_life_campaigns').select(SETTINGS_COLUMNS).eq('id', campaignId).maybeSingle()
  if (!settings) return null

  const { data: rows } = await db
    .from('xsell_life_campaign_touches')
    .select('touch_no, day_offset, kind, playbook_key, asset_label, template:template_id (id, name, channel, approval_status, body)')
    .eq('campaign_id', campaignId)
    .order('touch_no', { ascending: true })

  const touches: TouchDetail[] = (rows ?? []).map((r) => {
    const t = r.template as unknown
    const template = Array.isArray(t) ? (t[0] ?? null) : (t ?? null)
    return {
      touch_no: r.touch_no as number,
      day_offset: r.day_offset as number,
      kind: r.kind as string,
      playbook_key: (r.playbook_key as string | null) ?? null,
      asset_label: (r.asset_label as string | null) ?? null,
      template: template as TouchDetail['template'],
    }
  })

  // All versions of this campaign family (§ Audit & Version History).
  const { data: versions } = await db
    .from('xsell_life_campaigns')
    .select('id, version, status, created_at')
    .eq('family_key', (settings as { family_key: string }).family_key)
    .order('version', { ascending: false })

  return {
    settings: settings as unknown as CampaignSettings,
    touches,
    playbooks: PLAYBOOKS,
    advisorScripts: ADVISOR_SCRIPTS,
    versions: (versions ?? []) as CampaignDetail['versions'],
  }
}
