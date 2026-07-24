import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireRole } from '@/lib/auth/session'
import { PageHeader, ErrorState, Section } from '@/components/archetypes'
import { load } from '@/lib/data/query'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { ScenarioBuilder } from '@/components/fna/ScenarioBuilder'
import { SCENARIO_PRESETS } from '@/lib/fna/scenarios'
import { fmtMoney, fmtPercent } from '@/components/fna/value-label'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

interface RetOut {
  onTrack?: boolean
  shortfall?: number
  surplus?: number
  projectedSavingsAtRetirement?: number
  fundedRatio?: number
}
interface ScenarioRow {
  id: string
  name: string
  scenario_type: string
  results: { results?: Array<{ formula_id: string; envelope: { output: RetOut } }> } | null
  created_at: string
}

function retOf(results: Array<{ formula_id: string; envelope: { output: RetOut } }> | undefined): RetOut | undefined {
  return results?.find((r) => r.formula_id === 'retirement_projection')?.envelope.output
}

export default async function FnaPlanScenariosPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  await requireRole('fsa', `/app/fna/plans/${params.id}/scenarios`)

  const planRes = await load<{ id: string; plan_type: string; current_version_id: string | null; title: string | null } | null>(
    (db) => db.from('fna_plans').select('id, plan_type, current_version_id, title').eq('id', params.id).is('deleted_at', null).maybeSingle(),
    null,
  )
  if (!planRes.ok) {
    return (
      <div className="space-y-6">
        {planRes.kind === 'not_configured' ? <ErrorState title="Database not configured" /> : <ErrorState description={planRes.message} />}
      </div>
    )
  }
  if (!planRes.data) notFound()
  const plan = planRes.data

  const [baseRes, scenariosRes] = await Promise.all([
    plan.current_version_id
      ? load<{ envelope: { output: RetOut } } | null>(
          (db) => db.from('fna_results').select('envelope').eq('version_id', plan.current_version_id!).eq('formula_id', 'retirement_projection').maybeSingle(),
          null,
        )
      : Promise.resolve({ ok: true as const, data: null }),
    load<ScenarioRow[]>((db) => db.from('fna_scenarios').select('id, name, scenario_type, results, created_at').eq('plan_id', params.id).order('created_at', { ascending: false }), []),
  ])

  const baseOut = baseRes.ok && baseRes.data ? baseRes.data.envelope.output : undefined
  const scenarios = scenariosRes.ok ? scenariosRes.data : []

  return (
    <div className="space-y-6">
      <PageHeader
        title="Scenarios"
        description="What-if variants branched from this plan's current frozen version. Each re-runs the deterministic engine — the base version never changes."
        breadcrumb={[
          { label: 'FSA', href: '/app' },
          { label: 'AI FNA Command Center', href: '/app/fna' },
          { label: 'Plans', href: '/app/fna/plans' },
          { label: 'Workspace', href: `/app/fna/plans/${params.id}` },
          { label: 'Scenarios' },
        ]}
        actions={
          <Button asChild variant="outline">
            <Link href={`/app/fna/plans/${params.id}/results`}>Base results</Link>
          </Button>
        }
      />

      <ScenarioBuilder
        planId={params.id}
        presets={SCENARIO_PRESETS.map((p) => ({ type: p.type, name: p.name, description: p.description }))}
        disabled={!plan.current_version_id}
      />

      <Section title="Retirement comparison" description="Retirement shortfall/surplus, projected savings, and funded ratio across scenarios.">
        <Card>
          <CardContent className="overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th scope="col" className="py-2 pl-4 pr-4 font-medium">Scenario</th>
                  <th scope="col" className="py-2 pr-4 text-right font-medium">Shortfall / (surplus)</th>
                  <th scope="col" className="py-2 pr-4 text-right font-medium">Projected savings</th>
                  <th scope="col" className="py-2 pr-4 text-right font-medium">Funded</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b bg-muted/40">
                  <td className="py-2 pl-4 pr-4 font-medium">Base <Badge variant="outline">current</Badge></td>
                  <td className="py-2 pr-4 text-right font-mono tabular-nums">{baseOut?.onTrack ? fmtMoney(baseOut?.surplus) : `(${fmtMoney(baseOut?.shortfall)})`}</td>
                  <td className="py-2 pr-4 text-right font-mono tabular-nums">{fmtMoney(baseOut?.projectedSavingsAtRetirement)}</td>
                  <td className="py-2 pr-4 text-right font-mono tabular-nums">{fmtPercent(baseOut?.fundedRatio, 0)}</td>
                </tr>
                {scenarios.map((s) => (
                  <tr key={s.id} className="border-b last:border-0">
                    <td className="py-2 pl-4 pr-4 font-medium">{s.name}</td>
                    {(() => {
                      const o = retOf(s.results?.results)
                      return (
                        <>
                          <td className="py-2 pr-4 text-right font-mono tabular-nums">{o?.onTrack ? fmtMoney(o?.surplus) : `(${fmtMoney(o?.shortfall)})`}</td>
                          <td className="py-2 pr-4 text-right font-mono tabular-nums">{fmtMoney(o?.projectedSavingsAtRetirement)}</td>
                          <td className="py-2 pr-4 text-right font-mono tabular-nums">{fmtPercent(o?.fundedRatio, 0)}</td>
                        </>
                      )
                    })()}
                  </tr>
                ))}
                {scenarios.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-6 text-center text-sm text-muted-foreground">
                      No scenarios yet. Add one above to compare against the base.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </Section>
    </div>
  )
}
