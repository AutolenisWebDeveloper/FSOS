import { ImageResponse } from 'next/og'
import { BUSINESS, CONTACT } from '@/lib/site'

// Branded social-share image for link unfurls (Open Graph + Twitter). Generated
// at the edge from the brand palette — no binary asset to drift. Applies to the
// homepage / root segment; Next injects it into og:image and twitter:image.
export const runtime = 'nodejs'
export const alt = `${BUSINESS.agent} — ${BUSINESS.title}, ${BUSINESS.carrier}`
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

// Farmers navy shell + blue accent (mirrors globals.css --shell / --primary).
const NAVY = '#0d2138'
const NAVY_RAISED = '#1b3252'
const BLUE = '#0b5fcc'
const LIGHT = '#e8eefb'
const MUTED = '#9db6de'

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          background: `linear-gradient(160deg, ${NAVY_RAISED} 0%, ${NAVY} 55%)`,
          padding: '72px 80px',
          fontFamily: 'sans-serif',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div
            style={{
              width: 20,
              height: 20,
              borderRadius: 6,
              background: BLUE,
            }}
          />
          <div style={{ color: MUTED, fontSize: 26, letterSpacing: 2, textTransform: 'uppercase' }}>
            {`${BUSINESS.carrier} · Financial Services`}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div style={{ color: '#ffffff', fontSize: 82, fontWeight: 700, lineHeight: 1.05 }}>
            {BUSINESS.agent}
          </div>
          <div style={{ color: LIGHT, fontSize: 38, fontWeight: 500 }}>
            {`${BUSINESS.title} · ${BUSINESS.carrier}`}
          </div>
          <div style={{ color: MUTED, fontSize: 28 }}>
            {`Life insurance · Retirement · Investments — ${CONTACT.address.city}, ${CONTACT.address.region}`}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ width: 64, height: 6, borderRadius: 3, background: BLUE }} />
          <div style={{ color: MUTED, fontSize: 24 }}>Protect Today. Build Tomorrow.</div>
        </div>
      </div>
    ),
    { ...size },
  )
}
