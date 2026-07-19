'use client'

import * as React from 'react'
import { LifeBuoy, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { CompletionScreen } from '@/components/archetypes'
import { postJson, firstFieldError } from '@/lib/client/api'

// Support-request form (A5). Posts to /api/support/requests, which writes the
// support_requests table + audit. On success shows a completion screen with next
// actions (no dead end).
export function SupportRequestForm() {
  const [subject, setSubject] = React.useState('')
  const [body, setBody] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [done, setDone] = React.useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const res = await postJson('/api/support/requests', { subject: subject.trim(), body: body.trim() })
    setBusy(false)
    if (!res.ok) {
      setError(firstFieldError(res.error).message)
      return
    }
    setDone(true)
  }

  if (done) {
    return (
      <CompletionScreen
        title="Support request sent"
        description="Our team will follow up. You can keep working in the meantime."
        nextActions={[
          { label: 'Back to dashboard', href: '/app' },
          { label: 'Submit another', href: '/app/help' },
        ]}
      />
    )
  }

  return (
    <form onSubmit={submit} className="max-w-xl space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="subject">Subject</Label>
        <Input id="subject" value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={200} required placeholder="Short summary" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="body">How can we help?</Label>
        <Textarea id="body" value={body} onChange={(e) => setBody(e.target.value)} rows={6} maxLength={5000} required placeholder="Describe the issue or question…" />
      </div>
      {error ? (
        <p role="alert" className="text-sm text-status-lost">
          {error}
        </p>
      ) : null}
      <Button type="submit" disabled={busy || !subject.trim() || !body.trim()}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <LifeBuoy className="h-4 w-4" aria-hidden />}
        Send request
      </Button>
    </form>
  )
}
