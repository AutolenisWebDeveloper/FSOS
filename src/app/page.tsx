import type { Metadata, Viewport } from 'next'
import Image from 'next/image'
import { SiteShell } from '@/components/public/site/SiteShell'
import { SiteContactForm } from '@/components/public/site/SiteContactForm'
import { Icon } from '@/components/public/site/icons'
import { BUSINESS, CONTACT, LICENSING, bookingUrl, siteUrl } from '@/lib/site'

const TITLE = 'Markist Athelus — Farmers Insurance & Financial Services | Frisco, TX'
const DESCRIPTION =
  'Markist Athelus, Financial Services Agent with Farmers Insurance in Frisco, TX. Life insurance, retirement, college planning, investments, annuities, and business protection.'

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  title: TITLE,
  description: DESCRIPTION,
  applicationName: BUSINESS.brand,
  alternates: { canonical: '/' },
  robots: { index: true, follow: true },
  openGraph: { type: 'website', url: siteUrl(), title: TITLE, description: DESCRIPTION, siteName: BUSINESS.brand, locale: 'en_US' },
  twitter: { card: 'summary_large_image', title: TITLE, description: DESCRIPTION },
}

export const viewport: Viewport = { themeColor: '#0E2350' }

const SOLUTIONS: { icon: string; title: string; body: string }[] = [
  { icon: 'shield', title: 'Life Insurance', body: 'Protect your loved ones and secure their future with the right coverage.' },
  { icon: 'trend', title: 'Retirement Planning', body: 'Build a plan for a comfortable, confident retirement.' },
  { icon: 'cap', title: 'College Planning', body: 'Prepare today for tomorrow’s education funding.' },
  { icon: 'coins', title: 'Investments', body: 'Grow your wealth with smart, personalized investment strategies.' },
  { icon: 'annuity', title: 'Annuities', body: 'Create guaranteed income and plan for life with confidence.' },
  { icon: 'briefcase', title: 'Business Protection', body: 'Solutions to protect your business, employees, and future.' },
]

const BADGES: { icon: string; label: string }[] = [
  { icon: 'user', label: 'Experienced Financial Professional' },
  { icon: 'spark', label: 'Personalized Solutions' },
  { icon: 'shield', label: 'Trusted by Families & Businesses' },
  { icon: 'lock', label: 'Technology-Driven Service' },
]

const STEPS: { t: string; p: string }[] = [
  { t: 'Schedule Your Consultation', p: 'Let’s discuss your goals and what matters most.' },
  { t: 'Analyze Your Needs', p: 'We assess your needs and full financial picture.' },
  { t: 'Build Your Strategy', p: 'We create a personalized plan built just for you.' },
  { t: 'Protect & Grow', p: 'We help you implement, monitor, and adjust over time.' },
]

const REVIEWS: { av: string; name: string; loc: string; quote: string }[] = [
  { av: 'JR', name: 'Jessica R.', loc: 'Plano, TX', quote: 'Markist took the time to understand my needs and created a plan that gave me confidence in my family’s future.' },
  { av: 'MT', name: 'Michael T.', loc: 'Frisco, TX', quote: 'His knowledge and professionalism helped me simplify my finances and prepare for retirement the right way.' },
  { av: 'AL', name: 'Amanda L.', loc: 'McKinney, TX', quote: 'Markist and his team are responsive, thorough, and truly care about their clients. Highly recommended!' },
]

function StructuredData() {
  const base = siteUrl()
  const graph = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'FinancialService',
        '@id': `${base}/#practice`,
        name: BUSINESS.brand,
        description: DESCRIPTION,
        url: base,
        telephone: CONTACT.phoneE164,
        email: CONTACT.email,
        areaServed: CONTACT.serviceAreaCities,
        address: {
          '@type': 'PostalAddress',
          streetAddress: CONTACT.address.line1,
          addressLocality: CONTACT.address.city,
          addressRegion: CONTACT.address.region,
          postalCode: CONTACT.address.postal,
          addressCountry: CONTACT.address.country,
        },
      },
      {
        '@type': 'Person',
        '@id': `${base}/#markist`,
        name: BUSINESS.agent,
        jobTitle: `${BUSINESS.title}, ${BUSINESS.carrier}`,
        worksFor: { '@id': `${base}/#practice` },
        url: `${base}/#about`,
      },
    ],
  }
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(graph) }} />
}

export default function HomePage() {
  const book = bookingUrl()
  const bookExternal = book.startsWith('http')
  return (
    <SiteShell active="home">
      <StructuredData />
      <main id="main">
        {/* HERO */}
        <section className="hero">
          <div className="shell hero__in">
            <div>
              <p className="eyebrow eyebrow--light">Local guidance · Personalized service</p>
              <h1>
                Protect Today.
                <br />
                Build Tomorrow.
              </h1>
              <p className="hero__lead">
                Personalized insurance and financial strategies designed to protect what matters most and prepare you
                for a confident future.
              </p>
              <div className="hero__acts">
                <a className="btn btn--red" href={book} target={bookExternal ? '_blank' : undefined} rel={bookExternal ? 'noopener' : undefined}>
                  <Icon name="calendar" />
                  Schedule a Consultation
                </a>
                <a className="btn btn--ghost" href="#solutions">
                  Explore Solutions <Icon name="arrow" />
                </a>
              </div>
              <div className="hero__badges">
                {BADGES.map((b) => (
                  <span className="hbadge" key={b.label}>
                    <Icon name={b.icon} />
                    {b.label}
                  </span>
                ))}
              </div>
            </div>
            <div className="hero__art">
              {/* Live-text hero (Option A): the text-free portrait is the visual;
                  the name/title live in the nav + <h1>, the locator chip below is
                  live HTML — nothing is baked into the image. */}
              <Image
                className="hero__img"
                src="/images/markist-hero.jpg"
                alt="Markist Athelus, Financial Services Agent with Farmers Insurance, serving Plano, Frisco, and Greater DFW."
                fill
                priority
                sizes="(max-width: 900px) 100vw, 46vw"
                style={{ objectPosition: '42% 24%' }}
              />
              <div className="locator">
                <Icon name="pin" />
                <span>
                  <strong>Proudly serving</strong>
                  {CONTACT.serviceArea}
                </span>
              </div>
            </div>
          </div>
        </section>

        {/* SOLUTIONS */}
        <section className="sec" id="solutions">
          <div className="shell">
            <div className="sec__head reveal">
              <p className="eyebrow">Comprehensive Solutions</p>
              <h2>Comprehensive Solutions. Lasting Impact.</h2>
              <p>From protection to prosperity, I offer solutions that grow with you and adapt to your life.</p>
            </div>
            <div className="cards">
              {SOLUTIONS.map((s) => (
                <article className="card reveal" key={s.title}>
                  <div className="card__ic">
                    <Icon name={s.icon} />
                  </div>
                  <h3>{s.title}</h3>
                  <p>{s.body}</p>
                  <a className="card__more" href="#contact">
                    Learn More <Icon name="arrow" />
                    <span className="sr-only"> about {s.title}</span>
                  </a>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* TECHNOLOGY */}
        <section className="sec sec--navy" id="technology">
          <div className="shell tech">
            <div className="tech__art reveal">
              <div className="tech__chip">AI</div>
            </div>
            <div className="reveal">
              <p className="eyebrow eyebrow--light">Powered by Innovation</p>
              <h2>Technology That Enhances the Human Touch</h2>
              <p>
                Advanced technology paired with personal guidance for a seamless experience — proactive communication,
                efficient service, and recommendations reviewed by a licensed professional.
              </p>
              <div className="tech__feats">
                <div className="tfeat">
                  <Icon name="spark" />
                  <strong>Smart Insights</strong>
                  <span>Data-informed strategies built for you.</span>
                </div>
                <div className="tfeat">
                  <Icon name="bell" />
                  <strong>Proactive Follow-Up</strong>
                  <span>Never miss an important opportunity.</span>
                </div>
                <div className="tfeat">
                  <Icon name="lock" />
                  <strong>Secure &amp; Compliant</strong>
                  <span>Your information is always protected.</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* PROCESS */}
        <section className="sec sec--mist" id="process">
          <div className="shell">
            <div className="sec__head reveal">
              <p className="eyebrow">A Simple Process</p>
              <h2>A Simple Process. A Stronger Future.</h2>
            </div>
            <div className="steps">
              {STEPS.map((s, i) => (
                <div className="step reveal" key={s.t}>
                  <div className="step__n">{i + 1}</div>
                  <h3>{s.t}</h3>
                  <p>{s.p}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* REVIEWS */}
        <section className="sec sec--navy" id="reviews">
          <div className="shell">
            <div className="sec__head reveal">
              <p className="eyebrow eyebrow--light">Clients We Serve</p>
              <h2>Trusted by Individuals, Families &amp; Business Owners</h2>
            </div>
            <div className="quotes">
              {REVIEWS.map((r) => (
                <figure className="quote reveal" key={r.name}>
                  <div className="quote__stars" aria-label="5 out of 5 stars">
                    ★★★★★
                  </div>
                  <blockquote>
                    <p>{r.quote}</p>
                  </blockquote>
                  <figcaption className="quote__who">
                    <span className="quote__av">{r.av}</span>
                    <span>
                      <strong>{r.name}</strong>
                      <span>{r.loc}</span>
                    </span>
                  </figcaption>
                </figure>
              ))}
            </div>
          </div>
        </section>

        {/* ABOUT / BIO */}
        <section className="sec" id="about">
          <div className="shell bio">
            <div className="bio__photo reveal">
              <Image
                className="bio__img"
                src="/images/markist-about.jpg"
                alt="Markist Athelus, Financial Services Agent with Farmers Insurance."
                width={1500}
                height={1500}
                sizes="(max-width: 960px) 100vw, 32vw"
              />
            </div>
            <div className="reveal">
              <p className="eyebrow">About · Markist Athelus</p>
              <h2>Building Relationships. Creating Financial Security.</h2>
              <p className="bio__lead">
                I’m Markist Athelus, a {BUSINESS.title} with {BUSINESS.carrier}. I specialize in helping individuals,
                families, and business owners protect what matters most and build a strong financial future. With access
                to a wide range of insurance and financial products, I provide personalized solutions and ongoing
                guidance you can count on.
              </p>
              <p className="bio__sign">Markist Athelus</p>
            </div>
            <ul className="bio__facts reveal">
              <li className="bfact">
                <Icon name="user" />
                <span>
                  <strong>{BUSINESS.title}</strong>
                  <span>{BUSINESS.carrier}</span>
                </span>
              </li>
              <li className="bfact">
                <Icon name="award" />
                <span>
                  <strong>Licensed</strong>
                  <span>Life, Health, Series 6, 26, 63</span>
                </span>
              </li>
              <li className="bfact">
                <Icon name="pin" />
                <span>
                  <strong>Serving Texas Communities</strong>
                  <span>{CONTACT.serviceArea}</span>
                </span>
              </li>
              <li className="bfact">
                <Icon name="clock" />
                <span>
                  <strong>15+ Years of Experience</strong>
                  <span>In insurance and financial services</span>
                </span>
              </li>
            </ul>
          </div>
        </section>

        {/* CONTACT / OPT-IN */}
        <section className="sec sec--mist" id="contact">
          <div className="shell">
            <div className="plan">
              <div className="plan__grid">
                <div>
                  <p className="eyebrow eyebrow--light">Let’s Get Started</p>
                  <h2>Let’s Build Your Plan for a Secure Future</h2>
                  <p className="plan__lead">
                    Schedule a no-obligation consultation today and take the first step toward protecting your family and
                    achieving your financial goals.
                  </p>
                  <div className="plan__ways">
                    <a className="pway" href={`tel:${CONTACT.phoneE164}`}>
                      <Icon name="phone" />
                      <span>
                        <strong>Call the office</strong>
                        <span>{CONTACT.phoneDisplay}</span>
                      </span>
                    </a>
                    <a className="pway" href={`mailto:${CONTACT.email}`}>
                      <Icon name="mail" />
                      <span>
                        <strong>Email</strong>
                        <span>{CONTACT.email}</span>
                      </span>
                    </a>
                    <span className="pway">
                      <Icon name="pin" />
                      <span>
                        <strong>Visit</strong>
                        <span>
                          {CONTACT.address.line1}, {CONTACT.address.city}, {CONTACT.address.region}{' '}
                          {CONTACT.address.postal}
                        </span>
                      </span>
                    </span>
                  </div>
                  <p className="microcopy microcopy--onnavy">{LICENSING}</p>
                </div>
                <SiteContactForm />
              </div>
            </div>
          </div>
        </section>
      </main>
    </SiteShell>
  )
}
