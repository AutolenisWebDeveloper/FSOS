// src/emails/education.tsx — Slice 9 email templates (ADR-025). Financial-wellness education.
// STRICTLY green-zone: educate + invite a conversation. No product/investment recommendation,
// no securities solicitation (§4.1/§4.2) — retirement/college/estate stay purely educational.
import * as React from 'react'
import { Heading, Text } from '@react-email/components'
import { EmailLayout } from './_layout'
import { h1, p } from './_styles'

export function LifeInsuranceBasics() {
  return (
    <EmailLayout preview="Life insurance, in plain language">
      <Heading style={h1}>Life insurance, without the jargon</Heading>
      <Text style={p}>
        Term, whole, universal — the words can feel like alphabet soup. At its heart, life insurance answers one
        question: if something happened to you, would the people who depend on you be okay?
      </Text>
      <Text style={p}>
        We put together a short, plain-language overview of how the pieces fit together. If it would help to talk
        through what applies to your situation, just reply — no pressure, just clarity.
      </Text>
    </EmailLayout>
  )
}

export function EmergencyFundEducation() {
  return (
    <EmailLayout preview="The quiet foundation of a financial plan">
      <Heading style={h1}>Why an emergency fund comes first</Heading>
      <Text style={p}>
        Before anything else, a cushion of savings is what keeps a surprise — a car repair, a medical bill, a
        gap between jobs — from turning into a setback. A common starting point is a few months of expenses.
      </Text>
      <Text style={p}>
        If you'd like help thinking through what the right cushion looks like for your household, we're happy to
        talk it through whenever it's convenient.
      </Text>
    </EmailLayout>
  )
}

export function IncomeProtectionEducation() {
  return (
    <EmailLayout preview="What happens to your income if you can't work?">
      <Heading style={h1}>Your paycheck may be your biggest asset</Heading>
      <Text style={p}>
        For most families, the ability to earn an income is the engine behind every other goal. It's worth
        understanding what would happen to that income if an illness or injury kept you from working for a while.
      </Text>
      <Text style={p}>
        We're glad to walk through how income protection works and what questions are worth asking. Reply any
        time and we'll set up a short conversation.
      </Text>
    </EmailLayout>
  )
}

export function RetirementReadinessEducation() {
  return (
    <EmailLayout preview="A few questions worth asking about retirement">
      <Heading style={h1}>Are you on track for the retirement you picture?</Heading>
      <Text style={p}>
        Retirement planning starts with a picture — where you want to be, and what it will take to get there.
        Small, steady steps taken early tend to matter more than any single decision.
      </Text>
      <Text style={p}>
        If you'd like to talk through your goals and the questions worth considering, we're here to help. This is
        educational, not advice — reply and we'll find a time to connect.
      </Text>
    </EmailLayout>
  )
}

export function CollegeSavingsEducation() {
  return (
    <EmailLayout preview="Getting ahead of education costs">
      <Heading style={h1}>Planning ahead for education costs</Heading>
      <Text style={p}>
        Education is one of the biggest investments many families make in their children's future — and one where
        starting early gives you the most flexibility.
      </Text>
      <Text style={p}>
        We're happy to share what's worth understanding as you plan, and to help you think through your goals. If
        that would be useful, just reply and we'll set up a time.
      </Text>
    </EmailLayout>
  )
}

export function EstatePlanningBasics() {
  return (
    <EmailLayout preview="The basics of leaving things in good order">
      <Heading style={h1}>Leaving things in good order</Heading>
      <Text style={p}>
        Estate planning isn't only for the wealthy — it's about making sure your wishes are clear and the people
        you love aren't left with unnecessary complications. A few basics go a long way.
      </Text>
      <Text style={p}>
        We can point you to the questions worth asking and coordinate with the professionals you already work
        with. Reply whenever you'd like to talk it through.
      </Text>
    </EmailLayout>
  )
}
