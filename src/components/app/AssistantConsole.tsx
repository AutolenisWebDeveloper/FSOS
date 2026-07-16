'use client'

import * as React from 'react'
import { Send, Loader2, ShieldAlert, Bot, User } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { postJson } from '@/lib/client/api'

type Turn = { role: 'user' | 'assistant'; content: string; blocked?: boolean }

type AssistantResponse = { text?: string; blocked?: boolean; message?: string }

// Internal FSA assistant chat console. Posts the running transcript to
// /api/app/assistant (gateway + guardrail + logged). Renders a blocked turn
// distinctly when the red-line screen fires. Green-zone tool only.
export function AssistantConsole() {
  const [turns, setTurns] = React.useState<Turn[]>([])
  const [draft, setDraft] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const endRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [turns, busy])

  async function send() {
    const content = draft.trim()
    if (!content || busy) return
    setError(null)
    const next: Turn[] = [...turns, { role: 'user', content }]
    setTurns(next)
    setDraft('')
    setBusy(true)
    const res = await postJson<AssistantResponse>('/api/app/assistant', {
      messages: next.map((t) => ({ role: t.role, content: t.content })),
    })
    setBusy(false)
    if (!res.ok) {
      setError(res.error.error || 'The assistant is unavailable right now.')
      return
    }
    if (res.data.blocked) {
      setTurns((t) => [...t, { role: 'assistant', content: res.data.message || 'That response was blocked.', blocked: true }])
      return
    }
    setTurns((t) => [...t, { role: 'assistant', content: res.data.text || '' }])
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      void send()
    }
  }

  return (
    <div className="flex h-[calc(100vh-16rem)] min-h-[420px] flex-col rounded-lg border">
      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        {turns.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-sm text-muted-foreground">
            <Bot className="h-8 w-8" strokeWidth={1.5} aria-hidden />
            <p>Ask about your book, summarize a record, or draft an internal note.</p>
            <p className="text-xs">Green-zone only — it will not recommend a product to a client.</p>
          </div>
        ) : null}
        {turns.map((t, i) => (
          <div key={i} className={t.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
            <div
              className={
                t.blocked
                  ? 'flex max-w-[80%] items-start gap-2 rounded-lg border border-l-2 border-status-escalated/30 border-l-status-escalated bg-status-escalated/5 p-3 text-sm'
                  : t.role === 'user'
                    ? 'max-w-[80%] rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground'
                    : 'flex max-w-[80%] items-start gap-2 rounded-lg border bg-card px-3 py-2 text-sm'
              }
            >
              {t.role === 'assistant' ? (
                t.blocked ? (
                  <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-status-escalated" strokeWidth={1.75} aria-hidden />
                ) : (
                  <Bot className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.75} aria-hidden />
                )
              ) : (
                <User className="sr-only h-4 w-4" aria-hidden />
              )}
              <span className="whitespace-pre-wrap break-words">{t.content}</span>
            </div>
          </div>
        ))}
        {busy ? (
          <div className="flex justify-start">
            <div className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Thinking…
            </div>
          </div>
        ) : null}
        <div ref={endRef} />
      </div>

      {error ? (
        <div role="alert" className="border-t border-status-lost/30 bg-status-lost/5 px-4 py-2 text-sm text-status-lost">
          {error}
        </div>
      ) : null}

      <div className="flex items-end gap-2 border-t p-3">
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          rows={2}
          placeholder="Ask the assistant… (⌘/Ctrl + Enter to send)"
          aria-label="Message the assistant"
          className="min-h-[44px] flex-1 resize-none"
        />
        <Button type="button" onClick={() => void send()} disabled={busy || !draft.trim()}>
          <Send className="h-4 w-4" aria-hidden /> Send
        </Button>
      </div>
    </div>
  )
}
