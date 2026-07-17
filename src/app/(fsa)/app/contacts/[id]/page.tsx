import Link from 'next/link'
import { notFound } from 'next/navigation'
import { DetailShell, ErrorState } from '@/components/archetypes'
import { Badge } from '@/components/ui/badge'
import { load } from '@/lib/data/query'
import { ContactForm } from '@/components/app/ContactForm'
import { ContactDetailActions } from '@/components/app/ContactDetailActions'
import { CONTACT_TYPE_LABEL } from '@/components/app/ContactList'

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
  city: string | null
  state: string | null
  zip: string | null
  notes: string | null
  created_at: string
}

export default async function ContactDetailPage({ params }: { params: { id: string } }) {
  const res = await load<Contact | null>(
    (db) => db.from('contacts').select('*').eq('id', params.id).is('deleted_at', null).maybeSingle(),
    null,
  )
  if (!res.ok) return <ErrorState description={res.kind === 'not_configured' ? 'Database not configured.' : res.message} />
  const c = res.data
  if (!c) notFound()

  const rail = (
    <div className="space-y-3 text-sm">
      <p className="font-medium">Details</p>
      <dl className="space-y-1.5">
        <div><dt className="text-xs text-muted-foreground">Type</dt><dd>{CONTACT_TYPE_LABEL[c.contact_type] ?? c.contact_type}</dd></div>
        <div><dt className="text-xs text-muted-foreground">Source</dt><dd>{c.source ?? '—'}</dd></div>
        <div><dt className="text-xs text-muted-foreground">Added</dt><dd>{new Date(c.created_at).toLocaleDateString('en-US')}</dd></div>
      </dl>
      {c.tags.length ? (
        <div>
          <p className="mb-1 text-xs text-muted-foreground">Tags</p>
          <div className="flex flex-wrap gap-1">{c.tags.map((t) => <Badge key={t} variant="draft" className="text-[10px]">{t}</Badge>)}</div>
        </div>
      ) : null}
      <ul className="space-y-1.5 pt-1">
        {c.household_id ? <li><Link href={`/app/households/${c.household_id}`} className="text-primary hover:underline">Linked household</Link></li> : null}
        {c.agency_partnership_id ? <li><Link href={`/app/agencies/${c.agency_partnership_id}`} className="text-primary hover:underline">Linked agency</Link></li> : null}
      </ul>
    </div>
  )

  return (
    <DetailShell
      title={c.full_name}
      description={[c.title, c.company].filter(Boolean).join(' · ') || 'Contact'}
      breadcrumb={[{ label: 'FSA', href: '/app' }, { label: 'Contacts', href: '/app/contacts' }, { label: c.full_name }]}
      status={
        <span className="flex items-center gap-2">
          <Badge variant={c.status === 'archived' ? 'draft' : 'active'}>{c.status}</Badge>
        </span>
      }
      actions={<ContactDetailActions id={c.id} status={c.status} name={c.full_name} />}
      rail={rail}
    >
      <div className="max-w-3xl">
        <ContactForm mode="edit" initial={c} />
      </div>
    </DetailShell>
  )
}
