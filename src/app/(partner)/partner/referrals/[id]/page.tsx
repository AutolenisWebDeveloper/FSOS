import { notFound, redirect } from 'next/navigation'
import { DetailShell, ErrorState, StatusBadge } from '@/components/archetypes'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { getServerSession } from '@/lib/auth/session'
import { getDb } from '@/lib/supabase/client'
import { agencyIdsFor } from '@/lib/portal/scope'
import { PARTNER_ALLOWLIST, selectFor, pickAllowed } from '@/lib/portal/allowlist'

export const dynamic = 'force-dynamic'

// P-4 Referral Status (A3). Shows status progress only — no securities case content,
// no FSA private notes. Out-of-scope deep link → 403.
export default async function PartnerReferralDetailPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const session = await getServerSession()
  if (!session) redirect('/login')
  const agencyIds = await agencyIdsFor(session)

  type Row = { id: string; referred_name: string | null; engagement: string; status: string; received_at: string }
  let rec: (Row & { referring_agency_id: string }) | null = null
  let err: string | null = null
  try {
    const { data } = await getDb().from('referrals').select(selectFor(PARTNER_ALLOWLIST, 'referrals') + ', referring_agency_id').eq('id', params.id).maybeSingle()
    rec = data ? (data as unknown as Row & { referring_agency_id: string }) : null
  } catch (e) { err = e instanceof Error ? e.message : 'Failed' }

  if (err) return <ErrorState description={err} />
  if (!rec) notFound()
  // Scope enforcement: the owner may only view their own agency's referrals.
  if (!agencyIds.includes(rec.referring_agency_id)) redirect('/403')
  const row = pickAllowed(PARTNER_ALLOWLIST, 'referrals', [rec as unknown as Record<string, unknown>])[0] as unknown as Row

  const steps = ['received', 'working', 'converted']
  const currentIdx = steps.indexOf(row.status === 'declined' ? 'received' : row.status)

  return (
    <DetailShell
      title={row.referred_name ?? 'Referral'}
      description="Your referral's progress."
      breadcrumb={[{ label: 'Partner', href: '/partner' }, { label: 'My Referrals', href: '/partner/referrals' }, { label: row.referred_name ?? 'Referral' }]}
      status={<StatusBadge status={row.status === 'converted' ? 'won' : row.status === 'declined' ? 'lost' : 'active'} label={row.status} />}
    >
      <Card>
        <CardHeader><CardTitle className="text-base">Progress</CardTitle></CardHeader>
        <CardContent>
          <ol className="space-y-2 text-sm">
            {steps.map((s, i) => (
              <li key={s} className={`flex items-center gap-2 ${i <= currentIdx ? 'text-foreground' : 'text-muted-foreground'}`}>
                <span className={`h-2 w-2 rounded-full ${i <= currentIdx ? 'bg-status-won' : 'bg-muted'}`} />
                <span className="capitalize">{s}</span>
              </li>
            ))}
          </ol>
          {row.status === 'declined' ? <p className="mt-3 text-sm text-muted-foreground">This referral was not a fit. Thank you for the introduction.</p> : null}
          <p className="mt-3 text-xs text-muted-foreground">You see status only — never securities case content or the FSA&apos;s private notes.</p>
        </CardContent>
      </Card>
    </DetailShell>
  )
}
