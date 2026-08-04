import Link from 'next/link'
import { notFound } from 'next/navigation'
import { DetailShell, ErrorState, EmptyState } from '@/components/archetypes'
import {
  ContactSectionNav,
  ContactStatusRow,
  ContactTimeline,
  ContactActionBar,
  CONTACT_SECTION_IDS,
  CONTACT_SECTIONS,
  type ContactSection,
} from '@/components/archetypes'
import { Badge } from '@/components/ui/badge'
import { SecuritiesChip, securitiesRowClass } from '@/components/ui/securities'
import { Numeric } from '@/components/ui/typography'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { load } from '@/lib/data/query'
import { humanize } from '@/lib/dashboards/format'

// Contact 360 canonical sections (redesign spec §4.2). The record collapses the
// legacy flat tab list into six sections + a persistent Timeline + a persistent
// action bar, all composed from the shared design-system components (§12).
export { CONTACT_SECTION_IDS as HOUSEHOLD_SECTIONS } from '@/components/archetypes'
export type { ContactSection } from '@/components/archetypes'

// Legacy segment aliases so old bookmarks/links resolve instead of 404ing. The
// route handler maps these to the canonical section (redesign §16 — nothing
// removed, only regrouped).
export const HOUSEHOLD_SECTION_ALIASES: Record<string, ContactSection> = {
  members: 'people',
  policies: 'financial-planning',
  opportunities: 'crm',
  reviews: 'crm',
  documents: 'documents',
  preferences: 'preferences',
}

const SECTION_LABEL = new Map(CONTACT_SECTIONS.map((s) => [s.id, s.label] as const))

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
}

export async function HouseholdProfile({ id, section }: { id: string; section: ContactSection }) {
  const res = await load<Household | null>(
    (db) => db.from('households').select('*').eq('id', id).is('deleted_at', null).maybeSingle(),
    null,
  )
  if (!res.ok) return <ErrorState description={res.kind === 'not_configured' ? 'Database not configured.' : res.message} />
  const hh = res.data
  if (!hh) notFound()

  // Firewall marker (spec §14 / guardrail §4.1): does the household hold any
  // is_security record? Kept read-only and informational.
  const sec = await load<{ id: string }[]>(
    (db) =>
      db.from('household_policies').select('id').eq('household_id', id).eq('is_security', true).is('deleted_at', null).limit(1),
    [],
  )
  const hasSecurities = sec.ok && sec.data.length > 0

  const sectionLabel = SECTION_LABEL.get(section) ?? 'Overview'

  return (
    <DetailShell
      title={hh.primary_name}
      description={[hh.city, hh.state].filter(Boolean).join(', ') || 'Client household'}
      breadcrumb={[
        { label: 'FSA', href: '/app' },
        { label: 'Contacts', href: '/app/households' },
        { label: hh.primary_name, href: `/app/households/${id}` },
        { label: sectionLabel },
      ]}
      status={
        <ContactStatusRow doNotContact={hh.do_not_contact} hasSecurities={hasSecurities} archived={!!hh.archived_at} />
      }
      actions={<ContactActionBar id={id} />}
      rail={<ContactTimeline entityId={id} />}
    >
      <ContactSectionNav id={id} active={section} />
      <div className="mt-4">
        {section === 'overview' ? (
          <Overview id={id} hh={hh} hasSecurities={hasSecurities} />
        ) : section === 'people' ? (
          <People id={id} />
        ) : section === 'financial-planning' ? (
          <FinancialPlanning id={id} />
        ) : section === 'crm' ? (
          <Crm id={id} />
        ) : section === 'documents' ? (
          <Documents id={id} />
        ) : (
          <Preferences id={id} doNotContact={hh.do_not_contact} />
        )}
      </div>
    </DetailShell>
  )
}

// ─── Overview ─────────────────────────────────────────────────────────────────

async function Overview({ id, hh, hasSecurities }: { id: string; hh: Household; hasSecurities: boolean }) {
  const [members, policies, opps, agency] = await Promise.all([
    load<{ id: string }[]>((db) => db.from('household_members').select('id').eq('household_id', id).is('deleted_at', null), []),
    load<{ id: string }[]>((db) => db.from('household_policies').select('id').eq('household_id', id).is('deleted_at', null), []),
    load<{ id: string; stage: string }[]>((db) => db.from('opportunities').select('id, stage').eq('household_id', id).is('deleted_at', null), []),
    hh.referring_agency_id
      ? load<{ agency_name: string } | null>((db) => db.from('agency_partnerships').select('agency_name').eq('id', hh.referring_agency_id).maybeSingle(), null)
      : Promise.resolve({ ok: true as const, data: null }),
  ])
  const openOpps = (opps.ok ? opps.data : []).filter((o) => o.stage !== 'placed_issued' && o.stage !== 'lost')

  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <Stat label="Members" value={String(members.ok ? members.data.length : 0)} href={`/app/households/${id}/people`} />
      <Stat label="Policies" value={String(policies.ok ? policies.data.length : 0)} href={`/app/households/${id}/financial-planning`} />
      <Stat label="Open opportunities" value={String(openOpps.length)} href={`/app/households/${id}/crm`} />

      <Card className="sm:col-span-2">
        <CardHeader><CardTitle className="text-base">Address</CardTitle></CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          {[hh.address, hh.city, hh.state, hh.zip].filter(Boolean).join(', ') || 'No address on file.'}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Referring agency</CardTitle></CardHeader>
        <CardContent className="text-sm">
          {hh.referring_agency_id && agency.ok && agency.data ? (
            <Link href={`/app/agencies/${hh.referring_agency_id}`} className="text-primary hover:underline">
              {agency.data.agency_name}
            </Link>
          ) : (
            <span className="text-muted-foreground">Not attributed to an agency.</span>
          )}
        </CardContent>
      </Card>

      {hasSecurities ? (
        <Card className="sm:col-span-3">
          <CardContent className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
            <SecuritiesChip />
            <span>
              This household holds a securities record. It is managed in the FFS-supervised system — FSOS holds a
              reference only, and never auto-communicates it.
            </span>
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}

// ─── People ───────────────────────────────────────────────────────────────────

async function People({ id }: { id: string }) {
  const res = await load<{ id: string; full_name: string; relationship: string | null; email: string | null; phone: string | null }[]>(
    (db) => db.from('household_members').select('id, full_name, relationship, email, phone').eq('household_id', id).is('deleted_at', null).order('created_at'),
    [],
  )
  const add = <Button asChild size="sm"><Link href={`/app/households/${id}/members/new`}>Add member</Link></Button>
  if (!res.ok) return <ErrorState description="Could not load members." />
  if (res.data.length === 0) {
    return <EmptyState title="No members yet" description="Add the primary and any dependents, joint owners, or beneficiaries." action={add} />
  }
  return (
    <div className="space-y-3">
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
                <TableCell className="text-muted-foreground">{m.relationship ? humanize(m.relationship) : '—'}</TableCell>
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

// ─── Financial Planning ───────────────────────────────────────────────────────

async function FinancialPlanning({ id }: { id: string }) {
  const [policies, reviews] = await Promise.all([
    load<{ id: string; policy_number: string | null; status: string; is_security: boolean; is_with_us: boolean }[]>(
      (db) => db.from('household_policies').select('id, policy_number, status, is_security, is_with_us').eq('household_id', id).is('deleted_at', null).order('created_at', { ascending: false }),
      [],
    ),
    load<{ id: string; type: string; stage: string; scheduled_at: string | null }[]>(
      (db) => db.from('reviews').select('id, type, stage, scheduled_at').eq('household_id', id).is('deleted_at', null).order('created_at', { ascending: false }),
      [],
    ),
  ])

  const addPolicy = <Button asChild size="sm"><Link href={`/app/policies/new?household=${id}`}>Record policy</Link></Button>
  const addReview = <Button asChild size="sm" variant="outline"><Link href={`/app/reviews/new?household=${id}`}>New review</Link></Button>

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Policies &amp; coverage</h3>
          {policies.ok && policies.data.length > 0 ? addPolicy : null}
        </div>
        {!policies.ok ? (
          <ErrorState description="Could not load policies." />
        ) : policies.data.length === 0 ? (
          <EmptyState title="No policies yet" description="Record a policy or coverage for this household." action={addPolicy} />
        ) : (
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow><TableHead>Policy #</TableHead><TableHead>Status</TableHead><TableHead>Book</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {policies.data.map((p) => (
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
        )}
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Financial reviews</h3>
          {reviews.ok && reviews.data.length > 0 ? addReview : null}
        </div>
        {!reviews.ok ? (
          <ErrorState description="Could not load reviews." />
        ) : reviews.data.length === 0 ? (
          <EmptyState title="No reviews yet" description="Policy, coverage, term-conversion, retirement, and annual reviews are where opportunities originate." action={addReview} />
        ) : (
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow><TableHead>Type</TableHead><TableHead>Stage</TableHead><TableHead>Scheduled</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {reviews.data.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell><Link href={`/app/reviews/${r.id}`} className="text-primary hover:underline">{humanize(r.type)}</Link></TableCell>
                    <TableCell className="text-muted-foreground">{humanize(r.stage)}</TableCell>
                    <TableCell className="text-muted-foreground">{r.scheduled_at ? new Date(r.scheduled_at).toLocaleDateString() : '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>
    </div>
  )
}

// ─── CRM ──────────────────────────────────────────────────────────────────────

async function Crm({ id }: { id: string }) {
  const [opps, appts] = await Promise.all([
    load<{ id: string; stage: string; engagement: string; is_security: boolean; expected_commission: number | null }[]>(
      (db) => db.from('opportunities').select('id, stage, engagement, is_security, expected_commission').eq('household_id', id).is('deleted_at', null).order('created_at', { ascending: false }),
      [],
    ),
    load<{ id: string; scheduled_at: string | null; status: string }[]>(
      (db) => db.from('appointments').select('id, scheduled_at, status').eq('household_id', id).order('scheduled_at', { ascending: false }).limit(10),
      [],
    ),
  ])

  const addOpp = <Button asChild size="sm"><Link href={`/app/opportunities/new?household=${id}`}>New opportunity</Link></Button>

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Opportunities</h3>
          {opps.ok && opps.data.length > 0 ? addOpp : null}
        </div>
        {!opps.ok ? (
          <ErrorState description="Could not load opportunities." />
        ) : opps.data.length === 0 ? (
          <EmptyState title="No opportunities yet" description="Open an opportunity when a need surfaces from a review or referral." action={addOpp} />
        ) : (
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow><TableHead>Stage</TableHead><TableHead>Engagement</TableHead><TableHead className="text-right">Expected commission</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {opps.data.map((o) => (
                  <TableRow key={o.id} className={o.is_security ? securitiesRowClass : undefined}>
                    <TableCell>
                      <Link href={`/app/opportunities/${o.id}`} className="text-primary hover:underline">{humanize(o.stage)}</Link>
                      {o.is_security ? <SecuritiesChip className="ml-2" /> : null}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{humanize(o.engagement)}</TableCell>
                    <TableCell className="text-right text-muted-foreground"><Numeric>{o.expected_commission != null ? `$${o.expected_commission.toLocaleString()}` : '—'}</Numeric></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold">Appointments</h3>
        {!appts.ok ? (
          <ErrorState description="Could not load appointments." />
        ) : appts.data.length === 0 ? (
          <EmptyState title="No appointments" description="Schedule a meeting from the action bar." action={<Button asChild size="sm" variant="outline"><Link href="/app/booking">Schedule</Link></Button>} />
        ) : (
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow><TableHead>When</TableHead><TableHead>Status</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {appts.data.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell>{a.scheduled_at ? new Date(a.scheduled_at).toLocaleString() : '—'}</TableCell>
                    <TableCell><Badge variant={a.status === 'completed' ? 'won' : a.status === 'cancelled' || a.status === 'no_show' ? 'lost' : 'active'}>{humanize(a.status)}</Badge></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      <p className="text-xs text-muted-foreground">
        Calls, SMS, emails, campaigns, and AI conversations are logged to the Timeline and managed through the{' '}
        <Link href="/app/comms" className="text-primary hover:underline">communications workspace</Link> (dispatcher-gated).
      </p>
    </div>
  )
}

// ─── Documents ────────────────────────────────────────────────────────────────

async function Documents({ id }: { id: string }) {
  const [docs, requests] = await Promise.all([
    load<{ id: string; classification: string | null; version: number; created_at: string }[]>(
      (db) => db.from('documents').select('id, classification, version, created_at').eq('entity_type', 'household').eq('entity_id', id).order('created_at', { ascending: false }),
      [],
    ),
    load<{ id: string; requirement: string; status: string }[]>(
      (db) => db.from('document_requests').select('id, requirement, status').eq('household_id', id).order('created_at', { ascending: false }),
      [],
    ),
  ])
  const upload = <Button asChild size="sm"><Link href="/app/documents">Open Upload Center</Link></Button>

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Documents</h3>
          {docs.ok && docs.data.length > 0 ? upload : null}
        </div>
        {!docs.ok ? (
          <ErrorState description="Could not load documents." />
        ) : docs.data.length === 0 ? (
          <EmptyState title="No documents yet" description="Upload household documents through the Upload Center — the single entry point for every upload." action={upload} />
        ) : (
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow><TableHead>Classification</TableHead><TableHead>Version</TableHead><TableHead>Added</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {docs.data.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell><Link href={`/app/documents/${d.id}`} className="text-primary hover:underline">{d.classification ? humanize(d.classification) : 'Document'}</Link></TableCell>
                    <TableCell className="text-muted-foreground">v{d.version}</TableCell>
                    <TableCell className="text-muted-foreground">{new Date(d.created_at).toLocaleDateString()}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      {requests.ok && requests.data.length > 0 ? (
        <section className="space-y-3">
          <h3 className="text-sm font-semibold">Requested documents</h3>
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow><TableHead>Requirement</TableHead><TableHead>Status</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {requests.data.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>{r.requirement}</TableCell>
                    <TableCell><Badge variant={r.status === 'received' ? 'won' : r.status === 'waived' ? 'draft' : 'pending'}>{humanize(r.status)}</Badge></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </section>
      ) : null}
    </div>
  )
}

// ─── Preferences ──────────────────────────────────────────────────────────────

async function Preferences({ id, doNotContact }: { id: string; doNotContact: boolean }) {
  const consents = await load<{ id: string; channel: string; status: string; captured_at: string }[]>(
    (db) => db.from('consents').select('id, channel, status, captured_at').eq('household_id', id).order('captured_at', { ascending: false }),
    [],
  )

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader><CardTitle className="text-base">Contact status</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="flex items-center gap-2">
            <ContactStatusRow doNotContact={doNotContact} />
          </div>
          <p className="text-muted-foreground">
            Informational only. STOP is honored automatically at send time by the dispatcher — there is no consent-capture
            step here (standing decision: frictionless data).
          </p>
          <p>
            <Link href="/app/compliance/consent" className="text-primary hover:underline">Manage the consent &amp; opt-out ledger →</Link>
          </p>
        </CardContent>
      </Card>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold">Channel consent</h3>
        {!consents.ok ? (
          <ErrorState description="Could not load consent records." />
        ) : consents.data.length === 0 ? (
          <EmptyState title="No consent records" description="Channel-level consent for this household will appear here as it is captured." />
        ) : (
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow><TableHead>Channel</TableHead><TableHead>Status</TableHead><TableHead>Captured</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {consents.data.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="uppercase">{c.channel}</TableCell>
                    <TableCell><Badge variant={c.status === 'granted' ? 'won' : 'lost'}>{c.status}</Badge></TableCell>
                    <TableCell className="text-muted-foreground">{new Date(c.captured_at).toLocaleDateString()}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>
    </div>
  )
}

// ─── shared ───────────────────────────────────────────────────────────────────

function Stat({ label, value, href }: { label: string; value: string; href: string }) {
  return (
    <Link href={href} className="rounded-lg border p-4 hover:border-primary/40">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
    </Link>
  )
}
