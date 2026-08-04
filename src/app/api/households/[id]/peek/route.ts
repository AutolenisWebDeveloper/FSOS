import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/supabase/client'
import { configErrorResponse } from '@/lib/http'
import { requireApiRole, actorOf } from '@/lib/auth/api'
import { writeAudit } from '@/lib/audit/log'
import { buildAdvisor, topInsight } from '@/lib/contacts/advisor'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/*
 * GET /api/households/[id]/peek — the Contact Peek payload (redesign spec §4.4).
 * A compact, firewall-safe summary used by the reusable Contact Peek drawer that
 * is invoked from the list and every work-item ("peek, don't duplicate", §3).
 *
 * Guardrails:
 * - Securities firewall (§4.1): we surface only a boolean `hasSecurities` marker,
 *   never account numbers, orders, suitability, or any is_security substantive data.
 * - Frictionless data (§5): no DOB is read or returned.
 * - RLS scopes every read to the caller's book; the view is audited.
 */
export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response

  try {
    const db = getDb()
    const householdId = params.id

    const hh = await db
      .from('households')
      .select('id, primary_name, city, state, referring_agency_id, do_not_contact, archived_at')
      .eq('id', householdId)
      .is('deleted_at', null)
      .maybeSingle()
    if (hh.error) return NextResponse.json({ error: 'Failed to load contact' }, { status: 500 })
    if (!hh.data) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const [members, policies, openOpps, openReviews, securities, agency, recent, memberRels, policyDetail, reviewDates] = await Promise.all([
      db.from('household_members').select('id', { count: 'exact', head: true }).eq('household_id', householdId).is('deleted_at', null),
      db.from('household_policies').select('id', { count: 'exact', head: true }).eq('household_id', householdId).is('deleted_at', null),
      db
        .from('opportunities')
        .select('id', { count: 'exact', head: true })
        .eq('household_id', householdId)
        .is('deleted_at', null)
        .not('stage', 'in', '(placed_issued,lost)'),
      db.from('reviews').select('id', { count: 'exact', head: true }).eq('household_id', householdId).is('deleted_at', null).neq('stage', 'outcome_logged'),
      db.from('household_policies').select('id').eq('household_id', householdId).eq('is_security', true).is('deleted_at', null).limit(1),
      hh.data.referring_agency_id
        ? db.from('agency_partnerships').select('agency_name').eq('id', hh.data.referring_agency_id).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      db
        .from('activities')
        .select('id, kind, note, created_at')
        .eq('entity_type', 'household')
        .eq('entity_id', householdId)
        .order('created_at', { ascending: false })
        .limit(3),
      // Advisor inputs (§8) for the condensed mini-summary (§4.4).
      db.from('household_members').select('relationship').eq('household_id', householdId).is('deleted_at', null),
      db.from('household_policies').select('is_with_us, is_security, status, conversion_deadline').eq('household_id', householdId).is('deleted_at', null),
      db.from('reviews').select('created_at').eq('household_id', householdId).is('deleted_at', null),
    ])

    const memberCount = members.count ?? 0
    const policyCount = policies.count ?? 0
    const openOppCount = openOpps.count ?? 0
    const openReviewCount = openReviews.count ?? 0
    const hasSecurities = (securities.data?.length ?? 0) > 0

    // Condensed AI Advisor summary — same green-zone engine as the record (§8).
    const advisor = buildAdvisor({
      householdId,
      doNotContact: hh.data.do_not_contact,
      members: memberRels.data ?? [],
      policies: policyDetail.data ?? [],
      reviews: reviewDates.data ?? [],
      openOpportunities: openOppCount,
    })
    const advisorInsight = topInsight(advisor)?.text ?? null

    // Deterministic next-best-action hint (no AI in the peek path — cheap + safe).
    const nextAction =
      memberCount === 0
        ? 'Add household members'
        : openReviewCount > 0
          ? `${openReviewCount} review${openReviewCount === 1 ? '' : 's'} in progress`
          : openOppCount > 0
            ? `${openOppCount} open opportunit${openOppCount === 1 ? 'y' : 'ies'}`
            : policyCount === 0
              ? 'Record a policy or start a review'
              : 'Log a follow-up or schedule a review'

    await writeAudit({ actor: actorOf(auth.session), action: 'entity.viewed', entity: 'household', entityId: householdId, diff: { view: 'peek' } }).catch(() => {})

    return NextResponse.json({
      id: hh.data.id,
      name: hh.data.primary_name,
      location: [hh.data.city, hh.data.state].filter(Boolean).join(', ') || null,
      agencyName: agency.data?.agency_name ?? null,
      doNotContact: hh.data.do_not_contact,
      archived: !!hh.data.archived_at,
      hasSecurities,
      counts: { members: memberCount, policies: policyCount, openOpportunities: openOppCount },
      nextAction,
      advisorInsight,
      recent: (recent.data ?? []).map((r) => ({ id: r.id, kind: r.kind, note: r.note, created_at: r.created_at })),
    })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed to load contact' }, { status: 500 })
  }
}
