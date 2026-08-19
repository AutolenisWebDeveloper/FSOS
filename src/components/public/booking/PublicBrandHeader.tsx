// src/components/public/booking/PublicBrandHeader.tsx
// Premium, schedule-scoped brand lockup for the public booking surface (P1). Reads as a
// financial-services "letterhead": the FSA's OWN monogram + identity as the primary lockup,
// with the official Farmers carrier mark shown as an approved, UNALTERED secondary mark on a
// white chip (CLAUDE.md §17.1 — approved asset from public/brand/, never recolored/redrawn;
// the monogram is the FSA's mark, not the Farmers trademark, and the two stay distinct).
//
// Server-safe (no 'use client') so the RSC schedule page and the flows can compose it. The
// marketing-site BrandLogo lives in the `.msite` scope (marketing.css, not loaded here), so
// this renders the same approved asset directly rather than reaching across design systems.

import { BUSINESS, HEADSHOT_PATH } from '@/lib/site'

export function PublicBrandHeader({ className }: { className?: string }) {
  return (
    <header className={['mb-8 flex items-center justify-between gap-4', className].filter(Boolean).join(' ')}>
      {/* Primary: the FSA's own identity, led by the approved professional headshot (HEADSHOT_PATH,
          the same square portrait used on the email signature — §17.1 approved asset). A real face on
          the booking page builds the trust a financial-services consultation needs. Plain <img> (like
          the Farmers mark below) keeps it crisp and sidesteps next/image's local-optimizer caveats
          noted in middleware.ts; fixed square dims + object-cover → never stretched. */}
      <div className="flex items-center gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={HEADSHOT_PATH}
          alt={`${BUSINESS.agent}, ${BUSINESS.title}`}
          width={96}
          height={96}
          className="h-11 w-11 shrink-0 rounded-full object-cover object-top shadow-elev-sm ring-1 ring-border"
        />
        <div className="leading-tight">
          <div className="text-sm font-semibold tracking-tight text-foreground">{BUSINESS.agent}</div>
          <div className="mono-label text-muted-foreground">{BUSINESS.title}</div>
        </div>
      </div>

      {/* Secondary: approved Farmers carrier mark, rendered unaltered on a white chip. */}
      <div className="flex items-center gap-2">
        <span className="hidden text-[0.7rem] uppercase tracking-wide text-muted-foreground sm:inline">
          Represented carrier
        </span>
        <span className="inline-flex h-9 items-center rounded-md border border-border bg-white px-2.5 shadow-elev-sm">
          {/* Plain <img> keeps the vector mark crisp and avoids next/image's SVG caveats. Intrinsic
              dims match the asset viewBox so the aspect ratio is preserved; height is fixed, width
              auto → never stretched, cropped, or recolored (§17.1). */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/farmers-logo.svg" alt="Farmers Insurance" width={252} height={135} className="h-5 w-auto" />
        </span>
      </div>
    </header>
  )
}
