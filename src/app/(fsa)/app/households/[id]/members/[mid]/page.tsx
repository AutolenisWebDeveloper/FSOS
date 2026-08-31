import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { ReactNode } from 'react'
import { UserRound } from 'lucide-react'
import { DetailShell, ErrorState, ContactTimeline } from '@/components/archetypes'
import { Numeric } from '@/components/ui/typography'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { load } from '@/lib/data/query'
import { contactRecordHref } from '@/lib/contacts/member-link'
import { loadMemberContactLinks } from '@/lib/contacts/member-link-data'
import { MemberDobReveal } from '@/components/app/MemberDobReveal'

export const dynamic = 'force-dynamic'

// OS-04 Member Detail (A3). DOB is not rendered by default — revealed on demand
// (role-gated + audited server-side).
export default async function MemberDetailPage(props: { params: Promise<{ id: string; mid: string }> }) {
  const params = await props.params;
  const [member, hh] = await Promise.all([
    load<{ id: string; full_name: string; relationship: string | null; email: string | null; phone: string | null; household_id: string; source_contact_id: string | null } | null>(
      (db) => db.from('household_members').select('id, full_name, relationship, email, phone, household_id, source_contact_id').eq('id', params.mid).is('deleted_at', null).maybeSingle(),
      null,
    ),
    load<{ primary_name: string } | null>((db) => db.from('households').select('primary_name').eq('id', params.id).maybeSingle(), null),
  ])
  if (!member.ok) return <ErrorState description={member.kind === 'not_configured' ? 'Database not configured.' : member.message} />
  const m = member.data
  if (!m) notFound()
  const householdName = hh.ok ? hh.data?.primary_name ?? 'Household' : 'Household'

  // The Contact Record behind this member, when there is one and it still resolves.
  // Members added directly in the book have no contact; a soft-deleted contact is
  // treated as no contact so the book never advertises a 404.
  const contactId = (await loadMemberContactLinks([m])).get(m.id) ?? null

  return (
    <DetailShell
      title={m.full_name}
      description={m.relationship ?? 'Household member'}
      actions={
        contactId ? (
          <Button asChild size="sm">
            <Link href={contactRecordHref(contactId)}>
              <UserRound className="h-4 w-4" /> Open contact record
            </Link>
          </Button>
        ) : undefined
      }
      breadcrumb={[
        { label: 'FSA', href: '/app' },
        { label: 'Households', href: '/app/households' },
        { label: householdName, href: `/app/households/${params.id}` },
        { label: 'Members', href: `/app/households/${params.id}/members` },
        { label: m.full_name },
      ]}
      rail={
        <div className="space-y-6">
          <div className="space-y-3 text-sm">
            <p className="font-medium">Related</p>
            <ul className="space-y-1.5">
              <li><Link href={`/app/households/${params.id}`} className="text-primary hover:underline">Household</Link></li>
              <li><Link href={`/app/households/${params.id}/members`} className="text-primary hover:underline">All members</Link></li>
            </ul>
          </div>
          <ContactTimeline
            householdId={params.id}
            memberId={params.mid}
            entityType="member"
            entityId={params.mid}
            heading="Member timeline"
          />
        </div>
      }
    >
      <Card>
        <CardHeader><CardTitle className="text-base">Member details</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-sm">
          <Row label="Relationship" value={m.relationship ?? '—'} />
          <Row label="Email" value={m.email ?? '—'} />
          <Row label="Phone" value={<Numeric>{m.phone ?? '—'}</Numeric>} />
          <div className="flex items-center justify-between gap-3">
            <span className="text-muted-foreground">Date of birth</span>
            <MemberDobReveal householdId={params.id} memberId={params.mid} />
          </div>
        </CardContent>
      </Card>
    </DetailShell>
  )
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      {/* A long address (a real one ran to 60+ chars) pushed the page into horizontal
          scroll on a phone, since an email has no spaces to wrap at. */}
      <span className="min-w-0 break-words text-right font-medium">{value}</span>
    </div>
  )
}
