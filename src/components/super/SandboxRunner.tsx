'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Field } from '@/components/forms/Field'
import { SandboxRunSchema } from '@/lib/validation/schemas'
import { postJson, firstFieldError } from '@/lib/client/api'

interface SandboxRun {
  id: string
  agent_key: string | null
  blocked: boolean
  guardrail_pass: boolean
  guardrail_reason: string | null
  output: string | null
}

export function SandboxRunner() {
  const router = useRouter()
  const [prompt, setPrompt] = React.useState('')
  const [agentKey, setAgentKey] = React.useState('')
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [running, setRunning] = React.useState(false)
  const [result, setResult] = React.useState<SandboxRun | null>(null)

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setErrors({})
    const payload = { prompt, agent_key: agentKey.trim() ? agentKey.trim() : undefined }
    const parsed = SandboxRunSchema.safeParse(payload)
    if (!parsed.success) {
      const fe = parsed.error.flatten().fieldErrors
      setErrors(Object.fromEntries(Object.entries(fe).map(([k, val]) => [k, val?.[0] ?? 'Invalid'])))
      return
    }
    setRunning(true)
    const res = await postJson<{ run: SandboxRun }>('/api/super/sandbox', parsed.data)
    setRunning(false)
    if (!res.ok) {
      const fe = firstFieldError(res.error)
      if (fe.field) setErrors({ [fe.field]: fe.message })
      toast.error(fe.message)
      return
    }
    setResult(res.data.run)
    toast[res.data.run.blocked ? 'error' : 'success'](
      res.data.run.blocked ? 'HARD-BLOCKED — escalated, never sent.' : 'Passed guardrail (green-zone).',
    )
    router.refresh()
  }

  return (
    <div className="space-y-4">
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <Field id="agent_key" label="Agent (optional)" error={errors.agent_key} hint="Which agent would draft this — e.g. referral_follow_up.">
          <Input
            id="agent_key"
            name="agent_key"
            value={agentKey}
            onChange={(ev) => setAgentKey(ev.target.value)}
            placeholder="cross_sell"
          />
        </Field>
        <Field
          id="prompt"
          label="Draft client-facing message"
          required
          error={errors.prompt}
          hint="Education / invitation only. Recommendation, securities, DNC, or out-of-hours language is hard-blocked."
        >
          <Textarea
            id="prompt"
            name="prompt"
            rows={6}
            value={prompt}
            onChange={(ev) => setPrompt(ev.target.value)}
            placeholder="Hi {{first_name}}, it may be a good time for your annual coverage review. Reply STOP to opt out."
          />
        </Field>
        <div className="flex justify-end">
          <Button type="submit" disabled={running}>{running ? 'Testing…' : 'Test against guardrail'}</Button>
        </div>
      </form>

      {result ? (
        <div
          role="status"
          className={`rounded-lg border p-4 ${result.blocked ? 'border-status-blocked/40 bg-status-blocked/5' : 'border-status-won/40 bg-status-won/5'}`}
        >
          <div className="mb-2 flex items-center gap-2">
            <Badge variant={result.blocked ? 'blocked' : 'won'}>{result.blocked ? 'blocked' : 'passed'}</Badge>
            {result.guardrail_reason ? (
              <span className="text-sm text-muted-foreground">Reasons: {result.guardrail_reason}</span>
            ) : null}
          </div>
          <p className="text-sm">{result.output}</p>
        </div>
      ) : null}
    </div>
  )
}
