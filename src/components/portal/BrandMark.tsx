import * as React from 'react'
import { cn } from '@/lib/utils'

/*
 * BrandMark — the FSOS identity mark for the app/auth/portal chrome.
 *
 * Default (no approved trademark supplied): a deep Farmers-navy tile carrying
 * the "M" (Markist) monogram in brand blue, finished with a Farmers-red accent
 * keyline. This is the FSA's OWN command-center mark; it is deliberately NOT the
 * Farmers Insurance trademark, and it is the compliant interim treatment until
 * an approved asset is supplied.
 *
 * Activated state: when `NEXT_PUBLIC_USE_FARMERS_LOGO=1` AND the approved,
 * transparent asset is present at `public/images/farmers-logo.svg`, this renders
 * the official Farmers Insurance logo (object-contain, never stretched, cropped,
 * or recolored) instead of the monogram. This is the SAME flag + asset path used
 * by the public marketing `BrandLogo`, so a single drop-in switches the mark
 * consistently across the marketing site, the auth pages, and the /app chrome.
 * See `docs/branding-farmers-logo.md` for the drop-in contract and the trademark
 * usage constraints (guardrail: no invented/altered Farmers data).
 *
 * Sizing is token-free on purpose so the same mark reads correctly in the
 * sidebar lockup (md), the topbar (sm), and the auth screen (lg).
 */

// Gate the Farmers Insurance trademark swap behind an env flag that defaults OFF,
// so the approved logo only appears after Farmers brand + FINRA principal sign-off.
const USE_FARMERS_LOGO = process.env.NEXT_PUBLIC_USE_FARMERS_LOGO === '1'

const SIZES = {
  sm: 'h-8 w-8 rounded-lg text-[15px]',
  md: 'h-10 w-10 rounded-xl text-lg',
  lg: 'h-12 w-12 rounded-2xl text-2xl',
} as const

export function BrandMark({
  size = 'md',
  className,
}: {
  size?: keyof typeof SIZES
  className?: string
}) {
  if (USE_FARMERS_LOGO) {
    return (
      <span
        className={cn(
          'relative inline-flex shrink-0 items-center justify-center overflow-hidden',
          SIZES[size],
          className,
        )}
      >
        {/* Render the approved transparent trademark unmodified: contained (no
            stretch/crop), aspect-ratio preserved, no recolor. A plain <img>
            keeps a transparent SVG/PNG crisp without next/image's SVG caveats. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/images/farmers-logo.svg"
          alt="Farmers Insurance"
          className="h-full w-full object-contain p-0.5"
        />
      </span>
    )
  }
  return (
    <span
      aria-hidden
      className={cn(
        'relative inline-flex shrink-0 items-center justify-center overflow-hidden font-semibold text-shell-foreground shadow-elev-md ring-1 ring-inset ring-white/10',
        'bg-[hsl(var(--shell))]',
        SIZES[size],
        className,
      )}
      style={{
        backgroundImage:
          'radial-gradient(120% 120% at 30% 0%, hsl(var(--primary) / 0.55), transparent 60%), linear-gradient(160deg, hsl(var(--shell-raised)) 0%, hsl(var(--shell)) 70%)',
      }}
    >
      {/* Brand-blue monogram with a subtle lift. */}
      <span className="relative z-10 leading-none text-white drop-shadow-[0_1px_1px_hsl(var(--shell)/0.6)]">M</span>
      {/* Farmers-red base keyline — the brand's signature accent. */}
      <span
        className="absolute inset-x-1.5 bottom-1 z-10 h-[2px] rounded-full"
        style={{ backgroundColor: 'hsl(var(--destructive))' }}
      />
    </span>
  )
}
