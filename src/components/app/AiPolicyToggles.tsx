'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { patchJson, firstFieldError } from '@/lib/client/api'

export interface AgentToggle {
  key: string
  name: string
  enabled: boolean
  is_guardrail: boolean
}

/**
 * Super · AI kill switches. Renders the global gateway toggle and per-agent
 * toggles. Each toggle PATCHes /api/super/ai/policies then refreshes. The
 * Compliance Guardrail agent (is_guardrail) is rendered disabled — it cannot be
 * turned off from this surface (requires super + a second factor).
 */
export function AiPolicyToggles({
  global,
  agents,
  showGlobal = true,
}: {
  global: boolean
  agents: AgentToggle[]
  showGlobal?: boolean
}) {
  return (
    <div className="space-y-3">
      {showGlobal ? (
        <ToggleRow
          label="AI gateway"
          description="Master kill switch. When off, every agent and gateway call is disabled at run start."
          checked={global}
          payload={{ scope: 'global' }}
        />
      ) : null}
      {agents.map((agent) => (
        <ToggleRow
          key={agent.key}
          label={agent.name}
          description={
            agent.is_guardrail ? 'Cannot be disabled without super + second factor.' : undefined
          }
          checked={agent.enabled}
          disabled={agent.is_guardrail}
          badge={agent.is_guardrail ? <Badge variant="blocked">guardrail</Badge> : undefined}
          payload={{ scope: 'agent', key: agent.key }}
        />
      ))}
    </div>
  )
}

function ToggleRow({
  label,
  description,
  checked,
  disabled = false,
  badge,
  payload,
}: {
  label: string
  description?: string
  checked: boolean
  disabled?: boolean
  badge?: React.ReactNode
  payload: { scope: 'global' } | { scope: 'agent'; key: string }
}) {
  const router = useRouter()
  const [saving, setSaving] = React.useState(false)

  async function toggle() {
    if (disabled || saving) return
    const next = !checked
    setSaving(true)
    const res = await patchJson('/api/super/ai/policies', { ...payload, enabled: next })
    setSaving(false)
    if (!res.ok) {
      toast.error(firstFieldError(res.error).message)
      return
    }
    toast.success(next ? `${label} enabled` : `${label} disabled`)
    router.refresh()
  }

  return (
    <div className="flex items-start justify-between gap-4">
      <div className="space-y-0.5">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{label}</span>
          {badge}
        </div>
        {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={`${checked ? 'Disable' : 'Enable'} ${label}`}
        disabled={disabled || saving}
        onClick={toggle}
        className={[
          'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
          checked ? 'bg-primary' : 'bg-input',
        ].join(' ')}
      >
        <span
          className={[
            'inline-block h-5 w-5 transform rounded-full bg-background shadow transition-transform',
            checked ? 'translate-x-5' : 'translate-x-0.5',
          ].join(' ')}
        />
      </button>
    </div>
  )
}
