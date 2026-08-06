# Lifecycle Campaign Messaging Strategy (v2)

**Status:** Draft copy implemented; awaiting compliance approval
**Date:** 2026-08-06
**Scope:** Win-Back (ADR-031), Cross-Sell Life (ADR-032), Life Conversion (ADR-029)
**Implements:** migrations `099`, `100`, `101`; playbooks in `src/lib/{pipeline-winback,cross-sell-life,life-campaign}/playbooks.ts`

This document is the marketing rationale behind the v2 message set. It records *why* each
campaign says what it says, so the copy can be reviewed, argued with, and revised deliberately
rather than drifting. It changes no behavior on its own.

---

## 0. What is shared across all three campaigns

### The single positioning line

The FSA is **not** the client's insurance agent. The FSA is the life-and-financial-services
specialist who works **alongside** the client's existing Farmers agent. Every campaign
establishes this early, because it is simultaneously the truth, the source of borrowed trust,
and the answer to "who is this person and why are they emailing me?"

### Voice

First-person singular. Short sentences. Contractions. No corporate hedging, no
"we appreciate the opportunity to serve you." The FSA is one person, so the copy sounds like
one person. Where the prior copy said *"We would be happy to provide a complimentary review,"*
the v2 copy says *"I'd genuinely like to hear about it."*

### The conversion ladder

Every campaign uses the same three-rung micro-commitment ladder, and never asks for rung 3
before offering rung 1:

1. **Reply with one word.** Near-zero friction, and it converts a broadcast into a conversation
   (which, per ADR-018, also pauses promotional automation — the system rewards this).
2. **Ask one question, answered in writing.** No meeting, no call. Explicitly offered in every
   campaign, repeatedly.
3. **Book the twenty-minute review.** The actual objective.

### Behavioral principles applied

| Principle | Where it is used |
|---|---|
| **Zeigarnik effect** (open loops nag) | Win-Back E1/S1 — "you started something" |
| **Reactance reduction** (autonomy preserves compliance) | Every campaign offers an explicit, dignified exit; several messages actively invite "no" |
| **Endowed progress** | Win-Back — they already did the hard part |
| **Consistency** | Cross-Sell E2 — "you already insure the car and the house; same instinct, different risk" |
| **Reciprocity** | Life Conversion E7 and S2 give away two useful self-checks the client can do *without* the FSA |
| **Ambiguity reduction** | Every campaign spells out exactly what the review is and how long it takes |
| **Loss framing — deliberately avoided** | No fear appeals, no manufactured deadlines. Life Conversion E6 says so out loud: *"I'm not going to invent a deadline."* |

### What is banned in all copy

No product, carrier, coverage-amount, premium, or replacement recommendation. No suitability or
best-interest determination. No invented Farmers/FNWL figure, rate, statistic, or product claim
(§4.3). No specific claim about what the recipient owns or is eligible for (ADR-020). Every body
is asserted recommendation-free by `tests/lifecycle-campaign-messaging.test.mjs`.

---

## 1. Win-Back — migration 099

**Population.** Stalled *internal* pipeline opportunities: people who quoted, applied, or went
cold with this practice and never converted (`v_pipeline_winback_due`, ≥30 days stale). Distinct
from the imported `win_back` list. 24 touches / 120 days.

**Business objective.** Convert stalled opportunities into booked complimentary reviews, or into
a clean, recorded "no" that frees the pipeline. Both are wins; only silence is a loss.

**Psychology.** This audience raised their hand and then disappeared. The dominant emotion is
mild avoidance — a low-grade social debt from having gone quiet on someone. Any message that
increases that feeling gets deleted. So the copy's first job is **absolution**: *"That happens
far more often than you would think."* Only after the shame is removed is a question worth asking.

Their interest was *deferred*, not *declined* — nothing forced the decision, so it lost to
whatever did. Win-Back E6 names this mechanism explicitly, because being told the true reason
you procrastinated is disarming in a way that another "just checking in" is not.

**Messaging arc.**

| Phase | Days | Job |
|---|---|---|
| Absolution | 1–7 | Remove shame, ask for a one-word answer, offer a graceful close |
| Re-anchor | 14–25 | What changed in their life; reconnect to their original reason |
| Dissolve friction | 35–80 | The four real blockers; the person they were protecting |
| Offer + close | 90–120 | Concrete review offer, then a warm, permanent-door-open exit |

**Signature message.** E4, "Who were you thinking about?" — *"nobody actually wants life
insurance. What they want is for someone specific to be okay."* This reframes the entire
category away from the product and back onto the motive that made them enquire originally.

**CTA.** Reply-dominant. Only two touches (E7, S5) lead with booking.

---

## 2. Cross-Sell Life — migration 100

**Population.** Existing agency clients holding non-life policies, with no active life coverage.
35 touches / 180 days. The warmest list and the **most easily damaged**.

**Business objective.** Originate life opportunities from the existing book *without spending
the agency relationship to do it.* The relationship is worth more than any single conversion,
and the copy is written as though the agency owner is reading over the FSA's shoulder — because
in effect they are.

**Psychology.** This audience did not ask for this. They have no felt need, no open loop, and no
prior relationship with the FSA specifically. Three risks dominate:

1. **"Who is this?"** — the FSA is an unknown name arriving under a trusted brand. Fixed by
   leading E1 and S1 with a plain introduction and *no ask at all*.
2. **"Is my agency selling my data / upselling me?"** — fixed by explicitly decoupling the two:
   *"It will not affect anything else about your relationship with {{agency_name}}."*
3. **Fatigue** — 35 touches over 180 days can read as harassment. Fixed by making several
   touches pure value with no CTA, and by E11 explicitly granting permission to ignore the whole
   thing: *"I'd rather you read these and ignore them than feel chased by your own insurance agency."*

**Signature message.** E2 — *"You insure the house. What about the person paying for it?"* This
is the highest-leverage single idea available for this audience, because it needs no new belief:
it borrows a decision they already made and points it one step sideways.

**Messaging arc.**

| Phase | Days | Job |
|---|---|---|
| Introduce | 1–7 | Who the FSA is, why they are writing, no ask |
| One idea | 12–36 | The insure-what-you-own reframe; when it becomes relevant |
| Educate | 48–108 | Assumptions, what it's actually for, workplace coverage, the amount |
| Invite | 114–150 | Name the offer concretely; priorities before products |
| Release | 166–180 | Explicit permission to ignore; warm close protecting the relationship |

**Note on E6.** The workplace-coverage email deliberately gives the client a six-point checklist
they can complete *without contacting the FSA at all*, then offers to translate the result. This
is reciprocity with genuine cost, and it is also the safest possible way to raise existing
coverage without touching the replacement red line.

---

## 3. Life Conversion — migration 101

**Population.** Existing policyholders with an FSA-owned active opportunity (Active Opportunity
Ownership, ADR-029). 20 touches / 180 days.

### The compliance decision that shaped this campaign

The obvious hook for this audience is *"your policy has a conversion option and the window is
closing."* **That hook is not available to us**, and writing it would have been the single
biggest compliance failure in this work.

Term-conversion windows, product availability, and carrier rules are not publicly documented
(§4.3), and FSOS holds no verified per-policy conversion data for these recipients. Migration
082 left this as an explicit open checkpoint — its asset names read conversion-specific while
its copy was a general policy review, and its SMS #1 asserted *"Your life insurance policy may
include a conversion option worth reviewing,"* which is a specific claim about a contract the
system has not verified (ADR-020).

**v2 resolves this in the safe direction.** No message asserts the recipient's policy has a
conversion option, states or implies a deadline, names a product to convert into, or suggests
replacing or modifying existing coverage. Time-limited features appear only as a *general
category worth checking*, with the review itself as the thing that establishes the facts.

If verified per-policy conversion data ever lands (a `conversion_expiration_date` the claim
resolver can ground), a claim-bearing variant can be written **then**, under the data-confidence
gate. It must not be written speculatively now.

**Repositioned objective.** From *"convert your term policy"* to **"know what you already own."**
This is honest, needs no unverified data, and is genuinely valuable — most policyholders cannot
state their own coverage terms.

**Psychology.** This audience already believes in life insurance; they bought some. So there is
nothing to sell them on conceptually. Two forces dominate instead:

1. **Invisibility.** The policy was designed to be bought once and forgotten, and it worked. The
   job is to make it visible, which E1 does by asking a question they cannot answer.
2. **Replacement anxiety.** An existing policyholder contacted by someone who also sells
   insurance reasonably suspects churn. This is the campaign's central trust obstacle, and it is
   also a regulated one. E5 confronts it directly with an explicit *what this is not* list, and
   the copy repeatedly states that most reviews end in no change — which is both good
   positioning and true.

**Signature move.** The campaign gives away its own value. S2, C4, and E7 tell the client to
check their own beneficiary designation and coverage end date *without the FSA*. Beneficiary
drift is the most common and most consequential stale detail in a life policy, and flagging it
for free is the strongest available trust signal for someone braced for a sales pitch.

**Messaging arc.**

| Phase | Days | Job |
|---|---|---|
| Make it visible | 1–8 | "Could you say what your policy does?"; offer the review |
| Educate | 15–90 | Policy terms people forget; has your life changed; open questions |
| Disarm | 105–152 | The four wary questions; what a review is and is not; beneficiary check |
| Release | 165–180 | No manufactured urgency; two free self-checks; standing offer |

---

## 4. Channel strategy

**Email.** Carries the thinking. Bodies use the `wrapMarketingEmailBody` vocabulary — a
`Subject:` line rendered as the H1, a `Preview:` line as the inbox preheader, `* ` bullets, one
`Label {{scheduling_link}}` CTA rendered as a bulletproof button, and exactly one sign-off which
the shell replaces with the branded FSA signature. The CAN-SPAM footer (address, educational
disclaimer, per-recipient unsubscribe) is appended by the platform.

**SMS.** Carries the questions. Reply-driven almost throughout; the scheduling link appears on
only three of twenty-six messages. Every body is **≤235 characters and GSM-7 safe** — the
dispatcher appends a 71-character TRAIGA footer, and a single em dash or curly quote would force
UCS-2 encoding and cut segment capacity from 153 characters to 67. Both constraints are enforced
by test.

**AI conversation.** Carries the qualification. Every opener identifies itself as an automated
assistant in its first sentence, independently of the TRAIGA footer the dispatcher appends. Each
playbook now defines a no-reply follow-up, an advisor-handoff message, and a closing message, so
the AI's exits are authored copy rather than improvisation.

**Advisor outreach.** Carries the relationship. Human scripts, never auto-dispatched; a logged
attempt fulfils the touch.

---

## 5. Compliance posture

| Control | How the copy satisfies it |
|---|---|
| Securities firewall (§4.1) | No campaign references securities, investments, or FFS product. `is_security` records never enroll. |
| AI red line (§4.2) | No recommendation language in any body (test-enforced against the real `containsRecommendationLanguage`). Every policy-specific, pricing, medical, or replacement intent escalates to the licensed FSA. |
| No invented Farmers data (§4.3) | No rate, statistic, product name, commission figure, or conversion window appears anywhere. |
| Data confidence (ADR-020) | No message asserts what the recipient owns, is eligible for, or when anything expires. |
| TCPA / A2P | Consent, quiet hours, DNC, and the A2P hold are all enforced at the gate; copy adds no send-time claim. |
| TRAIGA | AI disclosure appended by the dispatcher to every SMS, and additionally stated in every AI opener. |
| CAN-SPAM | Unsubscribe + physical address appended by the marketing shell. |
| Approval | All 71 templates land `approval_status='draft'` at version 2. `sendThroughGate()` refuses an unapproved template. **Nothing is approved or activated by this work.** |

---

## 6. Measurement

**Leading:** reply rate (the primary signal — the ladder is built for it), open and click rate,
AI-conversation engagement rate, advisor-task completion rate.
**Lagging:** complimentary reviews booked, opportunities originated or advanced, cases opened.
**Health:** opt-out rate per campaign per 30 days. **Pause and review any campaign exceeding
1.0% opt-out on a channel** — for Cross-Sell Life in particular, an opt-out is a partial loss of
an existing client relationship, not merely a lost lead.

**Recommended before activation:** run each campaign through simulation mode (ADR-021), which is
required to activate, and review the rendered email HTML for at least one touch per campaign.
