import { ImageResponse } from 'next/og'

// Apple touch icon (home-screen / bookmark). Branded monogram on the Farmers
// navy, generated from the palette so there's no binary asset to drift.
//
// No explicit `runtime` export: Next renders this metadata route on its default
// (Node) runtime, same as robots.ts / sitemap.ts. Pinning `runtime = 'nodejs'`
// made Vercel treat the generated `/apple-icon/route` as an explicitly-configured
// function and warn ("Unable to find source file for page …") when reconciling it
// against vercel.json's `functions` block — the source is apple-icon.tsx, not
// apple-icon/route.tsx. Omitting the redundant default clears the warning with no
// behavior change.
export const size = { width: 180, height: 180 }
export const contentType = 'image/png'

const NAVY = '#0d2138'
const NAVY_RAISED = '#1b3252'
const BLUE = '#0b5fcc'

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: `linear-gradient(150deg, ${NAVY_RAISED}, ${NAVY})`,
          color: '#ffffff',
          fontSize: 92,
          fontWeight: 700,
          fontFamily: 'sans-serif',
          borderBottom: `10px solid ${BLUE}`,
        }}
      >
        MA
      </div>
    ),
    { ...size },
  )
}
