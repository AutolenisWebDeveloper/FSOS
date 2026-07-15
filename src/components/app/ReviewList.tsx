'use client'

import * as React from 'react'
import Link from 'next/link'
import { CalendarClock } from 'lucide-react'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Numeric } from '@/components/ui/typography'
import { EmptyState } from '@/components/archetypes'
import { REVIEW_TYPE, REVIEW_STAGE } from '@/lib/validation/schemas'

export interface ReviewRow {
  id: string
  household_name: string | null
  type: string
  stage: string
  scheduled_at: string | null
  generated_count: number
}

const STAGE_BADGE: Record<string, 'draft' | 'active' | 'pending' | 'won'> = {
  requested: 'draft',
  scheduled: 'pending',
  prepared: 'active',
  completed: 'active',
  outcome_logged: 'won',
}

export function ReviewList({ rows }: { rows: ReviewRow[] }) {
  const [q, setQ] = React.useState('')
  const [type, setType] = React.useState('')
  const [stage, setStage] = React.useState('')

  const filtered = React.useMemo(() => {
    let r = rows
    const n = q.trim().toLowerCase()
    if (n) r = r.filter((x) => (x.household_name ?? '').toLowerCase().includes(n))
    if (type) r = r.filter((x) => x.type === type)
    if (stage) r = r.filter((x) => x.stage === stage)
    return r
  }, [rows, q, type, stage])

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={CalendarClock}
        title="No reviews yet"
        description="The financial review is where needs are discovered and opportunities originate."
        action={<Button asChild><Link href="/app/reviews/new">Schedule a review</Link></Button>}
      />
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input placeholder="Search household…" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-xs" aria-label="Search reviews" />
        <Select value={type} onChange={(e) => setType(e.target.value)} className="max-w-[13rem]" aria-label="Filter type">
          <option value="">All types</option>
          {REVIEW_TYPE.map((t) => (<option key={t} value={t}>{t.replace(/_/g, ' ')}</option>))}
        </Select>
        <Select value={stage} onChange={(e) => setStage(e.target.value)} className="max-w-[13rem]" aria-label="Filter stage">
          <option value="">All stages</option>
          {REVIEW_STAGE.map((s) => (<option key={s} value={s}>{s.replace(/_/g, ' ')}</option>))}
        </Select>
      </div>
      {filtered.length === 0 ? (
        <EmptyState icon={CalendarClock} title="No matches" description="Adjust your search or filters." />
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Household</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Stage</TableHead>
                <TableHead>Scheduled</TableHead>
                <TableHead className="text-right">Opportunities</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <Link href={`/app/reviews/${r.id}`} className="font-medium text-primary hover:underline">{r.household_name ?? 'Review'}</Link>
                  </TableCell>
                  <TableCell className="capitalize text-muted-foreground">{r.type.replace(/_/g, ' ')}</TableCell>
                  <TableCell><Badge variant={STAGE_BADGE[r.stage] ?? 'draft'}>{r.stage.replace(/_/g, ' ')}</Badge></TableCell>
                  <TableCell className="text-muted-foreground"><Numeric>{r.scheduled_at ? new Date(r.scheduled_at).toLocaleDateString('en-US') : '—'}</Numeric></TableCell>
                  <TableCell className="text-right tabular-nums">{r.generated_count || '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
