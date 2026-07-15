'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { patchJson, firstFieldError } from '@/lib/client/api'

// Per-agent kill switch. The Compliance Guardrail cannot be disabled without super+2FA
// (server enforced); the UI reflects that with a confirm prompt.
export function AgentToggle({ agentKey, enabled, isGuardrail }: { agentKey: string; enabled: boolean; isGuardrail: boolean }) {
  const router = useRouter()
  const [busy, setBusy] = React.useState(false)

  async function toggle() {
    const next = !enabled
    setBusy(true)
    const body: Record<string, unknown> = { enabled: next }
    if (isGuardrail && !next) {
      const confirmed = typeof window !== 'undefined' && window.confirm('Disabling the Compliance Guardrail requires super-admin + second-factor. Confirm the second factor to proceed.')
      if (!confirmed) { setBusy(false); return }
      body.step_up_confirmed = true
    }
    const res = await patchJson(`/api/ai/agents/${agentKey}`, body)
    setBusy(false)
    if (!res.ok) {
      if (res.error.reason === 'guardrail_protected') { toast.error('The Compliance Guardrail can only be disabled by a super admin with a second factor.'); return }
      toast.error(firstFieldError(res.error).message); return
    }
    toast.success(next ? 'Agent enabled' : 'Agent disabled — stops at next run start.')
    router.refresh()
  }

  return (
    <Button size="sm" variant={enabled ? 'outline' : 'default'} onClick={toggle} disabled={busy}>
      {busy ? '…' : enabled ? 'Disable' : 'Enable'}
    </Button>
  )
}
