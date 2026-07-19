'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, UserPlus, Check } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { patchJson, firstFieldError } from '@/lib/client/api'

export interface Registration {
  reg_id: string
  name: string | null
  email: string | null
  phone: string | null
  status: string | null
  attended: boolean | null
  referral_id: string | null
  consent_channels: string[] | null
}

// Registrations table with attendance + convert-to-referral (docs/legacy-port.md §2.5).
export function WorkshopRegistrations({ registrations }: { registrations: Registration[] }) {
  const router = useRouter()
  const [busyId, setBusyId] = React.useState<string | null>(null)

  async function patch(regId: string, body: Record<string, unknown>, successMsg: string) {
    setBusyId(regId)
    const res = await patchJson(`/api/workshops/registrations/${regId}`, body)
    setBusyId(null)
    if (!res.ok) {
      toast.error(firstFieldError(res.error).message)
      return
    }
    toast.success(successMsg)
    router.refresh()
  }

  if (registrations.length === 0) {
    return <p className="text-sm text-muted-foreground">No registrations yet. Share the public link to fill seats.</p>
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Attendee</TableHead>
          <TableHead>Consent</TableHead>
          <TableHead>Attended</TableHead>
          <TableHead className="text-right">Convert</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {registrations.map((r) => {
          const channels = Array.isArray(r.consent_channels) ? r.consent_channels : []
          const busy = busyId === r.reg_id
          return (
            <TableRow key={r.reg_id}>
              <TableCell>
                <div className="font-medium">{r.name ?? 'Attendee'}</div>
                <div className="numeric text-xs text-muted-foreground">{r.email ?? '—'}</div>
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
                <Button
                  size="sm"
                  variant={r.attended ? 'default' : 'outline'}
                  disabled={busy}
                  onClick={() => patch(r.reg_id, { attended: !r.attended }, r.attended ? 'Marked absent.' : 'Marked attended.')}
                >
                  {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Check className="h-3.5 w-3.5" aria-hidden />}
                  {r.attended ? 'Attended' : 'Mark'}
                </Button>
              </TableCell>
              <TableCell className="text-right">
                {r.referral_id ? (
                  <a href={`/app/referrals/${r.referral_id}`} className="text-xs text-accent hover:underline">
                    View referral
                  </a>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => patch(r.reg_id, { convert_to_referral: true }, 'Converted to a referral.')}
                  >
                    <UserPlus className="h-3.5 w-3.5" aria-hidden /> To referral
                  </Button>
                )}
              </TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}
