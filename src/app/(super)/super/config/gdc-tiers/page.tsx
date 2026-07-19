import { SettingsShell, SettingsSection, ErrorState, EmptyState, AssumptionBadge } from '@/components/archetypes'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Numeric, Money } from '@/components/ui/typography'
import { load } from '@/lib/data/query'
import { GdcTierForm, type ExistingTier } from '@/components/super/GdcTierForm'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

interface TierRow extends ExistingTier {
  id: string
  is_assumption: boolean
  active: boolean
}

// Legacy-port GDC tier config (A10). Every tier is an assumption-flagged default —
// gold "config default — verify" badge; never presented as a Farmers-published figure.
export default async function GdcTiersConfigPage() {
  const tiers = await load<TierRow[]>(
    (db) => db.from('gdc_tiers').select('*').order('min_gdc', { ascending: true }),
    [],
  )

  return (
    <SettingsShell
      title="GDC Tiers"
      description="Rolling-12mo Gross Dealer Concession → FSA payout %. Labeled config defaults — verify against contract."
    >
      <SettingsSection title="Configured tiers" description="Bands are inclusive of the floor. A blank ceiling is the open-ended top tier.">
        {!tiers.ok ? (
          <ErrorState description={tiers.kind === 'not_configured' ? 'Database not configured.' : tiers.message} />
        ) : tiers.data.length === 0 ? (
          <EmptyState title="No tiers configured" description="Add the first GDC tier below." />
        ) : (
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tier</TableHead>
                  <TableHead>Band</TableHead>
                  <TableHead className="text-right">FSA payout</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tiers.data.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="font-medium">{t.label}</TableCell>
                    <TableCell className="tabular-nums text-muted-foreground">
                      <Money value={t.min_gdc} /> {t.max_gdc === null ? '+' : <>– <Money value={t.max_gdc} /></>}
                    </TableCell>
                    <TableCell className="text-right tabular-nums"><Numeric>{t.payout_pct}%</Numeric></TableCell>
                    <TableCell>{t.is_assumption ? <AssumptionBadge /> : null}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        <p className="text-xs text-muted-foreground">config default — verify with contract; not a Farmers-published figure.</p>
      </SettingsSection>

      <SettingsSection title="Add / update a tier" description="Keyed by tier number. Saving an existing tier number overwrites it.">
        <GdcTierForm tiers={tiers.ok ? tiers.data.map((t) => ({ tier_no: t.tier_no, label: t.label, min_gdc: Number(t.min_gdc), max_gdc: t.max_gdc === null ? null : Number(t.max_gdc), payout_pct: Number(t.payout_pct) })) : []} />
      </SettingsSection>
    </SettingsShell>
  )
}
