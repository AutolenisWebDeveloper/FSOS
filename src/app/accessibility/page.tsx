import type { Metadata } from 'next'
import { SiteShell } from '@/components/public/site/SiteShell'
import { CONTACT } from '@/lib/site'

export const metadata: Metadata = {
  title: 'Accessibility — Markist Athelus',
  description:
    'Our commitment to digital accessibility and WCAG 2.2 AA conformance, plus how to request assistance or report an issue.',
  robots: { index: true, follow: true },
  alternates: { canonical: '/accessibility' },
}

export default function AccessibilityPage() {
  return (
    <SiteShell>
      <main id="main" className="doc">
        <div className="shell" style={{ maxWidth: 820 }}>
          <article className="prose">
            <h1>Accessibility</h1>
            <p className="stamp">Last updated July 18, 2026</p>
            <p>
              We are committed to making our website usable for everyone, including people who rely on assistive
              technologies. We aim to conform to the Web Content Accessibility Guidelines (WCAG) 2.2 Level AA where
              reasonably achievable, and we continue to improve the experience as standards and our site evolve.
            </p>

            <h2>What we do</h2>
            <ul>
              <li>Semantic structure with clear headings, landmarks, and a skip-to-content link.</li>
              <li>Keyboard operability and visible focus indicators for interactive elements.</li>
              <li>Form fields with associated labels, clear error messages, and helpful hints.</li>
              <li>Color contrast that targets WCAG AA for text and meaningful UI.</li>
              <li>Respect for reduced-motion preferences.</li>
              <li>Descriptive alternative text for meaningful images.</li>
            </ul>

            <h2>Need help or found a problem?</h2>
            <p>
              If you encounter any difficulty using this site, or need information in an alternative format, please
              contact us — we’ll work with you to provide the information or transaction you need through an accessible
              method.
            </p>
            <ul>
              <li>
                Phone: <a href={`tel:${CONTACT.phoneE164}`}>{CONTACT.phoneDisplay}</a>
              </li>
              <li>
                Email: <a href={`mailto:${CONTACT.email}`}>{CONTACT.email}</a>
              </li>
            </ul>
            <p>We welcome your feedback and typically respond to accessibility requests within a reasonable timeframe.</p>
          </article>
        </div>
      </main>
    </SiteShell>
  )
}
