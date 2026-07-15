'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ShieldAlert } from 'lucide-react'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Select } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { SecuritiesChip, securitiesRowClass } from '@/components/ui/securities'
import { Numeric } from '@/components/ui/typography'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/archetypes'

export interface EscalationRow {
  id: string
  reason: string | null
  blocked_step: string | null
  target_type: string | null
  target_id: string | null
  outcome: string | null
  created_at: string
}

export interface ComplianceEventRow {
  id: string
  kind: string | null
  channel: string | null
  recipient: string | null
  entity_type: string | null
  entity_id: string | null
  blocked_step: string | null
  reason: string | null
  created_at: string
}

const RESOLVED = new Set(['handled', 'dismissed', 'reassigned'])

function isOpen(outcome: string | null): boolean {
  return !outcome || !RESOLVED.has(outcome)
}

function isSecurities(reason: string | null, blockedStep: string | null): boolean {
  return (
    (reason ?? '').toLowerCase().includes('securities') ||
    blockedStep === 'is_security' ||
    blockedStep === 'securities_scope'
  )
}

const TARGET_PATH: Record<string, string> = {
  referral: '/app/referrals',
  opportunity: '/app/opportunities',
  household: '/app/households',
  agency_partnership: '/app/agencies',
}

function targetHref(type: string | null, id: string | null): string | null {
  if (!type || !id) return null
  const base = TARGET_PATH[type]
  return base ? `${base}/${id}` : null
}

function fmt(s: string | null) {
  return s ? new Date(s).toLocaleString('en-US', { dateStyle: 'short', timeStyle: 'short' }) : '—'
}

export function EscalationList({
  rows,
  complianceEvents,
}: {
  rows: EscalationRow[]
  complianceEvents: ComplianceEventRow[]
}) {
  const router = useRouter()
  const [filter, setFilter] = React.useState<'open' | 'handled' | 'dismissed' | 'all'>('open')

  const filtered = React.useMemo(() => {
    if (filter === 'all') return rows
    if (filter === 'open') return rows.filter((r) => isOpen(r.outcome))
    return rows.filter((r) => r.outcome === filter)
  }, [rows, filter])

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={filter}
          onChange={(e) => setFilter(e.target.value as typeof filter)}
          className="max-w-[12rem]"
          aria-label="Filter escalations by status"
        >
          <option value="open">Open</option>
          <option value="handled">Handled</option>
          <option value="dismissed">Dismissed</option>
          <option value="all">All</option>
        </Select>
      </div>

      {filtered.length === 0 ? (
        <EmptyState title="No escalations" description="Agents are operating within guardrails." />
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Reason</TableHead>
                <TableHead>Target</TableHead>
                <TableHead>Blocked step</TableHead>
                <TableHead>Raised</TableHead>
                <TableHead>Outcome</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((r) => {
                const href = targetHref(r.target_type, r.target_id)
                const securities = isSecurities(r.reason, r.blocked_step)
                return (
                  <TableRow
                    key={r.id}
                    className={`cursor-pointer${securities ? ` ${securitiesRowClass}` : ''}`}
                    onClick={() => router.push(`/app/ai/escalations/${r.id}`)}
                  >
                    <TableCell>
                      <Link
                        href={`/app/ai/escalations/${r.id}`}
                        className="font-medium text-primary hover:underline"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {r.reason ?? 'Escalation'}
                      </Link>
                      {securities ? <SecuritiesChip className="ml-2" /> : null}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {href ? (
                        <Link href={href} className="text-primary hover:underline" onClick={(e) => e.stopPropagation()}>
                          {r.target_type} · <Numeric>{r.target_id?.slice(0, 8)}</Numeric>
                        </Link>
                      ) : r.target_type ? (
                        <span>{r.target_type}</span>
                      ) : (
                        '—'
                      )}
                    </TableCell>
                    <TableCell>
                      {r.blocked_step ? <Badge variant="pending">{r.blocked_step}</Badge> : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="text-muted-foreground"><Numeric>{fmt(r.created_at)}</Numeric></TableCell>
                    <TableCell>
                      <Badge variant={isOpen(r.outcome) ? 'escalated' : r.outcome === 'dismissed' ? 'lost' : 'won'}>
                        {r.outcome && RESOLVED.has(r.outcome) ? r.outcome : 'escalated'}
                      </Badge>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent compliance events</CardTitle>
          <p className="text-sm text-muted-foreground">
            Read-only firewall and comms-gate blocks, for context. Resolution happens on the escalation, not here.
          </p>
        </CardHeader>
        <CardContent>
          {complianceEvents.length === 0 ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <ShieldAlert className="h-4 w-4" /> No compliance events recorded.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Kind</TableHead>
                    <TableHead>Channel</TableHead>
                    <TableHead>Blocked step</TableHead>
                    <TableHead>Reason</TableHead>
                    <TableHead>When</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {complianceEvents.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell><Badge variant="blocked">{c.kind ?? 'event'}</Badge></TableCell>
                      <TableCell className="text-muted-foreground">{c.channel ?? '—'}</TableCell>
                      <TableCell className="text-muted-foreground">{c.blocked_step ?? '—'}</TableCell>
                      <TableCell className="text-muted-foreground">{c.reason ?? '—'}</TableCell>
                      <TableCell className="text-muted-foreground"><Numeric>{fmt(c.created_at)}</Numeric></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
