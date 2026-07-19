'use client'

import * as React from 'react'
import { Calculator, ShieldAlert } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { MonoLabel } from '@/components/ui/typography'

// Educational estimate disclaimer — rendered on EVERY calculator output (docs/
// legacy-port.md §2.8). This is an illustration tool, never a recommendation engine.
const ESTIMATE_DISCLAIMER =
  'Educational estimate only. Not a product recommendation or suitability determination.'

function money(n: number): string {
  if (!Number.isFinite(n)) return '$0'
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

function num(v: string): number {
  const n = Number.parseFloat(v)
  return Number.isFinite(n) ? n : 0
}

function NumField({
  id,
  label,
  value,
  onChange,
  suffix,
}: {
  id: string
  label: string
  value: string
  onChange: (v: string) => void
  suffix?: string
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex items-center gap-2">
        <Input id={id} type="number" min={0} inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value)} />
        {suffix ? <span className="text-xs text-muted-foreground">{suffix}</span> : null}
      </div>
    </div>
  )
}

function Result({ label, value, framing }: { label: string; value: string; framing: string }) {
  return (
    <div className="rounded-lg border bg-muted/40 p-4">
      <MonoLabel>{label}</MonoLabel>
      <div className="numeric mt-1 text-2xl font-semibold">{value}</div>
      <p className="mt-1 text-xs text-muted-foreground">{framing}</p>
      <p className="mt-3 flex items-start gap-1.5 text-[11px] text-muted-foreground">
        <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
        {ESTIMATE_DISCLAIMER}
      </p>
    </div>
  )
}

// Sales / needs calculators (docs/legacy-port.md §2.8). Client-side illustration
// tools. Every output is framed as an estimate/gap and carries the educational
// disclaimer — never a product recommendation. Nothing is persisted.
export function SalesCalculator() {
  // ── DIME life-insurance need ──────────────────────────────────────────────
  const [debt, setDebt] = React.useState('')
  const [income, setIncome] = React.useState('')
  const [years, setYears] = React.useState('10')
  const [mortgage, setMortgage] = React.useState('')
  const [education, setEducation] = React.useState('')
  const [existing, setExisting] = React.useState('')

  const dimeNeed = num(debt) + num(income) * num(years) + num(mortgage) + num(education)
  const dimeGap = Math.max(0, dimeNeed - num(existing))

  // ── Income replacement (present value of a level annual need) ─────────────
  const [replIncome, setReplIncome] = React.useState('')
  const [replYears, setReplYears] = React.useState('20')
  const [replRate, setReplRate] = React.useState('3')

  const r = num(replRate) / 100
  const n = num(replYears)
  const pv = r > 0 ? num(replIncome) * ((1 - Math.pow(1 + r, -n)) / r) : num(replIncome) * n

  // ── Retirement income gap ─────────────────────────────────────────────────
  const [desired, setDesired] = React.useState('')
  const [otherIncome, setOtherIncome] = React.useState('')
  const [retYears, setRetYears] = React.useState('25')

  const annualGap = Math.max(0, num(desired) - num(otherIncome))
  const retGap = annualGap * num(retYears)

  return (
    <div className="space-y-6">
      <p className="flex items-start gap-2 rounded-md border border-status-assumption/40 bg-status-assumption/10 p-3 text-xs text-status-assumption">
        <Calculator className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        These are educational illustrations for a review conversation. They identify potential coverage/income gaps —
        they never recommend a specific product. Every figure below is an estimate.
      </p>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* DIME */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Life insurance need (DIME)</CardTitle>
            <p className="text-sm text-muted-foreground">Debt · Income · Mortgage · Education, minus existing coverage.</p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <NumField id="debt" label="Debts (non-mortgage)" value={debt} onChange={setDebt} suffix="$" />
              <NumField id="income" label="Annual income to replace" value={income} onChange={setIncome} suffix="$/yr" />
              <NumField id="years" label="Years to replace income" value={years} onChange={setYears} suffix="yrs" />
              <NumField id="mortgage" label="Mortgage balance" value={mortgage} onChange={setMortgage} suffix="$" />
              <NumField id="education" label="Future education costs" value={education} onChange={setEducation} suffix="$" />
              <NumField id="existing" label="Existing coverage" value={existing} onChange={setExisting} suffix="$" />
            </div>
            <Result
              label="Estimated coverage gap"
              value={money(dimeGap)}
              framing="A discussion topic for the review — not an amount to buy."
            />
          </CardContent>
        </Card>

        {/* Income replacement */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Income replacement</CardTitle>
            <p className="text-sm text-muted-foreground">Present value of a level annual income need.</p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <NumField id="repl-income" label="Annual income need" value={replIncome} onChange={setReplIncome} suffix="$/yr" />
              <NumField id="repl-years" label="Years of need" value={replYears} onChange={setReplYears} suffix="yrs" />
              <NumField id="repl-rate" label="Assumed discount rate" value={replRate} onChange={setReplRate} suffix="%" />
            </div>
            <Result
              label="Estimated lump sum"
              value={money(pv)}
              framing="Illustrative present value — assumptions are editable inputs, not published figures."
            />
          </CardContent>
        </Card>

        {/* Retirement gap */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Retirement income gap</CardTitle>
            <p className="text-sm text-muted-foreground">Desired income minus other sources, over the retirement horizon.</p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-3">
              <NumField id="desired" label="Desired annual income" value={desired} onChange={setDesired} suffix="$/yr" />
              <NumField id="other" label="Other annual income (SS, pension)" value={otherIncome} onChange={setOtherIncome} suffix="$/yr" />
              <NumField id="ret-years" label="Years in retirement" value={retYears} onChange={setRetYears} suffix="yrs" />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Result label="Annual income gap" value={money(annualGap)} framing="The yearly shortfall to discuss." />
              <Result
                label="Cumulative gap"
                value={money(retGap)}
                framing="Estimated over the horizon — a planning conversation starter."
              />
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
