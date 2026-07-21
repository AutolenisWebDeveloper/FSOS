// Pure decision core for the GLOBAL AI gateway kill switch. Extracted so the
// fail-closed posture is unit-tested without a DB (tests/ai-kill-switch.test.mjs).
//
// The switch must fail CLOSED whenever it cannot be verified: an env override that
// disables it, or a DB read error (we could not confirm it is on). A kill switch that
// keeps running when it can't be read is not a kill switch (audit M-4). A missing config
// row with no error is the intentional "not configured yet → enabled" default.

export function gatewayEnabledFrom(
  envDisabled: boolean,
  row: { gateway_enabled?: boolean | null } | null | undefined,
  dbError: boolean,
): boolean {
  if (envDisabled) return false
  if (dbError) return false // fail closed — cannot verify the switch → treat as disabled
  return row?.gateway_enabled !== false // unconfigured (no row) defaults to enabled
}
