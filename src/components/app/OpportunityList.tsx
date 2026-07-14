'use client'

import * as React from 'react'
import Link from 'next/link'
import { Target } from 'lucide-react'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/archetypes'
import { OPPORTUNITY_STAGE, REFERRAL_ENGAGEMENT } from '@/lib/validation/schemas'
import type { OppCard } from '@/components/app/OpportunityBoard'

export function OpportunityList({ rows }: { rows: OppCard[] }) {
  const [q, setQ] = React.useState('')
  const [stage, setStage] = React.useState('')
  const [engagement, setEngagement] = React.useState('')
  const [secOnly, setSecOnly] = React.useState(false)

  const filtered = React.useMemo(() => {
    let r = rows
    const n = q.trim().toLowerCase()
    if (n) r = r.filter((o) => (o.household_name ?? '').toLowerCase().includes(n))
    if (stage) r = r.filter((o) => o.stage === stage)
    if (engagement) r = r.filter((o) => o.engagement === engagement)
    if (secOnly) r = r.filter((o) => o.is_security)
    return r
  }, [rows, q, stage, engagement, secOnly])

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={Target}
        title="No opportunities yet"
        description="Opportunities originate from converted referrals and financial reviews."
        action={<Button asChild><Link href="/app/opportunities/new">New opportunity</Link></Button>}
      />
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input placeholder="Search household…" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-xs" aria-label="Search opportunities" />
        <Select value={stage} onChange={(e) => setStage(e.target.value)} className="max-w-[14rem]" aria-label="Filter stage">
          <option value="">All stages</option>
          {OPPORTUNITY_STAGE.map((s) => (<option key={s} value={s}>{s.replace(/_/g, ' ')}</option>))}
        </Select>
        <Select value={engagement} onChange={(e) => setEngagement(e.target.value)} className="max-w-[11rem]" aria-label="Filter engagement">
          <option value="">All engagement</option>
          {REFERRAL_ENGAGEMENT.map((s) => (<option key={s} value={s}>{s}</option>))}
        </Select>
        <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <input type="checkbox" checked={secOnly} onChange={(e) => setSecOnly(e.target.checked)} /> Securities only
        </label>
      </div>
      {filtered.length === 0 ? (
        <EmptyState icon={Target} title="No matches" description="Adjust your search or filters." />
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Household</TableHead>
                <TableHead>Engagement</TableHead>
                <TableHead>Stage</TableHead>
                <TableHead className="text-right">Premium</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((o) => (
                <TableRow key={o.id}>
                  <TableCell>
                    <Link href={`/app/opportunities/${o.id}`} className="font-medium text-primary hover:underline">{o.household_name ?? 'Opportunity'}</Link>
                    {o.is_security ? <Badge variant="blocked" className="ml-2">securities</Badge> : null}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{o.engagement}</TableCell>
                  <TableCell><Badge variant={o.stage === 'placed_issued' ? 'won' : o.stage === 'lost' ? 'lost' : 'active'}>{o.stage.replace(/_/g, ' ')}</Badge></TableCell>
                  <TableCell className="text-right tabular-nums">{o.premium ? `$${Number(o.premium).toLocaleString('en-US')}` : '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
