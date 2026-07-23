import Link from 'next/link'
import { Plus, Upload } from 'lucide-react'
import { ListShell, ErrorState, EmptyState } from '@/components/archetypes'
import { Button } from '@/components/ui/button'
import { load } from '@/lib/data/query'
import { AgencyList, type AgencyRow } from '@/components/app/AgencyList'

export const dynamic = 'force-dynamic'

// OS-02 Agency Directory (A2). The FSA's book of agency-owner partnerships — the
// aggregate root and entry point to everything (spec p0-core OS-02).
export default async function AgenciesPage() {
  const [agencies, overdue] = await Promise.all([
    load<AgencyRow[]>(
      (db) =>
        db
          .from('agency_partnerships')
          .select('id, agency_name, owner_name, status, ytd_placed_premium, ytd_referrals, last_contact_at, archived_at')
          .is('deleted_at', null)
          .order('ytd_placed_premium', { ascending: false }),
      [],
    ),
    load<{ id: string; overdue_checkin: boolean }[]>(
      (db) => db.from('v_agencies_overdue_checkin').select('id, overdue_checkin'),
      [],
    ),
  ])

  const actions = (
    <div className="flex items-center gap-2">
      <Button asChild variant="outline">
        <Link href="/app/agencies/import">
          <Upload className="h-4 w-4" /> Import directory
        </Link>
      </Button>
      <Button asChild>
        <Link href="/app/agencies/new">
          <Plus className="h-4 w-4" /> New partnership
        </Link>
      </Button>
    </div>
  )

  let body: React.ReactNode
  if (!agencies.ok) {
    body =
      agencies.kind === 'not_configured' ? (
        <EmptyState
          title="Database not configured"
          description="Set the Supabase environment variables to load agency partnerships."
        />
      ) : (
        <ErrorState description={agencies.message} />
      )
  } else {
    const overdueMap = new Map((overdue.ok ? overdue.data : []).map((o) => [o.id, o.overdue_checkin]))
    const rows: AgencyRow[] = agencies.data.map((a) => ({
      ...a,
      ytd_placed_premium: Number(a.ytd_placed_premium ?? 0),
      ytd_referrals: Number(a.ytd_referrals ?? 0),
      overdue_checkin: overdueMap.get(a.id) ?? false,
    }))
    body = <AgencyList rows={rows} />
  }

  return (
    <ListShell
      title="Agency Partnerships"
      description="Your book of agency-owner partnerships — the aggregate root of FSOS."
      breadcrumb={[{ label: 'FSA', href: '/app' }, { label: 'Agencies' }]}
      actions={actions}
    >
      {body}
    </ListShell>
  )
}
