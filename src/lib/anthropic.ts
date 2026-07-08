// src/lib/anthropic.ts
// Lazy Anthropic client — never instantiate at module level, mirroring the
// getDb()/getResend() convention. The SDK constructor throws when the API key
// is unset, which would crash the whole route module at import time (breaking
// even GET handlers that never call the model, and next build).

import Anthropic from '@anthropic-ai/sdk'

// Current production model for FNA generation. Kept in one place so a model
// migration is a single-line change. claude-sonnet-4-20250514 was deprecated.
export const FNA_MODEL = 'claude-sonnet-5'
export const FNA_MAX_TOKENS = 4096

let _client: Anthropic | null = null

export function getAnthropic(): Anthropic {
  if (_client) return _client
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    throw new Error('[FSOS] ANTHROPIC_API_KEY is not configured')
  }
  _client = new Anthropic({ apiKey })
  return _client
}
