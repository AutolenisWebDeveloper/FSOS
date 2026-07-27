// src/emails/appointments.tsx — Slice 9 email templates (ADR-025). Appointment lifecycle.
// The specific date/time is grounded in stored data at send time (§13/§18); the copy here
// stays generic and never asserts an invented time.
import * as React from 'react'
import { Heading, Text } from '@react-email/components'
import { EmailLayout } from './_layout'
import { h1, p } from './_styles'

export function AppointmentConfirmation() {
  return (
    <EmailLayout preview="Your appointment is confirmed">
      <Heading style={h1}>You're all set, {'{{first_name}}'}</Heading>
      <Text style={p}>
        This note confirms your upcoming appointment with our office. We're looking forward to it, and we'll come
        prepared to make good use of your time.
      </Text>
      {/* Specifics are grounded in stored data at send time via merge tokens (ADR-025 / §13):
          appointment_time and meeting_details are substituted by the send path, never baked in. */}
      <Text style={p}>
        <strong>When:</strong> {'{{appointment_time}}'}
      </Text>
      <Text style={p}>{'{{meeting_details}}'}</Text>
      <Text style={p}>
        Need to make a change? Reschedule: {'{{reschedule_url}}'} — or cancel: {'{{cancel_url}}'}
      </Text>
    </EmailLayout>
  )
}

export function AppointmentCancellation() {
  return (
    <EmailLayout preview="Your appointment has been cancelled">
      <Heading style={h1}>Your appointment is cancelled, {'{{first_name}}'}</Heading>
      <Text style={p}>
        This confirms that your appointment ({'{{appointment_time}}'}) has been cancelled. No further action is
        needed on your part.
      </Text>
      <Text style={p}>
        If you'd like to find another time, you're always welcome to book again or just reply and we'll help.
      </Text>
    </EmailLayout>
  )
}

export function AppointmentReminderEmail() {
  return (
    <EmailLayout preview="A friendly reminder about your appointment">
      <Heading style={h1}>Looking forward to seeing you, {'{{first_name}}'}</Heading>
      <Text style={p}>
        This is a friendly reminder about your upcoming appointment with our office. There's nothing you need to
        prepare — just bring any questions you'd like to cover.
      </Text>
      <Text style={p}>
        <strong>When:</strong> {'{{appointment_time}}'}
      </Text>
      <Text style={p}>{'{{meeting_details}}'}</Text>
      <Text style={p}>
        Need to make a change? Reschedule: {'{{reschedule_url}}'} — or cancel: {'{{cancel_url}}'}
      </Text>
    </EmailLayout>
  )
}

export function AppointmentRecap() {
  return (
    <EmailLayout preview="Thanks for your time — a quick recap">
      <Heading style={h1}>Thanks for the conversation, {'{{first_name}}'}</Heading>
      <Text style={p}>
        It was good to connect. We appreciate you taking the time to talk through your goals — the more we
        understand what matters to you, the better we can help.
      </Text>
      <Text style={p}>
        If any new questions come to mind after our conversation, just reply. We're here whenever you need us.
      </Text>
    </EmailLayout>
  )
}

export function RescheduleInvite() {
  return (
    <EmailLayout preview="Let's find a better time">
      <Heading style={h1}>Let's find a time that works, {'{{first_name}}'}</Heading>
      <Text style={p}>
        We know schedules fill up. If our last plan didn't line up, no problem at all — we'd still love to connect
        whenever it's convenient for you.
      </Text>
      <Text style={p}>Just reply with a few times that suit you, and we'll get something back on the calendar.</Text>
    </EmailLayout>
  )
}
