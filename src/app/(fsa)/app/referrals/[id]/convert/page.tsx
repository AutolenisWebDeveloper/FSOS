import { notFound, redirect } from 'next/navigation'
import { ErrorState } from '@/components/archetypes'
import { load } from '@/lib/data/query'
import { ConvertWizard } from '@/components/app/ConvertWizard'

export const dynamic = 'force-dynamic'

// OS-03 Referral Convert (A6) — the WF-1 spine wizard.
export default async function ConvertPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const res = await load<{ id: string; referred_name: string | null; engagement: string; status: string } | null>(
    (db) => db.from('referrals').select('id, referred_name, engagement, status').eq('id', params.id).is('deleted_at', null).maybeSingle(),
    null,
  )
  if (!res.ok) return <ErrorState description={res.kind === 'not_configured' ? 'Database not configured.' : res.message} />
  const r = res.data
  if (!r) notFound()
  if (r.status === 'converted') redirect(`/app/referrals/${params.id}`)

  const [households, products] = await Promise.all([
    load<{ id: string; primary_name: string }[]>((db) => db.from('households').select('id, primary_name').is('deleted_at', null).order('primary_name'), []),
    load<{ id: string; family: string; subtype: string | null; is_security: boolean }[]>(
      (db) => db.from('products').select('id, family, subtype, is_security').eq('active', true).order('family'),
      [],
    ),
  ])

  return (
    <ConvertWizard
      referralId={params.id}
      defaultName={r.referred_name ?? ''}
      defaultEmail={null}
      defaultPhone={null}
      defaultEngagement={r.engagement}
      households={households.ok ? households.data : []}
      products={products.ok ? products.data : []}
    />
  )
}
