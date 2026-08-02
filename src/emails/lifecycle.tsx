// src/emails/lifecycle.tsx — Slice 9 email templates (ADR-025). Relationship / lifecycle
// touches. Green-zone: warm, educational/invitational, no product recommendation.
import * as React from 'react'
import { EmailLayout } from './_layout'
import { Eyebrow, H1, Lead, P, Callout, CtaButton, SecondaryNote } from './_components'

export function WelcomeNewClient() {
  return (
    <EmailLayout preview="Welcome — we're glad to be working with you">
      <Eyebrow>Welcome</Eyebrow>
      <H1>Welcome, {'{{first_name}}'} — we&rsquo;re glad you&rsquo;re here</H1>
      <Lead>
        Thank you for trusting us with something as important as protecting your family&rsquo;s future. Our role is
        simple: to know your goals, keep your coverage aligned with your life, and be here whenever questions come up.
      </Lead>
      <Callout>
        Over the coming weeks we&rsquo;ll share a few short, plain-language notes about the things that matter most —
        nothing to do on your end.
      </Callout>
      <P>In the meantime, if anything is on your mind, just reply — we&rsquo;re always happy to talk it through.</P>
      <CtaButton href="{{scheduling_link}}">Book an introductory chat</CtaButton>
    </EmailLayout>
  )
}

export function BirthdayGreetingEmail() {
  return (
    <EmailLayout preview="Happy birthday from all of us">
      <Eyebrow>Happy Birthday</Eyebrow>
      <H1>Happy birthday, {'{{first_name}}'}!</H1>
      <Lead>
        Wishing you a wonderful day and a great year ahead. We&rsquo;re grateful to know you and to be part of your
        financial journey.
      </Lead>
      <P>If there&rsquo;s ever anything we can help with, we&rsquo;re only a reply away. Enjoy your day!</P>
    </EmailLayout>
  )
}

export function PolicyAnniversary() {
  return (
    <EmailLayout preview="A quick note on your coverage anniversary">
      <Eyebrow>Coverage Anniversary</Eyebrow>
      <H1>It&rsquo;s been another year, {'{{first_name}}'}</H1>
      <Lead>
        Your coverage has reached another anniversary — a natural moment to make sure everything still fits the
        life you&rsquo;re living today. Sometimes nothing has changed; sometimes a lot has.
      </Lead>
      <P>If you&rsquo;d like to take a few minutes to review where things stand together, we&rsquo;d be glad to.</P>
      <CtaButton href="{{scheduling_link}}">Book a quick check-in</CtaButton>
      <SecondaryNote>Or just reply and we&rsquo;ll find a time that works for you.</SecondaryNote>
    </EmailLayout>
  )
}

export function HolidayGreeting() {
  return (
    <EmailLayout preview="Warm wishes for the season">
      <Eyebrow>Season&rsquo;s Greetings</Eyebrow>
      <H1>Warm wishes this season, {'{{first_name}}'}</H1>
      <Lead>
        As the year winds down, we wanted to pause and say thank you. It&rsquo;s a privilege to help families plan for
        what matters most, and we&rsquo;re grateful you&rsquo;re one of them.
      </Lead>
      <P>Wishing you and your loved ones a peaceful, joyful season — from all of us.</P>
    </EmailLayout>
  )
}
