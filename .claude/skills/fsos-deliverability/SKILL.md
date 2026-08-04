---
name: fsos-deliverability
description: >
  Master deliverability playbook and router for FSOS email (Resend) and SMS (Twilio). Use this
  whenever FSOS email is landing in spam or the Gmail Promotions tab, when inbox placement / sender
  reputation / bounce rate / spam-complaint rate is in question, when a client says "I never got your
  email", or when diagnosing why deliverability dropped. It maps the three-stream sending architecture
  (notify. transactional, mail. marketing, personal Workspace), gives the end-to-end diagnostic workflow
  (mail-tester → header inspection for aligned dkim/dmarc=pass → Google Postmaster Tools → seed test),
  the warmup schedule, the suppression model and where it is enforced, and the compliance overlay
  (securities firewall, CAN-SPAM, TCPA/A2P/TRAIGA). Reach for it even when the user just says "our emails
  go to spam", "why is FSOS mail in promotions", "check our sender reputation", or "diagnose deliverability"
  — then route to fsos-dns-auth for SPF/DKIM/DMARC record work and fsos-email-template-qa for template
  content/spam-signal work. Not for composing campaign copy (that is marketing-plan) or for the SMS consent
  gate internals (that is twilio-a2p-compliance).
---

# FSOS Deliverability — Master Playbook & Router

Deliverability is the discipline of getting a legitimately-consented message into the **inbox**, not the
spam folder or the Promotions tab. For a licensed FSA whose whole business runs on trust, a review invite
that silently lands in spam is a lost opportunity and — worse — a reputation the FSA can't see decaying.
This skill is the map. It owns the *strategy and diagnosis*; it delegates the two deep specialties:

- **DNS / authentication records** (SPF, DKIM, DMARC, ARC, BIMI, MX, alignment, the 10-lookup limit, the
  DMARC ramp) → **`fsos-dns-auth`** (ships a `validate_dns` script).
- **Template quality & spam-signal linting** (responsive HTML, plaintext multipart, dark mode, client
  compatibility, Promotions-tab content signals, accessibility) → **`fsos-email-template-qa`** (ships a
  `lint_email` script).

For **provider-agnostic deliverability theory** the org registry carries reference-only SendGrid/Twilio
skills: `twilio-sendgrid-deliverability-advisor`, `twilio-sendgrid-account-setup`,
`twilio-sendgrid-engagement-quality`, `twilio-sendgrid-suppressions`, `twilio-sendgrid-webhooks`,
`twilio-compliance-traffic`. **Read them for concepts only.** FSOS runs **Resend**, not SendGrid — none
of the SendGrid API surface, dashboard, or IP-warmup tooling applies here. Translate the theory to the
FSOS/Resend facts below; never follow a SendGrid API instruction against this codebase.

---

## 1. The three-stream sending architecture (know which stream you're debugging)

FSOS deliberately splits sending identities so a marketing complaint can never poison the reputation of
the transactional mail a client actually needs. A deliverability problem is almost always *stream-specific*
— always establish which stream first.

| Stream | Sending identity | Provider | Class | Unsubscribe | Compliance overlay |
|---|---|---|---|---|---|
| **Transactional** | `notify.markistfsa.com` | Resend | relationship (§CAN-SPAM relationship class) | **No** `List-Unsubscribe` (see §6 — it's a Promotions signal on relationship mail) | receipts, reminders, form links, review confirmations |
| **Marketing** | `mail.markistfsa.com` | Resend Broadcasts | commercial | **RFC 8058 one-click required** + physical postal address | FINRA Reg BI principal review before send; consent + quiet hours |
| **1:1 personal** | `markistfsa.com` | Google Workspace | personal | n/a (human-to-human) | **never sent via the app** — do not automate this identity |

**Why separated:** a spam complaint on a bulk campaign hitting `mail.` degrades only `mail.`'s reputation;
the `notify.` subdomain the client relies on for a form link or appointment reminder stays clean. Keeping
these on distinct subdomains is the single most important structural deliverability decision in FSOS.

### Where the stream is chosen in code (verified symbols)

Sender selection is config-driven — there is **no hardcoded `from`**:

- `src/lib/comms/senders.ts` → `resolveSender(stream)` and `streamForPurpose(purpose)`. Marketing/workshop
  purposes → `marketing` stream; every other purpose → `transactional`; an absent purpose defaults to
  `marketing` (the automated campaign/agent path) to keep the `notify.` reputation isolated.
- Env vars: `EMAIL_TRANSACTIONAL_FROM`, `EMAIL_MARKETING_FROM`, `EMAIL_TRANSACTIONAL_REPLY_TO`,
  `EMAIL_MARKETING_REPLY_TO`, with legacy `RESEND_FROM_EMAIL` as the fallback both streams use until the
  `notify.`/`mail.` subdomains are verified in Resend. **Until those env vars are set, both streams collapse
  onto the single legacy domain — that is itself a deliverability finding to surface, not a bug to "fix" in code.**
- The one send choke-point is `lib/messaging.sendEmail` (RFC 8058 headers ride in `EmailSendOptions.headers`);
  the one gated path is `src/lib/comms/send.ts` `sendThroughGate()` → `src/lib/comms/dispatcher.ts`.

> **Config default — verify (§4.3):** the subdomain names above (`notify.` / `mail.` / `markistfsa.com`)
> are the intended FSOS convention. Confirm the *actual* verified domains in the Resend dashboard and the
> deployed env before asserting reputation about a specific hostname. Do not invent a domain that isn't verified.

---

## 2. The diagnostic workflow (run it in this order — cheapest, most decisive first)

Do not guess. Deliverability has a deterministic ladder; each rung isolates a layer.

1. **mail-tester.com (or equivalent) — one send, a numeric score.** Send a real FSOS email of the affected
   stream to the generated address. It grades SPF, DKIM, DMARC, reverse DNS, SpamAssassin content rules,
   and blocklists in one shot. A score < 8/10 almost always points at either authentication (→ `fsos-dns-auth`)
   or content (→ `fsos-email-template-qa`) and tells you which.

2. **Raw header inspection — prove aligned `dkim=pass` AND `dmarc=pass`.** Open the received message's
   original/source and read `Authentication-Results`. You are looking for **both** `dkim=pass` **and**
   `dmarc=pass`, and — critically — **alignment**: the DKIM `d=` domain must match the `From:` subdomain
   (relaxed alignment: same organizational domain is enough). `dkim=pass` on the *wrong* domain still fails
   DMARC. This is the #1 subtle failure. Record work → `fsos-dns-auth`.

3. **Google Postmaster Tools — the reputation truth for Gmail.** Gmail is the dominant inbox for this book.
   Postmaster shows domain/IP reputation, spam-complaint rate, and authentication pass rates over time. A
   **spam-complaint rate above ~0.1% (Google's line is 0.3%)** is a five-alarm fire — pause the offending
   campaign, don't tune copy. Requires a one-time DNS TXT verification of the domain (a `fsos-dns-auth` task).

4. **Seed test across providers — real placement, not a score.** Send to a small hand-built set of real
   Gmail / Outlook / Yahoo / Apple Mail inboxes (or a seed-list service) and record where each landed:
   Inbox vs Promotions vs Spam. This catches Promotions-tab classification that mail-tester can't see —
   which is a *content/engagement* signal, so it routes to `fsos-email-template-qa`, not DNS.

**Interpreting the ladder:** auth failures (rungs 1–2) are binary and fixable in DNS. Reputation/placement
problems (rungs 3–4) are behavioral — they come from complaint rate, sending to stale/unengaged addresses,
poor text-to-image ratio, or missing engagement, and they heal slowly. Never "fix" a reputation problem by
editing a DNS record; never "fix" an auth failure by rewriting copy.

---

## 3. Warmup schedule (new/cold `notify.` and `mail.` subdomains)

A brand-new sending subdomain has no reputation. Blasting a full list on day one is the fastest way to a
permanent spam reputation. Ramp volume gradually, sending first to your **most-engaged** recipients (opens/
clicks build positive reputation), and watch Postmaster (§2.3) between steps.

> **Config default — verify (§4.3):** the ramp below is a conservative industry-standard default for a
> low-volume single-FSA practice, **not** a Resend-published guarantee. Adjust to actual list size and
> Postmaster signal; hold or step back a day if complaint rate rises or reputation dips.

| Day | Max sends / day (per subdomain) | Audience |
|---|---|---|
| 1–2 | ~50 | most-engaged / known-good only |
| 3–4 | ~100 | + recently-engaged |
| 5–7 | ~250 | + engaged last 30 days |
| 8–10 | ~500 | broaden cautiously |
| 11–14 | ~1,000 | approach steady-state |
| 15+ | steady-state | full consented, engaged list |

Warm `notify.` (transactional, naturally higher engagement) and `mail.` (marketing) **independently** —
they are separate reputations. For a practice this size, real transactional volume may never need a formal
ramp; the marketing stream is the one to warm deliberately before the first Broadcast.

---

## 4. The suppression model (and exactly where it is enforced)

A clean list is a deliverability control, not just a legal one: every send to a dead or complaining address
depresses reputation. FSOS enforces suppression **fail-closed inside the send gate** so a suppressed address
is *structurally* un-emailable — there is no bypass path.

**Verified mechanism (this supersedes the `comm_suppressions`/`is_comm_suppressed` naming in older briefs —
those tables/RPCs do not exist in this repo; §1 puts the live code above stale docs):**

- **Store:** the DNC store `dnc_entries`. Writes go through `src/lib/comms/unsubscribe.ts` →
  `suppressContact(address, channel, provenance)`. There is **one** suppression subsystem (§6) — do not add a parallel one.
- **Enforcement:** the dispatcher's **7-step gate** (`src/lib/comms/dispatcher.ts`, `gate.ts`,
  `data-guardrails.md §12`) — **step 3 is the DNC/suppression check**, and it blocks fail-closed. The gate
  order is: (1) consent on channel, (2) recipient-local quiet hours (9am–8pm floor), (3) **DNC/suppression**,
  (4) approved template or approved AI policy, (5) not an individualized securities recommendation,
  (6) not `is_security`-flagged, (7) no other FFS/carrier/state/federal block. First failure wins; blocked
  sends are logged and escalated, never silently dropped.
- **Feeders:**
  - **Email hard bounce / spam complaint** → Resend webhook `src/app/api/webhooks/resend/route.ts`
    (Svix-verified via `verifyResendSignature`) → `src/lib/comms/deliverability.ts`
    `applyDeliverabilitySuppression()` → `suppressContact(...)`. Soft/transient bounces do **not** suppress.
  - **SMS STOP** → `src/app/api/webhooks/twilio/inbound/route.ts` honors STOP/START/HELP immediately.
- **Marketing unsubscribe:** RFC 8058 one-click headers come from `unsubscribe.ts`
  `emailListUnsubscribeHeaders(contact)` / `emailUnsubscribeUrl(contact)`; `verifyOneClick(...)` validates
  the signed token. A one-click unsubscribe also lands in the same `dnc_entries` suppression.

**Diagnostic use:** if a specific recipient "isn't getting" marketing mail, first check whether they're
suppressed (a prior hard bounce, complaint, or STOP) before touching DNS or content — suppression is
working *as designed*, and the fix is data hygiene / re-consent, not deliverability tuning.

---

## 5. Compliance overlay (deliverability and compliance are the same gate)

Getting to the inbox and staying legal are enforced by the *same* dispatcher gate — you cannot improve
deliverability by weakening a compliance control, and you must never try.

- **Securities firewall (§4.1):** any `is_security = true` record **never auto-sends** (gate step 6) — it
  routes to human/FFS handling. This is a hard gate, not a guideline.
- **Marketing (`mail.`):** requires FINRA **Reg BI principal review**, an RFC 8058 unsubscribe, and a
  **physical postal address** in the footer (CAN-SPAM). All three are deliverability-relevant: the postal
  address and working unsubscribe are also positive inbox signals.
- **SMS:** **A2P 10DLC** registration + **TCPA prior express written consent** + **TRAIGA 2026** AI
  disclosure in every automated message. Internals live in `twilio-a2p-compliance`.
- **Before enabling any live automated outreach**, contact **Ryan Anderson, Compliance TX — (253) 242-0597**
  (a compliance resource, not an approval gate — the FSA owns go-live; document and remediate residual risk).

---

## 6. Router — pick the next skill by symptom

| Symptom / request | Go to |
|---|---|
| SPF/DKIM/DMARC/BIMI/MX record authoring; alignment; >10 DNS lookups; DMARC still `p=none`; "validate our DNS" | **`fsos-dns-auth`** (run `validate_dns`) |
| Email looks promotional / lands in Promotions; image-heavy; missing plaintext; dark-mode/Outlook/Apple render; alt-text/a11y | **`fsos-email-template-qa`** (run `lint_email`) |
| SMS consent / STOP / quiet hours / A2P / on-behalf-of send internals | `twilio-a2p-compliance` |
| Campaign strategy, cadence, audience, content themes | `marketing-plan` |
| RLS / audit / guardrail correctness on the comms tables | `fsos-security-audit` |
| Provider-agnostic theory only (translate to Resend, ignore the API) | reference-only SendGrid/Twilio skills (§intro) |

---

## 7. Quick reference — verified FSOS symbols

```
Sender selection      src/lib/comms/senders.ts   resolveSender(stream) · streamForPurpose(purpose)
Send gate (7-step)    src/lib/comms/send.ts      sendThroughGate()  →  dispatcher.ts / gate.ts
One email choke-point lib/messaging.sendEmail    EmailSendOptions.headers (RFC 8058 rides here)
Suppression write     src/lib/comms/unsubscribe.ts  suppressContact(addr, channel, provenance) → dnc_entries
Suppression enforce   dispatcher gate STEP 3 (DNC), fail-closed
Email event ingest    src/app/api/webhooks/resend/route.ts  (Svix)  → deliverability.ts applyDeliverabilitySuppression()
SMS STOP/START/HELP   src/app/api/webhooks/twilio/inbound/route.ts
Marketing unsub       src/lib/comms/unsubscribe.ts  emailListUnsubscribeHeaders() · emailUnsubscribeUrl() · verifyOneClick()
Multipart plaintext   src/lib/comms/send.ts  SendContext.bodyText (template stored body_text, ADR-025)
```

Everything in this skill is diagnosis and routing — it changes **no application code**. Record edits happen
in DNS (via `fsos-dns-auth`) and template edits in the template layer (via `fsos-email-template-qa`).
