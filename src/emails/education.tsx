// src/emails/education.tsx — Slice 9 email templates (ADR-025). Financial-wellness education.
// STRICTLY green-zone: educate + invite a conversation. No product/investment recommendation,
// no securities solicitation (§4.1/§4.2) — retirement/college/estate stay purely educational.
import * as React from 'react'
import { EmailLayout } from './_layout'
import { Eyebrow, H1, Lead, P, Callout, CtaButton, SecondaryNote } from './_components'

export function LifeInsuranceBasics() {
  return (
    <EmailLayout preview="Life insurance, in plain language">
      <Eyebrow>Financial Wellness</Eyebrow>
      <H1>Life insurance, without the jargon</H1>
      <Lead>
        Term, whole, universal — the words can feel like alphabet soup. At its heart, life insurance answers one
        question: if something happened to you, would the people who depend on you be okay?
      </Lead>
      <Callout>
        We put together a short, plain-language overview of how the pieces fit together — no pressure, just clarity.
      </Callout>
      <CtaButton href="{{scheduling_link}}">Talk it through</CtaButton>
      <SecondaryNote>Or just reply with your questions whenever it&rsquo;s convenient.</SecondaryNote>
    </EmailLayout>
  )
}

export function EmergencyFundEducation() {
  return (
    <EmailLayout preview="The quiet foundation of a financial plan">
      <Eyebrow>Financial Wellness</Eyebrow>
      <H1>Why an emergency fund comes first</H1>
      <Lead>
        Before anything else, a cushion of savings is what keeps a surprise — a car repair, a medical bill, a
        gap between jobs — from turning into a setback. A common starting point is a few months of expenses.
      </Lead>
      <P>
        If you&rsquo;d like help thinking through what the right cushion looks like for your household, we&rsquo;re happy
        to talk it through whenever it&rsquo;s convenient.
      </P>
      <CtaButton href="{{scheduling_link}}">Think it through together</CtaButton>
    </EmailLayout>
  )
}

export function IncomeProtectionEducation() {
  return (
    <EmailLayout preview="What happens to your income if you can't work?">
      <Eyebrow>Financial Wellness</Eyebrow>
      <H1>Your paycheck may be your biggest asset</H1>
      <Lead>
        For most families, the ability to earn an income is the engine behind every other goal. It&rsquo;s worth
        understanding what would happen to that income if an illness or injury kept you from working for a while.
      </Lead>
      <P>We&rsquo;re glad to walk through how income protection works and what questions are worth asking.</P>
      <CtaButton href="{{scheduling_link}}">Set up a short conversation</CtaButton>
      <SecondaryNote>Reply any time and we&rsquo;ll find a moment that suits you.</SecondaryNote>
    </EmailLayout>
  )
}

export function RetirementReadinessEducation() {
  return (
    <EmailLayout preview="A few questions worth asking about retirement">
      <Eyebrow>Financial Wellness</Eyebrow>
      <H1>Are you on track for the retirement you picture?</H1>
      <Lead>
        Retirement planning starts with a picture — where you want to be, and what it will take to get there.
        Small, steady steps taken early tend to matter more than any single decision.
      </Lead>
      <P>
        If you&rsquo;d like to talk through your goals and the questions worth considering, we&rsquo;re here to help.
        This is educational, not advice.
      </P>
      <CtaButton href="{{scheduling_link}}">Talk through your goals</CtaButton>
      <SecondaryNote>Or just reply and we&rsquo;ll find a time to connect.</SecondaryNote>
    </EmailLayout>
  )
}

export function CollegeSavingsEducation() {
  return (
    <EmailLayout preview="Getting ahead of education costs">
      <Eyebrow>Financial Wellness</Eyebrow>
      <H1>Planning ahead for education costs</H1>
      <Lead>
        Education is one of the biggest investments many families make in their children&rsquo;s future — and one where
        starting early gives you the most flexibility.
      </Lead>
      <P>
        We&rsquo;re happy to share what&rsquo;s worth understanding as you plan, and to help you think through your goals.
      </P>
      <CtaButton href="{{scheduling_link}}">Plan ahead together</CtaButton>
      <SecondaryNote>Just reply and we&rsquo;ll set up a time.</SecondaryNote>
    </EmailLayout>
  )
}

export function EstatePlanningBasics() {
  return (
    <EmailLayout preview="The basics of leaving things in good order">
      <Eyebrow>Financial Wellness</Eyebrow>
      <H1>Leaving things in good order</H1>
      <Lead>
        Estate planning isn&rsquo;t only for the wealthy — it&rsquo;s about making sure your wishes are clear and the people
        you love aren&rsquo;t left with unnecessary complications. A few basics go a long way.
      </Lead>
      <P>
        We can point you to the questions worth asking and coordinate with the professionals you already work with.
      </P>
      <CtaButton href="{{scheduling_link}}">Talk through the basics</CtaButton>
      <SecondaryNote>Reply whenever you&rsquo;d like to walk through it.</SecondaryNote>
    </EmailLayout>
  )
}
