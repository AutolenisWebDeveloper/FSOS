'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

// Editor for the first-contact identity-disclosure wording (§8). Saving bumps the
// version and resets approval (re-approval required); approving enables the platform to
// auto-insert the disclosure. Both actions post to /api/comms/identity. Buttons disable
// while in flight (duplicate-submission protection); errors surface inline.
export interface IdentityConfig {
  fsa_role_label: string
  full_template: string
  abbreviated_template: string
  inactivity_days: number
  approval_status: string
}

export function IdentityEditor({ config }: { config: IdentityConfig }) {
  const router = useRouter()
  const [roleLabel, setRoleLabel] = useState(config.fsa_role_label)
  const [full, setFull] = useState(config.full_template)
  const [abbrev, setAbbrev] = useState(config.abbreviated_template)
  const [days, setDays] = useState(String(config.inactivity_days))
  const [verified, setVerified] = useState(false)
  const [busy, setBusy] = useState<null | 'save' | 'approve'>(null)
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)

  async function post(payload: Record<string, unknown>, which: 'save' | 'approve') {
    setBusy(which)
    setError(null)
    setOk(null)
    try {
      const res = await fetch('/api/comms/identity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string; approval_status?: string }
      if (!res.ok) {
        setError(data.error ?? 'Could not save. Please try again.')
        setBusy(null)
        return
      }
      setOk(which === 'approve' ? 'Approved — the platform will now auto-insert this disclosure on first contact.' : 'Saved. Re-approval is required before it is auto-inserted.')
      setBusy(null)
      router.refresh()
    } catch {
      setError('Network error — please try again.')
      setBusy(null)
    }
  }

  function save() {
    const n = Number(days)
    if (!Number.isInteger(n) || n < 1) {
      setError('Enter a whole number of days (1 or more) for the inactivity window.')
      setOk(null)
      return
    }
    void post(
      { action: 'save', fsaRoleLabel: roleLabel, fullTemplate: full, abbreviatedTemplate: abbrev, inactivityDays: n, markVerified: verified },
      'save',
    )
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="role">Farmers role / entity label</Label>
        <Input id="role" value={roleLabel} onChange={(e) => setRoleLabel(e.target.value)} />
        <p className="text-xs text-muted-foreground">The approved way to describe the sender (e.g. “a Financial Services Agent with Farmers Financial Solutions”). Verify against approved Farmers/FFS wording.</p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="full">Full introduction (first contact)</Label>
        <Textarea id="full" rows={4} value={full} onChange={(e) => setFull(e.target.value)} />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="abbrev">Abbreviated identity (established thread)</Label>
        <Textarea id="abbrev" rows={2} value={abbrev} onChange={(e) => setAbbrev(e.target.value)} />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="days">Re-introduce after inactivity (days)</Label>
        <Input id="days" type="number" min={1} value={days} onChange={(e) => setDays(e.target.value)} className="max-w-[140px]" />
      </div>

      <p className="text-xs text-muted-foreground">
        Available tokens: <code>{'{{sender.full_name}}'}</code>, <code>{'{{sender.first_name}}'}</code>, <code>{'{{agency_owner.full_name}}'}</code>, <code>{'{{agency_owner.first_name}}'}</code>, <code>{'{{communication.reason}}'}</code>, <code>{'{{fsa_role_label}}'}</code>.
      </p>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={verified} onChange={(e) => setVerified(e.target.checked)} />
        Mark this wording as verified (clears the “config default” badge)
      </label>

      {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
      {ok && <p className="text-sm text-status-won" role="status">{ok}</p>}

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" disabled={busy !== null} onClick={save}>
          {busy === 'save' ? 'Saving…' : 'Save draft'}
        </Button>
        <Button disabled={busy !== null || config.approval_status === 'approved'} onClick={() => post({ action: 'approve' }, 'approve')}>
          {busy === 'approve' ? 'Approving…' : config.approval_status === 'approved' ? 'Approved' : 'Approve for use'}
        </Button>
      </div>
    </div>
  )
}
