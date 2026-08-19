'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/archetypes/overlays'
import { deleteJson, firstFieldError } from '@/lib/client/api'

/**
 * A guarded, permanent-delete control for a single event row (an executive alert / compliance event
 * or an AI escalation). Opens a destructive ConfirmDialog; on confirm it hard-deletes via `endpoint`
 * and refreshes the server data so the list, counts, and any cached views update and the row does
 * not return. `redirectTo` navigates away after deletion (used from a detail page whose record is
 * now gone). Rendered inside server components as a client island.
 */
export function DeleteEventButton({
  endpoint,
  title = 'Delete permanently?',
  consequence,
  confirmLabel = 'Delete permanently',
  successMessage = 'Deleted.',
  redirectTo,
  buttonLabel,
  size = 'sm',
  variant = 'ghost',
}: {
  endpoint: string
  title?: string
  consequence: string
  confirmLabel?: string
  successMessage?: string
  redirectTo?: string
  buttonLabel?: string
  size?: 'sm' | 'default'
  variant?: 'ghost' | 'outline'
}) {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [pending, setPending] = React.useState(false)

  async function onConfirm() {
    setPending(true)
    const res = await deleteJson(endpoint)
    setPending(false)
    if (!res.ok) {
      toast.error(firstFieldError(res.error).message)
      return
    }
    setOpen(false)
    toast.success(successMessage)
    if (redirectTo) router.push(redirectTo)
    else router.refresh()
  }

  return (
    <>
      <Button
        variant={variant}
        size={size}
        onClick={() => setOpen(true)}
        aria-label={buttonLabel ? undefined : 'Delete'}
        className="text-destructive hover:text-destructive"
      >
        {buttonLabel ? (
          <>
            <Trash2 className="mr-1.5 h-4 w-4" aria-hidden />
            {buttonLabel}
          </>
        ) : (
          <Trash2 className="h-4 w-4" aria-hidden />
        )}
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={title}
        consequence={consequence}
        confirmLabel={confirmLabel}
        destructive
        onConfirm={onConfirm}
        pending={pending}
      />
    </>
  )
}
