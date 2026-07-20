import type { Metadata } from 'next'
import { SiteShell } from '@/components/public/site/SiteShell'
import { BUSINESS, CONTACT, SMS_CONSENT } from '@/lib/site'

export const metadata: Metadata = {
  title: 'SMS Terms & Conditions — Markist Athelus',
  description:
    'Text messaging program terms for Markist Athelus, Farmers Insurance & Financial Services. Opt-in only. Reply STOP to opt out, HELP for help.',
  robots: { index: true, follow: true },
  alternates: { canonical: '/sms-terms' },
}

const TOC = [
  ['program', 'Program'],
  ['optin', 'How you opt in'],
  ['freq', 'Frequency & cost'],
  ['stop', 'Opting out'],
  ['help', 'Help'],
  ['carriers', 'Carriers & delivery'],
  ['privacy', 'Privacy'],
  ['eligibility', 'Eligibility'],
  ['securities', 'Securities'],
  ['contact', 'Changes & contact'],
]

export default function SmsTermsPage() {
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
            <h1>SMS Terms &amp; Conditions</h1>
            <p className="stamp">Effective July 18, 2026 · Markist Athelus — Farmers Insurance</p>
            <p>These SMS Terms govern text messages sent by or on behalf of Markist Athelus — Farmers Insurance.</p>
            <div className="callout">
              <p className="callout__h">Everything in one paragraph</p>
              <p>
                Program: <strong>{SMS_CONSENT.program}</strong>. Opt-in only.{' '}
                <strong>Message frequency varies. Message and data rates may apply.</strong> Reply <strong>STOP</strong>{' '}
                to opt out, <strong>HELP</strong> for help, or call{' '}
                <a href={`tel:${CONTACT.phoneE164}`}>{CONTACT.phoneDisplay}</a>. Consent is not a condition of purchase.
                Messages originate from {SMS_CONSENT.from}. See our <a href="/privacy">Privacy Policy</a>. No mobile
                information will be shared with third parties or affiliates for marketing or promotional purposes.
              </p>
            </div>

            <h2 id="program">1. Program</h2>
            <p>
              A mixed messaging program: subscribers receive recurring SMS/MMS about appointment and policy updates,
              account and customer-service messages, requested information, and marketing or promotional offers,
              consistent with the consent provided.
            </p>

            <h2 id="optin">2. How you opt in</h2>
            <p>
              Check the optional, unchecked SMS box on our website form and submit it; or, where enabled, text START to
              our registered number; or opt in verbally, after which we send a confirmation carrying the same
              disclosures. Consent is not a condition of purchase. The SMS box is separate from email consent and from
              accepting these terms.
            </p>

            <h2 id="freq">3. Frequency and cost</h2>
            <p>
              Message frequency varies with your requests and account activity. Message and data rates may apply under
              your carrier plan; we do not charge for the program.
            </p>

            <h2 id="stop">4. Opting out</h2>
            <p>Reply STOP, END, CANCEL, UNSUBSCRIBE, or QUIT at any time. You’ll get one confirmation, then no further messages:</p>
            <p className="sample">
              Markist Athelus — Farmers Insurance: You are unsubscribed and will receive no further texts. For help call{' '}
              {CONTACT.phoneDisplay}.
            </p>
            <p>We also honor opt-outs made by phone or email, and process them promptly.</p>

            <h2 id="help">5. Help</h2>
            <p>Reply HELP or INFO for assistance:</p>
            <p className="sample">
              Markist Athelus — Farmers Insurance: For help call {CONTACT.phoneDisplay} or email {CONTACT.email}. Msg
              &amp; data rates may apply. Reply STOP to opt out.
            </p>

            <h2 id="carriers">6. Carriers and delivery</h2>
            <p>
              Supported on major U.S. carriers. Delivery is not guaranteed and is subject to network conditions.{' '}
              <strong>Carriers are not liable for delayed or undelivered messages.</strong> Don’t rely on a text for
              anything time-critical — call the office.
            </p>

            <h2 id="privacy">7. Privacy</h2>
            <div className="callout">
              <p className="callout__h">Non-sharing</p>
              <p>
                <strong>
                  No mobile information will be shared with third parties or affiliates for marketing or promotional
                  purposes. All other categories of data exclude text messaging originator opt-in data and consent; this
                  information will not be shared with any third parties.
                </strong>
              </p>
            </div>
            <p>
              Only the messaging platform and delivering carriers touch your mobile information, under contract. Full
              detail in the <a href="/privacy">Privacy Policy</a>.
            </p>

            <h2 id="eligibility">8. Eligibility</h2>
            <p>You must be 18+ and the subscriber or authorized user of the mobile number provided.</p>

            <h2 id="securities">9. Securities</h2>
            <p>
              Texts about securities offered through Farmers Financial Solutions, LLC (Member FINRA &amp; SIPC) are
              supervised, retained, and archived per FINRA and SEC rules. Do not use text to place, change, or cancel a
              transaction.
            </p>

            <h2 id="contact">10. Changes and contact</h2>
            <p>
              We may modify or end the program; updated terms post here. Markist Athelus, {CONTACT.address.line1},{' '}
              {CONTACT.address.city}, {CONTACT.address.region} {CONTACT.address.postal} ·{' '}
              <a href={`tel:${CONTACT.phoneE164}`}>{CONTACT.phoneDisplay}</a>.
            </p>
            <p style={{ fontSize: 12, color: 'var(--slate)' }}>
              This program is a communications aid for {BUSINESS.agent}’s own practice and is not a securities order
              channel.
            </p>
          </article>
        </div>
      </main>
    </SiteShell>
  )
}
