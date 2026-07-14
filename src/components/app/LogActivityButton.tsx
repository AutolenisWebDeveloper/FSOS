'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { ModalShell } from '@/components/archetypes'
import { postJson, firstFieldError } from '@/lib/client/api'

/** A3 "log activity" primary action — reusable across detail pages. */
export function LogActivityButton({
  entityType,
  entityId,
  kind = 'note',
  label = 'Log activity',
}: {
  entityType: string
  entityId: string
  kind?: string
  label?: string
}) {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [note, setNote] = React.useState('')
  const [saving, setSaving] = React.useState(false)

  async function save() {
    if (note.trim().length === 0) {
      toast.error('Add a note')
      return
    }
    setSaving(true)
    const res = await postJson('/api/activities', { entity_type: entityType, entity_id: entityId, kind, note })
    setSaving(false)
    if (!res.ok) {
      toast.error(firstFieldError(res.error).message)
      return
    }
    toast.success('Activity logged')
    setNote('')
    setOpen(false)
    router.refresh()
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        {label}
      </Button>
      <ModalShell
        open={open}
        onOpenChange={setOpen}
        title="Log activity"
        description="Records a timeline entry and updates last-contact where applicable."
        footer={
          <>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={save} disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </>
        }
      >
        <Textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="What happened?"
          aria-label="Activity note"
        />
      </ModalShell>
    </>
  )
}
