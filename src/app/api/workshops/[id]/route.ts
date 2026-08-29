import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/supabase/client'
import { readJson, configErrorResponse, dbErrorResponse } from '@/lib/http'
import { requireApiRole, requirePermission, actorOf } from '@/lib/auth/api'
import { WorkshopPatchSchema } from '@/lib/validation/schemas'
import { writeAudit } from '@/lib/audit/log'
import { evaluateWorkshopPublish, publishBlockMessage } from '@/lib/workshops/logic'
import { syncPresenters, gatherPublishFacts, recordMaterial, cancelWorkshopZoomMeetings } from '@/lib/workshops/server'
import { pickChangeKind } from '@/lib/workshops/reminders'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// PATCH /api/workshops/[id] — update details, attach presenters, change status, or
// reschedule / move the session (WS-007). Publishing is HARD-GATED (spec §8): status ->
// 'published' is blocked unless the workshop references an approved compliance approval
// AND an approved (non-placeholder) disclosure config — and the gate is evaluated BEFORE
// any presenter/material side effects are applied (WS-076), so a rejected publish
// changes nothing. Defense in depth with the DB triggers in migrations 038/130. There is
// no force-publish path. Roles: fsa, licensed_staff, admin, super_admin.
//
// Lifecycle (WS-070b, mirrored by the DB terminality trigger): 'cancelled'/'completed'
// are terminal; the only way out is an explicit reopen to 'draft', which VOIDS the
// standing compliance approval (republishing requires a fresh one) — and any Zoom
// meetings were deleted at cancellation, so re-provisioning is part of republish.
//
// Session changes (WS-007): starts_at/ends_at/timezone/venue_name/venue_address write
// the SESSION (single source of truth; the legacy workshops.scheduled_at mirror is
// updated alongside). A MATERIAL change bumps the session's cadence_generation — which
// re-arms the pre-event reminder claims (WS-029) — and records the pending change kind;
// the engine's change pass turns that into change_reschedule/change_venue notices
// through the same claimed send path as everything else (never an inline send here).
export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, ['fsa', 'licensed_staff', 'admin', 'super_admin'])
  if (denied) return denied

  const parsed = await readJson(req)
  if ('error' in parsed) return parsed.error
  const v = WorkshopPatchSchema.safeParse(parsed.data)
  if (!v.success) return NextResponse.json({ error: 'Invalid update', details: v.error.flatten() }, { status: 400 })

  const actor = actorOf(auth.session)
  try {
    const db = getDb()

    // Load current state (needed for the publish gate + effective values).
    const { data: current, error: loadErr } = await db
      .from('workshops')
      .select('workshop_id, status, compliance_approval_ref, disclosure_config_id')
      .eq('workshop_id', params.id)
      .maybeSingle()
    if (loadErr) return dbErrorResponse('workshops/[id]', loadErr)
    if (!current) return NextResponse.json({ error: 'Workshop not found' }, { status: 404 })

    // Session-change fields are NOT workshops columns — split them off up front.
    const { presenter_ids, hero_image_ref, session_id, starts_at, ends_at, timezone, venue_name, venue_address, ...rest } = v.data
    const wantsSessionChange =
      starts_at !== undefined || ends_at !== undefined || timezone !== undefined ||
      venue_name !== undefined || venue_address !== undefined

    // ── VALIDATION FIRST (WS-076): every rejection below must leave zero writes. ──

    // WS-047 (approval-gate integrity, D-5): 'compliance_approved' is minted ONLY by the
    // /approve route, which records the approver + snapshot (FINRA 2210). A bare PATCH
    // status flip would fabricate compliance standing with no approval record.
    if (rest.status === 'compliance_approved') {
      return NextResponse.json(
        { error: 'Compliance approval is recorded through the approval workflow, not a status change.' },
        { status: 422 },
      )
    }

    // WS-070b: terminal states — the only exit is the explicit reopen to 'draft'.
    const isReopen =
      (current.status === 'cancelled' || current.status === 'completed') && rest.status === 'draft'
    if (
      (current.status === 'cancelled' || current.status === 'completed') &&
      rest.status !== undefined &&
      rest.status !== current.status &&
      !isReopen
    ) {
      return NextResponse.json(
        { error: `This workshop is ${current.status}. Reopen it to draft first — republishing requires fresh compliance approval.` },
        { status: 422 },
      )
    }

    // Publish hard-gate. Evaluate against the values that WILL be set — BEFORE any
    // presenter/material/session side effect (WS-076).
    if (rest.status === 'published') {
      const effective = {
        compliance_approval_ref: current.compliance_approval_ref,
        disclosure_config_id: rest.disclosure_config_id ?? current.disclosure_config_id,
      }
      const facts = await gatherPublishFacts(db, effective)
      const decision = evaluateWorkshopPublish({ nextStatus: 'published', ...facts })
      if (!decision.canPublish) {
        return NextResponse.json(
          { error: publishBlockMessage(decision.reasons), reasons: decision.reasons },
          { status: 422 },
        )
      }
    }

    // WS-007: resolve + validate the target session before writing anything.
    type SessionTarget = {
      id: string
      workshop_id: string
      starts_at: string
      ends_at: string | null
      timezone: string | null
      venue_name: string | null
      venue_address: string | null
      status: string
      cadence_generation: number | null
    }
    let targetSession: SessionTarget | null = null
    if (wantsSessionChange) {
      if (session_id) {
        const { data: s, error: sErr } = await db
          .from('workshop_sessions')
          .select('id, workshop_id, starts_at, ends_at, timezone, venue_name, venue_address, status, cadence_generation')
          .eq('id', session_id)
          .maybeSingle()
        if (sErr) return dbErrorResponse('workshops/[id]', sErr)
        if (!s || s.workshop_id !== params.id) {
          return NextResponse.json({ error: 'Session not found on this workshop' }, { status: 422 })
        }
        targetSession = s as SessionTarget
      } else {
        const { data: s, error: sErr } = await db
          .from('workshop_sessions')
          .select('id, workshop_id, starts_at, ends_at, timezone, venue_name, venue_address, status, cadence_generation')
          .eq('workshop_id', params.id)
          .eq('status', 'scheduled')
          .gte('starts_at', new Date().toISOString())
          .order('starts_at', { ascending: true })
          .limit(1)
          .maybeSingle()
        if (sErr) return dbErrorResponse('workshops/[id]', sErr)
        targetSession = (s as SessionTarget | null) ?? null
      }
      if (!targetSession) {
        return NextResponse.json({ error: 'No upcoming session to change. Pass session_id to target a specific session.' }, { status: 422 })
      }
      if (targetSession.status !== 'scheduled') {
        return NextResponse.json({ error: `This session is ${targetSession.status} and can no longer be changed.` }, { status: 422 })
      }
    }

    // ── WRITES (validation passed). Session first, then presenters, then the row. ──

    let sessionChange: { kind: string | null; generation: number } | null = null
    if (targetSession) {
      const nextStartsAt = starts_at ?? targetSession.starts_at
      const nextEndsAt = ends_at === undefined ? targetSession.ends_at : ends_at
      const nextTimezone = timezone ?? targetSession.timezone
      const nextVenueName = venue_name === undefined ? targetSession.venue_name : venue_name
      const nextVenueAddress = venue_address === undefined ? targetSession.venue_address : venue_address

      const timeChanged =
        Date.parse(nextStartsAt) !== Date.parse(targetSession.starts_at) ||
        (nextEndsAt ? Date.parse(nextEndsAt) : null) !== (targetSession.ends_at ? Date.parse(targetSession.ends_at) : null) ||
        (nextTimezone ?? null) !== (targetSession.timezone ?? null)
      const venueChanged =
        (nextVenueName ?? null) !== (targetSession.venue_name ?? null) ||
        (nextVenueAddress ?? null) !== (targetSession.venue_address ?? null)
      const changeKind = pickChangeKind({ timeChanged, venueChanged })

      const sessionUpdate: Record<string, unknown> = {
        starts_at: nextStartsAt,
        ends_at: nextEndsAt,
        timezone: nextTimezone,
        venue_name: nextVenueName,
        venue_address: nextVenueAddress,
        updated_at: new Date().toISOString(),
      }
      const generation = Math.max(1, targetSession.cadence_generation ?? 1) + (changeKind ? 1 : 0)
      if (changeKind) {
        // Material change: bump the re-arm generation and record the pending notice for
        // the engine's change pass. Registrants who sign up AFTER this moment saw the
        // new details and are excluded by the pass (change_recorded_at).
        sessionUpdate.cadence_generation = generation
        sessionUpdate.change_kind = changeKind
        sessionUpdate.change_recorded_at = new Date().toISOString()
      }
      const { error: sUpdErr } = await db.from('workshop_sessions').update(sessionUpdate).eq('id', targetSession.id)
      if (sUpdErr) return dbErrorResponse('workshops/[id]', sUpdErr)
      sessionChange = { kind: changeKind, generation }
      await writeAudit({
        actor,
        action: 'entity.updated',
        entity: 'workshop_session',
        entityId: targetSession.id,
        diff: {
          from: { starts_at: targetSession.starts_at, ends_at: targetSession.ends_at, timezone: targetSession.timezone, venue_name: targetSession.venue_name, venue_address: targetSession.venue_address },
          to: { starts_at: nextStartsAt, ends_at: nextEndsAt, timezone: nextTimezone, venue_name: nextVenueName, venue_address: nextVenueAddress },
          change_kind: changeKind,
          cadence_generation: generation,
        },
      })

      // Legacy mirror: workshops.scheduled_at follows the session's start.
      if (timeChanged) (rest as Record<string, unknown>).scheduled_at = nextStartsAt
    }

    // Presenter attach/detach recomputes the securities firewall flag.
    if (presenter_ids) {
      await syncPresenters(db, params.id, presenter_ids)
    }
    if (hero_image_ref) {
      await recordMaterial(db, { workshopId: params.id, kind: 'hero_image', storageRef: hero_image_ref })
    }

    const update: Record<string, unknown> = { ...rest, updated_at: new Date().toISOString() }
    if (hero_image_ref) update.hero_image_ref = hero_image_ref

    const { data, error } = await db
      .from('workshops')
      .update(update)
      .eq('workshop_id', params.id)
      .select('workshop_id, status')
    if (error) return dbErrorResponse('workshops/[id]', error)
    if (!data || data.length === 0) return NextResponse.json({ error: 'Workshop not found' }, { status: 404 })

    // Cancel → the DB cascade (mig 130) marks scheduled sessions cancelled, which the
    // engine's change pass turns into event_cancelled notices (WS-008). Here: delete the
    // session Zoom meetings AND clear the per-registrant links so no stale join URL
    // survives (WS-070c). Only on the transition INTO 'cancelled' (idempotent). Best-
    // effort + gated: never blocks the status change; failures audited for manual sweep.
    if (rest.status === 'cancelled' && current.status !== 'cancelled') {
      try {
        const z = await cancelWorkshopZoomMeetings(db, params.id)
        if (z.failed > 0) {
          await writeAudit({ actor, action: 'config.changed', entity: 'workshop', entityId: params.id, diff: { zoom_delete_failed: z.failed, zoom_deleted: z.deleted } })
        }
      } catch (zerr) {
        console.error('[workshop] zoom meeting cancel cleanup (non-fatal):', zerr)
      }
    }

    await writeAudit({
      actor,
      action: rest.status ? 'stage.changed' : 'entity.updated',
      entity: 'workshop',
      entityId: params.id,
      diff: { ...v.data, ...(isReopen ? { reopened: true, compliance_approval_voided: true } : {}) },
    })
    return NextResponse.json({
      ok: true,
      status: data[0].status,
      ...(sessionChange ? { session_change: sessionChange } : {}),
      // WS-070b: reopening voided the approval (DB trigger); republish needs a fresh
      // approval and Zoom re-provisioning (meetings were deleted at cancellation).
      ...(isReopen ? { reopened: true, requires: ['fresh compliance approval', 'zoom re-provisioning'] } : {}),
    })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed to update workshop' }, { status: 500 })
  }
}
