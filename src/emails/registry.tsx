// src/emails/registry.tsx
// Slice 9B — the email-template registry (author-time, ADR-025). Each entry maps a stable
// source_key to its React Email element + the comm_templates metadata the generation script
// writes (name / channel / category). source_key ties a stored template back to the exact
// component that produced it, so re-rendering updates the same draft (idempotent).
import * as React from 'react'
import { AnnualReviewInvite } from './annual-review-invite'
import { TermConversionWindowInvite } from './term-conversion-window-invite'
import { CoverageGapEducation } from './coverage-gap-education'

export interface EmailTemplateEntry {
  sourceKey: string
  name: string
  channel: 'email'
  category: string
  element: React.ReactElement
}

export const EMAIL_TEMPLATES: EmailTemplateEntry[] = [
  {
    sourceKey: 'annual-review-invite',
    name: 'Annual policy review invitation',
    channel: 'email',
    category: 'policy_review',
    element: <AnnualReviewInvite />,
  },
  {
    sourceKey: 'term-conversion-window-invite',
    name: 'Term conversion window — review invitation',
    channel: 'email',
    category: 'term_conversion',
    element: <TermConversionWindowInvite />,
  },
  {
    sourceKey: 'coverage-gap-education',
    name: 'Coverage gap — educational invitation',
    channel: 'email',
    category: 'educational',
    element: <CoverageGapEducation />,
  },
]
