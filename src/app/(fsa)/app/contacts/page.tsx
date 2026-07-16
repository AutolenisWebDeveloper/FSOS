import { Phone, Mail, Clock, Contact } from 'lucide-react'
import { requireRole } from '@/lib/auth/session'
import { ListShell, EmptyState, ErrorState } from '@/components/archetypes'
import { MonoLabel } from '@/components/ui/typography'
import { Card, CardContent } from '@/components/ui/card'
import { loadFfsContacts, type FfsContact } from '@/lib/data/ffs'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// FSA-facing FFS Key Contacts directory (ports the legacy Command Center "FFS
// Contacts" section into App B). Read-only view of the SAME config-driven
// `ffs_contacts` table that /super/config/ffs-contacts edits (docs/legacy-port.md
// §2.4) — contacts are configuration, never hard-coded. No mutation here, so no
// audit event. Roles: fsa, licensed_staff, super_admin (portal-gated by layout).
function telHref(phone: string): string {
  return 'tel:' + phone.replace(/[^0-9+]/g, '')
}

function ContactCard({ c }: { c: FfsContact }) {
  return (
    <Card>
      <CardContent className="space-y-2 p-4">
        <MonoLabel>{c.role}</MonoLabel>
        {c.name ? <div className="text-sm font-semibold">{c.name}</div> : null}
        <a
          href={telHref(c.phone)}
          className="numeric flex items-center gap-2 text-sm font-medium text-primary hover:underline"
        >
          <Phone className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
          {c.phone}
        </a>
        {c.hours ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Clock className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
            {c.hours}
          </div>
        ) : null}
        {c.note ? (
          <div className="flex items-start gap-2 text-xs text-muted-foreground">
            <Mail className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
            <span className="break-words">{c.note}</span>
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}

export default async function FsaFfsContactsPage() {
  await requireRole('fsa', '/app/contacts')
  const res = await loadFfsContacts(true)

  let body: React.ReactNode
  if (!res.ok) {
    body = res.notConfigured ? (
      <EmptyState
        icon={Contact}
        title="Contacts not configured"
        description="A super admin can add FFS key contacts under Super → Config → FFS Contacts."
      />
    ) : (
      <ErrorState description={res.message} />
    )
  } else if (res.contacts.length === 0) {
    body = (
      <EmptyState
        icon={Contact}
        title="No FFS contacts yet"
        description="FFS key contacts are managed as configuration under Super → Config → FFS Contacts."
      />
    )
  } else {
    body = (
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {res.contacts.map((c) => (
          <ContactCard key={c.id} c={c} />
        ))}
      </div>
    )
  }

  return (
    <ListShell
      title="FFS Key Contacts"
      description="Quick access to Farmers Financial Solutions desks and specialists. Managed as config — verify before relying on any number."
      breadcrumb={[{ label: 'FSA', href: '/app' }, { label: 'FFS Contacts' }]}
    >
      {body}
    </ListShell>
  )
}
