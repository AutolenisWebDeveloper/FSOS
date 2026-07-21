import * as React from 'react'

// Inline stroke icons for the public marketing surface (ported from the FSA's
// content build). One component, keyed by name, so markup stays readable.
const PATHS: Record<string, React.ReactNode> = {
  phone: <path d="M4 4h5l2 5-3 2a12 12 0 006 6l2-3 5 2v5a2 2 0 01-2 2A17 17 0 013 6a2 2 0 011-2z" />,
  mail: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3 7l9 6 9-6" />
    </>
  ),
  pin: (
    <>
      <path d="M12 21s7-6.3 7-11a7 7 0 10-14 0c0 4.7 7 11 7 11z" />
      <circle cx="12" cy="10" r="2.6" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  shield: <path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6l7-3z" />,
  shieldCheck: (
    <>
      <path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6l7-3z" />
      <path d="M9 11.5l2 2 4-4.5" />
    </>
  ),
  caret: <path d="M6 9l6 6 6-6" />,
  arrow: <path d="M5 12h14M13 6l6 6-6 6" />,
  menu: <path d="M4 6h16M4 12h16M4 18h16" />,
  calendar: (
    <>
      <rect x="3" y="4" width="18" height="17" rx="2" />
      <path d="M3 9h18M8 2v4M16 2v4" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0116 0" />
    </>
  ),
  spark: <path d="M12 3l1.8 4.7L18.5 9l-4.7 1.8L12 15l-1.8-4.2L5.5 9l4.7-1.3L12 3z" />,
  trend: (
    <>
      <path d="M4 19V5M4 19h16" />
      <path d="M8 16l3-4 3 2 4-6" />
    </>
  ),
  cap: (
    <>
      <path d="M22 9L12 5 2 9l10 4 10-4z" />
      <path d="M6 11v5c0 1 2.7 2.5 6 2.5s6-1.5 6-2.5v-5" />
    </>
  ),
  coins: (
    <>
      <ellipse cx="12" cy="6" rx="7" ry="3" />
      <path d="M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6" />
      <path d="M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6" />
    </>
  ),
  annuity: (
    <>
      <path d="M3 20h18" />
      <path d="M6 20V10M12 20V4M18 20v-7" />
    </>
  ),
  briefcase: (
    <>
      <rect x="3" y="7" width="18" height="13" rx="2" />
      <path d="M8 7V5a2 2 0 012-2h4a2 2 0 012 2v2" />
    </>
  ),
  bell: (
    <>
      <path d="M18 8a6 6 0 10-12 0c0 7-3 8-3 8h18s-3-1-3-8z" />
      <path d="M13.7 21a2 2 0 01-3.4 0" />
    </>
  ),
  lock: (
    <>
      <rect x="4" y="11" width="16" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 018 0v3" />
    </>
  ),
  award: (
    <>
      <circle cx="12" cy="9" r="5" />
      <path d="M8.5 13.5L7 22l5-3 5 3-1.5-8.5" />
    </>
  ),
  facebook: <path d="M14 9V7c0-1 .5-1.5 1.7-1.5H17V2.5h-2.3C12 2.5 11 4 11 6.3V9H9v3h2v9h3v-9h2.2l.5-3H14z" />,
  linkedin: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M8 10v7M8 7v.01M12 17v-4a2 2 0 014 0v4" />
    </>
  ),
  instagram: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17" cy="7" r="1" />
    </>
  ),
}

export function Icon({
  name,
  className,
  strokeWidth = 1.7,
}: {
  name: keyof typeof PATHS | string
  className?: string
  strokeWidth?: number
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {PATHS[name] ?? null}
    </svg>
  )
}

/**
 * Header/footer brand mark — the official Farmers Insurance emblem (CLAUDE.md §10.1
 * approved asset pack at /public/brand/farmers/). Rendered unaltered (object-contain,
 * official proportions preserved) on a white "chip" so the full-color mark reads on
 * both the light header and the dark footer without ever recoloring the logo. The
 * full FARMERS INSURANCE wordmark lockup — illegible at this 46px footprint — is
 * shown separately in the footer brand column where it has room.
 */
export function BrandLogo() {
  return (
    <span className="brand__logo brand__logo--farmers">
      {/* Plain <img> keeps the vector emblem crisp without next/image's SVG caveats. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/farmers/farmers-emblem.svg" alt="Farmers Insurance" />
    </span>
  )
}
