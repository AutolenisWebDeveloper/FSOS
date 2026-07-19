import Link from 'next/link'
import { notFound } from 'next/navigation'
import { DetailShell, ErrorState, EmptyState } from '@/components/archetypes'
import { Badge } from '@/components/ui/badge'
import { SecuritiesChip, securitiesRowClass } from '@/components/ui/securities'
import { Numeric } from '@/components/ui/typography'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { load } from '@/lib/data/query'
import { LogActivityButton } from '@/components/app/LogActivityButton'
import { GhlSyncButton } from '@/components/app/GhlSyncButton'

export const HOUSEHOLD_P0_TABS = ['overview', 'members', 'policies'] as const
export type HouseholdTab = (typeof HOUSEHOLD_P0_TABS)[number]

interface Household {
  id: string
  primary_name: string
  referring_agency_id: string | null
  address: string | null
  city: string | null
  state: string | null
  zip: string | null
  do_not_contact: boolean
  archived_at: string | null
  ghl_synced_at: string | null
}

export async function HouseholdProfile({ id, tab }: { id: string; tab: HouseholdTab }) {
  const res = await load<Household | null>(
    (db) => db.from('households').select('*').eq('id', id).is('deleted_at', null).maybeSingle(),
    null,
  )
  if (!res.ok) return <ErrorState description={res.kind === 'not_configured' ? 'Database not configured.' : res.message} />
  const hh = res.data
  if (!hh) notFound()

  const rail = (
    <div className="space-y-3 text-sm">
      <p className="font-medium">Related</p>
      <ul className="space-y-1.5">
        <li><Link href={`/app/households/${id}/members`} className="text-primary hover:underline">Members</Link></li>
        <li><Link href={`/app/households/${id}/policies`} className="text-primary hover:underline">Policies</Link></li>
        <li><Link href={`/app/opportunities?household=${id}`} className="text-primary hover:underline">Opportunities</Link></li>
        {hh.referring_agency_id ? (
          <li><Link href={`/app/agencies/${hh.referring_agency_id}`} className="text-primary hover:underline">Referring agency</Link></li>
        ) : null}
      </ul>
      <p className="pt-2 text-xs text-muted-foreground">Reviews, documents, consent &amp; communications arrive as P1 tabs.</p>
    </div>
  )

  return (
    <DetailShell
      title={hh.primary_name}
      description={[hh.city, hh.state].filter(Boolean).join(', ') || 'Client household'}
      breadcrumb={[{ label: 'FSA', href: '/app' }, { label: 'Households', href: '/app/households' }, { label: hh.primary_name, href: `/app/households/${id}` }, { label: tab }]}
      status={
        <span className="flex items-center gap-2">
          {hh.do_not_contact ? <Badge variant="blocked">DNC</Badge> : <Badge variant="active">contactable</Badge>}
          {hh.archived_at ? <Badge variant="draft">archived</Badge> : null}
        </span>
      }
      actions={
        <>
          <LogActivityButton entityType="household" entityId={id} />
          <GhlSyncButton entityType="household" entityId={id} synced={!!hh.ghl_synced_at} />
        </>
      }
      rail={rail}
    >
      <nav className="flex gap-1 border-b" aria-label="Household tabs">
        {HOUSEHOLD_P0_TABS.map((t) => {
          const href = t === 'overview' ? `/app/households/${id}` : `/app/households/${id}/${t}`
          const active = t === tab
          return (
            <Link key={t} href={href} aria-current={active ? 'page' : undefined} className={'rounded-t-md px-3 py-2 text-sm capitalize ' + (active ? 'border-b-2 border-primary font-medium text-primary' : 'text-muted-foreground hover:text-foreground')}>
              {t}
            </Link>
          )
        })}
      </nav>

      {tab === 'overview' ? <Overview id={id} hh={hh} /> : tab === 'members' ? <Members id={id} /> : <Policies id={id} />}
    </DetailShell>
  )
}

async function Overview({ id, hh }: { id: string; hh: Household }) {
  const [members, policies, opps] = await Promise.all([
    load<{ id: string }[]>((db) => db.from('household_members').select('id').eq('household_id', id).is('deleted_at', null), []),
    load<{ id: string }[]>((db) => db.from('household_policies').select('id').eq('household_id', id).is('deleted_at', null), []),
    load<{ id: string }[]>((db) => db.from('opportunities').select('id').eq('household_id', id).is('deleted_at', null), []),
  ])
  return (
    <div className="mt-4 grid gap-4 sm:grid-cols-3">
      <Stat label="Members" value={String(members.ok ? members.data.length : 0)} href={`/app/households/${id}/members`} />
      <Stat label="Policies" value={String(policies.ok ? policies.data.length : 0)} href={`/app/households/${id}/policies`} />
      <Stat label="Opportunities" value={String(opps.ok ? opps.data.length : 0)} href={`/app/opportunities?household=${id}`} />
      <Card className="sm:col-span-3">
        <CardHeader><CardTitle className="text-base">Address</CardTitle></CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          {[hh.address, hh.city, hh.state, hh.zip].filter(Boolean).join(', ') || 'No address on file.'}
        </CardContent>
      </Card>
    </div>
  )
}

async function Members({ id }: { id: string }) {
  const res = await load<{ id: string; full_name: string; relationship: string | null; email: string | null; phone: string | null }[]>(
    (db) => db.from('household_members').select('id, full_name, relationship, email, phone').eq('household_id', id).is('deleted_at', null).order('created_at'),
    [],
  )
  const add = (
    <Button asChild size="sm"><Link href={`/app/households/${id}/members/new`}>Add member</Link></Button>
  )
  if (!res.ok) return <ErrorState className="mt-4" description="Could not load members." />
  if (res.data.length === 0) {
    return <div className="mt-4"><EmptyState title="No members yet" description="Add the primary and any dependents." action={add} /></div>
  }
  return (
    <div className="mt-4 space-y-3">
      <div className="flex justify-end">{add}</div>
      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow><TableHead>Name</TableHead><TableHead>Relationship</TableHead><TableHead>Email</TableHead><TableHead>Phone</TableHead></TableRow>
          </TableHeader>
          <TableBody>
            {res.data.map((m) => (
              <TableRow key={m.id}>
                <TableCell><Link href={`/app/households/${id}/members/${m.id}`} className="text-primary hover:underline">{m.full_name}</Link></TableCell>
                <TableCell className="text-muted-foreground">{m.relationship ?? '—'}</TableCell>
                <TableCell className="text-muted-foreground">{m.email ?? '—'}</TableCell>
                <TableCell className="text-muted-foreground">{m.phone ?? '—'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}

async function Policies({ id }: { id: string }) {
  const res = await load<{ id: string; policy_number: string | null; status: string; is_security: boolean; is_with_us: boolean }[]>(
    (db) => db.from('household_policies').select('id, policy_number, status, is_security, is_with_us').eq('household_id', id).is('deleted_at', null).order('created_at', { ascending: false }),
    [],
  )
  const add = (
    <Button asChild size="sm"><Link href={`/app/policies/new?household=${id}`}>Record policy</Link></Button>
  )
  if (!res.ok) return <ErrorState className="mt-4" description="Could not load policies." />
  if (res.data.length === 0) {
    return <div className="mt-4"><EmptyState title="No policies yet" description="Record a policy or coverage for this household." action={add} /></div>
  }
  return (
    <div className="mt-4 space-y-3">
      <div className="flex justify-end">{add}</div>
      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow><TableHead>Policy #</TableHead><TableHead>Status</TableHead><TableHead>Book</TableHead></TableRow>
          </TableHeader>
          <TableBody>
            {res.data.map((p) => (
              <TableRow key={p.id} className={p.is_security ? securitiesRowClass : undefined}>
                <TableCell>
                  <Link href={`/app/policies/${p.id}`} className="text-primary hover:underline"><Numeric>{p.policy_number ?? 'Unnumbered'}</Numeric></Link>
                  {p.is_security ? <SecuritiesChip className="ml-2" /> : null}
                </TableCell>
                <TableCell><Badge variant={p.status === 'active' ? 'won' : p.status === 'lapsed' || p.status === 'cancelled' ? 'lost' : 'active'}>{p.status}</Badge></TableCell>
                <TableCell className="text-muted-foreground">{p.is_with_us ? 'Own book' : 'Competitor'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}

function Stat({ label, value, href }: { label: string; value: string; href: string }) {
  return (
    <Link href={href} className="rounded-lg border p-4 hover:border-primary/40">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
    </Link>
  )
}
