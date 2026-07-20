// src/lib/workshops/server.ts
// Server-only helpers for the Workshop/Seminar lead engine (P0). These run with a
// service-role db client (getDb) passed in by the caller; they never instantiate a
// client (CLAUDE.md §1 convention 1). Pure decision logic lives in ./logic.ts.

import { randomUUID } from 'node:crypto'
import { deriveIsSecurity } from './logic'
import { resolveCheckIn, type AttendanceStatus } from './attendance'
import {
  upsertContactWithRetry,
  createOpportunity,
  addContactTags,
  GHL_CUSTOM_FIELDS,
  ghlEnabled,
} from '@/lib/ghl'

// Minimal structural type for the Supabase client we use (avoids importing the SDK type).
type Db = ReturnType<typeof import('@/lib/supabase/client')['getDb']>

export const PLACEHOLDER_MARKER = '[PLACEHOLDER'

/**
 * Replace this workshop's presenter set with `presenterIds`, recompute the securities
 * firewall flag from the attached presenters, persist it, and snapshot each presenter's
 * bio + headshot as versioned workshop_materials rows for the approval record.
 * Returns the derived is_security value.
 */
export async function syncPresenters(
  db: Db,
  workshopId: string,
  presenterIds: string[],
): Promise<boolean> {
  // Replace join rows.
  await db.from('workshop_presenters').delete().eq('workshop_id', workshopId)
  if (presenterIds.length > 0) {
    await db.from('workshop_presenters').insert(
      presenterIds.map((presenter_id, i) => ({
        workshop_id: workshopId,
        presenter_id,
        display_order: i,
      })),
    )
  }

  // Load the attached presenters to derive the firewall flag + snapshot materials.
  const { data: presenters } = presenterIds.length
    ? await db
        .from('presenters')
        .select('id, name, bio, headshot_ref, is_third_party, fund_family, presenter_type')
        .in('id', presenterIds)
    : { data: [] as PresenterRow[] }

  const rows = (presenters ?? []) as PresenterRow[]
  const isSecurity = deriveIsSecurity(rows)
  await db.from('workshops').update({ is_security: isSecurity, updated_at: nowIso() }).eq('workshop_id', workshopId)

  // Snapshot presenter bio + headshot as materials (versioned) feeding the approval record.
  for (const p of rows) {
    if (p.bio) {
      await recordMaterial(db, {
        workshopId,
        kind: 'presenter_bio',
        label: p.name,
        contentSnapshot: p.bio,
      })
    }
    if (p.headshot_ref) {
      await recordMaterial(db, {
        workshopId,
        kind: 'presenter_headshot',
        label: p.name,
        storageRef: p.headshot_ref,
      })
    }
  }
  return isSecurity
}

interface PresenterRow {
  id: string
  name: string
  bio: string | null
  headshot_ref: string | null
  is_third_party: boolean | null
  fund_family: string | null
  presenter_type: string | null
}

/** Insert a versioned workshop_materials row (auto-increments version per (workshop, kind, label)). */
export async function recordMaterial(
  db: Db,
  args: {
    workshopId: string
    kind: string
    label?: string | null
    storageRef?: string | null
    contentSnapshot?: string | null
  },
): Promise<void> {
  const { count } = await db
    .from('workshop_materials')
    .select('*', { count: 'exact', head: true })
    .eq('workshop_id', args.workshopId)
    .eq('kind', args.kind)
  const version = (count ?? 0) + 1
  await db.from('workshop_materials').insert({
    workshop_id: args.workshopId,
    kind: args.kind,
    label: args.label ?? null,
    version,
    storage_ref: args.storageRef ?? null,
    content_snapshot: args.contentSnapshot ?? null,
    // finra_2210_class + filing_decision left NULL — compliance sets them (REQUIRES-APPROVAL).
  })
}

/**
 * Gather the two publish prerequisites for a workshop as booleans for the pure
 * evaluateWorkshopPublish() gate: an approved compliance approval + an approved
 * (non-placeholder) disclosure config.
 */
export async function gatherPublishFacts(
  db: Db,
  workshop: { compliance_approval_ref: string | null; disclosure_config_id: string | null },
): Promise<{ hasApprovedApproval: boolean; hasApprovedDisclosure: boolean }> {
  let hasApprovedApproval = false
  if (workshop.compliance_approval_ref) {
    const { data } = await db
      .from('workshop_approvals')
      .select('id, decision')
      .eq('id', workshop.compliance_approval_ref)
      .maybeSingle()
    hasApprovedApproval = data?.decision === 'approved'
  }
  let hasApprovedDisclosure = false
  if (workshop.disclosure_config_id) {
    const { data } = await db
      .from('workshop_disclosure_configs')
      .select('id, is_assumption, approved_by')
      .eq('id', workshop.disclosure_config_id)
      .maybeSingle()
    hasApprovedDisclosure = !!data && data.is_assumption === false && !!data.approved_by
  }
  return { hasApprovedApproval, hasApprovedDisclosure }
}

function nowIso(): string {
  return new Date().toISOString()
}

// ─── Attendance capture (P1) ────────────────────────────────────────────────────

interface RegForAttendance {
  reg_id: string
  workshop_id: string
  session_id: string | null
}

/**
 * Resolve the session a registration's attendance row is keyed to. Prefers the
 * registration's own session_id; falls back to the workshop's earliest session (the 1:1
 * default backfilled by migration 038) so attendance always has a valid session FK.
 */
async function resolveSessionId(db: Db, reg: RegForAttendance): Promise<string | null> {
  if (reg.session_id) return reg.session_id
  const { data } = await db
    .from('workshop_sessions')
    .select('id')
    .eq('workshop_id', reg.workshop_id)
    .order('starts_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  return data?.id ?? null
}

export type CheckInOutcome =
  | { ok: true; noop: boolean; registration_id: string; session_id: string }
  | { ok: false; error: string; status: number }

/**
 * Idempotent kiosk check-in by the registrant's unique join_token. A double-scan of an
 * already-checked-in registrant is a NO-OP (no write, no audit churn) — safe for spotty
 * venue wifi where the client may retry. Writes capture_method='checkin',
 * status='attended', checked_in_at on first scan.
 */
export async function checkInByToken(
  db: Db,
  workshopId: string,
  token: string,
): Promise<CheckInOutcome> {
  const { data: reg } = await db
    .from('workshop_registrations')
    .select('reg_id, workshop_id, session_id')
    .eq('join_token', token)
    .eq('workshop_id', workshopId)
    .maybeSingle()
  if (!reg) return { ok: false, error: 'No registration matches that code for this workshop.', status: 404 }

  const sessionId = await resolveSessionId(db, reg as RegForAttendance)
  if (!sessionId) return { ok: false, error: 'This workshop has no session to check into.', status: 409 }

  const { data: existing } = await db
    .from('workshop_attendance')
    .select('id, status, capture_method')
    .eq('registration_id', reg.reg_id)
    .eq('session_id', sessionId)
    .maybeSingle()

  const decided = resolveCheckIn(existing ? { status: existing.status as AttendanceStatus, capture_method: existing.capture_method } : null)
  if (!decided) {
    // Already attended — idempotent no-op.
    return { ok: true, noop: true, registration_id: reg.reg_id, session_id: sessionId }
  }

  await writeAttendance(db, {
    registrationId: reg.reg_id,
    sessionId,
    status: decided.status,
    captureMethod: decided.capture_method,
    checkedInAt: nowIso(),
    hasExisting: !!existing,
  })
  // Keep the legacy registration.attended flag in sync for back-compat readers.
  await db.from('workshop_registrations').update({ attended: true }).eq('reg_id', reg.reg_id)
  return { ok: true, noop: false, registration_id: reg.reg_id, session_id: sessionId }
}

/**
 * Upsert an attendance row for (registration_id, session_id) — the unique key in the P0
 * shell. Uses onConflict so a re-send updates in place rather than erroring (idempotent).
 */
async function writeAttendance(
  db: Db,
  args: {
    registrationId: string
    sessionId: string
    status: AttendanceStatus
    captureMethod: 'checkin' | 'manual' | 'webhook'
    checkedInAt?: string | null
    hasExisting?: boolean
  },
): Promise<void> {
  await db.from('workshop_attendance').upsert(
    {
      registration_id: args.registrationId,
      session_id: args.sessionId,
      status: args.status,
      capture_method: args.captureMethod,
      checked_in_at: args.checkedInAt ?? null,
    },
    { onConflict: 'registration_id,session_id' },
  )
}

export interface ReconcileEntry {
  registration_id: string
  status: AttendanceStatus
}

export interface ReconcileResult {
  written: number
  skipped: number
}

/**
 * Bulk/typed manual attendance reconcile (virtual + hybrid interim, or roster
 * corrections). Idempotent: an entry whose status already matches is skipped. Each write
 * is capture_method='manual'. Designed so a future Zoom webhook (P3) writes the SAME table
 * via writeAttendance with capture_method='webhook' — no rework. Returns counts for audit.
 */
export async function reconcileAttendance(
  db: Db,
  workshopId: string,
  entries: ReconcileEntry[],
): Promise<ReconcileResult> {
  // Load the registrations in one shot; ignore any that don't belong to this workshop.
  const ids = entries.map((e) => e.registration_id)
  const { data: regs } = await db
    .from('workshop_registrations')
    .select('reg_id, workshop_id, session_id')
    .in('reg_id', ids)
    .eq('workshop_id', workshopId)
  const regMap = new Map<string, RegForAttendance>()
  for (const r of (regs ?? []) as RegForAttendance[]) regMap.set(r.reg_id, r)

  let written = 0
  let skipped = 0
  for (const e of entries) {
    const reg = regMap.get(e.registration_id)
    if (!reg) {
      skipped++
      continue
    }
    const sessionId = await resolveSessionId(db, reg)
    if (!sessionId) {
      skipped++
      continue
    }
    const { data: existing } = await db
      .from('workshop_attendance')
      .select('id, status')
      .eq('registration_id', reg.reg_id)
      .eq('session_id', sessionId)
      .maybeSingle()
    if (existing && existing.status === e.status) {
      skipped++
      continue
    }
    await writeAttendance(db, {
      registrationId: reg.reg_id,
      sessionId,
      status: e.status,
      captureMethod: 'manual',
      checkedInAt: e.status === 'attended' || e.status === 'left_early' ? nowIso() : null,
    })
    await db
      .from('workshop_registrations')
      .update({ attended: e.status === 'attended' || e.status === 'left_early' })
      .eq('reg_id', reg.reg_id)
    written++
  }
  return { written, skipped }
}

export interface WalkInInput {
  name: string
  email?: string | null
  phone?: string | null
  chosen_delivery?: 'in_person' | 'virtual'
  consent_email?: boolean
  consent_sms?: boolean
  session_id?: string
}

export interface WalkInResult {
  registration_id: string
  session_id: string | null
}

/**
 * Add a walk-in at the kiosk: create a workshop_registrations row (flagged is_walk_in,
 * lead_source='walk-in') + an 'attended' attendance row (capture_method='checkin'). Consent
 * is captured the same way as public registration, including durable consent evidence.
 */
export async function addWalkIn(
  db: Db,
  workshopId: string,
  input: WalkInInput,
  meta: { ip?: string | null; userAgent?: string | null; disclosureText: string; disclosureVersion: string },
): Promise<WalkInResult> {
  // Resolve session (provided, else the workshop's default session).
  let sessionId = input.session_id ?? null
  if (!sessionId) {
    const { data: s } = await db
      .from('workshop_sessions')
      .select('id')
      .eq('workshop_id', workshopId)
      .order('starts_at', { ascending: true })
      .limit(1)
      .maybeSingle()
    sessionId = s?.id ?? null
  }

  const channels = [input.consent_email ? 'email' : null, input.consent_sms ? 'sms' : null].filter(Boolean) as (
    | 'email'
    | 'sms'
  )[]
  const joinToken = randomUUID()

  const { data: reg, error } = await db
    .from('workshop_registrations')
    .insert({
      workshop_id: workshopId,
      session_id: sessionId,
      name: input.name,
      email: input.email || null,
      phone: input.phone || null,
      chosen_delivery: input.chosen_delivery ?? 'in_person',
      consent_channels: channels,
      lead_source: 'walk-in',
      is_walk_in: true,
      join_token: joinToken,
      status: 'registered',
    })
    .select('reg_id')
    .single()
  if (error || !reg) throw new Error(error?.message ?? 'Walk-in registration failed')

  if (channels.length > 0) {
    await db.from('workshop_consent_events').insert(
      channels.map((channel) => ({
        registration_id: reg.reg_id,
        channel,
        action: 'granted',
        disclosure_text: meta.disclosureText,
        disclosure_version: meta.disclosureVersion,
        ip_address: meta.ip ?? null,
        user_agent: meta.userAgent ?? null,
      })),
    )
  }

  if (sessionId) {
    await writeAttendance(db, {
      registrationId: reg.reg_id,
      sessionId,
      status: 'attended',
      captureMethod: 'checkin',
      checkedInAt: nowIso(),
    })
    await db.from('workshop_registrations').update({ attended: true }).eq('reg_id', reg.reg_id)
  }

  return { registration_id: reg.reg_id, session_id: sessionId }
}

// ─── Convert an attendee to a lead (P1, manual) ─────────────────────────────────
// Non-securities: push into the EXISTING consult spine via GHL — upsert the contact with
// lead_source="Event" + tags (src-event, wshop-<slug>) and create a Pipeline-A
// prospect_client opportunity. is_security workshops are FIREWALLED: their attendees route
// to the FFS-supervised path (compliance escalation), NEVER the automated comms engine.

export interface WorkshopLeadContext {
  is_security: boolean | null
  slug: string | null
  title: string | null
}

export interface RegForConvert {
  reg_id: string
  name: string | null
  email: string | null
  phone: string | null
  ghl_opportunity_id: string | null
}

export type ConvertLeadOutcome =
  | { ok: true; routed: 'ghl'; ghl_contact_id: string | null; ghl_opportunity_id: string | null; skipped: boolean }
  | { ok: true; routed: 'ffs'; reason: string }
  | { ok: false; error: string; status: number }

/**
 * Route a workshop attendee into the consult spine. Returns the routing decision so the
 * caller can audit it. Does NOT create the internal referral (the caller owns the existing
 * referral-spine step); this handles the GHL push + the securities firewall branch.
 */
export async function convertRegistrationToLead(
  db: Db,
  reg: RegForConvert,
  ctx: WorkshopLeadContext,
  actor: string,
): Promise<ConvertLeadOutcome> {
  // ── Securities firewall: route to FFS, never the automated engine. ──
  if (ctx.is_security === true) {
    await db.from('compliance_events').insert({
      kind: 'firewall',
      actor,
      entity_type: 'workshop_registration',
      entity_id: reg.reg_id,
      blocked_step: 'workshop_convert_to_lead',
      reason: 'Securities-flagged workshop — attendee routed to the FFS-supervised path, not the automated comms engine.',
    })
    await db.from('agent_actions').insert({
      kind: 'escalation',
      actor,
      outcome: 'escalated',
      target_type: 'workshop_registration',
      target_id: reg.reg_id,
      reason: 'is_security workshop',
      note: 'Convert-to-lead on a securities workshop routes to FFS. No GHL push, no automated comms.',
    })
    return { ok: true, routed: 'ffs', reason: 'securities_ffs' }
  }

  // ── Non-securities: GHL Pipeline-A push (green-zone). No-ops cleanly when GHL is off. ──
  if (reg.ghl_opportunity_id) {
    // Idempotent: already converted to a GHL lead.
    return { ok: true, routed: 'ghl', ghl_contact_id: null, ghl_opportunity_id: reg.ghl_opportunity_id, skipped: true }
  }
  if (!ghlEnabled()) {
    return { ok: true, routed: 'ghl', ghl_contact_id: null, ghl_opportunity_id: null, skipped: true }
  }

  const [firstName, ...restName] = (reg.name ?? 'Workshop attendee').trim().split(/\s+/)
  const lastName = restName.join(' ') || undefined
  const slug = (ctx.slug ?? 'workshop').slice(0, 60)
  const tags = ['src-event', `wshop-${slug}`]

  const contactRes = await upsertContactWithRetry({
    firstName,
    lastName,
    email: reg.email,
    phone: reg.phone,
    tags,
    source: 'Event',
    customFields: { [GHL_CUSTOM_FIELDS.lead_source]: 'Event' },
  })
  const contactId = contactRes.data?.contact?.id ?? null
  if (!contactId) {
    // GHL failed transiently after retries — surface so the caller can leave the
    // registration unconverted and let staff retry (no data loss).
    return { ok: false, error: contactRes.error ?? 'GHL contact upsert failed', status: 502 }
  }
  await addContactTags(contactId, tags)

  const oppRes = await createOpportunity({
    contactId,
    pipelineKey: 'prospect_client',
    stagePosition: 1,
    name: `Workshop lead — ${reg.name ?? 'attendee'}${ctx.title ? ` (${ctx.title})` : ''}`.slice(0, 200),
    status: 'open',
  })
  const opportunityId = oppRes.data?.opportunity?.id ?? null

  return { ok: true, routed: 'ghl', ghl_contact_id: contactId, ghl_opportunity_id: opportunityId, skipped: false }
}

/**
 * Mint a short-lived signed URL for a private-bucket asset path (hero image / headshot).
 * Public landing pages call this at render time (force-dynamic) so images stay in the
 * private `documents` bucket and are never exposed as public URLs.
 */
export async function signedAssetUrl(db: Db, path: string | null, ttl = 60 * 60): Promise<string | null> {
  if (!path) return null
  try {
    const { data } = await db.storage.from('documents').createSignedUrl(path, ttl)
    return data?.signedUrl ?? null
  } catch {
    return null
  }
}
