'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { postJson, firstFieldError } from '@/lib/client/api'

interface Preset {
  type: string
  name: string
  description: string
}

// Scenario builder (build instruction §8). One click branches a what-if from the
// plan's current frozen version, re-runs the deterministic engine server-side, and
// stores it. The page refreshes to show the new comparison row.
export function ScenarioBuilder({ planId, presets, disabled }: { planId: string; presets: Preset[]; disabled?: boolean }) {
  const router = useRouter()
  const [busy, setBusy] = React.useState<string | null>(null)

  async function add(type: string) {
    setBusy(type)
    const res = await postJson<{ scenario_id?: string; name?: string }>(`/api/fna/plans/${planId}/scenarios`, { scenario_type: type })
    setBusy(null)
    if (!res.ok) {
      toast.error(firstFieldError(res.error).message)
      return
    }
    toast.success(`Added scenario: ${res.data.name ?? type}.`)
    router.refresh()
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Add a scenario</CardTitle>
      </CardHeader>
      <CardContent>
        {disabled ? (
          <p className="text-sm text-muted-foreground">Calculate the plan first — a scenario branches from a frozen version.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {presets.map((p) => (
              <Button key={p.type} variant="outline" size="sm" onClick={() => add(p.type)} disabled={busy !== null} title={p.description}>
                {busy === p.type ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Plus className="h-3.5 w-3.5" aria-hidden />}
                {p.name}
              </Button>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
