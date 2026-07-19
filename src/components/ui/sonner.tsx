'use client'

import { Toaster as Sonner } from 'sonner'

type ToasterProps = React.ComponentProps<typeof Sonner>

/** App-wide toast host (archetypes: success/error toasts). Themed via tokens. */
export function Toaster(props: ToasterProps) {
  return (
    <Sonner
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            'group toast group-[.toaster]:rounded-xl group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-xl',
          title: 'group-[.toast]:font-semibold',
          description: 'group-[.toast]:text-muted-foreground',
          actionButton: 'group-[.toast]:bg-primary group-[.toast]:text-primary-foreground',
          cancelButton: 'group-[.toast]:bg-muted group-[.toast]:text-muted-foreground',
          success: 'group-[.toaster]:[&_[data-icon]]:text-status-won',
          error: 'group-[.toaster]:[&_[data-icon]]:text-destructive',
          warning: 'group-[.toaster]:[&_[data-icon]]:text-status-pending',
          info: 'group-[.toaster]:[&_[data-icon]]:text-primary',
        },
      }}
      {...props}
    />
  )
}
