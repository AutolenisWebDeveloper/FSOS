// Pure predicate shared by the three campaign-engine ticks (Life Conversion,
// Cross-Sell Life, Pipeline Win-Back): is a loaded comm template actually usable
// for a message-touch send?
//
// Exists because the ticks once derived the channel with a bare
// `tpl?.channel === 'email' ? 'email' : 'sms'` — so a template fetch that
// returned null (schema drift made the select error) silently became an SMS with
// an EMPTY body, and 88 clients received near-empty texts
// (docs/audit/outbound-campaigns-2026-08-07.md). The ticks now fail closed on
// this predicate before deriving channel/recipient: an unloadable, channel-less,
// or empty-bodied template never dispatches.

export interface LoadedTemplate {
  channel?: string | null
  body?: string | null
  // Ticks select additional columns (version, introduces_sender, …); the guard
  // narrows an untyped Supabase row, so keep those reachable after narrowing.
  [key: string]: unknown
}

export function usableTemplate(
  tpl: LoadedTemplate | null | undefined,
): tpl is LoadedTemplate & { channel: string; body: string } {
  return (
    !!tpl &&
    typeof tpl.channel === 'string' &&
    tpl.channel.length > 0 &&
    typeof tpl.body === 'string' &&
    tpl.body.trim().length > 0
  )
}
