'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Check, Circle, CalendarCheck, ArrowRightLeft } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { MonoLabel, Money } from '@/components/ui/typography'
import { StatusBadge, EmptyState } from '@/components/archetypes'
import { SecuritiesChip } from '@/components/ui/securities'
import { patchJson, firstFieldError } from '@/lib/client/api'

export interface OpraTransferRow {
  id: string
  household_id: string
  household_name: string
  agency_name: string | null
  transfer_date: string | null
  annual_premium: number
  contacted: boolean
  appt_scheduled: boolean
  review_complete: boolean
  transferred: boolean
  status: string
  is_security: boolean
}

// Map the lifecycle status onto the shared StatusBadge status keys.
function badgeStatus(r: OpraTransferRow): 'active' | 'pending' | 'won' | 'draft' {
  if (r.transferred) return 'won'
  if (r.review_complete) return 'won'
  if (r.appt_scheduled) return 'active'
  if (r.contacted) return 'pending'
  return 'draft'
}

export function OpraTransferList({ rows }: { rows: OpraTransferRow[] }) {
  const router = useRouter()
  const [busy, setBusy] = React.useState<string | null>(null)

  // Uncontacted first, then by transfer date.
  const sorted = React.useMemo(
    () =>
      [...rows].sort((a, b) => {
        if (a.contacted !== b.contacted) return a.contacted ? 1 : -1
        return (a.transfer_date ?? '').localeCompare(b.transfer_date ?? '')
      }),
    [rows],
  )

  async function toggle(row: OpraTransferRow, patch: Record<string, unknown>, label: string) {
    setBusy(row.id + Object.keys(patch)[0])
    const res = await patchJson(`/api/opra-transfers/${row.id}`, patch)
    setBusy(null)
    if (!res.ok) {
      toast.error(firstFieldError(res.error).message)
      return
    }
    toast.success(`${row.household_name} — ${label}`)
    router.refresh()
  }

  if (sorted.length === 0) {
    return (
      <EmptyState
        title="No OPRA cases yet"
        description="Add a one-policy household from the Eligible list to start tracking transfers."
      />
    )
  }

  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Household</TableHead>
            <TableHead>Agency</TableHead>
            <TableHead>Transfer date</TableHead>
            <TableHead className="text-right">Annual premium</TableHead>
            <TableHead className="text-center">Contacted</TableHead>
            <TableHead className="text-center">Appt</TableHead>
            <TableHead className="text-center">Review</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.map((r) => (
            <TableRow key={r.id} className={r.is_security ? 'border-l-2 border-l-status-security' : undefined}>
              <TableCell className="font-medium">
                <div className="flex flex-wrap items-center gap-2">
                  <Link href={`/app/households/${r.household_id}`} className="hover:underline">
                    {r.household_name}
                  </Link>
                  {r.is_security ? <SecuritiesChip /> : null}
                </div>
              </TableCell>
              <TableCell className="text-muted-foreground">{r.agency_name ?? '—'}</TableCell>
              <TableCell>
                <MonoLabel>{r.transfer_date ?? '—'}</MonoLabel>
              </TableCell>
              <TableCell className="text-right">
                <Money value={r.annual_premium} />
              </TableCell>
              <TableCell className="text-center">
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={r.contacted ? 'Mark not contacted' : 'Mark contacted'}
                  disabled={busy !== null}
                  onClick={() => toggle(r, { contacted: !r.contacted }, r.contacted ? 'contacted cleared' : 'marked contacted')}
                >
                  {r.contacted ? <Check className="h-4 w-4 text-status-won" /> : <Circle className="h-4 w-4 text-muted-foreground" />}
                </Button>
              </TableCell>
              <TableCell className="text-center">
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={r.appt_scheduled ? 'Clear appointment' : 'Mark appointment scheduled'}
                  disabled={busy !== null}
                  onClick={() => toggle(r, { appt_scheduled: !r.appt_scheduled }, 'appointment updated')}
                >
                  <CalendarCheck className={`h-4 w-4 ${r.appt_scheduled ? 'text-status-active' : 'text-muted-foreground/40'}`} />
                </Button>
              </TableCell>
              <TableCell className="text-center">
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={r.review_complete ? 'Mark review incomplete' : 'Mark review complete'}
                  disabled={busy !== null}
                  onClick={() => toggle(r, { review_complete: !r.review_complete }, 'review updated')}
                >
                  {r.review_complete ? <Check className="h-4 w-4 text-status-won" /> : <Circle className="h-4 w-4 text-muted-foreground" />}
                </Button>
              </TableCell>
              <TableCell>
                <StatusBadge status={badgeStatus(r)} label={r.transferred ? 'Transferred' : r.status} />
              </TableCell>
              <TableCell>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy !== null || r.transferred}
                  onClick={() => toggle(r, { transferred: true }, 'transferred')}
                >
                  <ArrowRightLeft className="h-4 w-4" /> Transferred
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
