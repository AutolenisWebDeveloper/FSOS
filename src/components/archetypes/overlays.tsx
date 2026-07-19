'use client'

import * as React from 'react'
import Link from 'next/link'
import { CheckCircle2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'

/*
 * Interactive archetypes (client): A7 Modal, A8 Drawer, A9 Confirmation/Completion.
 * A7/A8 share Radix Dialog (focus-trap, ESC/backdrop, focus return); A8 anchors
 * to the right (side="right"). A9 confirm supports typed-confirmation for
 * destructive actions; completion screens always offer a next action.
 */

export function ModalShell({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  title: string
  description?: string
  children?: React.ReactNode
  footer?: React.ReactNode
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent side="center">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        {children}
        {footer ? <DialogFooter>{footer}</DialogFooter> : null}
      </DialogContent>
    </Dialog>
  )
}

export function DrawerShell({
  open,
  onOpenChange,
  title,
  description,
  children,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  title: string
  description?: string
  children?: React.ReactNode
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent side="right">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        <div className="mt-4">{children}</div>
      </DialogContent>
    </Dialog>
  )
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  consequence,
  confirmLabel = 'Confirm',
  destructive = false,
  /** When set, requires the user to type this string to enable confirm (A9). */
  typedConfirmation,
  onConfirm,
  pending = false,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  title: string
  consequence: string
  confirmLabel?: string
  destructive?: boolean
  typedConfirmation?: string
  onConfirm: () => void
  pending?: boolean
}) {
  const [typed, setTyped] = React.useState('')
  const fieldId = React.useId()
  const needsType = Boolean(typedConfirmation)
  const canConfirm = !pending && (!needsType || typed === typedConfirmation)

  React.useEffect(() => {
    if (!open) setTyped('')
  }, [open])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent side="center">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{consequence}</DialogDescription>
        </DialogHeader>
        {needsType ? (
          <div className="space-y-1.5">
            <label htmlFor={fieldId} className="text-sm text-muted-foreground">
              Type <span className="font-mono font-medium text-foreground">{typedConfirmation}</span> to confirm
            </label>
            <Input
              id={fieldId}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
              autoFocus
            />
          </div>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button
            variant={destructive ? 'destructive' : 'default'}
            onClick={onConfirm}
            disabled={!canConfirm}
            loading={pending}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** A9 completion screen — the only permitted dead end; always offers next actions. */
export function CompletionScreen({
  title,
  description,
  nextActions,
}: {
  title: string
  description?: string
  nextActions: { label: string; href: string }[]
}) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4 py-16 text-center">
      <CheckCircle2 className="h-12 w-12 text-status-won" />
      <div className="space-y-1">
        <h1 className="text-xl font-semibold">{title}</h1>
        {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        {nextActions.map((a) => (
          <Button key={a.href} asChild variant="outline">
            <Link href={a.href}>{a.label}</Link>
          </Button>
        ))}
      </div>
    </div>
  )
}
