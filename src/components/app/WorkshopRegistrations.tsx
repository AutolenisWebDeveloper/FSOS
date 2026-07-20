'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, UserPlus, Check, X, LogOut } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { patchJson, postJson, firstFieldError } from '@/lib/client/api'

export type AttendanceStatus = 'registered' | 'attended' | 'no_show' | 'left_early'

export interface Registration {
  reg_id: string
  name: string | null
  email: string | null
  phone: string | null
  status: string | null
  attended: boolean | null
  referral_id: string | null
  consent_channels: string[] | null
  // P1 additions
  chosen_delivery: string | null
  is_walk_in: boolean | null
  attendance_status: AttendanceStatus
  ghl_opportunity_id: string | null
  lead_source: string | null
}

const ATT_LABEL: Record<AttendanceStatus, string> = {
  registered: 'Registered',
  attended: 'Attended',
  no_show: 'No-show',
  left_early: 'Left early',
}
const ATT_VARIANT: Record<AttendanceStatus, 'active' | 'won' | 'lost' | 'pending'> = {
  registered: 'pending',
  attended: 'won',
  no_show: 'lost',
  left_early: 'active',
}

type StatusFilter = 'all' | AttendanceStatus
type DeliveryFilter = 'all' | 'in_person' | 'virtual'

// Registrations roster (spec §3.3, §5) — attendance status + convert-to-lead. Filter by
// attendance status and by chosen delivery. Manual attendance marks post to the idempotent
// reconcile route; convert-to-lead routes into the consult spine (securities → FFS).
export function WorkshopRegistrations({
  workshopId,
  isSecurity = false,
  registrations,
}: {
  workshopId: string
  isSecurity?: boolean
  registrations: Registration[]
}) {
  const router = useRouter()
  const [busyId, setBusyId] = React.useState<string | null>(null)
  const [statusFilter, setStatusFilter] = React.useState<StatusFilter>('all')
  const [deliveryFilter, setDeliveryFilter] = React.useState<DeliveryFilter>('all')

  const filtered = registrations.filter((r) => {
    if (statusFilter !== 'all' && r.attendance_status !== statusFilter) return false
    if (deliveryFilter !== 'all' && (r.chosen_delivery ?? 'in_person') !== deliveryFilter) return false
    return true
  })

  async function mark(regId: string, status: AttendanceStatus) {
    setBusyId(regId)
    const res = await postJson(`/api/workshops/${workshopId}/attendance`, { entries: [{ registration_id: regId, status }] })
    setBusyId(null)
    if (!res.ok) {
      toast.error(firstFieldError(res.error).message)
      return
    }
    toast.success(`Marked ${ATT_LABEL[status].toLowerCase()}.`)
    router.refresh()
  }

  async function convert(regId: string) {
    setBusyId(regId)
    const res = await patchJson(`/api/workshops/registrations/${regId}`, { convert_to_lead: true })
    setBusyId(null)
    if (!res.ok) {
      toast.error(firstFieldError(res.error).message)
      return
    }
    const routed = (res.data as { routed?: string })?.routed
    toast.success(routed === 'ffs' ? 'Routed to the FFS-supervised path.' : 'Converted to a lead.')
    router.refresh()
  }

  if (registrations.length === 0) {
    return <p className="text-sm text-muted-foreground">No registrations yet. Share the public link to fill seats.</p>
  }

  return (
    <div className="space-y-3">
      {/* Filters — attendance status + chosen delivery. */}
      <div className="flex flex-wrap items-center gap-2">
        <FilterGroup
          label="Status"
          value={statusFilter}
          onChange={(v) => setStatusFilter(v as StatusFilter)}
          options={[
            ['all', 'All'],
            ['registered', 'Registered'],
            ['attended', 'Attended'],
            ['no_show', 'No-show'],
            ['left_early', 'Left early'],
          ]}
        />
        <FilterGroup
          label="Delivery"
          value={deliveryFilter}
          onChange={(v) => setDeliveryFilter(v as DeliveryFilter)}
          options={[
            ['all', 'All'],
            ['in_person', 'In-person'],
            ['virtual', 'Virtual'],
          ]}
        />
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground">No registrations match these filters.</p>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Attendee</TableHead>
                <TableHead>Delivery</TableHead>
                <TableHead>Consent</TableHead>
                <TableHead>Attendance</TableHead>
                <TableHead className="text-right">Convert</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((r) => {
                const channels = Array.isArray(r.consent_channels) ? r.consent_channels : []
                const busy = busyId === r.reg_id
                const att = r.attendance_status
                return (
                  <TableRow key={r.reg_id}>
                    <TableCell>
                      <div className="flex items-center gap-2 font-medium">
                        {r.name ?? 'Attendee'}
                        {r.is_walk_in ? <Badge variant="active">walk-in</Badge> : null}
                      </div>
                      <div className="numeric text-xs text-muted-foreground">{r.email ?? '—'}</div>
                    </TableCell>
                    <TableCell className="capitalize text-sm text-muted-foreground">
                      {(r.chosen_delivery ?? 'in_person').replace('_', '-')}
                    </TableCell>
                    <TableCell>
                      {channels.length > 0 ? (
                        <div className="flex gap-1">
                          {channels.map((c) => (
                            <Badge key={c} variant="active">
                              {c}
                            </Badge>
                          ))}
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">none</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Badge variant={ATT_VARIANT[att]}>{ATT_LABEL[att]}</Badge>
                        <div className="flex items-center gap-1">
                          <IconMark title="Attended" active={att === 'attended'} disabled={busy} onClick={() => mark(r.reg_id, 'attended')}>
                            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Check className="h-3.5 w-3.5" aria-hidden />}
                          </IconMark>
                          <IconMark title="No-show" active={att === 'no_show'} disabled={busy} onClick={() => mark(r.reg_id, 'no_show')}>
                            <X className="h-3.5 w-3.5" aria-hidden />
                          </IconMark>
                          <IconMark title="Left early" active={att === 'left_early'} disabled={busy} onClick={() => mark(r.reg_id, 'left_early')}>
                            <LogOut className="h-3.5 w-3.5" aria-hidden />
                          </IconMark>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      {r.ghl_opportunity_id || r.referral_id ? (
                        <span className="text-xs text-status-won">Lead created</span>
                      ) : (
                        <Button size="sm" variant="outline" disabled={busy} onClick={() => convert(r.reg_id)}>
                          <UserPlus className="h-3.5 w-3.5" aria-hidden /> {isSecurity ? 'Route to FFS' : 'Convert to lead'}
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}

function FilterGroup({
  label,
  value,
  onChange,
  options,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  options: [string, string][]
}) {
  return (
    <div className="flex items-center gap-1">
      <span className="mono-label text-xs text-muted-foreground">{label}</span>
      <div className="flex flex-wrap gap-1" role="group" aria-label={label}>
        {options.map(([val, lbl]) => (
          <button
            key={val}
            type="button"
            aria-pressed={value === val}
            onClick={() => onChange(val)}
            className={`rounded-md border px-2 py-1 text-xs transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
              value === val ? 'border-primary bg-primary/10 text-primary' : 'border-input text-muted-foreground hover:bg-muted'
            }`}
          >
            {lbl}
          </button>
        ))}
      </div>
    </div>
  )
}

function IconMark({
  title,
  active,
  disabled,
  onClick,
  children,
}: {
  title: string
  active: boolean
  disabled: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex h-8 w-8 items-center justify-center rounded-md border transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 ${
        active ? 'border-primary bg-primary/10 text-primary' : 'border-input text-muted-foreground hover:bg-muted'
      }`}
    >
      {children}
    </button>
  )
}
