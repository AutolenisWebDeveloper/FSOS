// Social engagement triage — pure logic (ADR-026, Slice 5). No I/O; unit-testable.
//
// The Engagement Triager classifies inbound engagement and suggests a route. Author
// resolution matches to an EXISTING contact only — it never fabricates a person
// record (ADR-001). Matching is by a normalized email/phone the engagement carries;
// when nothing matches, the engagement stays UNMATCHED for the human review queue.

export type EngagementClassification = 'lead' | 'question' | 'complaint' | 'positive' | 'spam' | 'other'
export type EngagementRoute = 'create_lead' | 'reply_needed' | 'review' | 'ignore'
export type ResolutionStatus = 'unmatched' | 'matched' | 'triaged' | 'dismissed'

const RX = {
  spam: /\b(free\s+money|crypto|bitcoin|giveaway|click\s+here|buy\s+now|earn\s+\$|follow\s+back|check\s+my\s+(profile|page))\b/i,
  complaint: /\b(scam|terrible|worst|refund|angry|awful|ripoff|rip-off|fraud|complaint|unhappy)\b/i,
  lead: /\b(interested|how\s+much|pricing|quote|sign\s+up|get\s+started|call\s+me|dm\s+me|more\s+info|book\s+a|schedule)\b/i,
  positive: /\b(thank|thanks|love\s+this|great|awesome|helpful|amazing|appreciate)\b/i,
}

export function classifyEngagement(body: string | null | undefined): EngagementClassification {
  const text = (body ?? '').trim()
  if (!text) return 'other'
  if (RX.spam.test(text)) return 'spam'
  if (RX.complaint.test(text)) return 'complaint'
  if (RX.lead.test(text)) return 'lead'
  if (RX.positive.test(text)) return 'positive'
  if (text.includes('?')) return 'question'
  return 'other'
}

// The suggested route for a classification. A lead/question/complaint needs human
// attention; spam is ignored; positive is acknowledged via review.
export function routeFor(classification: EngagementClassification): EngagementRoute {
  switch (classification) {
    case 'lead':
      return 'create_lead'
    case 'question':
    case 'complaint':
      return 'reply_needed'
    case 'spam':
      return 'ignore'
    default:
      return 'review'
  }
}

export interface ContactCandidate {
  id: string
  email_lc: string | null
  phone_digits: string | null
}

export function normalizeEmail(email: string | null | undefined): string | null {
  const e = (email ?? '').trim().toLowerCase()
  return e && e.includes('@') ? e : null
}

export function normalizePhone(phone: string | null | undefined): string | null {
  const d = (phone ?? '').replace(/\D/g, '')
  return d.length >= 10 ? d.slice(-10) : null
}

// Match an engagement author to an EXISTING contact by email then phone. Returns
// the matched contact id or null (→ unmatched review queue). NEVER invents a
// contact — resolution to a new person record is not a possible output here.
export function matchContact(
  author: { email?: string | null; phone?: string | null },
  candidates: ContactCandidate[],
): { contactId: string; matchedBy: 'email' | 'phone' } | null {
  const email = normalizeEmail(author.email)
  if (email) {
    const byEmail = candidates.find((c) => c.email_lc && c.email_lc === email)
    if (byEmail) return { contactId: byEmail.id, matchedBy: 'email' }
  }
  const phone = normalizePhone(author.phone)
  if (phone) {
    const byPhone = candidates.find((c) => c.phone_digits && normalizePhone(c.phone_digits) === phone)
    if (byPhone) return { contactId: byPhone.id, matchedBy: 'phone' }
  }
  return null
}
