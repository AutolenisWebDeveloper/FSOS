import * as React from 'react'
import { cn } from '@/lib/utils'

/*
 * BrandMark — the FSOS identity mark for the app/auth/portal chrome.
 *
 * Renders the official Farmers Insurance emblem (CLAUDE.md §10.1 approved asset
 * pack at `/public/brand/farmers/`) on a white chip, so the full-color mark reads
 * on the dark navy shell (sidebar, topbar, auth backdrop) without ever recoloring
 * the trademark. The emblem is contained — official proportions preserved, never
 * stretched or cropped. See `docs/branding-farmers-logo.md` for the asset contract
 * and trademark usage rules.
 *
 * Sizing is token-free on purpose so the same mark reads correctly in the
 * sidebar lockup (md), the topbar (sm), and the auth screen (lg).
 */

const SIZES = {
  sm: 'h-8 w-8 rounded-lg',
  md: 'h-10 w-10 rounded-xl',
  lg: 'h-12 w-12 rounded-2xl',
} as const

export function BrandMark({
  size = 'md',
  className,
}: {
  size?: keyof typeof SIZES
  className?: string
}) {
  return (
    <span
      className={cn(
        'relative inline-flex shrink-0 items-center justify-center overflow-hidden bg-white p-1 shadow-elev-md ring-1 ring-inset ring-black/10',
        SIZES[size],
        className,
      )}
    >
      {/* Official emblem, unmodified: contained (no stretch/crop), proportions
          preserved, no recolor. Plain <img> keeps the vector crisp. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/farmers/farmers-emblem.svg" alt="Farmers Insurance" className="h-full w-full object-contain" />
    </span>
  )
}
