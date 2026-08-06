-- ─────────────────────────────────────────────────────────
-- Migration: 100_cross_sell_life_messaging_v2
--
-- Replaces ALL customer-facing Cross-Sell Life copy (ADR-032) with a rebuilt
-- lifecycle-marketing message set. Migration 086 (applied) is NOT modified — this
-- migration UPDATEs the same comm_templates rows IN PLACE (the repo's versioning
-- idiom: bump `version`, reset approval on any body change). Template IDs are
-- preserved, so xsell_life_campaign_touches keeps resolving the same rows and the
-- 35-touch / 180-day schedule and automation are untouched.
--
-- Every row lands at version 2 / approval_status='draft' with prior approval
-- cleared. sendThroughGate() refuses an unapproved template, so nothing dispatches
-- until a compliance reviewer approves it. Nothing here approves or activates.
--
-- AUDIENCE NOTE (drives the whole tone): these are EXISTING agency clients who hold
-- non-life policies and have no active life coverage. They are not in-market, they
-- did not ask for this, and the agency relationship is the most valuable asset in
-- the exchange. The copy therefore earns attention slowly: it leads with who the
-- FSA is and why they are writing on the agency's behalf, gives value before asking
-- for anything, and keeps every CTA optional. Several touches make no ask at all.
--
-- COPY CONTRACT: identical to migration 099 — email bodies follow the
-- wrapMarketingEmailBody vocabulary (Subject:/Preview:/"* " bullets/one
-- "Label {{scheduling_link}}" CTA/one closer); SMS bodies carry NO opt-out text
-- because dispatcher.ts appends TRAIGA_SMS_FOOTER to every SMS; merge tokens are
-- restricted to the six proven-resolvable tokens.
--
-- GUARDRAILS: green-zone only. No product, carrier, coverage-amount, premium, or
-- replacement recommendation; no suitability determination; no invented Farmers/FNWL
-- data, rate, or statistic; and — critically for this audience — no claim about what
-- the recipient does or does not already own (ADR-020 data confidence). Verified by
-- tests/lifecycle-campaign-messaging.test.mjs.
--
-- Idempotent; transaction-safe; no explicit BEGIN/COMMIT.
-- ─────────────────────────────────────────────────────────

-- ── Emails (12) — touches 1, 4, 7, 10, 12, 15, 19, 21, 24, 27, 30, 33 ───────
update comm_templates set
  name = 'Cross-Sell Life — Email 1 — Why You Are Hearing From Me',
  body = $body$Subject: A quick introduction, and why I am writing
Preview: Not a sales pitch. Mostly just so you know who I am.

Hi {{first_name}},

I am {{fsa_name}}, and I work alongside your Farmers agent at {{agency_name}} on the life insurance and financial services side of things.

You have not heard from me before, so let me be upfront about why I am writing. Most people set up their auto and home coverage, get it right, and then never revisit the one thing those policies do not cover: the income that pays for all of it.

That is the part I help with. Not today, necessarily, and not with any urgency.

For now I would just like you to know I exist, and that if a question ever comes up about life insurance, you have someone to ask who already knows your agency.

If you would rather I not write again, reply with the word "stop writing" and I will take care of it personally. No hard feelings whatsoever.

Say Hello or Ask Me Anything {{scheduling_link}}

Warm regards, {{fsa_name}} {{agency_name}} {{advisor_phone}} {{advisor_email}}

This email is a general introduction and is not a recommendation regarding any product, coverage amount, or premium.$body$,
  approval_status = 'draft', version = 2, approved_at = null, approved_by = null,
  updated_by = 'messaging-v2', updated_at = now()
where id = 'e5c00000-0000-4000-8000-000000000001';

update comm_templates set
  name = 'Cross-Sell Life — Email 2 — You Insure What You Own',
  body = $body$Subject: You insure the house. What about the person paying for it?
Preview: One idea, and then I will leave you alone for a couple of weeks.

Hi {{first_name}},

Here is the single idea I would want anyone to take from me, and then I will leave you alone for a while.

You already insure the things you own. The car, in case it is wrecked. The house, in case it burns. Those were sensible decisions and you made them without much fuss.

Life insurance covers the other half of that equation: the person whose income pays the mortgage, the premiums, the groceries, and everything else. It is the same instinct you have already acted on, pointed at a different risk.

That is genuinely the whole concept. Everything else is detail.

If it prompts a question, reply and ask it. I answer these myself, and I will not turn a question into a sales process.

Ask Me One Question {{scheduling_link}}

Warm regards, {{fsa_name}} {{agency_name}}

This email is educational and is not a recommendation regarding any specific policy, coverage amount, or premium.$body$,
  approval_status = 'draft', version = 2, approved_at = null, approved_by = null,
  updated_by = 'messaging-v2', updated_at = now()
where id = 'e5c00000-0000-4000-8000-000000000002';

update comm_templates set
  name = 'Cross-Sell Life — Email 3 — When It Actually Becomes Relevant',
  body = $body$Subject: When this actually starts to matter
Preview: For most people it is one of about six moments.

Hi {{first_name}},

Life insurance is not urgent for most people most of the time. It becomes relevant at specific moments, and they are fairly predictable:

* Someone starts depending on your income
* You take on a mortgage
* You have a child, or one arrives unexpectedly soon
* You start or buy into a business
* You pay off enough debt that you finally have something to protect
* You start mapping out retirement in real numbers

If none of those describe your last couple of years, you can file this away with a clear conscience.

If one of them does, that is usually the moment a twenty-minute conversation earns its keep. Reply and tell me which one, and I will tell you honestly whether it is worth your time.

Tell Me Which One {{scheduling_link}}

Warm regards, {{fsa_name}} {{agency_name}}

This message is provided for general educational purposes. Any personalized discussion requires an individual review.$body$,
  approval_status = 'draft', version = 2, approved_at = null, approved_by = null,
  updated_by = 'messaging-v2', updated_at = now()
where id = 'e5c00000-0000-4000-8000-000000000003';

update comm_templates set
  name = 'Cross-Sell Life — Email 4 — What People Assume',
  body = $body$Subject: Four assumptions worth checking
Preview: Most people never look into this because of one of these.

Hi {{first_name}},

Most people never look into life insurance because of one of four assumptions. They are all reasonable, and all worth checking.

* "It is expensive." Cost varies with the type of coverage, the amount, your age, your health, and underwriting. There is no universal price, which is why a blanket assumption in either direction tends to be wrong.
* "I am covered at work." Often true, and worth having. It is usually tied to the job and may not follow you when you leave.
* "I am too young for this." Age affects a lot of things here, and rarely in the direction people expect.
* "I would not qualify." Maybe. That is a question with an actual answer rather than a guess, and finding out costs nothing.

None of that is a nudge to do anything. It is just the four things I would want checked before someone decided this was not for them.

Reply with the one that sounds most like you and I will give you a straight answer.

Check One Assumption {{scheduling_link}}

Warm regards, {{fsa_name}} {{agency_name}}

This email is for general informational purposes only and is not a recommendation regarding any product, coverage amount, or premium.$body$,
  approval_status = 'draft', version = 2, approved_at = null, approved_by = null,
  updated_by = 'messaging-v2', updated_at = now()
where id = 'e5c00000-0000-4000-8000-000000000004';

update comm_templates set
  name = 'Cross-Sell Life — Email 5 — What It Is Actually For',
  body = $body$Subject: What this money is actually for
Preview: It is rarely about funerals, whatever the ads suggest.

Hi {{first_name}},

The advertising for this industry has convinced a lot of people that life insurance is about funeral costs. That is the smallest part of it.

In practice, households use it to keep specific things from falling apart:

* An income that stops arriving
* A mortgage that still wants paying every month
* Debts that do not disappear with the person
* Children who were going to go to school somewhere particular
* A business that suddenly has one owner instead of two
* A surviving partner who should be allowed to grieve rather than immediately restructure their whole life

Which of those matter, and how much, is entirely individual. That is exactly why I cannot tell you anything useful in an email, and would not try.

What I can do is sit down for twenty minutes and help you work out which of them apply to you.

Book a Protection Review {{scheduling_link}}

Warm regards, {{fsa_name}} {{agency_name}}

This communication does not recommend a specific product or coverage amount. Any recommendation would require a personal needs analysis.$body$,
  approval_status = 'draft', version = 2, approved_at = null, approved_by = null,
  updated_by = 'messaging-v2', updated_at = now()
where id = 'e5c00000-0000-4000-8000-000000000005';

update comm_templates set
  name = 'Cross-Sell Life — Email 6 — Coverage Through Work',
  body = $body$Subject: Six questions about your coverage at work
Preview: You can answer these from your benefits portal in about five minutes.

Hi {{first_name}},

If you have life insurance through an employer, that is a real benefit and I am not going to talk you out of it.

I would only suggest knowing the answers to six questions, all of which you can usually find in your benefits portal in about five minutes:

* How much is it, expressed as a multiple of salary or a flat amount
* Does it stay with you if you change jobs
* Does it continue into retirement, and at what level
* Does it reduce at a certain age
* Is any part of it individually owned rather than employer owned
* Would the amount cover the obligations your household actually has

I am not asking you to do anything with the answers. I would just rather you knew them than assumed them.

If you look and are not sure what you are reading, forward it to me and I will translate it. No charge and no follow-up sales call.

Have Me Translate Your Benefits Page {{scheduling_link}}

Warm regards, {{fsa_name}} {{agency_name}}

This email is educational and is not a recommendation to replace, reduce, or purchase any particular coverage.$body$,
  approval_status = 'draft', version = 2, approved_at = null, approved_by = null,
  updated_by = 'messaging-v2', updated_at = now()
where id = 'e5c00000-0000-4000-8000-000000000006';

update comm_templates set
  name = 'Cross-Sell Life — Email 7 — How People Land on an Amount',
  body = $body$Subject: How people land on a number
Preview: There is no universal answer, but the method is not complicated.

Hi {{first_name}},

"How much would I even need?" is the question I get most, and there is no universal answer. Anyone who gives you one without asking about your life is guessing.

The method itself is not complicated. People generally add up what would still need paying:

* Income, and for how many years it would need replacing
* The mortgage and any other housing obligation
* Consumer debt that would not disappear
* Final expenses, which arrive regardless
* Education, if that is part of the plan for someone
* Anything a business partner would be left holding

Then they subtract what already exists: savings, assets, and any coverage already in place.

The gap, if there is one, is the conversation. Sometimes there is not one, and that is a perfectly good afternoon's work.

Walk Through It With Me {{scheduling_link}}

Warm regards, {{fsa_name}} {{agency_name}}

This information is general and educational. Any specific coverage recommendation would require a review of your individual circumstances.$body$,
  approval_status = 'draft', version = 2, approved_at = null, approved_by = null,
  updated_by = 'messaging-v2', updated_at = now()
where id = 'e5c00000-0000-4000-8000-000000000007';

update comm_templates set
  name = 'Cross-Sell Life — Email 8 — Why It Gets Postponed',
  body = $body$Subject: Why this gets postponed forever
Preview: Nothing forces the issue, which is exactly the problem.

Hi {{first_name}},

Almost everyone intends to look into this eventually. Very few people do, and the reasons are always the same:

* Life is busy and nothing is on fire
* The subject seems more complicated than it is
* It is unclear what to even ask
* There is a vague worry about cost
* Nothing forces the issue

That last one is the real culprit. Every other financial decision has a deadline attached. This one has none, so it loses to whatever does.

I am not going to manufacture urgency, because there is not any. I will only point out that a conversation costs twenty minutes and settles the question either way, and that "no, you are fine as you are" is an outcome I deliver fairly often.

Twenty Minutes, No Decisions {{scheduling_link}}

Warm regards, {{fsa_name}} {{agency_name}}

This communication is not a recommendation to purchase any specific product.$body$,
  approval_status = 'draft', version = 2, approved_at = null, approved_by = null,
  updated_by = 'messaging-v2', updated_at = now()
where id = 'e5c00000-0000-4000-8000-000000000008';

update comm_templates set
  name = 'Cross-Sell Life — Email 9 — The Protection Review',
  body = $body$Subject: What a protection review actually involves
Preview: Twenty minutes, no cost, and no obligation to do anything afterwards.

Hi {{first_name}},

I have mentioned a protection review a few times without ever spelling out what it is, which is not very useful of me.

It is one conversation, usually twenty minutes, in which we:

* Talk about who depends on you and for what
* List the obligations that would outlive you
* Note what you already have, including anything through work
* Identify whether there is a gap between those two things
* Decide together whether anything is worth doing

That is the whole thing. There is no cost, and no obligation to act on any of it.

I want to be clear about the last point, because as an existing client of {{agency_name}} you should never feel that a conversation with me carries an expectation. It does not. Plenty of these end with me saying you are in good shape.

Book Your Protection Review {{scheduling_link}}

If you would rather begin with a single question by email, just reply here.

Sincerely, {{fsa_name}} {{agency_name}} {{advisor_phone}} {{advisor_email}}

Any recommendation would be made only after reviewing your individual needs, objectives, and circumstances.$body$,
  approval_status = 'draft', version = 2, approved_at = null, approved_by = null,
  updated_by = 'messaging-v2', updated_at = now()
where id = 'e5c00000-0000-4000-8000-000000000009';

update comm_templates set
  name = 'Cross-Sell Life — Email 10 — Priorities Before Products',
  body = $body$Subject: Start with your priorities, not a product
Preview: Any conversation that opens with a product is the wrong conversation.

Hi {{first_name}},

If someone opens a life insurance conversation by telling you about a product, you are in the wrong conversation. I mean that seriously.

A useful version starts with questions that have nothing to do with insurance:

* Who would feel it financially if your income stopped
* What would still need paying every month
* How long would they need support before finding their feet
* What already exists to draw on
* What could you comfortably set aside each month without resenting it
* What matters enough that you would want it protected on purpose

Only once those have honest answers does it make any sense to discuss what, if anything, fits.

I work in that order every time. If that sounds like a conversation worth having, the calendar is open.

Start With the Questions {{scheduling_link}}

Warm regards, {{fsa_name}} {{agency_name}}

This email is educational. It does not recommend any particular carrier, product, coverage amount, or premium.$body$,
  approval_status = 'draft', version = 2, approved_at = null, approved_by = null,
  updated_by = 'messaging-v2', updated_at = now()
where id = 'e5c00000-0000-4000-8000-000000000010';

update comm_templates set
  name = 'Cross-Sell Life — Email 11 — No Pressure Either Way',
  body = $body$Subject: Still here, still no pressure
Preview: A standing offer rather than a follow-up.

Hi {{first_name}},

I have written a few times now, and you have not needed anything. That is completely fine, and it is genuinely the most common outcome.

I would rather you read these and ignore them than feel chased by your own insurance agency. That is not the relationship anyone wants.

So consider this a standing offer rather than a follow-up. Nothing expires. If a year from now something shifts, you can reply to any of these emails and I will pick it up as though we spoke yesterday.

And if you would prefer I stop writing, tell me and I will handle it myself. It will not affect anything else about your relationship with {{agency_name}}.

Whenever You Are Ready {{scheduling_link}}

Warm regards, {{fsa_name}} {{agency_name}}

This communication is informational and does not constitute a recommendation.$body$,
  approval_status = 'draft', version = 2, approved_at = null, approved_by = null,
  updated_by = 'messaging-v2', updated_at = now()
where id = 'e5c00000-0000-4000-8000-000000000011';

update comm_templates set
  name = 'Cross-Sell Life — Email 12 — Final Note',
  body = $body$Subject: Last one from me
Preview: Closing this out, with thanks.

Hi {{first_name}},

This is the last email in this series.

Thank you for reading any of them. I know unsolicited email about life insurance is not the highlight of anyone's week, and I have tried to make these worth the thirty seconds.

If nothing here applied to you, that is a good outcome. It means the people who depend on you are already covered by decisions you made before I turned up.

If something did land but the timing was wrong, my details are below and they do not expire. Reply any time, this year or in five, and we will pick it up from there.

Thank you for being a client of {{agency_name}}. That part matters more than anything I have written here.

Reach Me Any Time {{scheduling_link}}

Warm regards, {{fsa_name}} {{agency_name}} {{advisor_phone}} {{advisor_email}}

This email concludes the current marketing outreach. Future communications will follow your recorded communication preferences and applicable consent. You may unsubscribe from marketing email using the link below.$body$,
  approval_status = 'draft', version = 2, approved_at = null, approved_by = null,
  updated_by = 'messaging-v2', updated_at = now()
where id = 'e5c00000-0000-4000-8000-000000000012';

-- ── SMS (12) — touches 2, 5, 8, 11, 14, 17, 20, 22, 25, 28, 31, 34 ──────────
--    No opt-out text: dispatcher.ts appends TRAIGA_SMS_FOOTER to every SMS.
update comm_templates set
  name = 'Cross-Sell Life — SMS 1 — Introduction',
  body = $body$Hi {{first_name}}, this is {{fsa_name}}. I handle life insurance and financial services alongside your Farmers agent at {{agency_name}}. No pitch today, just so you know who I am if a question ever comes up.$body$,
  approval_status = 'draft', version = 2, approved_at = null, approved_by = null,
  updated_by = 'messaging-v2', updated_at = now()
where id = 'd5c00000-0000-4000-8000-000000000001';

update comm_templates set
  name = 'Cross-Sell Life — SMS 2 — The Core Idea',
  body = $body$Hi {{first_name}}, one idea and then I'll leave it: you already insure the car and the house. Life insurance covers the person whose income pays for both. Same instinct, different risk. Questions welcome any time.$body$,
  approval_status = 'draft', version = 2, approved_at = null, approved_by = null,
  updated_by = 'messaging-v2', updated_at = now()
where id = 'd5c00000-0000-4000-8000-000000000002';

update comm_templates set
  name = 'Cross-Sell Life — SMS 3 — When It Matters',
  body = $body$Hi {{first_name}}, this usually only matters after a specific moment: a mortgage, a baby, a business, or someone new depending on your income. If one of those happened recently, reply and I'll tell you if it's worth 20 minutes.$body$,
  approval_status = 'draft', version = 2, approved_at = null, approved_by = null,
  updated_by = 'messaging-v2', updated_at = now()
where id = 'd5c00000-0000-4000-8000-000000000003';

update comm_templates set
  name = 'Cross-Sell Life — SMS 4 — The Cost Assumption',
  body = $body$Hi {{first_name}}, most people skip this because they assume the cost. It varies with the type and amount of coverage, your age, and health, so assumptions in either direction tend to be wrong. Happy to explain how it works.$body$,
  approval_status = 'draft', version = 2, approved_at = null, approved_by = null,
  updated_by = 'messaging-v2', updated_at = now()
where id = 'd5c00000-0000-4000-8000-000000000004';

update comm_templates set
  name = 'Cross-Sell Life — SMS 5 — What It Is For',
  body = $body$Hi {{first_name}}, life insurance is rarely about funeral costs. It's mostly about a mortgage that still wants paying and an income that stopped. Which of those would apply to your household? Reply any time.$body$,
  approval_status = 'draft', version = 2, approved_at = null, approved_by = null,
  updated_by = 'messaging-v2', updated_at = now()
where id = 'd5c00000-0000-4000-8000-000000000005';

update comm_templates set
  name = 'Cross-Sell Life — SMS 6 — Coverage At Work',
  body = $body$Hi {{first_name}}, quick one: do you know whether your life coverage at work would follow you if you changed jobs? Most people don't, and it's a five-minute check. Happy to talk you through what to look for.$body$,
  approval_status = 'draft', version = 2, approved_at = null, approved_by = null,
  updated_by = 'messaging-v2', updated_at = now()
where id = 'd5c00000-0000-4000-8000-000000000006';

update comm_templates set
  name = 'Cross-Sell Life — SMS 7 — Open Question',
  body = $body$Hi {{first_name}}, is there anything about life insurance you've quietly wondered about but never asked? Reply with it and I'll give you a straight answer. No meeting, no follow-up call.$body$,
  approval_status = 'draft', version = 2, approved_at = null, approved_by = null,
  updated_by = 'messaging-v2', updated_at = now()
where id = 'd5c00000-0000-4000-8000-000000000007';

update comm_templates set
  name = 'Cross-Sell Life — SMS 8 — No Decision Required',
  body = $body$Hi {{first_name}}, worth saying plainly: you don't have to decide anything in a protection review. Quite a few end with me saying you're already in good shape. Reply REVIEW if you'd like to book one.$body$,
  approval_status = 'draft', version = 2, approved_at = null, approved_by = null,
  updated_by = 'messaging-v2', updated_at = now()
where id = 'd5c00000-0000-4000-8000-000000000008';

update comm_templates set
  name = 'Cross-Sell Life — SMS 9 — Book a Review',
  body = $body$Hi {{first_name}}, {{fsa_name}} here. If a 20-minute protection review would be useful, you can pick a time that suits you here: {{scheduling_link}}$body$,
  approval_status = 'draft', version = 2, approved_at = null, approved_by = null,
  updated_by = 'messaging-v2', updated_at = now()
where id = 'd5c00000-0000-4000-8000-000000000009';

update comm_templates set
  name = 'Cross-Sell Life — SMS 10 — How You Prefer to Hear From Me',
  body = $body$Hi {{first_name}}, would you rather have general information by email, a short call, or nothing further for now? Reply INFO, CALL, or LATER and I'll set my follow-up to match.$body$,
  approval_status = 'draft', version = 2, approved_at = null, approved_by = null,
  updated_by = 'messaging-v2', updated_at = now()
where id = 'd5c00000-0000-4000-8000-000000000010';

update comm_templates set
  name = 'Cross-Sell Life — SMS 11 — Checking Preferences',
  body = $body$Hi {{first_name}}, checking in properly: is life insurance something you'd like to look at this year, or should I leave it? A yes, a no, or a "not now" all help me get this right.$body$,
  approval_status = 'draft', version = 2, approved_at = null, approved_by = null,
  updated_by = 'messaging-v2', updated_at = now()
where id = 'd5c00000-0000-4000-8000-000000000011';

update comm_templates set
  name = 'Cross-Sell Life — SMS 12 — Final Message',
  body = $body$Hi {{first_name}}, last message in this series. Thank you for being a client of {{agency_name}}. If a life insurance question ever comes up, reply here and I'll pick it straight up. All the best.$body$,
  approval_status = 'draft', version = 2, approved_at = null, approved_by = null,
  updated_by = 'messaging-v2', updated_at = now()
where id = 'd5c00000-0000-4000-8000-000000000012';

-- ── AI conversation openers (7) — touches 3, 9, 13, 18, 23, 29, 35 ──────────
--    Every opener self-identifies as an automated assistant (§4.2 / TRAIGA).
--    Bodies mirror PLAYBOOKS[].opening in src/lib/cross-sell-life/playbooks.ts.
update comm_templates set
  name = 'Cross-Sell Life — AI 1 — Existing Client Welcome',
  body = $body$Hi {{first_name}}, I'm the automated assistant for {{fsa_name}} at {{agency_name}}. As an existing client you're offered a complimentary life insurance review. Would a question, a booking, or general info help most?$body$,
  approval_status = 'draft', version = 2, approved_at = null, approved_by = null,
  updated_by = 'messaging-v2', updated_at = now()
where id = 'c5c00000-0000-4000-8000-000000000001';

update comm_templates set
  name = 'Cross-Sell Life — AI 2 — Life-Change Discovery',
  body = $body$Hi {{first_name}}, {{fsa_name}}'s automated assistant here. Has anything changed for you lately, such as a home purchase, a new child, a job move, or starting a business? Those are usually what make this worth a look.$body$,
  approval_status = 'draft', version = 2, approved_at = null, approved_by = null,
  updated_by = 'messaging-v2', updated_at = now()
where id = 'c5c00000-0000-4000-8000-000000000002';

update comm_templates set
  name = 'Cross-Sell Life — AI 3 — Priority Discovery',
  body = $body$Hi {{first_name}}, this is {{fsa_name}}'s automated assistant. If you were to look at this at all, what would you most want protected: your income, the mortgage, your children, or something else entirely?$body$,
  approval_status = 'draft', version = 2, approved_at = null, approved_by = null,
  updated_by = 'messaging-v2', updated_at = now()
where id = 'c5c00000-0000-4000-8000-000000000003';

update comm_templates set
  name = 'Cross-Sell Life — AI 4 — Existing Coverage Check',
  body = $body$Hi {{first_name}}, {{fsa_name}}'s automated assistant here. Do you currently have any life coverage through work, a policy of your own, both, or are you not sure? No wrong answer, it just tells us where to start.$body$,
  approval_status = 'draft', version = 2, approved_at = null, approved_by = null,
  updated_by = 'messaging-v2', updated_at = now()
where id = 'c5c00000-0000-4000-8000-000000000004';

update comm_templates set
  name = 'Cross-Sell Life — AI 5 — Objection Handling',
  body = $body$Hi {{first_name}}, this is {{fsa_name}}'s automated assistant. If you've been leaving this one alone, there's usually a specific reason. Is there something particular I can help clear up?$body$,
  approval_status = 'draft', version = 2, approved_at = null, approved_by = null,
  updated_by = 'messaging-v2', updated_at = now()
where id = 'c5c00000-0000-4000-8000-000000000005';

update comm_templates set
  name = 'Cross-Sell Life — AI 6 — Scheduling and Next Steps',
  body = $body$Hi {{first_name}}, {{fsa_name}}'s automated assistant here. I can set up a complimentary protection review whenever suits you. Would you prefer a phone call, a video meeting, or to meet in person?$body$,
  approval_status = 'draft', version = 2, approved_at = null, approved_by = null,
  updated_by = 'messaging-v2', updated_at = now()
where id = 'c5c00000-0000-4000-8000-000000000006';

update comm_templates set
  name = 'Cross-Sell Life — AI 7 — Respectful Close',
  body = $body$Hi {{first_name}}, {{fsa_name}}'s automated assistant one last time. Would you like to book a review, have us check back later, or close this out for now? Any of the three is completely fine.$body$,
  approval_status = 'draft', version = 2, approved_at = null, approved_by = null,
  updated_by = 'messaging-v2', updated_at = now()
where id = 'c5c00000-0000-4000-8000-000000000007';

-- ── ROLLBACK (manual) ───────────────────────────────────────────────────────
--   Re-apply 086_cross_sell_life_seed.sql bodies and set version = 1 for the
--   template IDs above (all remain approval_status='draft' either way).
