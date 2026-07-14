'use client'

import * as React from 'react'
import { Label } from '@/components/ui/label'

/**
 * Accessible field wrapper (archetype A5 a11y): label-for every input, error via
 * aria-describedby, required marked, no color-only error signal.
 */
export function Field({
  id,
  label,
  required,
  error,
  hint,
  children,
}: {
  id: string
  label: string
  required?: boolean
  error?: string
  hint?: string
  children: React.ReactNode
}) {
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>
        {label}
        {required ? <span className="ml-0.5 text-destructive" aria-hidden> *</span> : null}
      </Label>
      {React.isValidElement(children)
        ? React.cloneElement(children as React.ReactElement, {
            id,
            'aria-invalid': error ? true : undefined,
            'aria-describedby': describedBy,
            'aria-required': required || undefined,
          })
        : children}
      {hint && !error ? (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} className="text-xs font-medium text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  )
}
