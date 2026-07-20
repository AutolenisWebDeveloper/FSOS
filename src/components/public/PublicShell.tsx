import * as React from 'react'
import { cn } from '@/lib/utils'
import PublicFooter from '@/components/PublicFooter'
import { BrandMark } from '@/components/portal/BrandMark'

/**
 * Shared chrome for the public / unauthenticated surface (referral, upload, forms,
 * events, legal). Before this, every public page hand-rolled its own navy-header
 * card with off-token hex (#0f1e36 navy, #2b6cb0 blue). These primitives carry the
 * FSOS token system onto the public surface so it reads as the same product as the
 * authenticated app: the Farmers-navy shell header, the cool light canvas, token
 * elevation, and the signature DM Mono lockup label.
 *
 * Server-safe (no hooks / 'use client') so both server pages (terms, privacy) and
 * client pages (referral, upload) can compose it.
 */

/** Full-height page wrapper: light canvas, centered column, shared footer. */
export function PublicPage({
  children,
  align = 'top',
  footer = true,
  className,
}: {
  children: React.ReactNode
  /** `top` = scrollable form pages; `center` = compact single-card pages. */
  align?: 'top' | 'center'
  footer?: boolean
  className?: string
}) {
  return (
    <div className={cn('flex min-h-screen flex-col bg-background', className)}>
      <div
        className={cn(
          'flex flex-1 flex-col items-center px-4',
          align === 'center' ? 'justify-center py-10' : 'py-8 sm:py-12',
        )}
      >
        {children}
      </div>
      {footer ? <PublicFooter /> : null}
    </div>
  )
}

/** Brand lockup (mark + name) shown above self-carded public forms. */
export function PublicBrandLockup({ className }: { className?: string }) {
  return (
    <div className={cn('mb-6 flex items-center gap-3', className)}>
      <BrandMark size="sm" />
      <span className="text-sm font-semibold text-foreground">Markist Financial Services</span>
    </div>
  )
}

/** Elevated white card with the navy Farmers lockup header. */
export function PublicCard({
  subtitle,
  children,
  className,
  bodyClassName,
}: {
  subtitle?: React.ReactNode
  children: React.ReactNode
  className?: string
  bodyClassName?: string
}) {
  return (
    <div
      className={cn(
        'w-full max-w-[34rem] overflow-hidden rounded-xl border border-border bg-card shadow-elev-md',
        className,
      )}
    >
      <div className="shell-gradient px-6 py-5 sm:px-8">
        <div className="mono-label text-shell-foreground">Farmers Financial Solutions</div>
        {subtitle ? <div className="mt-1 text-xs text-shell-muted">{subtitle}</div> : null}
      </div>
      <div className={cn('p-6 sm:p-8', bodyClassName)}>{children}</div>
    </div>
  )
}

/**
 * Token-based inline alert for the public surface. `tone` maps to the semantic
 * ramp: destructive for errors, gold/assumption for notices. Text sits on a tint
 * of its own hue (never gray-on-color).
 */
export function PublicAlert({
  children,
  tone = 'error',
  className,
}: {
  children: React.ReactNode
  tone?: 'error'
  className?: string
}) {
  return (
    <div
      role="alert"
      className={cn(
        'rounded-md border px-3.5 py-2.5 text-sm',
        tone === 'error' && 'border-destructive/30 bg-destructive/10 text-destructive',
        className,
      )}
    >
      {children}
    </div>
  )
}
