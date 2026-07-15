'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Link2, Archive } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { Label } from '@/components/ui/label'
import { patchJson, deleteJson, firstFieldError } from '@/lib/client/api'

interface HouseholdOption {
  id: string
  primary_name: string
}

// Attach a submitted client-form response to a household (docs/legacy-port.md §2.3).
// Attaching records the response on the household and materializes captured consent.
export function AttachResponse({
  responseId,
  households,
  attachedHouseholdId,
}: {
  responseId: string
  households: HouseholdOption[]
  attachedHouseholdId: string | null
}) {
  const router = useRouter()
  const [householdId, setHouseholdId] = React.useState(households[0]?.id ?? '')
  const [busy, setBusy] = React.useState<'idle' | 'attaching' | 'archiving'>('idle')

  async function onAttach() {
    if (!householdId) return
    setBusy('attaching')
    const res = await patchJson<{ household_name?: string }>(`/api/forms/responses/${responseId}`, {
      household_id: householdId,
    })
    setBusy('idle')
    if (!res.ok) {
      toast.error(firstFieldError(res.error).message)
      return
    }
    toast.success(`Attached to ${res.data.household_name ?? 'household'}.`)
    router.refresh()
  }

  async function onArchive() {
    setBusy('archiving')
    const res = await deleteJson(`/api/forms/responses/${responseId}`)
    setBusy('idle')
    if (!res.ok) {
      toast.error(firstFieldError(res.error).message)
      return
    }
    toast.success('Response archived.')
    router.push('/app/forms')
    router.refresh()
  }

  if (attachedHouseholdId) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          This response is attached to a household. Open the household to see the recorded intake and consent.
        </p>
        <Button asChild variant="outline">
          <a href={`/app/households/${attachedHouseholdId}`}>
            <Link2 className="h-4 w-4" aria-hidden /> Open household
          </a>
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {households.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No households yet. Convert a referral into a household first, then attach this response.
        </p>
      ) : (
        <div className="space-y-1.5">
          <Label htmlFor="attach-household">Attach to household</Label>
          <Select
            id="attach-household"
            value={householdId}
            onChange={(e) => setHouseholdId(e.target.value)}
            disabled={busy !== 'idle'}
          >
            {households.map((h) => (
              <option key={h.id} value={h.id}>
                {h.primary_name}
              </option>
            ))}
          </Select>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={onAttach} disabled={busy !== 'idle' || !householdId}>
          {busy === 'attaching' ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Attaching…
            </>
          ) : (
            <>
              <Link2 className="h-4 w-4" aria-hidden /> Attach to household
            </>
          )}
        </Button>
        <Button variant="outline" onClick={onArchive} disabled={busy !== 'idle'}>
          {busy === 'archiving' ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Archiving…
            </>
          ) : (
            <>
              <Archive className="h-4 w-4" aria-hidden /> Archive
            </>
          )}
        </Button>
      </div>
    </div>
  )
}
