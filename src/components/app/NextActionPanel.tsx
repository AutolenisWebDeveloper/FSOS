'use client'

import * as React from 'react'
import { Sparkles, Loader2, ShieldAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { postJson } from '@/lib/client/api'

type Result = { text?: string; blocked?: boolean; message?: string }

// Client-360 "next best action" panel. Requests green-zone operational
// suggestions from /api/app/households/[id]/next-action (gateway + guardrail +
// logged). Renders a blocked state distinctly if the red-line screen fires.
export function NextActionPanel({ householdId }: { householdId: string }) {
  const [state, setState] = React.useState<'idle' | 'loading' | 'ready' | 'blocked' | 'error'>('idle')
  const [text, setText] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)

  async function run() {
    setState('loading')
    setError(null)
    const res = await postJson<Result>(`/api/app/households/${householdId}/next-action`, {})
    if (!res.ok) {
      setError(res.error.error || 'AI is unavailable right now.')
      setState('error')
      return
    }
    if (res.data.blocked) {
      setText(res.data.message || 'The suggestion was blocked.')
      setState('blocked')
      return
    }
    setText(res.data.text || '')
    setState('ready')
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="text-base">Next best action</CardTitle>
        <Button size="sm" variant="outline" onClick={() => void run()} disabled={state === 'loading'}>
          {state === 'loading' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Sparkles className="h-4 w-4" aria-hidden />}
          {state === 'idle' ? 'Suggest' : 'Refresh'}
        </Button>
      </CardHeader>
      <CardContent>
        <p className="mb-3 text-xs text-muted-foreground">
          Operational suggestions only — schedule a review, request a document, log a follow-up. Never a product recommendation.
        </p>
        {state === 'idle' ? (
          <p className="text-sm text-muted-foreground">Ask for suggested next steps for this household.</p>
        ) : null}
        {state === 'error' ? (
          <div role="alert" className="rounded-lg border border-l-2 border-status-lost/30 border-l-status-lost bg-status-lost/5 p-3 text-sm">
            {error}
          </div>
        ) : null}
        {state === 'blocked' ? (
          <div className="flex items-start gap-2 rounded-lg border border-l-2 border-status-escalated/30 border-l-status-escalated bg-status-escalated/5 p-3 text-sm">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-status-escalated" strokeWidth={1.75} aria-hidden />
            <span>{text}</span>
          </div>
        ) : null}
        {state === 'ready' ? <div className="whitespace-pre-wrap text-sm">{text}</div> : null}
      </CardContent>
    </Card>
  )
}
