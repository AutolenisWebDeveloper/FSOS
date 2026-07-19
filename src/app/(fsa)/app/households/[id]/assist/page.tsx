import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { requireRole } from '@/lib/auth/session'
import { PageHeader } from '@/components/archetypes'
import { load } from '@/lib/data/query'
import { Card, CardContent } from '@/components/ui/card'
import { MonoLabel } from '@/components/ui/typography'
import { NextActionPanel } from '@/components/app/NextActionPanel'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type Household = { id: string; primary_name: string; city: string | null; state: string | null }

// Client-360 assist page (ports the legacy client-drawer AI next-action). Sits
// alongside the household profile (does not modify it). The suggestion engine is
// green-zone + firewall-safe (see the next-action route). Roles: fsa,
// licensed_staff, super_admin (portal-gated by the (fsa) layout).
export default async function HouseholdAssistPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  await requireRole('fsa', `/app/households/${params.id}/assist`)

  const res = await load<Household | null>(
    (db) => db.from('households').select('id, primary_name, city, state').eq('id', params.id).is('deleted_at', null).maybeSingle(),
    null,
  )
  if (res.ok && !res.data) notFound()
  const hh = res.ok ? res.data : null

  return (
    <div className="max-w-2xl space-y-6">
      <PageHeader
        title={hh ? `Assist — ${hh.primary_name}` : 'Assist'}
        description="Green-zone next-best-action suggestions for this household."
        breadcrumb={[
          { label: 'FSA', href: '/app' },
          { label: 'Households', href: '/app/households' },
          { label: hh?.primary_name ?? 'Household', href: `/app/households/${params.id}` },
          { label: 'Assist' },
        ]}
      />

      {hh ? (
        <Card>
          <CardContent className="flex items-center justify-between gap-3 p-4">
            <div>
              <MonoLabel>Household</MonoLabel>
              <div className="text-sm font-semibold">{hh.primary_name}</div>
              {hh.city || hh.state ? (
                <div className="text-xs text-muted-foreground">{[hh.city, hh.state].filter(Boolean).join(', ')}</div>
              ) : null}
            </div>
            <Link href={`/app/households/${params.id}`} className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline">
              <ArrowLeft className="h-4 w-4" aria-hidden /> Back to profile
            </Link>
          </CardContent>
        </Card>
      ) : null}

      <NextActionPanel householdId={params.id} />
    </div>
  )
}
