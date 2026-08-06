# Operational limits awaiting Markist's real numbers

**Audience:** Markist (the FSA). Three decisions, best answered as a set.
**Status:** all three are shipped as **config defaults**, flagged `is_assumption = true` in the
database, and render with the gold *"config default — verify"* badge. **None is a Farmers, FFS,
or carrier figure.** They are placeholders chosen to be safe, not correct.
**Last updated:** 2026-08-06

These govern the two-way conversation feature (a client texts in, the automation may reply).
Nothing here is active in production yet.

---

## Answer this one first

### 1. Hours of operation — what are the agency's actual hours?

| | |
|---|---|
| **Where** | `comm_hours_policy`, row `global` |
| **Shipped default** | **09:00–19:00, Monday–Saturday, US Central** |
| **Source** | Migration 035, explicitly noted as *"Config default — verify your real hours of operation."* |

**Why this one goes first:** a separate decision — whether a live conversation should be able
to reply outside these hours — depends on it. Measured against the shipped default, the window
where a client is inside the legal contact hours but outside the agency's hours is:

- **19:00–20:00, Monday–Saturday** — 6 hours/week
- **09:00–20:00, all day Sunday** — 11 hours/week

≈17 hours a week in which a client who texts gets no automated reply. **But some of that may be
fictional**, because 9–19 Mon–Sat is a guess. It is not worth deciding how to close a gap
before knowing whether the gap is real.

**What is not on the table:** the legal floor of 09:00–20:00 in the *recipient's* local time
applies on top of whatever you choose, always. Hours of operation can only narrow that window,
never widen it.

**The question:** what hours does the agency actually work, and on which days?

---

## Then these two

### 2. Reply frequency cap — how many AI replies to one person per day?

| | |
|---|---|
| **Where** | `comm_frequency_policy`, row `reply` |
| **Shipped default** | **10 per day, 40 per 7 days**, no minimum spacing |
| **Source** | Migration 102 (ADR-017 amendment) |

This bounds **volume**: how many automated replies one contact can receive. It is separate from
the outreach caps (row `global`: 2 SMS/day, 60-minute spacing), which continue to govern
campaign and drip messages and are unchanged.

There is no minimum spacing on replies, deliberately — a spacing rule stalls a normal
back-and-forth after a single turn. The per-day maximum is the real bound.

*Engineering view, for discussion:* 10/day looks reasonable. A genuine two-way exchange can
approach it without anything being wrong.

**The question:** is 10 per day the right ceiling for automated replies to one person?

---

### 3. AI turn limit — how long may the automation talk before you take over?

| | |
|---|---|
| **Where** | `comm_conversation_policy`, row `global` (a per-campaign row can override it) |
| **Shipped default** | **6 consecutive AI replies**, counted since your last reply |
| **Source** | Migration 103 |

This bounds **depth**: how far a conversation can go without a licensed person. Reaching the
limit hands the thread to you — automatic replies are switched off for that thread, it appears
in your queue with the reason, and the client is not left in an automated loop. **Replying once
yourself resets the budget**, because you have taken and returned control.

*Engineering view, for discussion:* **6 is arguably too high, and 3 or 4 is worth considering.**
Six AI turns since your last reply is a long unsupervised conversation about life insurance.
The cost of handing off early is small — you pick it up. The cost of handing off late is a
transcript nobody licensed ever saw.

**The question:** how many automated replies in a row are you comfortable with before it comes
to you — 3, 4, or 6?

---

## Changing them

All three are database rows, editable without a code change or a deploy. Every value carries
`is_assumption`; once you have set a real number, that flag should be cleared for the values
you have confirmed so the *"verify"* badge stops appearing on settled configuration.

## Related

- `docs/compliance/ai-reply-classification.md` — what the automation is allowed to say at all,
  and the open compliance fork
- ADR-017 (frequency caps and the reply-scoped amendment), ADR-019 (AI authority, reply
  classification, turn ceiling)
