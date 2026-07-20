import * as React from 'react'
import Link from 'next/link'
import { CalendarCheck, Mail, MapPin } from 'lucide-react'
import { Section } from './section'
import { Button } from '@/components/ui/button'
import { Portrait } from './Portrait'
import { bookingUrl, CONTACT } from '@/lib/site'

const FOCUS = ['Life insurance', 'Retirement income', 'Investment strategies', 'Business protection', 'Estate coordination']

export function AboutMarkist() {
  const book = bookingUrl()
  const external = book.startsWith('http')
  return (
    <Section id="about" tone="canvas">
      <div className="grid items-center gap-12 lg:grid-cols-[0.8fr_1.2fr] lg:gap-16">
        {/* Portrait */}
        <div className="mx-auto w-full max-w-sm lg:mx-0">
          <Portrait alt="Markist Athelus, Farmers Financial Services Agent" />
        </div>

        {/* Bio */}
        <div>
          <p className="mono-label text-primary">About Markist Athelus</p>
          <h2
            className="mt-3 font-bold tracking-[-0.02em] text-foreground text-balance"
            style={{ fontSize: 'clamp(1.7rem, 3.4vw, 2.6rem)', lineHeight: 1.08 }}
          >
            Building relationships. Creating financial security.
          </h2>
          <div className="mt-5 space-y-4 text-[1.05rem] leading-relaxed text-muted-foreground">
            <p>
              As a Farmers Financial Services Agent, I help individuals, families, and business owners protect what
              matters most and build a strong financial future. With access to a wide range of insurance and financial
              products, I provide personalized solutions and ongoing guidance you can count on.
            </p>
            <p>
              My approach is simple: understand your goals first, explain your options clearly, and stay in your corner
              for the long run — through every review, every question, and every stage of life.
            </p>
          </div>

          {/* Focus areas */}
          <ul className="mt-6 flex flex-wrap gap-2">
            {FOCUS.map((f) => (
              <li
                key={f}
                className="rounded-full border border-border bg-card px-3 py-1.5 text-sm font-medium text-foreground/80"
              >
                {f}
              </li>
            ))}
          </ul>

          {/* Meta + CTAs */}
          <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <MapPin className="h-4 w-4 text-primary" aria-hidden />
              {CONTACT.serviceArea}
            </span>
          </div>

          <div className="mt-7 flex flex-col gap-3 sm:flex-row">
            <Button asChild size="lg" variant="destructive">
              <a href={book} target={external ? '_blank' : undefined} rel={external ? 'noopener' : undefined}>
                <CalendarCheck className="h-5 w-5" aria-hidden />
                Schedule a consultation
              </a>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link href="#contact">
                <Mail className="h-5 w-5" aria-hidden />
                Send a message
              </Link>
            </Button>
          </div>

          <p className="mt-6 font-[var(--font-dm-mono)] text-2xl italic text-foreground/70" aria-hidden>
            Markist Athelus
          </p>
        </div>
      </div>
    </Section>
  )
}
