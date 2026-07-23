import type { Metadata } from 'next'
import { SiteShell } from '@/components/public/site/SiteShell'
import { Icon } from '@/components/public/site/icons'
import { BUSINESS, CONTACT, bookingUrl } from '@/lib/site'

const TITLE = 'Services — Life Insurance, Retirement & Financial Solutions | Markist Athelus'
const DESCRIPTION =
  'Educational overview of the insurance and financial solutions Markist Athelus helps with — life insurance, retirement planning, college planning, investments, annuities, and business protection. Serving Frisco & Greater DFW.'

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: '/services' },
  robots: { index: true, follow: true },
  openGraph: { type: 'website', title: TITLE, description: DESCRIPTION, siteName: BUSINESS.brand, locale: 'en_US' },
  twitter: { card: 'summary_large_image', title: TITLE, description: DESCRIPTION },
}

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Educational-only service overviews (CLAUDE.md §4 / farmers-brand-website): each
// describes what a category IS and who it can help — never an individualized
// product, investment, or replacement recommendation. Securities-related items
// carry the FFS/FINRA reference; nothing here is a securities call to action.
const SERVICES: { id: string; icon: string; title: string; body: string; points: string[]; security?: boolean }[] = [
  {
    id: 'life-insurance',
    icon: 'shield',
    title: 'Life Insurance',
    body: 'Life insurance is designed to protect the people who depend on you — helping replace income, cover final expenses, and keep long-term plans on track if the unexpected happens.',
    points: [
      'Term and permanent coverage — what each is and how they differ',
      'Income replacement, mortgage and debt protection, and legacy goals',
      'Reviewing existing coverage as your family and finances change',
    ],
  },
  {
    id: 'retirement-planning',
    icon: 'trend',
    title: 'Retirement Planning',
    body: 'Retirement planning is about building income you won’t outlive. A review looks at where your income will come from and how the pieces fit together for a confident retirement.',
    points: [
      'Understanding your sources of future retirement income',
      'Education on employer-plan and IRA concepts',
      'How timing and longevity factor into an income strategy',
    ],
    security: true,
  },
  {
    id: 'college-planning',
    icon: 'cap',
    title: 'College Planning',
    body: 'Preparing for tomorrow’s education costs is easier the earlier you start. We help you understand the funding options and how they align with your family’s goals.',
    points: [
      'Overview of common education-funding vehicles',
      'How saving early can affect long-term outcomes',
      'Coordinating education goals with your broader plan',
    ],
    security: true,
  },
  {
    id: 'investments',
    icon: 'coins',
    title: 'Investments',
    body: 'Investing is about growing wealth toward your goals within a strategy that fits your time horizon and comfort with risk. Our conversations educate — any recommendation is made only after a licensed review.',
    points: [
      'Education on diversification and long-term investing concepts',
      'Aligning an approach to your goals, time horizon, and risk tolerance',
      'Reviewing how your investments support your overall plan',
    ],
    security: true,
  },
  {
    id: 'annuities',
    icon: 'annuity',
    title: 'Annuities',
    body: 'Annuities are financial products some people use to create income and plan for the future. We explain how the common types work so you can understand whether they may fit your situation.',
    points: [
      'How income and deferred annuity concepts work',
      'The role guaranteed-income options can play in a plan',
      'Questions to consider before any decision',
    ],
    security: true,
  },
  {
    id: 'business-protection',
    icon: 'briefcase',
    title: 'Business Protection',
    body: 'For business owners, the right planning helps protect what you’ve built — your people, your continuity, and your future — so the business is resilient when circumstances change.',
    points: [
      'Key-person and business-continuity concepts',
      'Education on buy-sell funding approaches',
      'Employee-benefit and protection considerations',
    ],
  },
]

const REVIEW_STEPS: { t: string; p: string }[] = [
  { t: 'Understand your goals', p: 'We start by listening — what matters most to you, your family, or your business.' },
  { t: 'Review your full picture', p: 'We look at your needs and current coverage to see where there may be gaps or opportunities.' },
  { t: 'Educate on the options', p: 'We explain the relevant concepts and choices in plain language — no jargon, no pressure.' },
  { t: 'Licensed review before any recommendation', p: 'Any specific recommendation is made only after a licensed review appropriate to your situation.' },
]

export default function ServicesPage() {
  const book = bookingUrl()
  const bookExternal = book.startsWith('http')
  return (
    <SiteShell active="services">
      <main id="main">
        {/* Intro band */}
        <section className="wintro">
          <div className="shell wintro__in">
            <p className="eyebrow eyebrow--light reveal">Comprehensive Solutions</p>
            <h1 className="reveal">Solutions that grow with you</h1>
            <p className="reveal">
              From protection to prosperity, here’s an educational overview of the areas {BUSINESS.agent} helps with.
              Every conversation is designed to inform — specific recommendations are made only after a licensed review.
            </p>
            <div className="wintro__meta reveal">
              <span>
                <Icon name="shieldCheck" aria-hidden /> Education first
              </span>
              <span>
                <Icon name="user" aria-hidden /> Personalized to your goals
              </span>
              <span>
                <Icon name="pin" aria-hidden /> {CONTACT.address.city}, {CONTACT.address.region} &amp; Greater DFW
              </span>
            </div>
          </div>
        </section>

        {/* Services grid */}
        <section className="sec">
          <div className="shell">
            <div className="cards">
              {SERVICES.map((s) => (
                <article className="card reveal" id={s.id} key={s.id}>
                  <div className="card__ic">
                    <Icon name={s.icon} />
                  </div>
                  <h2 className="svc__title">{s.title}</h2>
                  <p>{s.body}</p>
                  <ul className="svc__points">
                    {s.points.map((p) => (
                      <li key={p}>
                        <Icon name="shieldCheck" className="svc__tick" />
                        <span>{p}</span>
                      </li>
                    ))}
                  </ul>
                  {s.security ? (
                    <p className="svc__note">
                      Securities and investment products offered through Farmers Financial Solutions, LLC — Member FINRA &amp; SIPC.
                    </p>
                  ) : null}
                  <a className="card__more" href="#contact-cta">
                    Talk it through <Icon name="arrow" />
                    <span className="sr-only"> about {s.title}</span>
                  </a>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* How a review works */}
        <section className="sec sec--mist" id="how-it-works">
          <div className="shell">
            <div className="sec__head reveal">
              <p className="eyebrow">A Simple, Educational Process</p>
              <h2>What a review looks like</h2>
              <p>No obligation, no pressure — just clear guidance you can act on when you’re ready.</p>
            </div>
            <div className="steps">
              {REVIEW_STEPS.map((s, i) => (
                <div className="step reveal" key={s.t}>
                  <div className="step__n">{i + 1}</div>
                  <h3>{s.t}</h3>
                  <p>{s.p}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* CTA band */}
        <section className="sec sec--navy" id="contact-cta">
          <div className="shell">
            <div className="sec__head reveal">
              <p className="eyebrow eyebrow--light">Let’s Get Started</p>
              <h2>Have a question about any of these?</h2>
              <p>
                Schedule a no-obligation consultation and we’ll walk through what fits your goals — in plain language,
                on your timeline.
              </p>
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
