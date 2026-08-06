# AI conversation replies — what the automation may answer on its own

**Audience:** compliance review. No code reading required.
**Status:** for review before go-live. Nothing described here is active in production yet.
**Scope:** replies the FSOS automation drafts when a client sends an SMS or email into an
existing conversation thread. It does **not** cover campaign messages, which are sent from
pre-written templates that go through their own approval.
**Last updated:** 2026-08-06

---

## 1. What this document is for

When a client texts in, FSOS can draft a reply and send it without waiting for Markist. This
document describes **the rule that decides whether a given reply may go out on its own, or
must be held for Markist to review.** The rule is enforced in code, not by instructing the AI
model — the model's cooperation is not relied on.

Two questions are worth keeping separate while reading:

- *What is the client asking about?* → the **topic** rule (§3)
- *What is the automation about to say?* → the **content** rule (§4)

Both must pass. Either one failing means the reply is held.

---

## 2. What "held" means

Two subjects — complaints, and bereavement/illness/hardship — are additionally marked
**urgent**, and appear in the FSA queue under their own reason (`urgent_human_attention`)
rather than the general one, so they are findable ahead of routine holds. Urgency is
determined across all subjects independently of which one labels the message, so a
bereavement raised inside a securities question is still routed as urgent.


A held reply is **not** discarded and the client is **not** ignored by the system:

- the drafted text is saved for Markist to read, edit, or send;
- an item appears in the FSA queue naming the reason (e.g. *"exchange touches pricing or
  premium"*);
- the event is written to the audit log;
- nothing is sent to the client until a person acts.

The practical effect of a hold is that **the client waits for a human** rather than getting an
automated response.

---

## 3. Topic rule — subjects the automation will not engage on its own

If the conversation touches any of the following, the reply is held for Markist **regardless
of how harmless the drafted text looks.** The check runs against **both** the client's message
and the drafted reply, so it does not matter which side raised the subject.

| Subject | What it covers | Why it is held |
|---|---|---|
| **Securities** | Retirement accounts (401(k), 403(b), IRA, Roth), mutual funds, annuities, brokerage, portfolios, ETFs, stocks, bonds, rollovers, variable products, market performance, investing generally | FSOS is not a broker-dealer system. Securities activity belongs in the FFS-supervised channel. This subject is **blocked outright**, not merely held. |
| **Pricing and premiums** | Premiums, quotes, "how much would it cost", monthly cost, rates, affordability | A figure quoted by automation is a representation about cost. Requires a licensed person. |
| **The client's own policy** | Their policy or policy number, death benefit, cash value, face amount, beneficiaries, coverage, riders, lapse status, payouts — including a **third party's** contract ("*our* policy", "*his* coverage"), which is how a survivor asks | A specific claim about a specific contract. FSOS should not assert policy facts unverified. |
| **Term conversion** | Conversion windows, deadlines, the conversion privilege, converting a policy | Carrier-specific and not publicly documented; FSOS treats these values as unverified defaults. (General "what is term life insurance" education is **not** held — see §5.) |
| **Replacement or surrender** | Replacing, surrendering, cancelling a policy, 1035 exchanges, switching carriers | Replacement is a supervised determination. |
| **Underwriting and medical** | Underwriting, medical exams, health questions, tobacco use, pre-existing conditions, eligibility or approval, prior declines | Insurability is not something automation may assess or imply. |
| **How much coverage is needed** | "How much coverage do I need", "do I have enough" | A needs conclusion is a suitability determination. |
| **Product comparison** | Term vs whole life, "which is better", comparisons between products or carriers | A comparison is an implicit recommendation. |
| **Complaints and disputes** | Complaints and grievances, attorneys, lawsuits, disputes, refunds — **and unhappy language that never uses the word "complaint"**: furious, angry, unacceptable, ridiculous, "nobody has called me back", "I want to speak to a supervisor" | Must reach a person quickly, with a record. Depending on state handling requirements, an automated non-answer to a complaint may itself be a failure. **Routed as urgent.** |
| **Bereavement, serious illness, hardship** | A death in the family, a spouse or parent who has passed, funerals, widowhood, hospice, terminal or serious illness — and financial crisis: job loss, redundancy, "can't afford", falling behind on payments, divorce | **This one is not an advice risk.** The danger is an automated non-answer to a human moment: replying to *"my husband passed away, does our policy pay out?"* with a booking link. Held so a person responds. **Routed as urgent.** |
| **Sensitive personal data** | Social Security numbers, dates of birth, account or routing numbers, card numbers, licence numbers | Automation should not solicit, confirm, or handle these in a message thread. |
| **Open applications and claims** | Their application, a claim, "status of my…", paperwork, submissions | Case-affecting; belongs with whoever owns the case. |
| **Requests for advice** | "What do you recommend", "should I…", "what would you do", "best option", "does this make sense for me" | The advice red line. |

Adding a subject to this list can only ever make FSOS **more** restrictive. Nothing on this
list can be overridden by any setting.

---

## 4. Content rule — the only four things the automation may say on its own

Even when no subject above is involved, the drafted reply must be one of exactly **four**
shapes, all of which are deliberately *contentless* — none of them answers anything:

1. **An availability question** — "What day works for you this week?"
2. **A scheduling link** — a link to book time with Markist.
3. **An acknowledgment of receipt** — "Got it, passing this along to Markist."
4. **A thank-you** — "Thanks so much, talk soon."

Anything else is held. In particular, **the automation cannot auto-send an answer to a
question.** A reply that explains, quantifies, reassures, or concludes is held even if the
subject is not on the §3 list and even if it reads as completely benign.

Two additional limits apply:

- A reply longer than roughly 480 characters is held, whatever it says. Length is treated as
  evidence of substance.
- If the AI itself decides the question is not one it should answer and substitutes its
  hand-off wording, that is treated as a hold, not as a send.

Every auto-sent message also carries the standard AI disclosure and opt-out line required by
Texas TRAIGA, appended by the system, and passes the same consent / quiet-hours / do-not-
contact / securities checks as any other outbound message.

---

## 5. What is deliberately *not* held

General, category-level education is inside the permitted zone and is not treated as a
regulated subject: explaining what term life insurance *is*, what a financial review covers,
or what to expect from a meeting. Only *conversion mechanics* — windows, deadlines, eligibility
— are held, not the product category itself.

This distinction is deliberate. Over-holding produces silence, and silence to a client who
just texted is its own failure.

---

## 6. Known limitation, stated plainly

The §3 subject list works by recognising how people phrase things. **Some phrasings will be
missed**, particularly colloquial ones. For example, *"what would my premium be"* is
recognised; *"what's the damage gonna be each month"* is not.

What happens when a phrasing is missed is bounded by §4, and this is the part worth
understanding:

> A missed phrasing does **not** mean the automation answers the question. It means the
> automation replies with **a scheduling invitation instead of waiting for Markist.** The
> message that goes out still contains no figure, no product, no policy fact and no advice —
> because §4 permits only the four contentless shapes.

So the failure mode of a missed keyword is *"the client is invited to book a call"*, not
*"the client is given advice."* The subject list reduces how often a client gets an automated
reply on a sensitive topic; the four-shape limit is what makes any automated reply safe.

The situations where the subject list is doing real work are the ones where a scheduling
invitation is itself the wrong response: a bereavement, a hardship, a complaint, or a message
containing a Social Security number. Those families exist precisely for that, and they route to
silence plus an urgent escalation rather than to an automated reply.

This limitation is tested and pinned, so a change in either direction is a deliberate decision
rather than drift.

---

## 7. The decision this needs — and it is a fork

**The question.** Is a scheduling invitation an acceptable automated response to a *sensitive
but unrecognised* question (§6), or should the automation stay silent unless the subject is
positively recognised as safe?

**The case for the current design (recognise-the-risk).** A scheduling invitation is
structurally contentless and routes the person to a licensed human — for an unrecognised
question that is close to the ideal answer. Silence has its own failure mode: it reads as
broken, and the client either texts again or gives up.

**The case for the alternative (recognise-the-safe).** It removes the residual in §6 entirely.
The cost is throughput, not compliance: most inbound would wait for Markist, and response
latency becomes his to absorb. **This is as much an operational decision as a compliance one,
and Markist should be in the conversation.**

**The category that neither option handled**, and which is why this was worth checking before
the review: bereavement, serious illness, hardship, and complaints. *"My husband passed away,
does our policy pay out?"* was, until this was fixed, answered with a scheduling invitation.
The risk there is not advice — it is an automated non-answer to a human moment, and for a
complaint potentially a state handling-requirement issue. That family now exists (§3) and
routes to silence plus an urgent escalation **regardless of how the broader fork is decided.**

### Other questions

1. Are the thirteen subjects in §3 the right set, and is anything missing that should never get
   an automated reply?
2. Is the bereavement/hardship family drawn widely enough? It currently covers death, funerals,
   hospice and terminal or serious illness, plus job loss, affordability, arrears and divorce.
3. Should the four permitted shapes in §4 be narrower — for example, dropping the thank-you
   and acknowledgment shapes and permitting only scheduling?
4. Should any of this differ by channel (SMS vs email)?
5. Are the operational limits set correctly? They are unverified config defaults — see
   `docs/compliance/config-defaults-to-verify.md`.

---

## 8. Where this lives

- Rule implementation: `src/lib/comms/reply-classification.ts`
- Tests pinning every statement above: `tests/comms-reply-classification.test.mjs`
- End-to-end proof against a real database: `tests/comms-inbound-e2e.test.mjs` §1, §1b
- Governing decisions: CLAUDE.md §4.1 (securities firewall), §4.2 (AI green-zone / red-line),
  ADR-019 (AI authority matrix and communication evaluations)
