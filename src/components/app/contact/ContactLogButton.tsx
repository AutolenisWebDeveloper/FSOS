'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { NotebookPen } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { ModalShell } from '@/components/archetypes/overlays'
import { Segmented } from '@/components/ui/segmented'
import { postJson, firstFieldError } from '@/lib/client/api'
import { cn } from '@/lib/utils'

/*
 * "Log interaction" — records what actually happened onto the contact's activity
 * stream through the existing POST /api/activities (entity_type: 'contact'). It
 * SENDS nothing; it is the record of a conversation the FSA had, which is exactly
 * what makes the Timeline trustworthy.
 *
 * The kind selector maps onto the icons the timeline already renders, so a logged
 * call reads identically to a system-logged one.
 */

const KINDS = [
  { value: 'call', label: 'Call' },
  { value: 'sms', label: 'Text' },
  { value: 'email', label: 'Email' },
  { value: 'meeting', label: 'Meeting' },
  { value: 'note', label: 'Note' },
] as const

type Kind = (typeof KINDS)[number]['value']

export function ContactLogButton({
  contactId,
  className,
  variant = 'outline',
  label = 'Log interaction',
  defaultKind = 'call',
}: {
  contactId: string
  className?: string
  variant?: 'outline' | 'default' | 'ghost'
  label?: string
  defaultKind?: Kind
}) {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [kind, setKind] = React.useState<Kind>(defaultKind)
  const [note, setNote] = React.useState('')
  const [saving, setSaving] = React.useState(false)
  const fieldId = React.useId()

  async function save() {
    const body = note.trim()
    if (!body) {
      toast.error('Add a short summary first')
      return
    }
    setSaving(true)
    const res = await postJson('/api/activities', {
      entity_type: 'contact',
      entity_id: contactId,
      kind,
      note: body,
    })
    setSaving(false)
    if (!res.ok) {
      toast.error(firstFieldError(res.error).message)
      return
    }
    toast.success('Logged to the timeline')
    setNote('')
    setOpen(false)
    router.refresh()
  }

  return (
    <>
      <Button size="sm" variant={variant} className={cn(className)} onClick={() => setOpen(true)}>
        <NotebookPen className="h-4 w-4" /> {label}
      </Button>
      <ModalShell
        open={open}
        onOpenChange={setOpen}
        title="Log interaction"
        description="Records what happened onto this contact's timeline. Nothing is sent."
        footer={
          <>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={save} loading={saving} disabled={saving}>
              Save to timeline
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor={`${fieldId}-kind`}>Type</Label>
            <Segmented
              options={KINDS}
              value={kind}
              onChange={(v) => setKind(v)}
              label="Interaction type"
              size="sm"
              className="flex-wrap"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={fieldId}>What happened</Label>
            <Textarea
              id={fieldId}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={4}
              placeholder="Walked through the conversion window; sending the illustration Monday."
              autoFocus
            />
          </div>
        </div>
      </ModalShell>
    </>
  )
}
