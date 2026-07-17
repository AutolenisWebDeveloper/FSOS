'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Archive, ArchiveRestore, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { patchJson, deleteJson, firstFieldError } from '@/lib/client/api'

export function ContactDetailActions({ id, status, name }: { id: string; status: string; name: string }) {
  const router = useRouter()
  const [busy, setBusy] = React.useState(false)

  async function setStatus(next: 'active' | 'archived') {
    setBusy(true)
    const res = await patchJson(`/api/app/contacts/${id}`, { status: next })
    setBusy(false)
    if (!res.ok) return toast.error(firstFieldError(res.error).message)
    toast.success(next === 'archived' ? 'Contact archived.' : 'Contact restored.')
    router.refresh()
  }

  async function remove() {
    if (!window.confirm(`Delete ${name}? This cannot be undone from the UI.`)) return
    setBusy(true)
    const res = await deleteJson(`/api/app/contacts/${id}`)
    setBusy(false)
    if (!res.ok) return toast.error(firstFieldError(res.error).message)
    toast.success('Contact deleted.')
    router.push('/app/contacts')
  }

  return (
    <div className="flex gap-2">
      {status === 'archived' ? (
        <Button size="sm" variant="outline" disabled={busy} onClick={() => setStatus('active')}><ArchiveRestore className="h-4 w-4" /> Restore</Button>
      ) : (
        <Button size="sm" variant="outline" disabled={busy} onClick={() => setStatus('archived')}><Archive className="h-4 w-4" /> Archive</Button>
      )}
      <Button size="sm" variant="outline" disabled={busy} onClick={remove}><Trash2 className="h-4 w-4 text-destructive" /> Delete</Button>
    </div>
  )
}
