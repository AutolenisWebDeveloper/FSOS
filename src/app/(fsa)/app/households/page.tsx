import Link from 'next/link'
import { Plus, Users, UserRound, Target, PhoneOff, Upload } from 'lucide-react'
import { ListShell, ErrorState, EmptyState } from '@/components/archetypes'
import { Button } from '@/components/ui/button'
import { loadAll } from '@/lib/data/query'
import { HouseholdList, type HouseholdRow } from '@/components/app/HouseholdList'
import { PageStatStrip, type PageStat } from '@/components/app/PageStatStrip'
import { contactViewKeys, CONTACT_VIEW_KEYS, CONTACT_VIEW_WINDOWS, type ContactViewKey } from '@/lib/contacts/views'

export const dynamic = 'force-dynamic'

const ACTIVE_POLICY = new Set(['active', 'bound', 'renewed'])
const LAPSED_POLICY = new Set(['lapsed', 'cancelled', 'non_renewed'])

// OS-04 Household Directory (A2). Full book — loadAll pages past PostgREST's row
// cap so every household (and correct per-household counts) is loaded.
export default async function HouseholdsPage() {
  const now = Date.now()
  const contactCutoff = new Date(now - CONTACT_VIEW_WINDOWS.needsContactDays * 86400000).toISOString()
  const [households, members, policies, opps, agencies, reviews, recentActivity] = await Promise.all([
    loadAll<{ id: string; primary_name: string; referring_agency_id: string | null; do_not_contact: boolean; archived_at: string | null }>(
      (db) => db.from('households').select('id, primary_name, referring_agency_id, do_not_contact, archived_at').is('deleted_at', null).order('created_at', { ascending: false }),
    ),
    loadAll<{ household_id: string }>((db) => db.from('household_members').select('household_id').is('deleted_at', null)),
    loadAll<{ household_id: string; status: string; is_with_us: boolean; is_security: boolean; conversion_deadline: string | null }>(
      (db) => db.from('household_policies').select('household_id, status, is_with_us, is_security, conversion_deadline').is('deleted_at', null),
    ),
    loadAll<{ household_id: string | null; stage: string }>((db) => db.from('opportunities').select('household_id, stage').is('deleted_at', null)),
    loadAll<{ id: string; agency_name: string }>((db) => db.from('agency_partnerships').select('id, agency_name').is('deleted_at', null)),
    loadAll<{ household_id: string; created_at: string }>((db) => db.from('reviews').select('household_id, created_at').is('deleted_at', null)),
    // Households contacted within the needs-contact window — a bounded scan (last
    // N days only), not the full activity stream.
    loadAll<{ entity_id: string }>((db) => db.from('activities').select('entity_id').eq('entity_type', 'household').gte('created_at', contactCutoff)),
  ])

  const actions = (
    <>
      <Button asChild variant="outline">
        <Link href="/app/uploads"><Upload className="h-4 w-4" /> Import contacts</Link>
      </Button>
      <Button asChild>
        <Link href="/app/households/new"><Plus className="h-4 w-4" /> Add household</Link>
      </Button>
    </>
  )

  let body: React.ReactNode
  if (!households.ok) {
    body = households.kind === 'not_configured' ? <EmptyState title="Database not configured" description="Set Supabase env vars to load households." /> : <ErrorState description={households.message} />
  } else {
    const count = (arr: { household_id: string | null }[], id: string) => arr.filter((x) => x.household_id === id).length
    const agencyMap = new Map((agencies.ok ? agencies.data : []).map((a) => [a.id, a.agency_name]))
    const memberRows = members.ok ? members.data : []
    const policyRows = policies.ok ? policies.data : []
    const oppRows = (opps.ok ? opps.data : []).filter((o) => o.stage !== 'placed_issued' && o.stage !== 'lost')

    // Per-household signal maps for saved-view membership (§4.1). Built once from
    // the loaded data — no per-row queries.
    const policiesByHh = new Map<string, typeof policyRows>()
    for (const p of policyRows) {
      const arr = policiesByHh.get(p.household_id) ?? []
      arr.push(p)
      policiesByHh.set(p.household_id, arr)
    }
    const latestReviewByHh = new Map<string, number>()
    for (const r of reviews.ok ? reviews.data : []) {
      const t = new Date(r.created_at).getTime()
      if (Number.isNaN(t)) continue
      const prev = latestReviewByHh.get(r.household_id)
      if (prev === undefined || t > prev) latestReviewByHh.set(r.household_id, t)
    }
    const recentlyContacted = new Set((recentActivity.ok ? recentActivity.data : []).map((a) => a.entity_id))

    const viewCounts = Object.fromEntries(CONTACT_VIEW_KEYS.map((k) => [k, 0])) as Record<ContactViewKey, number>
    const rows: HouseholdRow[] = households.data.map((h) => {
      const ps = policiesByHh.get(h.id) ?? []
      const latestReview = latestReviewByHh.get(h.id)
      const views = contactViewKeys({
        archived: !!h.archived_at,
        doNotContact: h.do_not_contact,
        policyCount: ps.length,
        activePolicy: ps.some((p) => ACTIVE_POLICY.has(p.status)),
        heldAwayPolicy: ps.some((p) => !p.is_with_us),
        lapsedPolicy: ps.some((p) => LAPSED_POLICY.has(p.status)),
        conversionEligible: ps.some((p) => !p.is_security && p.conversion_deadline !== null && new Date(p.conversion_deadline).getTime() > now),
        hasReview: latestReview !== undefined,
        lastReviewAgeDays: latestReview !== undefined ? Math.floor((now - latestReview) / 86400000) : null,
        recentlyContacted: recentlyContacted.has(h.id),
      })
      for (const v of views) viewCounts[v] += 1
      return {
        id: h.id,
        primary_name: h.primary_name,
        agency_name: h.referring_agency_id ? agencyMap.get(h.referring_agency_id) ?? null : null,
        members: count(memberRows, h.id),
        policies: ps.length,
        opportunities: count(oppRows, h.id),
        do_not_contact: h.do_not_contact,
        archived_at: h.archived_at,
        views,
      }
    })

    // Book-level summary — computed from the data already loaded (no new query).
    const dncCount = households.data.filter((h) => h.do_not_contact).length
    const stats: PageStat[] = [
      { label: 'Households', value: households.data.length, hint: 'In your book', icon: Users, accent: 'brand' },
      { label: 'Members', value: memberRows.length, hint: 'People across the book', icon: UserRound, accent: 'neutral', href: undefined },
      { label: 'Open opportunities', value: oppRows.length, hint: 'Active in pipeline', href: '/app/opportunities/board', icon: Target, accent: 'positive' },
      { label: 'Do-not-contact', value: dncCount, hint: dncCount ? 'Excluded from outreach' : 'None flagged', href: '/app/compliance/dnc', icon: PhoneOff, accent: 'attention' },
    ]

    body = (
      <div className="space-y-6">
        <PageStatStrip stats={stats} />
        <HouseholdList rows={rows} viewCounts={viewCounts} />
      </div>
    )
  }

  return (
    <ListShell title="Contacts" description="Client households and members in your book." breadcrumb={[{ label: 'FSA', href: '/app' }, { label: 'Contacts' }]} actions={actions}>
      {body}
    </ListShell>
  )
}
