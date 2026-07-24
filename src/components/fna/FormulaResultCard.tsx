// src/components/fna/FormulaResultCard.tsx
// Renders one engine result envelope with FULL traceability (build instruction §1,
// ADR-015): every figure is labeled Calculated, assumptions used carry the gold
// badge, warnings surface as non-blocking notices, and the footer pins formula +
// version + rounding + computed-at. Pure render (no client state).
import { AlertTriangle } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ValueLabelBadge, ConfidenceBadge, fmtMoney, fmtPercent } from './value-label'

const FORMULA_LABEL: Record<string, string> = {
  cash_flow: 'Cash flow',
  net_worth: 'Net worth',
  emergency_fund: 'Emergency fund',
  life_insurance_need: 'Life insurance need',
  coverage_gap: 'Coverage gap',
  disability_exposure: 'Disability exposure',
  retirement_projection: 'Retirement projection',
  education_funding: 'Education funding',
  survivor_income: 'Survivor income',
}

interface Envelope {
  formula_id: string
  formula_version: string
  output: Record<string, unknown>
  assumptions_used?: Array<{ key: string; value: number; unit: string; assumption_set_version: string }>
  warnings?: Array<{ code: string; message: string; severity: string }>
  missing_inputs?: string[]
  confidence: 'high' | 'medium' | 'low'
  rounding: string
  computed_at: string
}

function fmtLeaf(key: string, value: number): string {
  const k = key.toLowerCase()
  if (k.includes('ratio') || k.includes('rate') || k.includes('margin') || k === 'savingsrate') return fmtPercent(value)
  if (k.includes('months') || k.includes('years') || k === 'yearsuntilcollege') return value.toLocaleString('en-US', { maximumFractionDigits: 1 })
  if (k.includes('age') || k.endsWith('_no') || k === 'versionno') return String(value)
  return fmtMoney(value)
}

function flatten(output: Record<string, unknown>): Array<{ label: string; value: string }> {
  const rows: Array<{ label: string; value: string }> = []
  for (const [k, v] of Object.entries(output)) {
    if (typeof v === 'number') rows.push({ label: humanize(k), value: fmtLeaf(k, v) })
    else if (typeof v === 'boolean') rows.push({ label: humanize(k), value: v ? 'Yes' : 'No' })
    else if (v && typeof v === 'object') {
      for (const [k2, v2] of Object.entries(v as Record<string, unknown>)) {
        if (typeof v2 === 'number') rows.push({ label: `${humanize(k)} — ${humanize(k2)}`, value: fmtLeaf(k2, v2) })
      }
    }
  }
  return rows
}

function humanize(k: string): string {
  return k.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase())
}

export function FormulaResultCard({ envelope }: { envelope: Envelope }) {
  const rows = flatten(envelope.output)
  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3">
        <CardTitle className="text-base">{FORMULA_LABEL[envelope.formula_id] ?? envelope.formula_id}</CardTitle>
        <div className="flex flex-wrap items-center gap-2">
          <ValueLabelBadge label="calculated" />
          <ConfidenceBadge confidence={envelope.confidence} />
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-b last:border-0">
                  <td className="py-1.5 pr-4 text-muted-foreground">{r.label}</td>
                  <td className="py-1.5 text-right font-mono tabular-nums">{r.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {envelope.assumptions_used && envelope.assumptions_used.length > 0 ? (
          <div className="space-y-1.5">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Assumptions used</p>
            <div className="flex flex-wrap gap-1.5">
              {envelope.assumptions_used.map((a) => (
                <Badge key={a.key} variant="assumption">
                  {humanize(a.key)}: {a.unit === 'rate' ? fmtPercent(a.value, 1) : a.unit === 'usd' ? fmtMoney(a.value) : a.value}
                </Badge>
              ))}
            </div>
          </div>
        ) : null}

        {envelope.warnings && envelope.warnings.length > 0 ? (
          <ul className="space-y-1">
            {envelope.warnings.map((w, i) => (
              <li key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-status-assumption" aria-hidden />
                <span>{w.message}</span>
              </li>
            ))}
          </ul>
        ) : null}

        <p className="border-t pt-2 text-[11px] text-muted-foreground">
          <span className="font-mono">{envelope.formula_id}@{envelope.formula_version}</span> · rounding {envelope.rounding} ·
          {envelope.missing_inputs && envelope.missing_inputs.length > 0 ? ` missing: ${envelope.missing_inputs.join(', ')} ·` : ''} computed {new Date(envelope.computed_at).toLocaleString('en-US')}
        </p>
      </CardContent>
    </Card>
  )
}
