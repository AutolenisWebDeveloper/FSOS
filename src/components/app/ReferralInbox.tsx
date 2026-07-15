'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Inbox } from 'lucide-react'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Numeric } from '@/components/ui/typography'
import { EmptyState } from '@/components/archetypes'
import { REFERRAL_ENGAGEMENT } from '@/lib/validation/schemas'
import { patchJson } from '@/lib/client/api'

export interface ReferralRow {
  id: string
  referred_name: string | null
  engagement: string
  status: string
  received_at: string
  first_touch_at: string | null
  sla_due_at: string | null
  sla_breached: boolean
  untouched: boolean
  agency_name: string | null
}

function fmt(s: string | null) {
  return s ? new Date(s).toLocaleString('en-US', { dateStyle: 'short', timeStyle: 'short' }) : '—'
}

export function ReferralInbox({ rows }: { rows: ReferralRow[] }) {
  const router = useRouter()
  const [q, setQ] = React.useState('')
  const [status, setStatus] = React.useState('')
  const [engagement, setEngagement] = React.useState('')
  const [untouchedOnly, setUntouchedOnly] = React.useState(false)
  const [breachedOnly, setBreachedOnly] = React.useState(false)
  const [busy, setBusy] = React.useState<string | null>(null)

  const filtered = React.useMemo(() => {
    let r = rows
    const n = q.trim().toLowerCase()
    if (n) r = r.filter((x) => (x.referred_name ?? '').toLowerCase().includes(n) || (x.agency_name ?? '').toLowerCase().includes(n))
    if (status) r = r.filter((x) => x.status === status)
    if (engagement) r = r.filter((x) => x.engagement === engagement)
    if (untouchedOnly) r = r.filter((x) => x.untouched)
    if (breachedOnly) r = r.filter((x) => x.sla_breached)
    return [...r].sort((a, b) => (a.sla_due_at ?? '').localeCompare(b.sla_due_at ?? ''))
  }, [rows, q, status, engagement, untouchedOnly, breachedOnly])

  async function logFirstTouch(id: string) {
    setBusy(id)
    const res = await patchJson(`/api/referrals/${id}`, { first_touch: true })
    setBusy(null)
    if (!res.ok) {
      toast.error(res.error.error || 'Could not log first touch')
      return
    }
    toast.success('First touch logged — SLA clock stopped')
    router.refresh()
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input placeholder="Search referred or agency…" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-xs" aria-label="Search referrals" />
        <Select value={status} onChange={(e) => setStatus(e.target.value)} className="max-w-[10rem]" aria-label="Filter status">
          <option value="">All statuses</option>
          {['received', 'working', 'converted', 'declined'].map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </Select>
        <Select value={engagement} onChange={(e) => setEngagement(e.target.value)} className="max-w-[11rem]" aria-label="Filter engagement">
          <option value="">All engagement</option>
          {REFERRAL_ENGAGEMENT.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </Select>
        <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <input type="checkbox" checked={untouchedOnly} onChange={(e) => setUntouchedOnly(e.target.checked)} /> Untouched
        </label>
        <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <input type="checkbox" checked={breachedOnly} onChange={(e) => setBreachedOnly(e.target.checked)} /> Breached SLA
        </label>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title="No referrals awaiting action"
          description="Inbound agency referrals appear here with speed-to-lead SLA timers."
          action={
            <Button asChild>
              <Link href="/app/referrals/new">Record a referral</Link>
            </Button>
          }
        />
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Referred</TableHead>
                <TableHead>Agency</TableHead>
                <TableHead>Engagement</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>SLA due</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((r) => (
                <TableRow key={r.id} className={r.sla_breached ? 'bg-destructive/5' : undefined}>
                  <TableCell>
                    <Link href={`/app/referrals/${r.id}`} className="font-medium text-primary hover:underline">
                      {r.referred_name ?? 'Unnamed'}
                    </Link>
                    {r.sla_breached ? <Badge variant="blocked" className="ml-2">SLA breached</Badge> : r.untouched ? <Badge variant="pending" className="ml-2">untouched</Badge> : null}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{r.agency_name ?? '—'}</TableCell>
                  <TableCell className="text-muted-foreground">{r.engagement}</TableCell>
                  <TableCell>
                    <Badge variant={r.status === 'converted' ? 'won' : r.status === 'declined' ? 'lost' : 'active'}>{r.status}</Badge>
                  </TableCell>
                  <TableCell className={r.sla_breached ? 'font-medium text-destructive' : 'text-muted-foreground'}><Numeric>{fmt(r.sla_due_at)}</Numeric></TableCell>
                  <TableCell className="text-right">
                    {r.untouched && r.status !== 'converted' && r.status !== 'declined' ? (
                      <Button size="sm" variant="outline" disabled={busy === r.id} onClick={() => logFirstTouch(r.id)}>
                        {busy === r.id ? '…' : 'Log first touch'}
                      </Button>
                    ) : (
                      <Button asChild size="sm" variant="ghost">
                        <Link href={`/app/referrals/${r.id}`}>Open</Link>
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
