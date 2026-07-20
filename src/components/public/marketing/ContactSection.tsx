import * as React from 'react'
import { Phone, Mail, MapPin, Clock, CalendarCheck } from 'lucide-react'
import { Section, SectionIntro } from './section'
import { ContactForm } from './ContactForm'
import { CalendlyEmbed } from './CalendlyEmbed'
import { bookingUrl, CONTACT, hasCalendly } from '@/lib/site'

export function ContactSection() {
  const book = bookingUrl()
  return (
    <Section id="contact" tone="sunken">
      <SectionIntro
        align="center"
        kicker="Let’s build your plan"
        title="Schedule a consultation or send a message"
        lead="Take the first step toward protecting your family and reaching your goals. No pressure, no obligation — just a clear conversation about what matters to you."
      />

      <div className="mt-12 grid gap-6 lg:grid-cols-[0.8fr_1.2fr]">
        {/* Contact details — navy card */}
        <aside className="flex flex-col overflow-hidden rounded-2xl shell-gradient text-shell-foreground shadow-elev-md">
          <div className="p-7">
            <h3 className="text-lg font-semibold text-white">Get in touch</h3>
            <ul className="mt-5 space-y-4 text-sm">
              <ContactRow icon={Phone} label="Phone">
                <a href={`tel:${CONTACT.phoneE164}`} className="font-medium text-white underline-offset-2 hover:underline">
                  {CONTACT.phoneDisplay}
                </a>
              </ContactRow>
              <ContactRow icon={Mail} label="Email">
                <a href={`mailto:${CONTACT.email}`} className="font-medium text-white underline-offset-2 hover:underline">
                  {CONTACT.email}
                </a>
              </ContactRow>
              <ContactRow icon={MapPin} label="Office">
                <span className="text-shell-foreground/90">
                  {CONTACT.address.line1}
                  <br />
                  {CONTACT.address.city}, {CONTACT.address.region} {CONTACT.address.postal}
                </span>
              </ContactRow>
              <ContactRow icon={Clock} label="Hours">
                <span className="text-shell-foreground/90">{CONTACT.hoursDisplay}</span>
              </ContactRow>
            </ul>
          </div>
          <div className="mt-auto border-t border-white/10 bg-white/[0.03] p-7">
            <p className="mono-label text-shell-highlight">{CONTACT.serviceArea}</p>
          </div>
        </aside>

        {/* Contact form */}
        <div>
          <ContactForm />
        </div>
      </div>

      {/* Appointment scheduler */}
      <div id="appointment" className="mt-14 scroll-mt-24">
        <div className="mb-5 flex items-center gap-2.5">
          <CalendarCheck className="h-5 w-5 text-primary" aria-hidden />
          <h3 className="text-xl font-bold tracking-tight text-foreground">
            {hasCalendly() ? 'Schedule an appointment' : 'Ready to schedule?'}
          </h3>
        </div>
        <CalendlyEmbed url={book} />
      </div>
    </Section>
  )
}

function ContactRow({
  icon: Icon,
  label,
  children,
}: {
  icon: typeof Phone
  label: string
  children: React.ReactNode
}) {
  return (
    <li className="flex items-start gap-3">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/10 text-[hsl(210_90%_72%)]">
        <Icon className="h-[18px] w-[18px]" aria-hidden />
      </span>
      <span className="flex flex-col">
        <span className="text-[11px] uppercase tracking-wide text-shell-muted">{label}</span>
        {children}
      </span>
    </li>
  )
}
