import type { Metadata } from 'next'
import Link from 'next/link'
import { SiteShell } from '@/components/public/site/SiteShell'
import { CONTACT } from '@/lib/site'

export const metadata: Metadata = {
  title: 'Terms of Use — Markist Athelus',
  description: 'Terms of Use for the website of Markist Athelus, Farmers Insurance & Financial Services, Frisco, TX.',
  robots: { index: true, follow: true },
  alternates: { canonical: '/terms' },
}

const TOC = [
  ['info', 'General information only'],
  ['notx', 'No coverage by website'],
  ['use', 'Acceptable use'],
  ['sms', 'Text messaging'],
  ['ip', 'Intellectual property'],
  ['links', 'External links'],
  ['disc', 'Disclaimer & limitation'],
  ['law', 'Governing law'],
  ['contact', 'Changes & contact'],
]

export default function TermsPage() {
  return (
    <SiteShell>
      <main id="main" className="doc">
        <div className="shell doc__grid">
          <nav className="toc" aria-label="On this page">
            <p className="toc__h">On this page</p>
            <ol>
              {TOC.map(([id, label]) => (
                <li key={id}>
                  <a href={`#${id}`}>{label}</a>
                </li>
              ))}
            </ol>
          </nav>
          <article className="prose">
            <h1>Terms of Use</h1>
            <p className="stamp">Effective July 18, 2026 · Last updated July 18, 2026</p>
            <p>
              These Terms govern use of this website, operated for Markist Athelus, Financial Services Agent with Farmers
              Insurance. By using the site, you agree to them.
            </p>

            <h2 id="info">1. General information only</h2>
            <p>
              Content here is general information, not insurance, investment, tax, or legal advice, a recommendation, a
              guarantee, a binder, or an offer to sell a security. Products are subject to eligibility, underwriting,
              availability, and the terms of the issued policy or contract.
            </p>

            <h2 id="notx">2. No coverage or transaction by website</h2>
            <p>
              Submitting a form, email, or text does not bind, change, or cancel coverage, complete a securities
              transaction, or guarantee an appointment. Do not use the site to report an emergency or a time-sensitive
              claim — call the office or the insurer.
            </p>

            <h2 id="use">3. Acceptable use</h2>
            <p>
              You must be 18+ to submit information. Don’t submit false information or someone else’s data without
              permission, interfere with the site, attempt unauthorized access, or use it unlawfully.
            </p>

            <h2 id="sms">4. Text messaging</h2>
            <p>
              The optional SMS program is governed by our <Link href="/sms-terms">SMS Terms &amp; Conditions</Link> and{' '}
              <Link href="/privacy">Privacy Policy</Link>, incorporated by reference. Consent is not a condition of purchase.
              Message frequency varies. Message and data rates may apply. Reply STOP to opt out, HELP for help. No mobile
              information will be shared with third parties or affiliates for marketing or promotional purposes.
            </p>

            <h2 id="ip">5. Intellectual property</h2>
            <p>
              Site content is protected by applicable law. Farmers Insurance and related marks belong to their
              respective owners and are used by an authorized agent to identify the companies represented. No license is
              granted except to use the site for its informational purpose.
            </p>

            <h2 id="links">6. External links</h2>
            <p>Third-party sites are governed by their own terms and policies. A link is not an endorsement.</p>

            <h2 id="disc">7. Disclaimer and limitation</h2>
            <p>
              The site is provided “as is” and “as available,” without warranties of any kind. To the fullest extent
              permitted by law, we are not liable for indirect, incidental, special, consequential, or punitive damages
              arising from its use. Nothing here limits a right you have under an issued policy or under Texas law.
            </p>

            <h2 id="law">8. Governing law</h2>
            <p>
              These Terms are governed by the laws of Texas, without regard to conflict-of-laws rules; disputes lie in
              the state or federal courts of Collin County, Texas.
            </p>

            <h2 id="contact">9. Changes and contact</h2>
            <p>
              We may update these Terms; the effective date shows the current version. Markist Athelus,{' '}
              {CONTACT.address.line1}, {CONTACT.address.city}, {CONTACT.address.region} {CONTACT.address.postal} ·{' '}
              <a href={`tel:${CONTACT.phoneE164}`}>{CONTACT.phoneDisplay}</a>.
            </p>
          </article>
        </div>
      </main>
    </SiteShell>
  )
}
