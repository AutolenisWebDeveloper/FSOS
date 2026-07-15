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
// P2 (operational enhancement) tabs — engagement, penetration & health analytics,
// training, and goals. Added without weakening any P0 gate.
export const AGENCY_P2_TABS = ['engagement', 'penetration', 'health', 'training', 'goals'] as const
export const AGENCY_TABS = [...AGENCY_P0_TABS, ...AGENCY_P2_TABS] as const
export type AgencyTab = (typeof AGENCY_TABS)[number]

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
        <li>
          <Link href={`/app/agencies/${id}/health`} className="text-primary hover:underline">
            Agency health
          </Link>
        </li>
        <li>
          <Link href="/app/agencies/leaderboard" className="text-primary hover:underline">
            Leaderboard
          </Link>
        </li>
      </ul>
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
      {/* Tab nav (only resolving tabs — no dead links) */}
      <nav className="flex flex-wrap gap-1 border-b" aria-label="Agency tabs">
        {AGENCY_TABS.map((t) => {
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

      {tab === 'overview' ? (
        <OverviewTab id={id} agency={agency} />
      ) : tab === 'referrals' ? (
        <ReferralsTab id={id} />
      ) : tab === 'penetration' ? (
        <PenetrationTab id={id} />
      ) : tab === 'health' ? (
        <HealthTab id={id} />
      ) : tab === 'engagement' ? (
        <EngagementTab id={id} />
      ) : tab === 'training' ? (
        <TrainingTab id={id} />
      ) : (
        <GoalsTab id={id} agency={agency} />
      )}
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

// ─── P2 tabs ──────────────────────────────────────────────────────────────────

async function PenetrationTab({ id }: { id: string }) {
  const res = await load<{ agency_name: string; pc_book_policies: number; life_policies_in_force: number; life_penetration_pct: number }[]>(
    (db) => db.from('v_crosssell_targets').select('agency_name, pc_book_policies, life_policies_in_force, life_penetration_pct').eq('id', id).limit(1),
    [],
  )
  if (!res.ok) return <ErrorState className="mt-4" description="Could not load penetration." />
  const row = res.data[0]
  if (!row) return <div className="mt-4"><EmptyState title="No book data yet" description="P&C book and life-in-force counts populate penetration analytics." /></div>
  return (
    <div className="mt-4 grid gap-4 sm:grid-cols-3">
      <Stat label="P&C book policies" value={String(row.pc_book_policies)} />
      <Stat label="Life policies in force" value={String(row.life_policies_in_force)} />
      <Stat label="Life penetration" value={`${row.life_penetration_pct}%`} />
      <div className="sm:col-span-3">
        <Link href="/app/cross-sell/agency-penetration" className="text-sm text-primary hover:underline">See all agencies by penetration →</Link>
      </div>
    </div>
  )
}

async function HealthTab({ id }: { id: string }) {
  const res = await load<{ health_score: number; days_since_contact: number; life_penetration_pct: number; status: string }[]>(
    (db) => db.from('v_agency_health').select('health_score, days_since_contact, life_penetration_pct, status').eq('id', id).limit(1),
    [],
  )
  if (!res.ok) return <ErrorState className="mt-4" description="Could not load health." />
  const row = res.data[0]
  if (!row) return <div className="mt-4"><EmptyState title="No health signal yet" description="Health scores from contact recency and penetration appear here." /></div>
  const band = row.health_score >= 70 ? 'won' : row.health_score >= 40 ? 'pending' : 'lost'
  return (
    <div className="mt-4 space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-lg border p-3">
          <p className="text-xs text-muted-foreground">Health score</p>
          <p className="mt-1 flex items-center gap-2 text-lg font-semibold">{row.health_score}<Badge variant={band}>{band === 'won' ? 'healthy' : band === 'pending' ? 'watch' : 'at risk'}</Badge></p>
        </div>
        <Stat label="Days since contact" value={String(row.days_since_contact)} />
        <Stat label="Life penetration" value={`${row.life_penetration_pct}%`} />
      </div>
      <p className="text-xs text-muted-foreground">Health thresholds are operational heuristics — config defaults, not Farmers-published figures.</p>
    </div>
  )
}

async function EngagementTab({ id }: { id: string }) {
  const res = await load<{ id: string; kind: string; note: string; created_at: string }[]>(
    (db) => db.from('activities').select('id, kind, note, created_at').eq('entity_type', 'agency_partnership').eq('entity_id', id).order('created_at', { ascending: false }).limit(50),
    [],
  )
  if (!res.ok) return <ErrorState className="mt-4" description="Could not load engagement." />
  if (res.data.length === 0) return <div className="mt-4"><EmptyState title="No engagement logged" description="Check-ins, calls, and touches appear here." action={<LogActivityButton entityType="agency_partnership" entityId={id} kind="checkin" label="Log a touch" />} /></div>
  return (
    <div className="mt-4 space-y-2">
      <div className="mb-2"><LogActivityButton entityType="agency_partnership" entityId={id} kind="checkin" label="Log a touch" /></div>
      <ol className="space-y-2">
        {res.data.map((a) => (
          <li key={a.id} className="flex gap-2 rounded-lg border p-2 text-sm">
            <span className="text-muted-foreground">{new Date(a.created_at).toLocaleDateString('en-US')}</span>
            <span className="font-medium capitalize">{a.kind}</span>
            <span className="text-muted-foreground">— {a.note}</span>
          </li>
        ))}
      </ol>
    </div>
  )
}

async function TrainingTab({ id }: { id: string }) {
  const [modules, completions] = await Promise.all([
    load<{ id: string; title: string; category: string | null; required: boolean }[]>(
      (db) => db.from('partner_training').select('id, title, category, required').eq('published', true).order('created_at', { ascending: true }),
      [],
    ),
    load<{ training_id: string }[]>(
      (db) => db.from('partner_training_completions').select('training_id').eq('agency_id', id),
      [],
    ),
  ])
  if (!modules.ok) return <ErrorState className="mt-4" description="Could not load training." />
  if (modules.data.length === 0) return <div className="mt-4"><EmptyState title="No training modules" description="Published partner training appears here." /></div>
  const done = new Set((completions.ok ? completions.data : []).map((c) => c.training_id))
  return (
    <div className="mt-4 rounded-lg border">
      <Table>
        <TableHeader><TableRow><TableHead>Module</TableHead><TableHead>Category</TableHead><TableHead>Required</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
        <TableBody>
          {modules.data.map((m) => (
            <TableRow key={m.id}>
              <TableCell className="font-medium">{m.title}</TableCell>
              <TableCell className="capitalize text-muted-foreground">{m.category ?? '—'}</TableCell>
              <TableCell>{m.required ? <Badge variant="pending">required</Badge> : <span className="text-muted-foreground">optional</span>}</TableCell>
              <TableCell>{done.has(m.id) ? <Badge variant="won">completed</Badge> : <Badge variant="draft">not started</Badge>}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

function GoalsTab({ id, agency }: { id: string; agency: Agency }) {
  // Goals are operational targets set by the FSA (config; editable). Baselines are
  // the agency's current book so a goal is always contextualized.
  const lifeTarget = Math.max(agency.life_policies_in_force + 5, Math.round(agency.pc_book_policies * 0.15))
  const referralTarget = Math.max(agency.ytd_referrals + 2, 6)
  return (
    <div className="mt-4 space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">Life penetration goal</CardTitle></CardHeader>
          <CardContent className="space-y-1 text-sm">
            <p>Current in-force: <span className="font-semibold">{agency.life_policies_in_force}</span></p>
            <p>Target: <span className="font-semibold">{lifeTarget}</span> <Badge variant="assumption">config default — verify</Badge></p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Referral goal (YTD)</CardTitle></CardHeader>
          <CardContent className="space-y-1 text-sm">
            <p>Current: <span className="font-semibold">{agency.ytd_referrals}</span></p>
            <p>Target: <span className="font-semibold">{referralTarget}</span> <Badge variant="assumption">config default — verify</Badge></p>
          </CardContent>
        </Card>
      </div>
      <p className="text-xs text-muted-foreground">Goal targets are editable operational defaults — not Farmers-published quotas.</p>
      <Link href={`/app/agencies/${id}/health`} className="text-sm text-primary hover:underline">View agency health →</Link>
    </div>
  )
}
