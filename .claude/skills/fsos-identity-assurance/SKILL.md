---
name: fsos-identity-assurance
description: Use when working on caller identification, verification, step-up, assurance levels, what may be disclosed on a call, household or third-party callers, or the FSA assistant sign-in.
---

# FSOS identity and assurance

Assurance is an authorization input held server-side in the call session. It is not a UI badge and the model cannot raise it.

## Levels
| Level | How it's reached | Allows |
|---|---|---|
| AL0 | Default | Practice info, approved FAQ, new-lead capture, appointment availability, human transfer, stop requests |
| AL1 | Caller number matches a client contact AND carrier attestation `StirVerstat = TN-Validation-Passed-A` | Limited appointment actions, existing-client routing, service requests, SMS confirmations |
| AL2 | AL1 + keypad step-up (date of birth + ZIP, or policy last four) or a one-time code to the number on file | Policy facts, case status, conversion deadlines, other protected records |
| AL3 | Reserved; only where a tool explicitly requires it | No extra authority unless a tool says so |
| AL-F1 / AL-F2 | FSA assistant: registered phone + PIN / plus a texted code (12 hours) | Read-only calendar, follow-ups, deadlines, alerts within the FSA's own book |

## Hard rules
- Keypad digits and codes are captured by the orchestrator from `dtmf` messages, compared server-side, and never sent to the model, prompts, transcripts (redacted) or logs.
- Three failed attempts → script S-AUTH-02 and transfer. A failure never lowers protection or leaks whether a record exists.
- Stop/DNC requests need no verification.
- Spouses, children, POAs and other third parties stay AL0 unless listed as authorized on the policy and verified themselves. Trusted contacts are not authorized persons.
- A forwarded practice number, if one is kept, cannot reach AL1 by caller ID; such calls fall back to AL0 and step up.
- Client matching uses the existing person tables (`contacts`, `household_members`); trusted contact is a new field. Every tool declares a minimum assurance; results are filtered by level before the model sees them.
- The FSA assistant is a separate authenticated experience, read-only in its first release, with lockout after repeated failures and SSO reset.

## Tests required
Unknown caller, known caller, spoofed caller ID (no attestation), wrong family member, failed and repeated failed verification, request above assurance, 50 impersonation attempts inside the 500-call disclosure suite (exit: 0 disclosures above level).
