import { NextRequest, NextResponse } from 'next/server'
import { requireInternalAuth, readJson } from '@/lib/http'
import { getAnthropic, FNA_MODEL } from '@/lib/anthropic'
import { FINRA_DISCLAIMER, AI_PROHIBITED_ACTIONS } from '@/lib/compliance'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const MAX_TURNS = 20

const SYSTEM_PROMPT = `You are the FSOS Assistant — an in-app helper for Markist, a licensed Farmers Financial Services (FSA) agent using the FSA Operating System (FSOS) command center.

Your job is to help Markist operate the tool and his practice: explain how FSOS features work (Daily Briefing, Opportunities, Conversions, OPRA Center, GDC & Commission, Client Forms, FNA Generator, Calendar, Workshops), summarize workflows, draft outreach copy (emails, SMS, call scripts) for his review, explain financial and insurance concepts at an educational level, and answer questions about the 10-3-1 activity model and GDC tiers (40% under $15k, 60% $15k–$54,999, 80% $55k+ rolling 12-month GDC).

COMPLIANCE — you must never do any of the following:
${AI_PROHIBITED_ACTIONS.map((a) => `- ${a}`).join('\n')}
You never recommend a specific product, carrier, or security, and never make a suitability determination — those require a licensed FSA meeting and FINRA Reg BI review. Product CATEGORIES (e.g. "term life", "annuities") are fine to discuss educationally; specific named products are not. If asked to cross these lines, decline briefly and redirect to what you can do.

Keep answers concise, practical, and formatted for a small side panel. When you draft client-facing content, label it clearly as a draft for Markist's review. If a topic touches product suitability or a specific recommendation, remind him: "${FINRA_DISCLAIMER}"`

export async function POST(req: NextRequest) {
  const unauthorized = requireInternalAuth(req)
  if (unauthorized) return unauthorized

  const parsed = await readJson<{
    messages?: Array<{ role: 'user' | 'assistant'; content: string }>
  }>(req)
  if ('error' in parsed) return parsed.error

  const incoming = Array.isArray(parsed.data.messages) ? parsed.data.messages : []
  const messages = incoming
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .slice(-MAX_TURNS)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 4000) }))

  if (messages.length === 0 || messages[messages.length - 1].role !== 'user') {
    return NextResponse.json({ error: 'A user message is required' }, { status: 400 })
  }

  try {
    const message = await getAnthropic().messages.create({
      model: FNA_MODEL,
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages,
    })
    const block = message.content[0]
    const reply = block && block.type === 'text' ? block.text : ''
    return NextResponse.json({ reply })
  } catch (err) {
    console.error('[assistant] model call failed:', err)
    return NextResponse.json({ error: 'Assistant is unavailable right now' }, { status: 502 })
  }
}
