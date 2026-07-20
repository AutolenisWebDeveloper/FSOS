'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { postJson, firstFieldError } from '@/lib/client/api'

export interface DisclosureOption {
  id: string
  kind: string
  version: number
  body: string
  is_assumption: boolean
}

// Registered-principal approval action (spec §8). Approving blesses the selected
// disclosure version and opens the publish gate; the server refuses placeholder text.
export function WorkshopApprovalForm({
  workshopId,
  disclosures,
  defaultDisclosureId,
}: {
  workshopId: string
  disclosures: DisclosureOption[]
  defaultDisclosureId: string | null
}) {
  const router = useRouter()
  const [busy, setBusy] = React.useState(false)
  const [approverName, setApproverName] = React.useState('')
  const [approverCrd, setApproverCrd] = React.useState('')
  const [disclosureId, setDisclosureId] = React.useState(defaultDisclosureId ?? disclosures[0]?.id ?? '')
  const [body, setBody] = React.useState('')
  const [notes, setNotes] = React.useState('')

  // Prefill the body from the selected disclosure so the principal edits from context.
  React.useEffect(() => {
    const d = disclosures.find((x) => x.id === disclosureId)
    setBody(d?.body ?? '')
  }, [disclosureId, disclosures])

  const selected = disclosures.find((x) => x.id === disclosureId)
  const isPlaceholder = body.includes('[PLACEHOLDER')

  async function submit(decision: 'approved' | 'rejected') {
    if (!approverName.trim()) {
      toast.error('Enter the approving principal’s name.')
      return
    }
    setBusy(true)
    const res = await postJson(`/api/workshops/${workshopId}/approve`, {
      decision,
      approver_name: approverName,
      approver_crd: approverCrd || undefined,
      disclosure_config_id: decision === 'approved' ? disclosureId || undefined : undefined,
      disclosure_body: decision === 'approved' ? body || undefined : undefined,
      notes: notes || undefined,
    })
    setBusy(false)
    if (!res.ok) {
      toast.error(firstFieldError(res.error).message)
      return
    }
    toast.success(decision === 'approved' ? 'Workshop approved.' : 'Workshop rejected — returned to draft.')
    router.refresh()
  }

  return (
    <div className="space-y-4 rounded-lg border border-border bg-muted/40 p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={`approver-${workshopId}`}>Approving principal</Label>
          <Input
            id={`approver-${workshopId}`}
            value={approverName}
            onChange={(e) => setApproverName(e.target.value)}
            placeholder="e.g. Ryan Anderson (FFS)"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`crd-${workshopId}`}>Principal CRD (optional)</Label>
          <Input id={`crd-${workshopId}`} value={approverCrd} onChange={(e) => setApproverCrd(e.target.value)} />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={`disc-${workshopId}`}>Disclosure version to publish under</Label>
        <Select id={`disc-${workshopId}`} value={disclosureId} onChange={(e) => setDisclosureId(e.target.value)}>
          {disclosures.map((d) => (
            <option key={d.id} value={d.id}>
              {d.kind} · v{d.version}
              {d.is_assumption ? ' (placeholder — verify)' : ' (approved)'}
            </option>
          ))}
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={`body-${workshopId}`}>Approved disclosure text</Label>
        <Textarea id={`body-${workshopId}`} rows={4} value={body} onChange={(e) => setBody(e.target.value)} />
        {isPlaceholder ? (
          <p role="alert" className="text-xs text-destructive">
            This is placeholder text. Replace it with the approved language — the system will not publish placeholder disclosures.
          </p>
        ) : null}
        {selected ? (
          <p className="text-xs text-muted-foreground">
            Kind: <span className="font-medium">{selected.kind}</span>. Approving records this exact text against the workshop.
          </p>
        ) : null}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={`notes-${workshopId}`}>Notes (optional)</Label>
        <Textarea id={`notes-${workshopId}`} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>

      <div className="flex items-center gap-2 border-t pt-3">
        <Button size="sm" onClick={() => submit('approved')} disabled={busy || isPlaceholder}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
          Approve
        </Button>
        <Button size="sm" variant="outline" onClick={() => submit('rejected')} disabled={busy}>
          Reject
        </Button>
      </div>
    </div>
  )
}
