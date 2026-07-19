import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { ReactNode } from 'react'
import { DetailShell, ErrorState } from '@/components/archetypes'
import { Numeric } from '@/components/ui/typography'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { load } from '@/lib/data/query'
import { MemberDobReveal } from '@/components/app/MemberDobReveal'

export const dynamic = 'force-dynamic'

// OS-04 Member Detail (A3). DOB is not rendered by default — revealed on demand
// (role-gated + audited server-side).
export default async function MemberDetailPage(props: { params: Promise<{ id: string; mid: string }> }) {
  const params = await props.params;
  const [member, hh] = await Promise.all([
    load<{ id: string; full_name: string; relationship: string | null; email: string | null; phone: string | null; household_id: string } | null>(
      (db) => db.from('household_members').select('id, full_name, relationship, email, phone, household_id').eq('id', params.mid).is('deleted_at', null).maybeSingle(),
      null,
    ),
    load<{ primary_name: string } | null>((db) => db.from('households').select('primary_name').eq('id', params.id).maybeSingle(), null),
  ])
  if (!member.ok) return <ErrorState description={member.kind === 'not_configured' ? 'Database not configured.' : member.message} />
  const m = member.data
  if (!m) notFound()
  const householdName = hh.ok ? hh.data?.primary_name ?? 'Household' : 'Household'

  return (
    <DetailShell
      title={m.full_name}
      description={m.relationship ?? 'Household member'}
      breadcrumb={[
        { label: 'FSA', href: '/app' },
        { label: 'Households', href: '/app/households' },
        { label: householdName, href: `/app/households/${params.id}` },
        { label: 'Members', href: `/app/households/${params.id}/members` },
        { label: m.full_name },
      ]}
      rail={
        <div className="space-y-3 text-sm">
          <p className="font-medium">Related</p>
          <ul className="space-y-1.5">
            <li><Link href={`/app/households/${params.id}`} className="text-primary hover:underline">Household</Link></li>
            <li><Link href={`/app/households/${params.id}/members`} className="text-primary hover:underline">All members</Link></li>
          </ul>
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
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{value}</span>
    </div>
  )
}
