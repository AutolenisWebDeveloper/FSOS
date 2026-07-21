import * as React from 'react'
import { cn } from '@/lib/utils'

/*
 * BrandMark — the FSA's OWN command-center monogram (CLAUDE.md §17.1).
 *
 * A deep Farmers-navy tile carrying the "M" (Markist) monogram in brand blue,
 * finished with a Farmers-red base keyline. This is deliberately the FSA's own
 * identity mark for the app/auth/portal chrome — it is NOT the Farmers Insurance
 * trademark, and the two must not be conflated (§17.1). The official Farmers logo
 * lives on the public brand surfaces (marketing header/footer, favicon) via
 * `BrandLogo`, sourced from the approved asset pack in `public/brand/`.
 *
 * Sizing is token-free on purpose so the same mark reads correctly in the
 * sidebar lockup (md), the topbar (sm), and the auth screen (lg).
 */

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
