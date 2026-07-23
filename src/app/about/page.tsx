import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import { SiteShell } from '@/components/public/site/SiteShell'
import { Icon } from '@/components/public/site/icons'
import { BUSINESS, CONTACT, LICENSING, siteUrl } from '@/lib/site'

const TITLE = 'About Markist Athelus — Financial Services Agent, Farmers Insurance | Frisco, TX'
const DESCRIPTION = `Meet ${BUSINESS.agent}, a licensed ${BUSINESS.title} with ${BUSINESS.carrier} serving ${CONTACT.serviceArea}. Insurance and financial guidance built on relationships and trust.`

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: '/about' },
  robots: { index: true, follow: true },
  openGraph: { type: 'profile', title: TITLE, description: DESCRIPTION, siteName: BUSINESS.brand, locale: 'en_US' },
  twitter: { card: 'summary_large_image', title: TITLE, description: DESCRIPTION },
}

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Factual, educational bio (CLAUDE.md §4 / farmers-brand-website). Content mirrors
// the FSA's own live homepage bio; no performance claims or invented figures.
const FACTS: { icon: string; title: string; sub: string }[] = [
  { icon: 'user', title: BUSINESS.title, sub: BUSINESS.carrier },
  { icon: 'award', title: 'Licensed & Registered', sub: LICENSING },
  { icon: 'pin', title: 'Serving Texas Communities', sub: CONTACT.serviceArea },
  { icon: 'clock', title: '15+ Years of Experience', sub: 'In insurance and financial services' },
]

function AboutStructuredData() {
  const base = siteUrl()
  const graph = {
    '@context': 'https://schema.org',
    '@type': 'Person',
    '@id': `${base}/about#person`,
    name: BUSINESS.agent,
    jobTitle: `${BUSINESS.title}, ${BUSINESS.carrier}`,
    url: `${base}/about`,
    telephone: CONTACT.phoneE164,
    email: CONTACT.email,
    areaServed: CONTACT.serviceAreaCities,
    worksFor: { '@type': 'FinancialService', name: BUSINESS.brand, url: base },
  }
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(graph) }} />
}

export default function AboutPage() {
  return (
    <SiteShell active="about">
      <AboutStructuredData />
      <main id="main">
        {/* Bio */}
        <section className="sec">
          <div className="shell bio">
            <div className="bio__photo reveal">
              <Image
                className="bio__img"
                src="/images/markist-about.jpg"
                alt={`${BUSINESS.agent}, ${BUSINESS.title} with ${BUSINESS.carrier}.`}
                width={1500}
                height={1500}
                sizes="(max-width: 960px) 100vw, 32vw"
                priority
              />
            </div>
            <div className="reveal">
              <p className="eyebrow">About · {BUSINESS.agent}</p>
              <h1>Building relationships. Creating financial security.</h1>
              <p className="bio__lead">
                I’m {BUSINESS.agent}, a {BUSINESS.title} with {BUSINESS.carrier}. I specialize in helping individuals,
                families, and business owners protect what matters most and build a strong financial future. With access
                to a wide range of insurance and financial products, I provide personalized solutions and ongoing
                guidance you can count on.
              </p>
              <p className="bio__lead">
                My approach is simple: listen first, educate clearly, and put your goals at the center of every
                conversation. Whether you’re protecting your family, planning for retirement, or safeguarding a
                business, I’m here to help you move forward with confidence.
              </p>
              <p className="bio__sign">{BUSINESS.agent}</p>
            </div>
            <ul className="bio__facts reveal">
              {FACTS.map((f) => (
                <li className="bfact" key={f.title}>
                  <Icon name={f.icon} />
                  <span>
                    <strong>{f.title}</strong>
                    <span>{f.sub}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Where to go next — no dead ends */}
        <section className="sec sec--mist">
          <div className="shell">
            <div className="sec__head reveal">
              <p className="eyebrow">Explore</p>
              <h2>How I can help</h2>
            </div>
            <div className="cards">
              <article className="card reveal">
                <div className="card__ic"><Icon name="shield" /></div>
                <h3>Services</h3>
                <p>An educational overview of life insurance, retirement, investments, annuities, and business protection.</p>
                <Link className="card__more" href="/services">Explore services <Icon name="arrow" /></Link>
              </article>
              <article className="card reveal">
                <div className="card__ic"><Icon name="cap" /></div>
                <h3>Workshops</h3>
                <p>Free, plain-English educational sessions — attend in person or online, with nothing sold.</p>
                <Link className="card__more" href="/workshops">Browse workshops <Icon name="arrow" /></Link>
              </article>
              <article className="card reveal">
                <div className="card__ic"><Icon name="spark" /></div>
                <h3>Common questions</h3>
                <p>Answers about coverage, reviews, retirement, and working together — in plain language.</p>
                <Link className="card__more" href="/faq">Read the FAQ <Icon name="arrow" /></Link>
              </article>
            </div>
          </div>
        </section>

        {/* CTA band */}
        <section className="sec sec--navy">
          <div className="shell">
            <div className="sec__head reveal">
              <p className="eyebrow eyebrow--light">Let’s Get Started</p>
              <h2>Let’s build your plan for a secure future</h2>
              <p>Reach out for a no-obligation conversation about what matters most to you.</p>
            </div>
            <div className="hero__acts reveal" style={{ justifyContent: 'center' }}>
              <Link className="btn btn--red" href="/#contact">
                <Icon name="calendar" />
                Request a Consultation
              </Link>
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
