// src/lib/workshops/replay.ts
// Server-only loader for the PUBLIC replay page (/workshops/[slug]/replay). Enforces, in
// order (evaluateReplayAccess): (1) an APPROVED recording-consent disclosure exists — the
// recording/replay surface can NEVER activate publicly on placeholder copy (retained-
// communication rule, 17a-4/4511); (2) the caller presents a valid registration token for
// this workshop; (3) a recording exists; (4) it is within its finite window. When the
// recording is served, an audit row is written FIRST (retention/evidence trail).

import { getDb } from '@/lib/supabase/client'
import { writeAudit } from '@/lib/audit/log'
import { evaluateReplayAccess, type ReplayGate } from './delivery'

export interface ReplayView {
  gate: ReplayGate
  title: string
  slug: string
  /** The approved recording-consent disclosure body (rendered on the page). Null until approved. */
  recordingDisclosure: string | null
  recordingUrl: string | null
  recordingExpiresAt: string | null
  /** The registrant's join_token, threaded to the feedback form (null when no valid token). */
  feedbackToken: string | null
  isSecurity: boolean
}

export async function loadReplay(slug: string, token: string | null, nowIso: string): Promise<ReplayView | null> {
  const db = getDb()

  const { data: w } = await db
    .from('workshops')
    .select('workshop_id, slug, title, status, is_security')
    .eq('slug', slug)
    .maybeSingle()
  // Replay is available for published/completed workshops only (never a draft).
  if (!w || (w.status !== 'published' && w.status !== 'completed')) return null

  // Earliest session carries the recording pointer + finite window (038 columns).
  const { data: session } = await db
    .from('workshop_sessions')
    .select('id, recording_url, recording_expires_at')
    .eq('workshop_id', w.workshop_id)
    .order('starts_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  // Recording-consent gate: an APPROVED (non-placeholder) recording disclosure must exist.
  const { data: rec } = await db
    .from('workshop_disclosure_configs')
    .select('body, is_assumption, approved_by')
    .eq('kind', 'recording')
    .eq('is_assumption', false)
    .not('approved_by', 'is', null)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle()
  const recordingDisclosureApproved = !!rec

  // Access gate: a valid registration token for THIS workshop (never a name lookup).
  let feedbackToken: string | null = null
  if (token) {
    const { data: reg } = await db
      .from('workshop_registrations')
      .select('reg_id')
      .eq('join_token', token)
      .eq('workshop_id', w.workshop_id)
      .maybeSingle()
    if (reg) feedbackToken = token
  }

  const gate = evaluateReplayAccess({
    recordingUrl: session?.recording_url ?? null,
    recordingExpiresAt: session?.recording_expires_at ?? null,
    recordingDisclosureApproved,
    hasValidRegistration: !!feedbackToken,
    nowIso,
  })

  // Retention/audit evidence — write BEFORE the recording is served.
  if (gate === 'available') {
    await writeAudit({
      actor: 'public',
      action: 'entity.viewed',
      entity: 'workshop_recording',
      entityId: w.workshop_id,
      diff: { via: 'replay_served', slug: w.slug },
    })
  }

  return {
    gate,
    title: w.title,
    slug: w.slug,
    recordingDisclosure: rec?.body ?? null,
    recordingUrl: gate === 'available' ? (session?.recording_url ?? null) : null,
    recordingExpiresAt: session?.recording_expires_at ?? null,
    feedbackToken,
    isSecurity: !!w.is_security,
  }
}
