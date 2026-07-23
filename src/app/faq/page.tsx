import type { Metadata } from 'next'
import { SiteShell } from '@/components/public/site/SiteShell'
import { Icon } from '@/components/public/site/icons'
import { BUSINESS, CONTACT, bookingUrl } from '@/lib/site'

const TITLE = 'Frequently Asked Questions — Insurance & Financial Planning | Markist Athelus'
const DESCRIPTION =
  'Plain-English answers about life insurance, retirement, annuities, financial reviews, and working with a Financial Services Agent. Educational — not a product recommendation.'

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: '/faq' },
  robots: { index: true, follow: true },
  openGraph: { type: 'website', title: TITLE, description: DESCRIPTION, siteName: BUSINESS.brand, locale: 'en_US' },
  twitter: { card: 'summary_large_image', title: TITLE, description: DESCRIPTION },
}

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Educational-only FAQ (CLAUDE.md §4 / farmers-brand-website): every answer
// explains a concept or how the practice works — none makes an individualized
// product, investment, or replacement recommendation, and no figures are invented.
type QA = { q: string; a: string }
const GROUPS: { heading: string; items: QA[] }[] = [
  {
    heading: 'Life insurance',
    items: [
      {
        q: 'What’s the difference between term and permanent life insurance?',
        a: 'Term life covers you for a set period — often 10, 20, or 30 years — and usually has a lower initial cost. Permanent life insurance (such as whole or universal life) is designed to last your lifetime and can build cash value over time. Which one fits depends on your goals, budget, and time horizon, and that’s exactly what a review helps you sort through.',
      },
      {
        q: 'How much life insurance do people usually consider?',
        a: 'It varies a lot from person to person. People commonly think about replacing income, paying off debts like a mortgage, covering final expenses, and funding future goals such as a child’s education. Rather than a one-size number, a needs analysis looks at your specific situation.',
      },
      {
        q: 'Can I review coverage I already have?',
        a: 'Yes. Reviewing existing policies as your family and finances change is a normal part of the process — it helps confirm your coverage still lines up with your goals.',
      },
    ],
  },
  {
    heading: 'Financial reviews',
    items: [
      {
        q: 'What is a financial review or needs analysis?',
        a: 'It’s a structured, educational look at your current coverage, your goals, and your overall financial picture to help identify gaps and opportunities. It’s informational — not a sales pitch — and there’s no obligation.',
      },
      {
        q: 'Do I have to buy anything to meet with you?',
        a: 'No. Consultations are no-obligation. The goal is to give you clear information so you can make confident decisions on your own timeline.',
      },
      {
        q: 'What should I bring to a consultation?',
        a: 'Whatever helps paint an accurate picture — recent statements, any existing policies, and a sense of your goals. If you’re not sure, come as you are; we can start with a conversation.',
      },
    ],
  },
  {
    heading: 'Retirement & annuities',
    items: [
      {
        q: 'How do people plan for retirement income?',
        a: 'A common starting point is understanding where your future income will come from and how the pieces fit together, so you have a strategy for income you won’t outlive. A review educates you on the relevant concepts before any decision.',
      },
      {
        q: 'How does an annuity work?',
        a: 'An annuity is a financial product some people use to create income or to grow money on a tax-deferred basis. Common types include immediate/income annuities and deferred annuities. Whether one fits your situation is an individual question. Securities and investment products are offered through Farmers Financial Solutions, LLC — Member FINRA & SIPC.',
      },
    ],
  },
  {
    heading: 'Working together',
    items: [
      {
        q: 'What areas do you serve?',
        a: `${CONTACT.address.city} and the Greater DFW area, along with clients across Texas. In-person and virtual meetings are both available.`,
      },
      {
        q: 'Will I receive text messages?',
        a: 'Only if you choose to opt in — SMS is optional and is never a condition of working together. Message frequency varies, and message and data rates may apply. You can reply STOP to opt out at any time. Full details are in our SMS Terms and Privacy Policy, linked in the footer.',
      },
      {
        q: 'How is my information handled?',
        a: 'Your information is handled with care and used only to serve you. Mobile opt-in information is never shared or sold to third parties for marketing. See our Privacy Policy in the footer for details.',
      },
    ],
  },
]

const ALL: QA[] = GROUPS.flatMap((g) => g.items)

function FaqStructuredData() {
  const graph = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: ALL.map((qa) => ({
      '@type': 'Question',
      name: qa.q,
      acceptedAnswer: { '@type': 'Answer', text: qa.a },
    })),
  }
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(graph) }} />
}

export default function FaqPage() {
  const book = bookingUrl()
  const bookExternal = book.startsWith('http')
  return (
    <SiteShell active="faq">
      <FaqStructuredData />
      <main id="main">
        {/* Intro band */}
        <section className="wintro">
          <div className="shell wintro__in">
            <p className="eyebrow eyebrow--light reveal">Questions &amp; Answers</p>
            <h1 className="reveal">Frequently asked questions</h1>
            <p className="reveal">
              Plain-English answers about insurance, retirement, and working with a licensed Financial Services Agent.
              These are educational — specific recommendations are made only after a licensed review.
            </p>
          </div>
        </section>

        {/* FAQ groups */}
        <section className="sec">
          <div className="shell faq">
            {GROUPS.map((g) => (
              <div className="faq__group reveal" key={g.heading}>
                <h2 className="faq__heading">{g.heading}</h2>
                <div className="faq__list">
                  {g.items.map((qa) => (
                    <details className="faq__item" key={qa.q}>
                      <summary className="faq__q">
                        <span>{qa.q}</span>
                        <Icon name="caret" className="faq__chev" aria-hidden />
                      </summary>
                      <div className="faq__a">
                        <p>{qa.a}</p>
                      </div>
                    </details>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* CTA band */}
        <section className="sec sec--navy">
          <div className="shell">
            <div className="sec__head reveal">
              <p className="eyebrow eyebrow--light">Still have a question?</p>
              <h2>Let’s talk it through</h2>
              <p>Schedule a no-obligation consultation, or call the office — we’re happy to help.</p>
            </div>
            <div className="hero__acts reveal" style={{ justifyContent: 'center' }}>
              <a className="btn btn--red" href={book} target={bookExternal ? '_blank' : undefined} rel={bookExternal ? 'noopener' : undefined}>
                <Icon name="calendar" />
                Schedule a Consultation
              </a>
              <a className="btn btn--ghost" href={`tel:${CONTACT.phoneE164}`}>
                <Icon name="phone" />
                {CONTACT.phoneDisplay}
              </a>
            </div>
          </div>
        </section>
      </main>
    </SiteShell>
  )
}
