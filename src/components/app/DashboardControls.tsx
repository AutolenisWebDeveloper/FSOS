'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/archetypes'
import { patchJson, firstFieldError } from '@/lib/client/api'

// A3 detail controls for a custom dashboard: refresh + archive (soft-delete).
export function DashboardControls({ id }: { id: string }) {
  const router = useRouter()
  const [busy, setBusy] = React.useState(false)
  const [confirmOpen, setConfirmOpen] = React.useState(false)

  async function archive() {
    setBusy(true)
    const res = await patchJson(`/api/dashboards/${id}`, { archived: true })
    setBusy(false)
    setConfirmOpen(false)
    if (!res.ok) {
      toast.error(firstFieldError(res.error).message)
      return
    }
    toast.success('Dashboard archived.')
    router.push('/app/dashboards')
  }

  return (
    <div className="flex flex-wrap gap-2">
      <Button size="sm" variant="outline" onClick={() => router.refresh()} disabled={busy}>Refresh</Button>
      <Button size="sm" variant="outline" onClick={() => setConfirmOpen(true)} disabled={busy}>Archive</Button>
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Archive this dashboard?"
        consequence="It will be removed from your dashboards list. This does not delete any underlying data."
        confirmLabel="Archive"
        pending={busy}
        onConfirm={archive}
      />
    </div>
  )
}
