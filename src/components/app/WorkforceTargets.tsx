'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { AssumptionBadge } from '@/components/archetypes/states'
import { toast } from 'sonner'

export interface TargetRow {
  agent_key: string
  daily_target: number
  channel: 'sms' | 'email'
  enabled: boolean
  is_assumption: boolean
  note: string | null
}

const LABEL: Record<string, string> = {
  cross_sell: 'Cross-Sell',
  term_conversion: 'Term Conversion',
  referral_followup: 'Referral Follow-Up',
  marketing_automation: 'Marketing / Win-Back',
}

// Super editor for the per-agent daily contact quotas. Saving a row clears its
// "config default — verify" assumption flag (the operator has now verified it). The
// orchestrator never exceeds daily_target contacts/agent/day.
export function WorkforceTargets({ initial }: { initial: TargetRow[] }) {
  const router = useRouter()
  const [rows, setRows] = useState<TargetRow[]>(initial)
  const [savingKey, setSavingKey] = useState<string | null>(null)

  function patch(key: string, p: Partial<TargetRow>) {
    setRows((rs) => rs.map((r) => (r.agent_key === key ? { ...r, ...p } : r)))
  }

  async function save(row: TargetRow) {
    setSavingKey(row.agent_key)
    try {
      const res = await fetch('/api/super/ai/targets', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agent_key: row.agent_key,
          daily_target: Number(row.daily_target),
          channel: row.channel,
          enabled: row.enabled,
        }),
      })
      const json = await res.json()
      if (!res.ok) {
        toast.error(json.error || 'Could not save')
      } else {
        toast.success(`${LABEL[row.agent_key] ?? row.agent_key} quota saved`)
        patch(row.agent_key, { is_assumption: false })
        router.refresh()
      }
    } catch {
      toast.error('Network error')
    } finally {
      setSavingKey(null)
    }
  }

  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">No outreach agents configured.</p>
  }

  return (
    <div className="space-y-3">
      {rows.map((row) => (
        <div key={row.agent_key} className="flex flex-wrap items-end gap-3 rounded-lg border p-4">
          <div className="min-w-[10rem]">
            <div className="text-sm font-medium">{LABEL[row.agent_key] ?? row.agent_key}</div>
            {row.is_assumption ? (
              <div className="mt-1"><AssumptionBadge /></div>
            ) : (
              <div className="mt-1 text-xs text-muted-foreground">verified</div>
            )}
          </div>

          <label className="flex flex-col gap-1 text-xs">
            <span className="text-muted-foreground">Daily contacts</span>
            <Input
              type="number"
              min={0}
              max={1000}
              value={row.daily_target}
              onChange={(e) => patch(row.agent_key, { daily_target: Number(e.target.value) })}
              className="h-8 w-24"
            />
          </label>

          <label className="flex flex-col gap-1 text-xs">
            <span className="text-muted-foreground">Channel</span>
            <select
              value={row.channel}
              onChange={(e) => patch(row.agent_key, { channel: e.target.value as 'sms' | 'email' })}
              className="h-8 rounded-md border bg-background px-2 text-sm"
            >
              <option value="sms">SMS</option>
              <option value="email">Email</option>
            </select>
          </label>

          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={row.enabled}
              onChange={(e) => patch(row.agent_key, { enabled: e.target.checked })}
            />
            <span>Enabled</span>
          </label>

          <Button size="sm" onClick={() => save(row)} disabled={savingKey === row.agent_key}>
            {savingKey === row.agent_key ? 'Saving…' : 'Save'}
          </Button>
        </div>
      ))}
    </div>
  )
}
