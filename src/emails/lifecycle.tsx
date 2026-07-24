// src/emails/lifecycle.tsx — Slice 9 email templates (ADR-025). Relationship / lifecycle
// touches. Green-zone: warm, educational/invitational, no product recommendation.
import * as React from 'react'
import { Heading, Text } from '@react-email/components'
import { EmailLayout } from './_layout'
import { h1, p } from './_styles'

export function WelcomeNewClient() {
  return (
    <EmailLayout preview="Welcome — we're glad to be working with you">
      <Heading style={h1}>Welcome, {'{{first_name}}'} — we're glad you're here</Heading>
      <Text style={p}>
        Thank you for trusting us with something as important as protecting your family's future. Our role is
        simple: to know your goals, keep your coverage aligned with your life, and be here whenever questions come up.
      </Text>
      <Text style={p}>
        Over the coming weeks we'll share a few short, plain-language notes about the things that matter most. In
        the meantime, if anything is on your mind, just reply — we're always happy to talk it through.
      </Text>
    </EmailLayout>
  )
}

export function BirthdayGreetingEmail() {
  return (
    <EmailLayout preview="Happy birthday from all of us">
      <Heading style={h1}>Happy birthday, {'{{first_name}}'}!</Heading>
      <Text style={p}>
        Wishing you a wonderful day and a great year ahead. We're grateful to know you and to be part of your
        financial journey.
      </Text>
      <Text style={p}>If there's ever anything we can help with, we're only a reply away. Enjoy your day!</Text>
    </EmailLayout>
  )
}

export function PolicyAnniversary() {
  return (
    <EmailLayout preview="A quick note on your coverage anniversary">
      <Heading style={h1}>It's been another year, {'{{first_name}}'}</Heading>
      <Text style={p}>
        Your coverage has reached another anniversary — a natural moment to make sure everything still fits the
        life you're living today. Sometimes nothing has changed; sometimes a lot has.
      </Text>
      <Text style={p}>
        If you'd like to take a few minutes to review where things stand together, just reply and we'll find a
        time that works for you.
      </Text>
    </EmailLayout>
  )
}

export function HolidayGreeting() {
  return (
    <EmailLayout preview="Warm wishes for the season">
      <Heading style={h1}>Warm wishes this season, {'{{first_name}}'}</Heading>
      <Text style={p}>
        As the year winds down, we wanted to pause and say thank you. It's a privilege to help families plan for
        what matters most, and we're grateful you're one of them.
      </Text>
      <Text style={p}>Wishing you and your loved ones a peaceful, joyful season — from all of us.</Text>
    </EmailLayout>
  )
}
