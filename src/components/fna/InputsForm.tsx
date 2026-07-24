'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { postJson, firstFieldError } from '@/lib/client/api'

interface Field {
  key: string
  section: string
  label: string
  unit: string
  help?: string
}

const SECTION_TITLE: Record<string, string> = {
  income: 'Income',
  expenses: 'Expenses',
  assets: 'Assets',
  liabilities: 'Liabilities',
  coverage: 'Protection / coverage',
  household: 'Household',
  retirement: 'Retirement',
  education: 'Education',
  survivor: 'Survivor needs',
}

// Structured intake (build instruction §5). Save-and-resume; never blocks on
// incompleteness. A live completeness meter shows what's answered and what each
// gap costs analytically. Values persist as fna_inputs rows (client_supplied).
export function InputsForm({
  planId,
  fields,
  initial,
}: {
  planId: string
  fields: Field[]
  initial: Record<string, number>
}) {
  const router = useRouter()
  const [values, setValues] = React.useState<Record<string, string>>(() => {
    const v: Record<string, string> = {}
    for (const f of fields) v[f.key] = initial[f.key] != null ? String(initial[f.key]) : ''
    return v
  })
  const [busy, setBusy] = React.useState<false | 'save' | 'calc'>(false)

  const sections = React.useMemo(() => {
    const map = new Map<string, Field[]>()
    for (const f of fields) {
      const arr = map.get(f.section) ?? []
      arr.push(f)
      map.set(f.section, arr)
    }
    return [...map.entries()]
  }, [fields])

  const answered = fields.filter((f) => values[f.key] !== '' && Number.isFinite(Number(values[f.key]))).length
  const pct = fields.length === 0 ? 0 : Math.round((answered / fields.length) * 100)

  function collect() {
    return fields
      .filter((f) => values[f.key] !== '' && Number.isFinite(Number(values[f.key])))
      .map((f) => ({ section: f.section, key: f.key, value_numeric: Number(values[f.key]), unit: f.unit, source_label: 'client_supplied' as const }))
  }

  async function save(then?: 'calc') {
    setBusy(then === 'calc' ? 'calc' : 'save')
    const inputs = collect()
    const res = await postJson<{ written?: number; conflicts?: number }>(`/api/fna/plans/${planId}/inputs`, { inputs })
    if (!res.ok) {
      setBusy(false)
      toast.error(firstFieldError(res.error).message)
      return
    }
    if (then === 'calc') {
      const calc = await postJson<{ version_no?: number }>(`/api/fna/plans/${planId}/calculate`, {})
      setBusy(false)
      if (!calc.ok) {
        toast.error(firstFieldError(calc.error).message)
        return
      }
      toast.success('Saved and calculated.')
      router.push(`/app/fna/plans/${planId}/results`)
      return
    }
    setBusy(false)
    toast.success(`Saved ${res.data.written ?? 0} value(s).`)
    router.refresh()
  }

  return (
    <div className="space-y-6">
      <div className="sticky top-0 z-10 -mx-4 border-b bg-background/95 px-4 py-3 backdrop-blur md:-mx-6 md:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-medium">
              {answered}/{fields.length} answered · {pct}% complete
            </p>
            <div className="mt-1 h-1.5 w-56 max-w-full overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
              <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
            </div>
            <p className="mt-1 text-xs text-muted-foreground">Missing values lower analytical confidence — they never block the analysis.</p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => save()} disabled={busy !== false}>
              {busy === 'save' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
              Save
            </Button>
            <Button onClick={() => save('calc')} disabled={busy !== false}>
              {busy === 'calc' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
              Save &amp; calculate
            </Button>
          </div>
        </div>
      </div>

      {sections.map(([section, fs]) => (
        <Card key={section}>
          <CardHeader>
            <CardTitle className="text-base">{SECTION_TITLE[section] ?? section}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            {fs.map((f) => (
              <div key={f.key} className="space-y-1.5">
                <Label htmlFor={`in-${f.key}`}>{f.label}</Label>
                <Input
                  id={`in-${f.key}`}
                  type="number"
                  inputMode="decimal"
                  value={values[f.key]}
                  onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                  placeholder={f.unit === 'age' ? 'years' : f.unit === 'years' ? 'years' : '$'}
                  disabled={busy !== false}
                />
                {f.help ? <p className="text-xs text-muted-foreground">{f.help}</p> : null}
              </div>
            ))}
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
