'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { toast } from 'sonner'

export interface HoursPolicy {
  enabled: boolean
  start_hour: number
  end_hour: number
  days: number[]
  timezone_offset_hours: number
  is_assumption: boolean
}

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function hourLabel(h: number): string {
  if (h === 0 || h === 24) return h === 24 ? '12am (next day)' : '12am'
  if (h === 12) return '12pm'
  return h < 12 ? `${h}am` : `${h - 12}pm`
}

// Super editor for the hours of operation. Governs every automated SMS/email. Saving
// clears the "config default — verify" flag. Note: the legal recipient-local 9am–8pm
// floor always applies on top of whatever is set here — this window can only tighten.
export function HoursOfOperation({ initial }: { initial: HoursPolicy }) {
  const router = useRouter()
  const [p, setP] = useState<HoursPolicy>(initial)
  const [saving, setSaving] = useState(false)

  function toggleDay(d: number) {
    setP((s) => ({ ...s, days: s.days.includes(d) ? s.days.filter((x) => x !== d) : [...s.days, d].sort() }))
  }

  async function save() {
    if (p.end_hour <= p.start_hour) {
      toast.error('End time must be after start time')
      return
    }
    setSaving(true)
    try {
      const res = await fetch('/api/super/ai/hours', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled: p.enabled,
          start_hour: Number(p.start_hour),
          end_hour: Number(p.end_hour),
          days: p.days,
          timezone_offset_hours: Number(p.timezone_offset_hours),
        }),
      })
      const json = await res.json()
      if (!res.ok) {
        toast.error(json.error || 'Could not save')
      } else {
        toast.success('Hours of operation saved')
        setP((s) => ({ ...s, is_assumption: false }))
        router.refresh()
      }
    } catch {
      toast.error('Network error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4 rounded-lg border p-4">
      <label className="flex items-center gap-2 text-sm font-medium">
        <input type="checkbox" checked={p.enabled} onChange={(e) => setP((s) => ({ ...s, enabled: e.target.checked }))} />
        Enforce hours of operation
        {p.is_assumption ? <span className="text-xs text-amber-600 dark:text-amber-500">(config default — verify)</span> : null}
      </label>

      <div className="flex flex-wrap items-end gap-4">
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">Start ({hourLabel(p.start_hour)})</span>
          <Input type="number" min={0} max={23} value={p.start_hour} onChange={(e) => setP((s) => ({ ...s, start_hour: Number(e.target.value) }))} className="h-8 w-24" disabled={!p.enabled} />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">End ({hourLabel(p.end_hour)}, exclusive)</span>
          <Input type="number" min={1} max={24} value={p.end_hour} onChange={(e) => setP((s) => ({ ...s, end_hour: Number(e.target.value) }))} className="h-8 w-24" disabled={!p.enabled} />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">Business UTC offset</span>
          <Input type="number" min={-12} max={14} step={0.5} value={p.timezone_offset_hours} onChange={(e) => setP((s) => ({ ...s, timezone_offset_hours: Number(e.target.value) }))} className="h-8 w-24" disabled={!p.enabled} />
        </label>
      </div>

      <div className="space-y-1">
        <span className="text-xs text-muted-foreground">Days</span>
        <div className="flex flex-wrap gap-2">
          {DAY_LABELS.map((label, d) => (
            <button
              key={d}
              type="button"
              disabled={!p.enabled}
              onClick={() => toggleDay(d)}
              className={`h-8 rounded-md border px-3 text-xs ${p.days.includes(d) ? 'bg-primary text-primary-foreground' : 'bg-background'} disabled:opacity-50`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        The legal quiet-hours floor (recipient-local 9am–8pm) always applies on top of this — these hours can only make sending more restrictive, never less. Outside these hours, automated messages are held for the next in-hours cycle (not escalated).
      </p>

      <Button size="sm" onClick={save} disabled={saving}>
        {saving ? 'Saving…' : 'Save hours'}
      </Button>
    </div>
  )
}
