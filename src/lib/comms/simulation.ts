// src/lib/comms/simulation.ts
// Slice 6 (§14) — Simulation mode (DB-backed, READ-ONLY). Master build instruction §14.
//
// A SAFE dry-run of a campaign that NEVER calls Twilio/Resend and writes no messages: it
// resolves the audience, computes the SAME gate inputs the real send uses (consent, DNC,
// quiet hours, template approval, securities), runs the pure gate per contact, renders
// the body, and returns a per-contact report (would-send vs excluded + exact reason) +
// summary. Required before a campaign can be activated (activate API checks simulated_at).
// Reuses the audience resolver + gate — no duplicate send logic, no side effects.

import { getDb } from '@/lib/supabase/client'
import { evaluateGate } from './gate'
import { resolveAudience, templateBody } from './campaign'
import { isTemplateApproved } from './send'
import { personalize } from './personalize'
import { loadHoursPolicy, isWithinOperatingHours } from './hours'
import { conversationIsSecurity, normalizeContact } from './conversations'
import { verdictFromGate, summarizeSimulation, type SimulationEntry, type SimulationSummary } from './simulation-core'

const DEFAULT_UTC_OFFSET = -6
function recipientLocalHour(): number {
  return (new Date().getUTCHours() + DEFAULT_UTC_OFFSET + 24) % 24
}

async function memberConsentGranted(memberId: string, channel: 'sms' | 'email'): Promise<boolean> {
  try {
    const { data } = await getDb().from('consents').select('status').eq('member_id', memberId).eq('channel', channel).maybeSingle()
    return data?.status === 'granted'
  } catch {
    return false
  }
}
async function onDnc(to: string, channel: 'sms' | 'email'): Promise<boolean> {
  try {
    const { data } = await getDb().from('dnc_entries').select('id').eq('contact', to).in('channel', [channel, 'all']).limit(1)
    return Array.isArray(data) && data.length > 0
  } catch {
    return true // fail safe: unknown DNC → treat as suppressed in the preview
  }
}

export interface SimulationReport {
  campaignId: string
  channel: 'sms' | 'email'
  simulatedAt: string
  summary: SimulationSummary
  /** Capped sample of per-contact entries for the preview UI (full counts are in summary). */
  entries: SimulationEntry[]
}

/**
 * Run a read-only simulation of a campaign (§14). Never calls a provider or writes a
 * message. Returns the per-contact would-send/excluded verdict + summary; the caller
 * (simulate API) persists comm_campaigns.simulated_at + the summary.
 */
export async function simulateCampaign(campaignId: string, sampleLimit = 200): Promise<SimulationReport | { error: string }> {
  const db = getDb()
  const { data: campaign } = await db.from('comm_campaigns').select('*').eq('id', campaignId).maybeSingle()
  if (!campaign) return { error: 'Campaign not found' }
  const channel = (campaign.channel as 'sms' | 'email') ?? 'email'
  const templateId: string | null = campaign.template_id ?? null

  const [templateApproved, body, hoursPolicy] = await Promise.all([
    isTemplateApproved(templateId),
    templateId ? templateBody(templateId) : Promise.resolve(''),
    loadHoursPolicy(),
  ])
  const withinBusinessHours = await isWithinOperatingHours(hoursPolicy)
  const localHour = recipientLocalHour()

  const audience = await resolveAudience({ channel, audience: campaign.audience ?? {} })
  const entries: SimulationEntry[] = []
  let audienceCount = 0
  const fullEntries: SimulationEntry[] = []

  for (const r of audience) {
    audienceCount++
    const to = normalizeContact(channel, channel === 'email' ? r.email ?? '' : r.phone ?? '')
    const rendered = personalize(body, { full_name: r.full_name })
    const [consent, dnc, isSecurity] = await Promise.all([
      memberConsentGranted(r.member_id, channel),
      onDnc(to, channel),
      conversationIsSecurity(r.household_id),
    ])
    const gate = evaluateGate({
      draft: rendered,
      channel,
      hasConsent: consent,
      recipientLocalHour: localHour,
      withinBusinessHours,
      onDNC: dnc,
      usesApprovedTemplateOrPolicy: templateApproved,
      isSecurity,
    })
    const verdict = verdictFromGate(gate)
    const entry: SimulationEntry = {
      memberId: r.member_id,
      channel,
      to,
      representedAgencyId: r.agency_id,
      representedAgencyOwnerId: null, // resolved by the delegated-campaign path (later slice)
      templateVersion: campaign.version ?? null,
      renderedBody: rendered,
      scheduledAt: campaign.schedule_at ?? null,
      wouldSend: verdict.wouldSend,
      excludedReason: verdict.excludedReason,
      decisions: {
        consent: consent ? 'pass' : 'no consent on channel',
        quiet_hours: 'pass (recipient-local floor)',
        business_hours: withinBusinessHours ? 'pass' : 'outside operating hours (deferred)',
        dnc: dnc ? 'on DNC' : 'pass',
        approved_template: templateApproved ? 'pass' : 'template not approved',
        is_security: isSecurity ? 'securities-flagged (excluded)' : 'pass',
      },
    }
    fullEntries.push(entry)
    if (entries.length < sampleLimit) entries.push(entry)
  }

  const summary = summarizeSimulation(fullEntries)
  summary.audience = audienceCount
  return { campaignId, channel, simulatedAt: new Date().toISOString(), summary, entries }
}
