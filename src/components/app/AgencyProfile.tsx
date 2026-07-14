import Link from 'next/link'
import { notFound } from 'next/navigation'
import { DetailShell, ErrorState, EmptyState, StatusBadge } from '@/components/archetypes'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { load } from '@/lib/data/query'
import { LogActivityButton } from '@/components/app/LogActivityButton'

// Valid P0 tabs (spec p0-core OS-02): overview + referrals. Any other tab param
// 404s within the shell (acceptance criterion).
export const AGENCY_P0_TABS = ['overview', 'referrals'] as const
export type AgencyTab = (typeof AGENCY_P0_TABS)[number]

interface Agency {
  id: string
  agency_name: string
  owner_name: string
  status: string
  archived_at: string | null
  last_contact_at: string | null
  checkin_interval_days: number
  ytd_placed_premium: number
  ytd_referrals: number
  pc_book_policies: number
  life_policies_in_force: number
}

export async function AgencyProfile({ id, tab }: { id: string; tab: AgencyTab }) {
  const res = await load<Agency | null>(
    (db) => db.from('agency_partnerships').select('*').eq('id', id).is('deleted_at', null).maybeSingle(),
    null,
  )

  if (!res.ok) {
    return <ErrorState description={res.kind === 'not_configured' ? 'Database not configured.' : res.message} />
  }
  const agency = res.data
  if (!agency) notFound()

  const breadcrumb = [
    { label: 'FSA', href: '/app' },
    { label: 'Agencies', href: '/app/agencies' },
    { label: agency.agency_name, href: `/app/agencies/${id}` },
    { label: tab },
  ]

  const rail = (
    <div className="space-y-3 text-sm">
      <p className="font-medium">Related</p>
      <ul className="space-y-1.5">
        <li>
          <Link href={`/app/agencies/${id}/referrals`} className="text-primary hover:underline">
            Referrals from this agency
          </Link>
        </li>
        <li>
          <Link href={`/app/referrals/new?agency=${id}`} className="text-primary hover:underline">
            Record a referral
          </Link>
        </li>
        <li>
          <Link href="/app/opportunities" className="text-primary hover:underline">
            Opportunities
          </Link>
        </li>
      </ul>
      <p className="pt-2 text-xs text-muted-foreground">
        Production, commissions, documents, staff, reviews &amp; health arrive as P1 tabs.
      </p>
    </div>
  )

  return (
    <DetailShell
      title={agency.agency_name}
      description={`Owner: ${agency.owner_name}`}
      breadcrumb={breadcrumb}
      status={
        <span className="flex items-center gap-2">
          <StatusBadge status={agency.status === 'producing' ? 'won' : agency.status === 'terminated' ? 'lost' : 'active'} label={agency.status} />
          {agency.archived_at ? <Badge variant="draft">archived</Badge> : null}
        </span>
      }
      actions={
        <>
          <LogActivityButton entityType="agency_partnership" entityId={id} kind="checkin" label="Start check-in" />
          <Button asChild variant="outline" size="sm">
            <Link href={`/app/referrals/new?agency=${id}`}>Record referral</Link>
          </Button>
        </>
      }
      rail={rail}
    >
      {/* Tab nav (only resolving P0 tabs — no dead links) */}
      <nav className="flex gap-1 border-b" aria-label="Agency tabs">
        {AGENCY_P0_TABS.map((t) => {
          const href = t === 'overview' ? `/app/agencies/${id}` : `/app/agencies/${id}/${t}`
          const active = t === tab
          return (
            <Link
              key={t}
              href={href}
              aria-current={active ? 'page' : undefined}
              className={
                'rounded-t-md px-3 py-2 text-sm capitalize ' +
                (active ? 'border-b-2 border-primary font-medium text-primary' : 'text-muted-foreground hover:text-foreground')
              }
            >
              {t}
            </Link>
          )
        })}
      </nav>

      {tab === 'overview' ? <OverviewTab id={id} agency={agency} /> : <ReferralsTab id={id} />}
    </DetailShell>
  )
}

function money(n: number) {
  return `$${Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 0 })}`
}

async function OverviewTab({ id, agency }: { id: string; agency: Agency }) {
  const activation = await load<{ stage: string }[]>(
    (db) => db.from('agency_activation').select('stage').eq('agency_id', id).order('created_at', { ascending: false }).limit(1),
    [],
  )
  const activities = await load<{ id: string; kind: string; note: string; created_at: string }[]>(
    (db) =>
      db
        .from('activities')
        .select('id, kind, note, created_at')
        .eq('entity_type', 'agency_partnership')
        .eq('entity_id', id)
        .order('created_at', { ascending: false })
        .limit(10),
    [],
  )
  const stage = activation.ok && activation.data[0] ? activation.data[0].stage : '—'

  return (
    <div className="mt-4 space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="YTD placed premium" value={money(agency.ytd_placed_premium)} />
        <Stat label="YTD referrals" value={String(agency.ytd_referrals)} />
        <Stat label="P&C book policies" value={String(agency.pc_book_policies)} />
        <Stat label="Life policies in force" value={String(agency.life_policies_in_force)} />
        <Stat label="Activation stage" value={stage} />
        <Stat label="Check-in interval" value={`${agency.checkin_interval_days} days`} />
        <Stat label="Last contact" value={agency.last_contact_at ? new Date(agency.last_contact_at).toLocaleDateString('en-US') : 'Never'} />
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent activity</CardTitle>
        </CardHeader>
        <CardContent>
          {!activities.ok ? (
            <p className="text-sm text-destructive">Could not load activity.</p>
          ) : activities.data.length === 0 ? (
            <p className="text-sm text-muted-foreground">No activity yet. Use “Start check-in” to log the first touch.</p>
          ) : (
            <ol className="space-y-2">
              {activities.data.map((a) => (
                <li key={a.id} className="flex gap-2 text-sm">
                  <span className="text-muted-foreground">{new Date(a.created_at).toLocaleDateString('en-US')}</span>
                  <span className="font-medium capitalize">{a.kind}</span>
                  <span className="text-muted-foreground">— {a.note}</span>
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

async function ReferralsTab({ id }: { id: string }) {
  const res = await load<{ id: string; referred_name: string | null; engagement: string; status: string; received_at: string }[]>(
    (db) =>
      db
        .from('referrals')
        .select('id, referred_name, engagement, status, received_at')
        .eq('referring_agency_id', id)
        .is('deleted_at', null)
        .order('received_at', { ascending: false }),
    [],
  )
  if (!res.ok) return <ErrorState className="mt-4" description="Could not load referrals." />
  if (res.data.length === 0)
    return (
      <div className="mt-4">
        <EmptyState
          title="No referrals from this agency yet"
          description="When this partner sends a referral it appears here."
          action={
            <Button asChild size="sm">
              <Link href={`/app/referrals/new?agency=${id}`}>Record a referral</Link>
            </Button>
          }
        />
      </div>
    )
  return (
    <div className="mt-4 rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Referred</TableHead>
            <TableHead>Engagement</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Received</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {res.data.map((r) => (
            <TableRow key={r.id}>
              <TableCell>
                <Link href={`/app/referrals/${r.id}`} className="text-primary hover:underline">
                  {r.referred_name ?? 'Unnamed'}
                </Link>
              </TableCell>
              <TableCell className="text-muted-foreground">{r.engagement}</TableCell>
              <TableCell>
                <Badge variant={r.status === 'converted' ? 'won' : r.status === 'declined' ? 'lost' : 'active'}>{r.status}</Badge>
              </TableCell>
              <TableCell className="text-muted-foreground">{new Date(r.received_at).toLocaleDateString('en-US')}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-semibold">{value}</p>
    </div>
  )
}
