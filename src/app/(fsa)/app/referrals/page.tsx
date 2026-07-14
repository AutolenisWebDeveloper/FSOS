import Link from 'next/link'
import { Plus } from 'lucide-react'
import { ListShell, ErrorState, EmptyState } from '@/components/archetypes'
import { Button } from '@/components/ui/button'
import { load } from '@/lib/data/query'
import { ReferralInbox, type ReferralRow } from '@/components/app/ReferralInbox'

export const dynamic = 'force-dynamic'

// OS-03 Referral Inbox (A2) — every inbound agency referral with speed-to-lead.
export default async function ReferralsPage() {
  const [referrals, sla, agencies] = await Promise.all([
    load<{ id: string; referred_name: string | null; engagement: string; status: string; received_at: string; first_touch_at: string | null; sla_due_at: string | null; referring_agency_id: string | null }[]>(
      (db) => db.from('referrals').select('id, referred_name, engagement, status, received_at, first_touch_at, sla_due_at, referring_agency_id').is('deleted_at', null).order('sla_due_at', { ascending: true, nullsFirst: false }),
      [],
    ),
    load<{ id: string; sla_breached: boolean; untouched: boolean }[]>(
      (db) => db.from('v_referrals_awaiting_action').select('id, sla_breached, untouched'),
      [],
    ),
    load<{ id: string; agency_name: string }[]>((db) => db.from('agency_partnerships').select('id, agency_name').is('deleted_at', null), []),
  ])

  const actions = (
    <Button asChild>
      <Link href="/app/referrals/new">
        <Plus className="h-4 w-4" /> Record referral
      </Link>
    </Button>
  )

  let body: React.ReactNode
  if (!referrals.ok) {
    body = referrals.kind === 'not_configured' ? <EmptyState title="Database not configured" description="Set Supabase env vars to load referrals." /> : <ErrorState description={referrals.message} />
  } else {
    const slaMap = new Map((sla.ok ? sla.data : []).map((s) => [s.id, s]))
    const agencyMap = new Map((agencies.ok ? agencies.data : []).map((a) => [a.id, a.agency_name]))
    const rows: ReferralRow[] = referrals.data.map((r) => {
      const s = slaMap.get(r.id)
      return {
        ...r,
        sla_breached: s?.sla_breached ?? false,
        untouched: s?.untouched ?? r.first_touch_at === null,
        agency_name: r.referring_agency_id ? agencyMap.get(r.referring_agency_id) ?? null : null,
      }
    })
    body = <ReferralInbox rows={rows} />
  }

  return (
    <ListShell title="Referral Inbox" description="Inbound agency referrals with speed-to-lead SLA timers." breadcrumb={[{ label: 'FSA', href: '/app' }, { label: 'Referrals' }]} actions={actions}>
      {body}
    </ListShell>
  )
}
