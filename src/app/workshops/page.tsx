import type { Metadata } from 'next'
import { GraduationCap, Video, MapPin, ShieldCheck } from 'lucide-react'
import { SiteShell } from '@/components/public/site/SiteShell'
import { WorkshopHubFilters } from '@/components/public/site/WorkshopHubFilters'
import { loadPublicWorkshops } from '@/lib/workshops/public'

export const metadata: Metadata = {
  title: 'Educational Workshops — Markist Athelus, Farmers Financial Services',
  description:
    'Free educational workshops on retirement, life insurance, and financial planning with Markist Athelus, Financial Services Agent. In person and online. No products sold — education only.',
  alternates: { canonical: '/workshops' },
  // Public lead-gen hub: opt in to indexing (root layout defaults to noindex for
  // the private app). Without this the primary funnel page is silently de-indexed.
  robots: { index: true, follow: true },
}
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Public workshop hub (/workshops). Lists PUBLISHED workshops only (the compliance publish
// gate is the single door). Full marketing chrome (SiteShell nav + footer). Educational
// events only — no products sold, no fabricated social proof; scarcity is real seat data.
export default async function WorkshopsHubPage() {
  let cards: Awaited<ReturnType<typeof loadPublicWorkshops>> = []
  let loadError = false
  try {
    cards = await loadPublicWorkshops()
  } catch {
    loadError = true
  }

  return (
    <SiteShell active="workshops">
      <main id="main">
        {/* Intro band */}
        <section className="wintro">
          <div className="shell wintro__in">
            <p className="eyebrow eyebrow--light reveal">Educational events</p>
            <h1 className="reveal">Financial workshops, without the sales pitch</h1>
            <p className="reveal">
              Practical, plain-English sessions on retirement, life insurance, and planning your family&apos;s future —
              led by a licensed Financial Services Agent. Attend in person or online.
            </p>
            <div className="wintro__meta reveal">
              <span>
                <GraduationCap aria-hidden /> Education only — nothing sold
              </span>
              <span>
                <MapPin aria-hidden /> In person &amp; <Video aria-hidden /> online
              </span>
              <span>
                <ShieldCheck aria-hidden /> No obligation
              </span>
            </div>
          </div>
        </section>

        {/* Listing */}
        <section className="wsec">
          <div className="shell">
            {loadError ? (
              <div className="wempty" role="alert">
                <p style={{ margin: 0, fontWeight: 600, color: 'var(--navy)' }}>We couldn&apos;t load workshops right now</p>
                <p style={{ margin: '6px 0 0' }}>Please refresh in a moment, or call the office and we&apos;ll help.</p>
              </div>
            ) : cards.length === 0 ? (
              <div className="wempty">
                <GraduationCap aria-hidden />
                <p style={{ margin: 0, fontWeight: 600, color: 'var(--navy)' }}>No upcoming workshops right now</p>
                <p style={{ margin: '6px 0 0' }}>New sessions are added regularly — check back soon.</p>
              </div>
            ) : (
              <WorkshopHubFilters cards={cards} />
            )}
          </div>
        </section>
      </main>
    </SiteShell>
  )
}
