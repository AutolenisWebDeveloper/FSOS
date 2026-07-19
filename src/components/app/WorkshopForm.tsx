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
import { WORKSHOP_TOPICS } from '@/lib/validation/schemas'

// Create-workshop form (docs/legacy-port.md §2.5). Zod-validated server-side; the
// same field names as WorkshopCreateSchema.
export function WorkshopForm() {
  const router = useRouter()
  const [busy, setBusy] = React.useState(false)
  const [errorField, setErrorField] = React.useState<string | undefined>()

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    setBusy(true)
    setErrorField(undefined)
    const res = await postJson<{ workshop_id?: string }>('/api/workshops', {
      title: fd.get('title'),
      topic: fd.get('topic'),
      description: (fd.get('description') as string) || undefined,
      scheduled_at: fd.get('scheduled_at'),
      location: (fd.get('location') as string) || undefined,
      max_attendees: fd.get('max_attendees') ? Number(fd.get('max_attendees')) : undefined,
    })
    setBusy(false)
    if (!res.ok) {
      const fe = firstFieldError(res.error)
      setErrorField(fe.field)
      toast.error(fe.message)
      return
    }
    toast.success('Workshop created.')
    router.push(`/app/workshops/${res.data.workshop_id}`)
    router.refresh()
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="title">Title</Label>
        <Input id="title" name="title" required aria-invalid={errorField === 'title'} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="topic">Topic</Label>
          <Select id="topic" name="topic" defaultValue="general">
            {WORKSHOP_TOPICS.map((t) => (
              <option key={t} value={t} className="capitalize">
                {t}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="scheduled_at">Date &amp; time</Label>
          <Input id="scheduled_at" name="scheduled_at" type="datetime-local" required aria-invalid={errorField === 'scheduled_at'} />
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="location">Location</Label>
          <Input id="location" name="location" placeholder="Virtual or address" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="max_attendees">Max attendees</Label>
          <Input id="max_attendees" name="max_attendees" type="number" min={1} defaultValue={50} />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="description">Description</Label>
        <Textarea id="description" name="description" rows={3} placeholder="Educational content only — no product pitch." />
      </div>
      <div className="flex items-center gap-2 border-t pt-4">
        <Button type="submit" disabled={busy}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
          Create workshop
        </Button>
        <Button type="button" variant="outline" onClick={() => router.push('/app/workshops')} disabled={busy}>
          Cancel
        </Button>
      </div>
    </form>
  )
}
