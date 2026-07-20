import type { Metadata } from 'next'
import { SiteShell } from '@/components/public/site/SiteShell'
import { CONTACT } from '@/lib/site'

export const metadata: Metadata = {
  title: 'Privacy Policy — Markist Athelus',
  description:
    'Privacy Policy for Markist Athelus, Farmers Insurance & Financial Services. No mobile information is shared with third parties or affiliates for marketing.',
  robots: { index: true, follow: true },
  alternates: { canonical: '/privacy' },
}

const TOC = [
  ['collect', 'Information we collect'],
  ['use', 'How it is used'],
  ['sms', 'SMS & mobile information'],
  ['share', 'Sharing & non-sharing'],
  ['vendors', 'Service providers'],
  ['cookies', 'Cookies & analytics'],
  ['security', 'Security'],
  ['retention', 'Retention'],
  ['choices', 'Your choices & rights'],
  ['financial', 'Financial services'],
  ['children', 'Children'],
  ['changes', 'Changes & contact'],
]

export default function PrivacyPage() {
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
            <h1>Privacy Policy</h1>
            <p className="stamp">Effective July 18, 2026 · Last updated July 18, 2026</p>
            <p>
              This Privacy Policy explains how Markist Athelus, Financial Services Agent (“we,” “us,” “our”), collects,
              uses, and protects information submitted through this website and our communications, and what we will
              never do with it.
            </p>
            <div className="callout">
              <p className="callout__h">Mobile-information non-sharing</p>
              <p>
                <strong>
                  No mobile information will be shared with third parties or affiliates for marketing or promotional
                  purposes. All other categories of data exclude text messaging originator opt-in data and consent; this
                  information will not be shared with any third parties.
                </strong>
              </p>
            </div>

            <h2 id="collect">1. Information we collect</h2>
            <p>
              Identifiers and contact details you provide — name, email, phone and mobile number, mailing address, and
              anything you enter in a contact or appointment request. Consent records: whether you checked the SMS box,
              plus date, time, IP address, and the form or method used to opt in. Insurance and financial details you
              volunteer. Message content you send us. Technical data — IP address, browser and device type, and site
              activity through standard hosting, security, and analytics tools.
            </p>

            <h2 id="use">2. How we use information</h2>
            <ul>
              <li>Respond to inquiries, prepare quotes, and service policies and accounts.</li>
              <li>Schedule and manage appointments and follow-up.</li>
              <li>Send SMS messages only where you have provided applicable consent.</li>
              <li>Maintain records of communications, consent, and opt-outs.</li>
              <li>Protect the site, prevent fraud, and comply with law.</li>
            </ul>
            <p>
              We do not sell personal information, and we do not share it with lead generators, data brokers, or
              marketing partners.
            </p>

            <h2 id="sms">3. SMS and mobile information</h2>
            <p>
              When you opt in, we use your mobile number to send recurring messages from Markist Athelus — Farmers
              Insurance — appointment and policy updates, account and customer-service messages, and marketing or
              promotional offers consistent with your consent.
            </p>
            <p>
              <strong>Message frequency varies. Message and data rates may apply.</strong> Reply STOP to opt out, HELP
              for help.
            </p>
            <p>
              <strong>
                We do not share, sell, or rent your mobile phone number, SMS opt-in data, or messaging consent to third
                parties or affiliates for their marketing or promotional purposes.
              </strong>{' '}
              Mobile opt-in data and consent are carved out of every sharing category in Section 4, and are shared only
              with the vendors that deliver the messages (Section 5).
            </p>

            <h2 id="share">4. Sharing — and non-sharing</h2>
            <p>
              We share information only to do what you asked — with the insurers and financial-services companies needed
              to quote, bind, and service your products; with underwriting and claims vendors engaged for your
              application or claim; with our own service providers under contract (Section 5); and when the law requires
              it.
            </p>
            <div className="callout">
              <p className="callout__h">Carve-out that governs</p>
              <p>
                <strong>
                  Every category above excludes text-messaging opt-in data and consent. That information is not shared
                  with any third parties. No mobile information will be shared with third parties or affiliates for
                  marketing or promotional purposes.
                </strong>{' '}
                Where any other statement appears to conflict with this paragraph, this paragraph controls.
              </p>
            </div>

            <h2 id="vendors">5. Service providers</h2>
            <p>
              A messaging platform and its carriers, an email provider, a website/form host, and a records system may
              process information only to provide their service to us, under confidentiality obligations, and may not use
              it for their own marketing. Carriers deliver messages but are not liable for delayed or undelivered
              messages.
            </p>

            <h2 id="cookies">6. Cookies and analytics</h2>
            <p>
              The site uses cookies needed to serve pages and process forms, and limited, privacy-respecting analytics.
              We do not use advertising cookies or cross-site trackers, and any analytics is configured so it does not
              receive SMS consent records or use mobile opt-in information for third-party marketing.
            </p>

            <h2 id="security">7. Security</h2>
            <p>
              The site is served over HTTPS with reasonable administrative, technical, and physical safeguards. No
              method is completely secure — do not send Social Security numbers, account numbers, or medical details
              through the form or by text; call the office instead.
            </p>

            <h2 id="retention">8. Retention</h2>
            <p>
              We retain information as long as needed for the purposes above and to satisfy consent, opt-out, and
              recordkeeping obligations, including SEC/FINRA books-and-records rules where a communication relates to
              securities. Opt-out records are kept so we can continue to honor your opt-out.
            </p>

            <h2 id="choices">9. Your choices and rights</h2>
            <ul>
              <li>Reply STOP to end texts, or call the office. We honor opt-outs by any reasonable method.</li>
              <li>Use the unsubscribe link in any email.</li>
              <li>
                Texas residents may request access, correction, or deletion, subject to records we must keep. Email{' '}
                <a href={`mailto:${CONTACT.email}`}>{CONTACT.email}</a> or call{' '}
                <a href={`tel:${CONTACT.phoneE164}`}>{CONTACT.phoneDisplay}</a>.
              </li>
            </ul>

            <h2 id="financial">10. Financial-services information</h2>
            <p>
              Securities are offered through Farmers Financial Solutions, LLC (Member FINRA &amp; SIPC). Nonpublic
              personal financial information is handled under the Gramm-Leach-Bliley Act and Regulation S-P and the
              firm’s own privacy notice. Business communications about securities, including texts, are supervised and
              archived per FINRA and SEC rules.
            </p>

            <h2 id="children">11. Children</h2>
            <p>This site is not directed to children under 13 and we do not knowingly collect their information.</p>

            <h2 id="changes">12. Changes and contact</h2>
            <p>
              We may update this Policy; the effective date shows the current version. Questions: Markist Athelus,{' '}
              {CONTACT.address.line1}, {CONTACT.address.city}, {CONTACT.address.region} {CONTACT.address.postal} ·{' '}
              <a href={`tel:${CONTACT.phoneE164}`}>{CONTACT.phoneDisplay}</a> ·{' '}
              <a href={`mailto:${CONTACT.email}`}>{CONTACT.email}</a>.
            </p>
          </article>
        </div>
      </main>
    </SiteShell>
  )
}
