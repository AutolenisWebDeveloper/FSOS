'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { postJson, patchJson, firstFieldError } from '@/lib/client/api'

// FSA inbox reply box. The reply is sent through the SAME 7-step gate as every
// message (consent/quiet-hours/DNC/approved-template/recommendation/securities); a
// block is surfaced with its reason, never forced. Securities threads are blocked.
export function ConversationReply({ id, channel, isSecurity }: { id: string; channel: string; isSecurity: boolean }) {
  const router = useRouter()
  const [body, setBody] = React.useState('')
  const [subject, setSubject] = React.useState('')
  const [sending, setSending] = React.useState(false)

  async function send() {
    if (!body.trim()) return
    setSending(true)
    const res = await postJson<{ blocked?: boolean; reason?: string; sent?: boolean }>(`/api/comms/conversations/${id}`, {
      body,
      subject: channel === 'email' ? subject || undefined : undefined,
      idempotency_key: `reply-${id}-${Date.now()}`,
    })
    setSending(false)
    if (!res.ok) {
      toast.error(firstFieldError(res.error).message)
      return
    }
    if (res.data.blocked) {
      toast.error(`Blocked by the gate: ${res.data.reason ?? 'not sendable'}. Escalated to you.`)
      return
    }
    toast.success('Reply sent through the gate.')
    setBody('')
    setSubject('')
    router.refresh()
  }

  if (isSecurity) {
    return (
      <div className="rounded-lg border border-status-security/40 bg-status-security/5 p-3 text-sm">
        This thread is securities-flagged. Replies are excluded from automation and must be handled through the
        FFS-supervised channel — not from FSOS.
      </div>
    )
  }

  return (
    <div className="space-y-2 rounded-lg border p-3">
      {channel === 'email' ? (
        <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject" aria-label="Subject" />
      ) : null}
      <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3} placeholder="Type a reply… (passes the compliance gate before sending)" aria-label="Reply" />
      <div className="flex justify-end">
        <Button size="sm" onClick={send} disabled={sending || !body.trim()}>{sending ? 'Sending…' : `Send ${channel}`}</Button>
      </div>
    </div>
  )
}

// Per-thread AI auto-reply toggle. When on, an inbound message is answered by the
// green-zone Conversation Responder — the draft still passes the gate before send.
export function AutoReplyToggle({ id, enabled }: { id: string; enabled: boolean }) {
  const router = useRouter()
  const [on, setOn] = React.useState(enabled)
  const [busy, setBusy] = React.useState(false)

  async function toggle() {
    setBusy(true)
    const res = await patchJson(`/api/comms/conversations/${id}`, { ai_autoreply: !on })
    setBusy(false)
    if (!res.ok) {
      toast.error(firstFieldError(res.error).message)
      return
    }
    setOn(!on)
    toast.success(`AI auto-reply ${!on ? 'enabled' : 'disabled'} for this thread.`)
    router.refresh()
  }

  return (
    <Button size="sm" variant={on ? 'default' : 'outline'} onClick={toggle} disabled={busy}>
      {on ? 'AI auto-reply: on' : 'AI auto-reply: off'}
    </Button>
  )
}
