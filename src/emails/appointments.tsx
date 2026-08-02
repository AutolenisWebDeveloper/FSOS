// src/emails/appointments.tsx — Slice 9 email templates (ADR-025). Appointment lifecycle.
// The specific date/time is grounded in stored data at send time (§13/§18); the copy here
// stays generic and never asserts an invented time. appointment_time / meeting_details /
// reschedule_url / cancel_url are BLOCKING merge tokens the booking notify path supplies.
import * as React from 'react'
import { EmailLayout } from './_layout'
import { Eyebrow, H1, Lead, P, DetailTable, CtaButton, SecondaryNote } from './_components'

export function AppointmentConfirmation() {
  return (
    <EmailLayout preview="Your appointment is confirmed">
      <Eyebrow>Appointment Confirmed</Eyebrow>
      <H1>You&rsquo;re all set, {'{{first_name}}'}</H1>
      <Lead>
        This note confirms your upcoming appointment with our office. We&rsquo;re looking forward to it, and we&rsquo;ll come
        prepared to make good use of your time.
      </Lead>
      <DetailTable
        rows={[
          { label: 'When', children: '{{appointment_time}}' },
          { label: 'Details', children: '{{meeting_details}}' },
        ]}
      />
      <CtaButton href="{{reschedule_url}}">Reschedule</CtaButton>
      <SecondaryNote>Need to cancel instead? {'{{cancel_url}}'}</SecondaryNote>
    </EmailLayout>
  )
}

export function AppointmentCancellation() {
  return (
    <EmailLayout preview="Your appointment has been cancelled">
      <Eyebrow>Appointment Cancelled</Eyebrow>
      <H1>Your appointment is cancelled, {'{{first_name}}'}</H1>
      <Lead>
        This confirms that your appointment ({'{{appointment_time}}'}) has been cancelled. No further action is
        needed on your part.
      </Lead>
      <P>If you&rsquo;d like to find another time, you&rsquo;re always welcome to book again.</P>
      <CtaButton href="{{scheduling_link}}">Book another time</CtaButton>
      <SecondaryNote>Or just reply and we&rsquo;ll help.</SecondaryNote>
    </EmailLayout>
  )
}

export function AppointmentReminderEmail() {
  return (
    <EmailLayout preview="A friendly reminder about your appointment">
      <Eyebrow>Appointment Reminder</Eyebrow>
      <H1>Looking forward to seeing you, {'{{first_name}}'}</H1>
      <Lead>
        This is a friendly reminder about your upcoming appointment with our office. There&rsquo;s nothing you need to
        prepare — just bring any questions you&rsquo;d like to cover.
      </Lead>
      <DetailTable
        rows={[
          { label: 'When', children: '{{appointment_time}}' },
          { label: 'Details', children: '{{meeting_details}}' },
        ]}
      />
      <CtaButton href="{{reschedule_url}}">Reschedule</CtaButton>
      <SecondaryNote>Need to cancel instead? {'{{cancel_url}}'}</SecondaryNote>
    </EmailLayout>
  )
}

export function AppointmentRecap() {
  return (
    <EmailLayout preview="Thanks for your time — a quick recap">
      <Eyebrow>Recap</Eyebrow>
      <H1>Thanks for the conversation, {'{{first_name}}'}</H1>
      <Lead>
        It was good to connect. We appreciate you taking the time to talk through your goals — the more we
        understand what matters to you, the better we can help.
      </Lead>
      <P>If any new questions come to mind after our conversation, just reply. We&rsquo;re here whenever you need us.</P>
    </EmailLayout>
  )
}

export function RescheduleInvite() {
  return (
    <EmailLayout preview="Let's find a better time">
      <Eyebrow>Let&rsquo;s Reschedule</Eyebrow>
      <H1>Let&rsquo;s find a time that works, {'{{first_name}}'}</H1>
      <Lead>
        We know schedules fill up. If our last plan didn&rsquo;t line up, no problem at all — we&rsquo;d still love to connect
        whenever it&rsquo;s convenient for you.
      </Lead>
      <CtaButton href="{{scheduling_link}}">Find a new time</CtaButton>
      <SecondaryNote>Or reply with a few times that suit you, and we&rsquo;ll get something back on the calendar.</SecondaryNote>
    </EmailLayout>
  )
}
