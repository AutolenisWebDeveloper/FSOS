import type { Metadata } from 'next'
import PublicFooter from '@/components/PublicFooter'
import { CONTACT } from '@/lib/site'

export const metadata: Metadata = {
  title: 'Accessibility — Markist Financial Services',
  description:
    'Our commitment to digital accessibility and WCAG 2.2 AA conformance, plus how to request assistance or report an issue.',
  robots: { index: true, follow: true },
  alternates: { canonical: '/accessibility' },
}

const LAST_UPDATED = 'July 20, 2026'

export default function AccessibilityPage() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <article className="mx-auto w-full max-w-3xl flex-1 px-6 py-12 text-foreground/80">
        <h1 className="text-3xl font-bold tracking-tight text-foreground">Accessibility statement</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">Last updated {LAST_UPDATED}</p>

        <p className="mt-6 text-[15px] leading-7">
          We are committed to making our website usable for everyone, including people who rely on assistive
          technologies. We aim to conform to the Web Content Accessibility Guidelines (WCAG) 2.2 Level AA where reasonably
          achievable, and we continue to improve the experience as standards and our site evolve.
        </p>

        <h2 className="mt-8 text-lg font-semibold text-foreground">What we do</h2>
        <ul className="mt-2 list-disc space-y-2 pl-5 text-[15px] leading-7">
          <li>Semantic structure with clear headings, landmarks, and a skip-to-content link.</li>
          <li>Keyboard operability and visible focus indicators for interactive elements.</li>
          <li>Form fields with associated labels, clear error messages, and helpful hints.</li>
          <li>Color contrast that targets WCAG AA for text and meaningful UI.</li>
          <li>Respect for reduced-motion preferences.</li>
          <li>Descriptive alternative text for meaningful images.</li>
        </ul>

        <h2 className="mt-8 text-lg font-semibold text-foreground">Need help or found a problem?</h2>
        <p className="mt-2 text-[15px] leading-7">
          If you encounter any difficulty using this site, or need information in an alternative format, please contact
          us — we’ll work with you to provide the information or transaction you need through an accessible method.
        </p>
        <ul className="mt-3 space-y-1 text-[15px] leading-7">
          <li>
            Phone:{' '}
            <a href={`tel:${CONTACT.phoneE164}`} className="font-medium text-primary underline-offset-2 hover:underline">
              {CONTACT.phoneDisplay}
            </a>
          </li>
          <li>
            Email:{' '}
            <a href={`mailto:${CONTACT.email}`} className="font-medium text-primary underline-offset-2 hover:underline">
              {CONTACT.email}
            </a>
          </li>
        </ul>

        <p className="mt-8 text-xs leading-relaxed text-muted-foreground">
          We welcome your feedback and typically respond to accessibility requests within a reasonable timeframe.
        </p>
      </article>
      <PublicFooter />
    </div>
  )
}
