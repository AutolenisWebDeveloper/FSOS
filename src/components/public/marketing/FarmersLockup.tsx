import * as React from 'react'
import { cn } from '@/lib/utils'
import { BrandMark } from '@/components/portal/BrandMark'

/**
 * Brand lockup for the public marketing surface.
 *
 * IMPORTANT — trademark discipline (task brand requirements): the official Farmers
 * Insurance logo is a registered trademark. No approved Farmers logo asset ships
 * in this repo, so we do NOT recreate, redraw, or approximate it here. Instead we
 * present the FSA's OWN identity (the BrandMark monogram + name) alongside a plain
 * TEXT designation of the professional relationship ("Farmers Financial Services
 * Agent"). When an approved SVG/PNG is provided, drop it at
 * `public/brand/farmers-logo.svg` and render it in place of the text designation.
 */
export function FarmersLockup({
  variant = 'dark',
  size = 'md',
  showTitle = true,
  className,
}: {
  /** `light` = for the light canvas; `dark` = for the navy shell. */
  variant?: 'light' | 'dark'
  size?: 'sm' | 'md'
  showTitle?: boolean
  className?: string
}) {
  const onDark = variant === 'dark'
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <BrandMark size={size === 'sm' ? 'sm' : 'md'} />
      <span className="flex flex-col leading-tight">
        <span
          className={cn(
            'font-semibold tracking-tight',
            size === 'sm' ? 'text-[15px]' : 'text-base',
            onDark ? 'text-white' : 'text-foreground',
          )}
        >
          Markist Athelus
        </span>
        {showTitle ? (
          <span
            className={cn(
              'text-[11px] font-medium tracking-wide',
              onDark ? 'text-shell-muted' : 'text-muted-foreground',
            )}
          >
            Farmers Financial Services Agent
          </span>
        ) : null}
      </span>
    </span>
  )
}
