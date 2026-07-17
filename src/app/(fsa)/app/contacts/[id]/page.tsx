import Link from 'next/link'
import { notFound } from 'next/navigation'
import { DetailShell, ErrorState } from '@/components/archetypes'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { MonoLabel, Money } from '@/components/ui/typography'
import { SecuritiesChip } from '@/components/ui/securities'
import { load } from '@/lib/data/query'
import { ContactForm } from '@/components/app/ContactForm'
import { ContactDetailActions } from '@/components/app/ContactDetailActions'
import { CONTACT_TYPE_LABEL } from '@/components/app/contactMeta'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

interface Contact {
  id: string
  first_name: string | null
  last_name: string | null
  full_name: string
  email: string | null
  phone: string | null
  company: string | null
  title: string | null
  contact_type: string
  tags: string[]
  source: string | null
  status: string
  household_id: string | null
  agency_partnership_id: string | null
  address: string | null
  city: string | null
  state: string | null
  zip: string | null
  notes: string | null
  created_at: string
}
interface Policy { id: string; policy_number: string | null; product_name: string | null; status: string; is_security: boolean; face_amount: number | string | null }
interface Member { id: string; full_name: string; relationship: string | null }

export default async function ContactDetailPage({ params }: { params: { id: string } }) {
  const res = await load<Contact | null>(
    (db) => db.from('contacts').select('*').eq('id', params.id).is('deleted_at', null).maybeSingle(),
    null,
  )
  if (!res.ok) return <ErrorState description={res.kind === 'not_configured' ? 'Database not configured.' : res.message} />
  const c = res.data
  if (!c) notFound()

  // Source-of-truth aggregation: the linked household's policies + members + agency.
  const [policiesR, membersR, agencyR] = await Promise.all([
    c.household_id
      ? load<Policy[]>((db) => db.from('household_policies').select('id, policy_number, product_name, status, is_security, face_amount').eq('household_id', c.household_id!).is('deleted_at', null).order('created_at', { ascending: false }), [])
      : Promise.resolve({ ok: true as const, data: [] as Policy[] }),
    c.household_id
      ? load<Member[]>((db) => db.from('household_members').select('id, full_name, relationship').eq('household_id', c.household_id!).is('deleted_at', null), [])
      : Promise.resolve({ ok: true as const, data: [] as Member[] }),
    c.agency_partnership_id
      ? load<{ agency_name: string } | null>((db) => db.from('agency_partnerships').select('agency_name').eq('id', c.agency_partnership_id!).maybeSingle(), null)
      : Promise.resolve({ ok: true as const, data: null }),
  ])
  const policies = policiesR.ok ? policiesR.data : []
  const members = membersR.ok ? membersR.data : []
  const agencyName = agencyR.ok && agencyR.data ? agencyR.data.agency_name : null

  const mailing = [c.address, [c.city, c.state].filter(Boolean).join(', '), c.zip].filter(Boolean).join(' · ')

  const rail = (
    <div className="space-y-3 text-sm">
      <p className="font-medium">Contact details</p>
      <dl className="space-y-1.5">
        <Row label="Type" value={CONTACT_TYPE_LABEL[c.contact_type] ?? c.contact_type} />
        <Row label="Phone" value={c.phone} mono />
        <Row label="Email" value={c.email} />
        <Row label="Mailing" value={mailing || null} />
        <Row label="Source" value={c.source} />
        <Row label="Added" value={new Date(c.created_at).toLocaleDateString('en-US')} />
      </dl>
      {c.tags.length ? (
        <div>
          <p className="mb-1 text-xs text-muted-foreground">Tags</p>
          <div className="flex flex-wrap gap-1">{c.tags.map((t) => <Badge key={t} variant="draft" className="text-[10px]">{t}</Badge>)}</div>
        </div>
      ) : null}
      <ul className="space-y-1.5 pt-1">
        {c.household_id ? <li><Link href={`/app/households/${c.household_id}`} className="text-primary hover:underline">Open household</Link></li> : null}
        {c.agency_partnership_id ? <li><Link href={`/app/agencies/${c.agency_partnership_id}`} className="text-primary hover:underline">{agencyName ? `Agency: ${agencyName}` : 'Linked agency'}</Link></li> : null}
      </ul>
    </div>
  )

  return (
    <DetailShell
      title={c.full_name}
      description={[c.title, c.company, mailing].filter(Boolean).join(' · ') || 'Contact'}
      breadcrumb={[{ label: 'FSA', href: '/app' }, { label: 'Contacts', href: '/app/contacts' }, { label: c.full_name }]}
      status={<Badge variant={c.status === 'archived' ? 'draft' : 'active'}>{c.status}</Badge>}
      actions={<ContactDetailActions id={c.id} status={c.status} name={c.full_name} />}
      rail={rail}
    >
      {c.household_id ? (
        <div className="mb-6 grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Policies ({policies.length})</CardTitle></CardHeader>
            <CardContent>
              {policies.length === 0 ? (
                <p className="text-sm text-muted-foreground">No policies on the linked household.</p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader><TableRow><TableHead>Policy</TableHead><TableHead>Product</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Face</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {policies.map((p) => (
                        <TableRow key={p.id}>
                          <TableCell><MonoLabel>{p.policy_number ?? '—'}</MonoLabel></TableCell>
                          <TableCell className="text-xs">{p.product_name ?? '—'}{p.is_security ? <SecuritiesChip className="ml-1" /> : null}</TableCell>
                          <TableCell className="text-xs capitalize">{p.status}</TableCell>
                          <TableCell className="text-right"><Money value={p.face_amount == null ? null : Number(p.face_amount)} /></TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Household ({members.length})</CardTitle></CardHeader>
            <CardContent>
              {members.length === 0 ? (
                <p className="text-sm text-muted-foreground">No household members recorded.</p>
              ) : (
                <ul className="space-y-1.5 text-sm">
                  {members.map((m) => (
                    <li key={m.id} className="flex items-center justify-between gap-2">
                      <span>{m.full_name}</span>
                      <Badge variant="draft" className="text-[10px] capitalize">{(m.relationship ?? '—').replace(/_/g, ' ')}</Badge>
                    </li>
                  ))}
                </ul>
              )}
              {agencyName ? <p className="mt-3 text-xs text-muted-foreground">Serving agency: <span className="text-foreground">{agencyName}</span></p> : null}
            </CardContent>
          </Card>
        </div>
      ) : null}

      <div className="max-w-3xl">
        <ContactForm mode="edit" initial={c} />
      </div>
    </DetailShell>
  )
}

function Row({ label, value, mono }: { label: string; value: string | null; mono?: boolean }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={mono ? 'font-mono text-sm' : 'text-sm'}>{value || '—'}</dd>
    </div>
  )
}
