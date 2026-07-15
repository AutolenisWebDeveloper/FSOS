import { notFound } from 'next/navigation'
import { SettingsShell, SettingsSection, ErrorState, AssumptionBadge } from '@/components/archetypes'
import { SecuritiesChip, SecuritiesBanner } from '@/components/ui/securities'
import { load } from '@/lib/data/query'
export const dynamic = 'force-dynamic'
// P-6 Product config (A10). family, subtype, is_security, required_license, conversion_window.
export default async function SuperProductConfigPage({ params }: { params: { id: string } }) {
  const res = await load<{ id: string; family: string; subtype: string | null; is_security: boolean; required_license: string | null; conversion_window_days: number | null; conversion_window_is_assumption: boolean; active: boolean } | null>(
    (db) => db.from('products').select('*').eq('id', params.id).maybeSingle(), null)
  if (!res.ok) return <ErrorState description={res.kind === 'not_configured' ? 'Database not configured.' : res.message} />
  if (!res.data) notFound()
  const p = res.data
  return (
    <SettingsShell title={`Product — ${p.family}`} description="Product configuration. is_security propagates the firewall.">
      <SettingsSection title="Configuration">
        {p.is_security ? <SecuritiesBanner className="mb-3" /> : null}
        <div className="space-y-1 text-sm">
          <div className="flex justify-between"><span className="text-muted-foreground">Family</span><span className="capitalize">{p.family}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Subtype</span><span>{p.subtype ?? '—'}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Securities</span><span>{p.is_security ? <SecuritiesChip /> : 'no'}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Required license</span><span>{p.required_license ?? '—'}</span></div>
          <div className="flex items-center justify-between"><span className="text-muted-foreground">Conversion window</span><span className="flex items-center gap-2">{p.conversion_window_days ? `${p.conversion_window_days}d` : '—'}{p.conversion_window_is_assumption ? <AssumptionBadge /> : null}</span></div>
        </div>
        <p className="text-xs text-muted-foreground">Conversion windows are config defaults — verify against the FNWL / ICC25-FTL contract. Never a Farmers-published figure.</p>
      </SettingsSection>
    </SettingsShell>
  )
}
