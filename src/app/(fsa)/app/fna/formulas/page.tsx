import { requireRole } from '@/lib/auth/session'
import { PageHeader, Section } from '@/components/archetypes'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { FORMULAS, ENGINE_VERSION, futureValue } from '@/lib/fna/engine'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Formula explorer (build instruction §8/§9). Inspect any formula, its version,
// inputs, and a worked example — the traceability index behind every figure. Reads
// the pure engine registry; no data. Roles: fsa.
export default async function FnaFormulasPage() {
  await requireRole('fsa', '/app/fna/formulas')

  // A live worked example for the FV primitive (deterministic, engine-computed).
  const example = futureValue({ presentValue: 10000, ratePerPeriod: 0.06, periods: 10, payment: 0 }, { computedAt: '2026-01-01T00:00:00.000Z' })

  return (
    <div className="space-y-6">
      <PageHeader
        title="Formula explorer"
        description="Every displayed figure traces to one of these versioned formulas. Deterministic — the same inputs always produce the same output."
        breadcrumb={[{ label: 'FSA', href: '/app' }, { label: 'AI FNA Command Center', href: '/app/fna' }, { label: 'Formulas' }]}
        actions={<Badge variant="outline">engine {ENGINE_VERSION}</Badge>}
      />

      <Section title="Worked example — future value" description="10,000 present value at 6% for 10 periods, computed by the engine (not the model).">
        <Card>
          <CardContent className="pt-6 text-sm">
            <p className="font-mono">
              {example.formula_id}@{example.formula_version} → future value ${(example.output as { futureValue: number }).futureValue.toLocaleString('en-US')}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">rounding {example.rounding} · growth factor {example.intermediates.growthFactor}</p>
          </CardContent>
        </Card>
      </Section>

      <Section title="Formula catalog" description="Id, version, category, and inputs for every calculation.">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FORMULAS.map((f) => (
            <Card key={f.id}>
              <CardHeader className="flex-row items-start justify-between gap-2">
                <CardTitle className="text-base">{f.label}</CardTitle>
                <Badge variant="outline">v{f.version}</Badge>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <p className="text-muted-foreground">{f.description}</p>
                <div className="flex flex-wrap gap-1.5">
                  <Badge variant="outline">{f.category.replace(/_/g, ' ')}</Badge>
                  {f.usesAssumptions ? <Badge variant="assumption">uses assumptions</Badge> : null}
                </div>
                <p className="text-xs text-muted-foreground">
                  <span className="font-mono">{f.id}</span> · inputs: {f.inputs.join(', ')}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      </Section>
    </div>
  )
}
