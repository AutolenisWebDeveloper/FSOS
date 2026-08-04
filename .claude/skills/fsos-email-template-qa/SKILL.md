---
name: fsos-email-template-qa
description: >
  Quality-check and spam-signal-lint an FSOS email template before it ships — responsive HTML, the required
  plain-text multipart part, dark-mode behavior, Gmail/Outlook/Apple Mail rendering compatibility,
  accessibility (alt text, semantics, contrast), and the content signals that get mail filed under Gmail's
  Promotions tab. Use this whenever the task is building, reviewing, or debugging an FSOS email template, a
  Resend Broadcast layout, a transactional notification email, or asking "why does this email look
  promotional / land in Promotions / render broken in Outlook / look wrong in dark mode". It ships a lint
  script (lint_email.mjs) that takes an HTML file and reports image-to-text ratio, link count, spam/finance
  trigger-word density, alt-text coverage, plain-text-part guidance, unsubscribe/List-Unsubscribe signal (and
  whether that's appropriate for the stream), and responsive/dark-mode readiness. Reach for it even when the
  user just says "review this email HTML", "make the newsletter render in Outlook", "why is our receipt going
  to Promotions", "add dark mode to the template", or "check this template for spam triggers" — so the
  multipart text part and Promotions signals are caught before send. Not for DNS/auth records (fsos-dns-auth)
  or overall deliverability strategy (fsos-deliverability).
---

# FSOS Email Template QA — Rendering, Accessibility & Spam-Signal Lint

A template can authenticate perfectly (SPF/DKIM/DMARC all green) and still land in spam or the Promotions
tab because of what's *inside* it: too many images and too little text, trigger words, a missing plain-text
alternative, broken Outlook layout, or an unsubscribe footer on a transactional receipt. This skill is the
content-and-rendering gate that runs *after* authentication is sound. It owns template quality; it does not
touch DNS (that's `fsos-dns-auth`) or reputation strategy (that's `fsos-deliverability`).

For provider-agnostic theory, the org's reference-only `twilio-sendgrid-engagement-quality` skill covers the
same content principles — but FSOS renders and sends via **Resend / Resend Broadcasts**, not SendGrid, and
uses no SendGrid template engine or API. Apply the *concepts*, ignore the SendGrid surface.

## The two streams have different template rules

The template rules differ by stream (see `fsos-deliverability` for the architecture). **Always lint against
the stream the template belongs to:**

- **Transactional** (`notify.markistfsa.com` — receipts, reminders, form links): relationship-class mail.
  It should **not** carry marketing chrome — no `List-Unsubscribe` header, no promotional imagery, minimal
  links. An unsubscribe footer or heavy graphics on a receipt is a *Promotions-tab signal* that can bump
  needed mail out of the Primary inbox.
- **Marketing** (`mail.markistfsa.com` — Broadcasts, newsletters): commercial mail. It **must** carry an
  RFC 8058 one-click unsubscribe and a physical postal address (CAN-SPAM), and must pass FINRA Reg BI
  principal review. Here the unsubscribe is required, not a smell.

Pass `--stream=transactional` or `--stream=marketing` to the lint script so its verdict matches the rules
that actually apply.

## The FSOS send path already gives you multipart plaintext — use it

Every well-formed email ships **two** parts: an HTML part and a `text/plain` alternative. Mailbox providers
treat a missing plain-text part as a spam signal, and it's the fallback for watches, screen readers, and
plaintext-preferring clients. In FSOS this is first-class: `src/lib/comms/send.ts` `SendContext.bodyText`
carries the template's stored `body_text` (ADR-025) and sends it as the multipart text part. **A template
whose stored `body_text` is empty is shipping single-part HTML — the lint flags this**, because the HTML file
alone can't prove the text part exists. Author the plaintext deliberately; don't auto-strip tags and call it done.

## What the lint checks (and why each matters)

Run it on the rendered HTML:

```bash
node .claude/skills/fsos-email-template-qa/scripts/lint_email.mjs path/to/template.html --stream=marketing
node .claude/skills/fsos-email-template-qa/scripts/lint_email.mjs path/to/receipt.html  --stream=transactional --json
node .claude/skills/fsos-email-template-qa/scripts/lint_email.mjs --self-test   # offline fixtures
```

| Signal | Why it matters |
|---|---|
| **Image-to-text ratio** | Image-heavy, text-light emails are the classic Promotions/spam pattern (and break when images are blocked by default in Outlook/Apple Mail). Aim for a healthy amount of real text; never ship an all-image email. |
| **Link count** | Many links — especially trackers and shorteners — reads as bulk marketing. Transactional mail should have very few. |
| **Trigger-word density** | Finance/urgency trigger words ("guarantee", "free", "act now", "risk-free", "limited time", "wire funds") raise SpamAssassin-style scores and are also a **compliance** smell — a guarantee or a securities call-to-action can violate the AI red-line / Reg BI (§4.2). The lint surfaces them for *both* reasons. |
| **Alt-text coverage** | Every `<img>` needs `alt`. It's WCAG 2.2 AA (screen readers), and it's what renders when images are blocked — a template that's meaningless without images fails both accessibility and image-blocked deliverability. |
| **Plain-text part** | A missing `text/plain` alternative is a spam signal and an accessibility gap (see above). |
| **Unsubscribe / List-Unsubscribe** | *Required* on marketing; a *Promotions signal* on transactional. The lint judges it against `--stream`. |
| **Responsive readiness** | A `viewport` meta + media queries (or fluid/hybrid layout) so it's legible on mobile — where most of this book reads mail. |
| **Dark-mode readiness** | `prefers-color-scheme` handling and no hardcoded pure-white backgrounds that invert badly. Gmail/Apple Mail dark mode can make an unprepared template unreadable. |

## Client compatibility notes (Gmail · Outlook · Apple Mail)

- **Outlook (Windows, Word engine):** ignores many modern CSS features. Use **table-based layout** for
  structure, inline styles, and treat `<div>`+flex/grid as unreliable. VML or bulletproof buttons for CTAs.
- **Gmail:** strips `<style>` in some contexts and clips messages over ~102KB (a clip hides your unsubscribe
  footer — a real compliance risk). Keep the HTML lean; prefer inline styles.
- **Apple Mail / iOS:** best CSS support, aggressive dark-mode color inversion — test both appearances.
- **Universal:** inline your critical CSS, keep total size well under Gmail's clip threshold, and always
  provide the plain-text part.

## Accessibility (WCAG 2.2 AA — it's also deliverability)

Semantic structure, a logical heading order, `alt` on every image, sufficient color contrast, and a
meaningful `lang` attribute. Accessible emails are also more deliverable: alt text saves you when images are
blocked, and real text (not text-baked-into-an-image) is what filters and screen readers both read.

## Verdict → next step

- Content/rendering findings (this skill): fix in the template's HTML and stored `body_text`.
- If the template is clean but mail still lands in spam: authentication (`fsos-dns-auth`) or reputation/
  engagement (`fsos-deliverability`) is the cause — not the template.

This skill reviews and lints template files — it changes **no application code** and touches nothing under
`src/**`. Template edits land in the template layer / stored template rows, not in the send path.
