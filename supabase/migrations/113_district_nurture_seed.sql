-- ─────────────────────────────────────────────────────────
-- Migration 113 — District Agent FS Nurture content seed ("The Second Conversation")
--
-- Seeds the full 12-module curriculum as DRAFT comm_templates (24 email + 12 SMS),
-- the campaign row, and the 40-touch blueprint (24 email + 12 sms + 4 advisor_outreach
-- live touchpoints). Every template lands approval_status='draft' — sendThroughGate()
-- refuses an unapproved template, so THIS MIGRATION ACTIVATES AND APPROVES NOTHING.
--
-- AUDIENCE: the Farmers district agent (agency owner), not the client. Copy identifies
-- {{fsa_name}} (Markist Athelus) as the licensed Financial Services specialist who works
-- ALONGSIDE the agent — never as the client's P&C agent.
--
-- COPY CONTRACT (email-shell.ts vocabulary, enforced by the send path):
--   • Leading "Subject:" line (rendered H1) + "Preview:" line (inbox preheader).
--   • "* " bullets; exactly ONE "Label {{scheduling_link}}" CTA (bulletproof button);
--     exactly ONE closer ("Warm regards," / "Sincerely,") → branded FSA signature.
--   • Trailing disclaimer superseded by the CAN-SPAM footer at render time.
--   • Merge tokens restricted to registry-resolvable, FSA-identity tokens (site.ts):
--     first_name (cosmetic), fsa_name, advisor_title, advisor_phone, advisor_email,
--     agency_name, scheduling_link. NO agent_of_record_* tokens (the recipient IS the
--     Farmers agent) and NO policy tokens.
--   • SMS carry NO opt-out text (dispatcher appends the TRAIGA/STOP footer); GSM-7 safe,
--     no em dash / curly quotes; ≤ ~300 chars authored.
--
-- EDUCATION BOUNDARY (agent-facing): every body teaches what a concept does, the need it
-- addresses, the client statement that signals an opportunity, the limits/costs/risks,
-- what the agent MAY say, what requires the licensed FSA, and how to introduce. NO body
-- trains an unlicensed agent to recommend securities, compare products, determine
-- suitability, recommend allocations/rollovers/replacements, or interpret illustrations.
-- Asserted recommendation-free by tests/district-nurture-messaging.test.mjs.
--
-- Idempotent (fixed UUIDs, on conflict do nothing / deterministic update). Tx-safe.
-- ─────────────────────────────────────────────────────────

-- ══ EMAILS (24) — two per module: A = concept/signal, B = what-you-say + hand-off ══

insert into comm_templates (id, name, channel, category, body, approval_status, version, introduces_sender) values

-- ── Module 1 — Financial foundations ────────────────────────────────────────
('d2e00000-0000-4000-8000-000000000001', 'Second Conversation — M1 Email A — The Second Conversation', 'email', 'district_nurture',
$body$Subject: The conversation your clients are quietly waiting for
Preview: You already have the trust. This is about knowing when a financial question is really being asked.

Hi {{first_name}},

It's {{fsa_name}}, the licensed Financial Services specialist who works alongside your agency. I am not your clients' P&C agent, and I am not here to touch what you do best. I am here for the other conversation.

Here is how I see our partnership: I will help you understand the financial issues your clients and your agency may face, recognize when a deeper conversation is appropriate, and provide the licensed Financial Services support needed to handle it correctly.

Over the next twelve months I will send you one short, practical idea at a time. No theory you cannot use on Monday. This first one is the foundation everything else rests on:

* Your clients already tell you when money is on their mind, usually sideways.
* "We are stretched thin this month." "I finally paid off the truck." "The baby is due in spring."
* Each of those is a financial-planning door, quietly opening.

You do not have to walk through it. You just have to notice it, and know who to call.

Learn How This Partnership Works {{scheduling_link}}

Warm regards, {{fsa_name}} {{advisor_title}} {{advisor_phone}} {{advisor_email}}

This message is educational and is intended for licensed agents. It is not financial, tax, or legal advice and is not a recommendation regarding any product.$body$,
'draft', 1, true),

('d2e00000-0000-4000-8000-000000000002', 'Second Conversation — M1 Email B — From a signal to an introduction', 'email', 'district_nurture',
$body$Subject: What to say when you hear a money signal
Preview: You do not need the answers. You need one good sentence and a name.

Hi {{first_name}},

Last time I said your clients tell you when money is on their mind. So what do you actually do with that?

You do not diagnose. You do not quote. You do not advise. You simply open the door and step aside:

* What you can say: "That is exactly the kind of thing my Financial Services partner helps people think through. Want me to connect you? No cost, no pressure."
* What needs me: anything specific, numeric, or product-related. Suitability, amounts, tax treatment, comparisons. That is my license, not yours.
* How to introduce: reply to me, or send them my scheduling link. I take it from there and keep you in the loop.

That is the whole move. Notice, name it, introduce. The trust stays yours; the licensing risk stays mine.

Send Me Your First Introduction {{scheduling_link}}

Warm regards, {{fsa_name}} {{advisor_title}} {{advisor_phone}} {{advisor_email}}

This message is educational and is intended for licensed agents. It is not a recommendation regarding any product or a suitability determination.$body$,
'draft', 1, false),

-- ── Module 2 — Managing money, reserves & debt ──────────────────────────────
('d2e00000-0000-4000-8000-000000000003', 'Second Conversation — M2 Email A — Reserves and debt', 'email', 'district_nurture',
$body$Subject: The two numbers that tell you a household is fragile
Preview: Emergency reserves and high-interest debt. Both show up in plain conversation.

Hi {{first_name}},

Most financial stress traces back to two things: too little set aside, and too much owed at a high rate. You will hear both without asking.

* A cash reserve is money a household can reach fast, usually a few months of expenses. The need it addresses: a surprise that would otherwise become debt.
* High-interest debt quietly undoes everything else. It is the leak under the boat.
* Client signals: "We had to put the deductible on a card." "We are just trying to catch up." "Every month is tight."

The limitation to respect: you are noticing a pattern, not prescribing a plan. What the reserve should be, or how to approach debt, is a licensed conversation.

Your job is the noticing. Mine is the plan.

See How I Frame a Reserve Conversation {{scheduling_link}}

Warm regards, {{fsa_name}} {{advisor_title}} {{advisor_phone}} {{advisor_email}}

This message is educational and is not a recommendation regarding any product, debt strategy, or financial plan.$body$,
'draft', 1, false),

('d2e00000-0000-4000-8000-000000000004', 'Second Conversation — M2 Email B — Handing off the money conversation', 'email', 'district_nurture',
$body$Subject: The gentlest way to hand off a money conversation
Preview: You are not prying. You are pointing to a resource they already trust you for.

Hi {{first_name}},

When a client tells you money is tight, the instinct is to sympathize and move on. Try one more step.

* What you can say: "You are not the only one juggling this. My Financial Services partner does a simple, no-cost review that helps people get their footing. Want an introduction?"
* What needs me: the actual reserve target, any debt approach, and anything about their accounts. All licensed, all mine.
* How to introduce: forward them my scheduling link or just reply with their name and I will reach out with care.

Nobody is embarrassed to be handed a helping hand by someone they trust. That is the quiet power of your position.

Introduce a Client for a Reserve Review {{scheduling_link}}

Warm regards, {{fsa_name}} {{advisor_title}} {{advisor_phone}} {{advisor_email}}

This message is educational and is not financial advice or a recommendation regarding any product.$body$,
'draft', 1, false),

-- ── Module 3 — Retirement planning for agency owners ────────────────────────
('d2e00000-0000-4000-8000-000000000005', 'Second Conversation — M3 Email A — Retirement, starting with you', 'email',
'district_nurture',
$body$Subject: Let's start retirement with your own business
Preview: Agency owners plan everyone's future but their own. This month, that includes you.

Hi {{first_name}},

Retirement planning is easiest to teach when you have done it yourself, so this month starts at home: your agency.

* As an owner, your retirement is not automatic. There is no employer plan unless you build one.
* General concepts worth knowing exist for self-employed owners, and the right structure depends entirely on your situation.
* The same is true for your clients who own businesses or work for themselves.

I am not going to tell you which vehicle to use in an email, and you should be wary of anyone who would. That is a personal, licensed conversation about your numbers.

But it starts with a simple question: when did you last look at your own plan?

Book a Confidential Owner Review {{scheduling_link}}

Warm regards, {{fsa_name}} {{advisor_title}} {{advisor_phone}} {{advisor_email}}

This message is educational and is not a recommendation regarding any retirement product, account, or strategy.$body$,
'draft', 1, false),

('d2e00000-0000-4000-8000-000000000006', 'Second Conversation — M3 Email B — Retirement signals in your book', 'email',
'district_nurture',
$body$Subject: Hearing "someday" in your client conversations
Preview: "Someday" is a retirement signal. Here is what to do with it.

Hi {{first_name}},

Your clients say "someday" a lot. Someday we will travel. Someday I will slow down. Someday is a planning word.

* Client signals: "I do not even know if I can retire." "I have an old 401k from a job I left." "I keep meaning to figure this out."
* What you can say: "Figuring that out is exactly what my Financial Services partner does. It is a no-cost conversation. Want me to connect you?"
* What needs me: anything about their accounts, rollovers, income, or products. Especially anything with the word "invest" in it. That is licensed work.

You do not carry the plan. You carry the introduction.

Refer a "Someday" Conversation {{scheduling_link}}

Warm regards, {{fsa_name}} {{advisor_title}} {{advisor_phone}} {{advisor_email}}

This message is educational and is not a recommendation regarding any product, account, or rollover.$body$,
'draft', 1, false),

-- ── Module 4 — Homeownership & household protection ─────────────────────────
('d2e00000-0000-4000-8000-000000000007', 'Second Conversation — M4 Email A — Protecting the home and the people in it', 'email',
'district_nurture',
$body$Subject: You insure the house. Who is protecting the mortgage?
Preview: The home is covered. The income that pays for it often is not.

Hi {{first_name}},

You already protect the structure. The conversation next door is about the paycheck that keeps the roof overhead.

* Homeownership creates a long obligation: the mortgage. If the earner is gone, the obligation is not.
* Life insurance is one common way households make sure a home stays a home. What kind and how much is a personal, licensed decision.
* Client signals: "We just bought." "We refinanced." "It would be a stretch on one income."

The limitation to keep: you connect the dots between the home and the household. You do not size or recommend coverage. That is mine.

A new mortgage is one of the clearest moments this conversation is welcome.

See the New-Homeowner Talking Points {{scheduling_link}}

Warm regards, {{fsa_name}} {{advisor_title}} {{advisor_phone}} {{advisor_email}}

This message is educational and is not a recommendation regarding any coverage type or amount.$body$,
'draft', 1, false),

('d2e00000-0000-4000-8000-000000000008', 'Second Conversation — M4 Email B — The refinance and closing handoff', 'email',
'district_nurture',
$body$Subject: A closing or a refi is an open door
Preview: The moment the mortgage changes is the moment the question fits.

Hi {{first_name}},

When a client buys or refinances, the numbers are already on their mind. That is the natural moment for a warm introduction.

* What you can say: "Now that the mortgage is set, a lot of folks like to make sure their family could keep the home no matter what. My Financial Services partner walks through that at no cost. Want an intro?"
* What needs me: coverage amounts, product type, health and pricing questions. All licensed, all mine.
* How to introduce: send my scheduling link, or reply with their name.

You are not selling. You are finishing the thought the mortgage already started.

Hand Off a New-Homeowner Review {{scheduling_link}}

Warm regards, {{fsa_name}} {{advisor_title}} {{advisor_phone}} {{advisor_email}}

This message is educational and is not a recommendation regarding any product, coverage amount, or premium.$body$,
'draft', 1, false),

-- ── Module 5 — Family protection & education funding ────────────────────────
('d2e00000-0000-4000-8000-000000000009', 'Second Conversation — M5 Email A — When the family grows', 'email',
'district_nurture',
$body$Subject: A new baby changes the math
Preview: Growing families are the most natural protection conversation there is.

Hi {{first_name}},

Nothing rearranges a household's priorities like a new child, and few people pause to update their financial picture when it happens.

* Family protection is about income continuity: if a parent is gone, does the plan for the kids survive?
* Education funding is a separate, general category with several approaches. Which one fits is a personal, licensed decision.
* Client signals: "We are expecting." "The kids start college in a few years." "I want them to have it easier than I did."

Your role is to hear the life event and open the door. The strategy, the accounts, and the amounts are mine.

Get the Growing-Family Script {{scheduling_link}}

Warm regards, {{fsa_name}} {{advisor_title}} {{advisor_phone}} {{advisor_email}}

This message is educational and is not a recommendation regarding any product or education-funding vehicle.$body$,
'draft', 1, false),

('d2e00000-0000-4000-8000-000000000010', 'Second Conversation — M5 Email B — Introducing the family review', 'email',
'district_nurture',
$body$Subject: How to introduce the family review
Preview: One sentence turns a life event into a conversation they will thank you for.

Hi {{first_name}},

A family milestone is a gift for our partnership, because the client is already thinking about the future. You just name the resource.

* What you can say: "Congratulations. When our family grew, we sat down and made sure everyone was covered. My Financial Services partner does that review for free. Want me to set it up?"
* What needs me: how much protection, what kind, and any education-funding plan. Licensed, and mine.
* How to introduce: reply with the family's name, or forward my scheduling link.

The best referrals are not sold. They are noticed at the right moment and handed off with care.

Introduce a Growing Family {{scheduling_link}}

Warm regards, {{fsa_name}} {{advisor_title}} {{advisor_phone}} {{advisor_email}}

This message is educational and is not a recommendation regarding any product or amount.$body$,
'draft', 1, false),

-- ── Module 6 — Financial Needs Analysis ─────────────────────────────────────
('d2e00000-0000-4000-8000-000000000011', 'Second Conversation — M6 Email A — What an FNA actually is', 'email',
'district_nurture',
$body$Subject: The one tool that ties all of this together
Preview: A Financial Needs Analysis is the honest math behind every good recommendation.

Hi {{first_name}},

Everything I have shared so far points to one thing: the Financial Needs Analysis, or FNA. It is the structured conversation that turns a worry into a number.

* An FNA looks at income to replace, debt that would remain, final expenses, education plans, and how long people would need support.
* It is arithmetic and honesty, not a sales pitch. It ends with clarity, and sometimes the clarity is "you are fine."
* Client signals: "I have no idea if we have enough." "How do people even decide this?"

Here is the important limit: only a licensed professional performs the analysis and makes any recommendation from it. You do not run the FNA. You open the door to one.

Watch How an FNA Works {{scheduling_link}}

Warm regards, {{fsa_name}} {{advisor_title}} {{advisor_phone}} {{advisor_email}}

This message is educational and is not itself a Financial Needs Analysis or a recommendation.$body$,
'draft', 1, false),

('d2e00000-0000-4000-8000-000000000012', 'Second Conversation — M6 Email B — Teeing up the FNA', 'email',
'district_nurture',
$body$Subject: How to tee up a Financial Needs Analysis
Preview: You do not run the numbers. You earn the appointment where I do.

Hi {{first_name}},

The FNA is the appointment worth aiming for, because it is where real value gets delivered. Your part is simply the invitation.

* What you can say: "There is a free, no-obligation review my Financial Services partner does. Twenty minutes, and you walk away actually knowing where you stand. Want me to book it?"
* What needs me: the entire analysis, every number, and any recommendation that follows. Licensed, and mine.
* How to introduce: send my scheduling link, or reply and I will reach out to book it.

An FNA introduction is the single most valuable thing you can hand me. It is where households get clarity and our partnership proves itself.

Book an FNA for a Client {{scheduling_link}}

Warm regards, {{fsa_name}} {{advisor_title}} {{advisor_phone}} {{advisor_email}}

This message is educational and is not a recommendation or a suitability determination.$body$,
'draft', 1, false),

-- ── Module 7 — Business-owner planning ──────────────────────────────────────
('d2e00000-0000-4000-8000-000000000013', 'Second Conversation — M7 Email A — Your business-owner clients', 'email',
'district_nurture',
$body$Subject: The clients who are also businesses
Preview: Business owners carry risks a personal policy never touches.

Hi {{first_name}},

You insure plenty of business owners. Behind each one are financial exposures that rarely come up until it is too late.

* Key-person risk: what happens to the business if the owner or a critical person is gone?
* Continuity and buy-sell: how does ownership transfer without a fire sale? These are general concepts with several structures.
* Client signals: "It would all fall apart without me." "My partner and I never put anything in writing."

The boundary to hold: you flag the exposure. The structure, the funding, and the recommendation are a licensed, often multi-professional conversation. That is where I bring the team in.

Get the Business-Owner Questions {{scheduling_link}}

Warm regards, {{fsa_name}} {{advisor_title}} {{advisor_phone}} {{advisor_email}}

This message is educational and is not legal, tax, or product advice.$body$,
'draft', 1, false),

('d2e00000-0000-4000-8000-000000000014', 'Second Conversation — M7 Email B — Introducing a business review', 'email',
'district_nurture',
$body$Subject: How to open the business-continuity door
Preview: Owners respect a peer who thinks ahead. That is you.

Hi {{first_name}},

Business owners are direct, so the introduction can be too.

* What you can say: "You have built something real. Have you protected what happens to it if something happens to you? My Financial Services partner does a no-cost continuity conversation. Worth twenty minutes?"
* What needs me: the plan, the funding, the ownership mechanics, and any recommendation. Licensed, and coordinated with their attorney and accountant when needed.
* How to introduce: reply with the business name, or send my scheduling link.

You are not the planner. You are the trusted peer who says the thing no one else did.

Introduce a Business Owner {{scheduling_link}}

Warm regards, {{fsa_name}} {{advisor_title}} {{advisor_phone}} {{advisor_email}}

This message is educational and is not a recommendation or a legal, tax, or product determination.$body$,
'draft', 1, false),

-- ── Module 8 — Term, Whole Life, IUL & VUL education ────────────────────────
('d2e00000-0000-4000-8000-000000000015', 'Second Conversation — M8 Email A — The life insurance family, in plain terms', 'email',
'district_nurture',
$body$Subject: Term, whole life, IUL, VUL, without the jargon
Preview: A quick map of what each generally does, so you recognize the conversation.

Hi {{first_name}},

You do not need to sell life insurance to be useful here. You need to recognize which conversation a client is edging toward. In the most general terms:

* Term covers a set period. People often use it for temporary needs like a mortgage or young children.
* Whole life is permanent and builds cash value over time, with more cost and more guarantees.
* IUL and VUL are more complex permanent products; VUL in particular involves securities and is strictly a licensed, registered conversation.

I am describing categories, not recommending one. Which product, if any, suits a person is a suitability decision only a licensed professional makes after a full review.

See When Each Conversation Fits {{scheduling_link}}

Warm regards, {{fsa_name}} {{advisor_title}} {{advisor_phone}} {{advisor_email}}

This message is general education about product categories. It is not a comparison, endorsement, or recommendation of any product.$body$,
'draft', 1, false),

('d2e00000-0000-4000-8000-000000000016', 'Second Conversation — M8 Email B — Which one? Not your call, and that is fine', 'email',
'district_nurture',
$body$Subject: "Which one should I get?" Here is your answer
Preview: The safest and most helpful answer is an introduction.

Hi {{first_name}},

Sooner or later a client asks you directly: "Which kind should I get?" The professional answer protects them and you.

* What you can say: "Honestly, that depends on your situation, and it is worth getting right. My Financial Services partner will walk you through it with no cost and no pressure. Let me connect you."
* What you should not do: pick a product, compare them, or estimate what they need. That is a suitability determination and a licensed act.
* Anything involving IUL or VUL: route to me every time. VUL is a registered, securities-related product.

"Let me connect you to someone who does this for a living" is always the right answer.

Route a Product Question to Me {{scheduling_link}}

Warm regards, {{fsa_name}} {{advisor_title}} {{advisor_phone}} {{advisor_email}}

This message is educational. It is not a recommendation, comparison, or suitability determination regarding any product.$body$,
'draft', 1, false),

-- ── Module 9 — Protection planning & LIAM ───────────────────────────────────
('d2e00000-0000-4000-8000-000000000017', 'Second Conversation — M9 Email A — Protection planning and LIAM', 'email',
'district_nurture',
$body$Subject: September is a built-in reason to ask
Preview: Life Insurance Awareness Month gives you natural permission to raise it.

Hi {{first_name}},

Protection planning is simply making sure a household can absorb a loss without losing everything else. And this month there is a calendar reason to bring it up: Life Insurance Awareness Month.

* A seasonal hook lowers the awkwardness. "September is Life Insurance Awareness Month, so I have been asking clients a simple question..."
* The general idea: most families are underinsured relative to what they would actually need, though the right number is always personal.
* Client signals: any life change, plus the simple admission "we have been meaning to look at this."

The limit is unchanged: the amount, the product, and the recommendation are mine. The seasonal nudge is yours to use.

Run a LIAM Referral Push With Me {{scheduling_link}}

Warm regards, {{fsa_name}} {{advisor_title}} {{advisor_phone}} {{advisor_email}}

This message is educational and is not a recommendation regarding any product or coverage amount.$body$,
'draft', 1, false),

('d2e00000-0000-4000-8000-000000000018', 'Second Conversation — M9 Email B — The awareness-month introduction', 'email',
'district_nurture',
$body$Subject: A simple script for the whole month
Preview: One question, asked all September, produces real introductions.

Hi {{first_name}},

You do not need a campaign. You need one question you are willing to ask this month.

* What you can say: "September is Life Insurance Awareness Month. Can I ask, if something happened to you tomorrow, would your family be okay financially? If you are not sure, my Financial Services partner reviews that for free."
* What needs me: everything after they say "I am not sure." The review, the numbers, the recommendation. Licensed, and mine.
* How to introduce: reply with the name, or send my scheduling link.

Ask it ten times this month. A few of those become the most important conversations those families have all year.

Send Me Your LIAM Introductions {{scheduling_link}}

Warm regards, {{fsa_name}} {{advisor_title}} {{advisor_phone}} {{advisor_email}}

This message is educational and is not a recommendation regarding any product.$body$,
'draft', 1, false),

-- ── Module 10 — Investments, IRAs, rollovers & money in motion ──────────────
('d2e00000-0000-4000-8000-000000000019', 'Second Conversation — M10 Email A — Money in motion (and the securities line)', 'email',
'district_nurture',
$body$Subject: When money is moving, do not touch it, refer it
Preview: This module has the firmest boundary of all. Please read it carefully.

Hi {{first_name}},

"Money in motion" means a moment when significant money changes hands or accounts: a job change, a rollover, an inheritance, a maturing account. These are enormous opportunities, and the strictest of all boundaries.

* Anything involving investments, IRAs, rollovers, or securities is a licensed, registered activity. Full stop.
* You should never advise on, compare, or recommend an investment or a rollover. Not casually, not "just my opinion."
* Client signals: "I am changing jobs and have a 401k to deal with." "My mom left me some money." "My CD is maturing and I do not know what to do."

The only correct action is to recognize the moment and hand it to me immediately. That protects the client, protects you, and keeps everyone on the right side of the line.

Refer a Money-in-Motion Moment {{scheduling_link}}

Warm regards, {{fsa_name}} {{advisor_title}} {{advisor_phone}} {{advisor_email}}

This message is educational. It is not investment advice or a recommendation regarding any security, account, or rollover.$body$,
'draft', 1, false),

('d2e00000-0000-4000-8000-000000000020', 'Second Conversation — M10 Email B — The immediate hand-off', 'email',
'district_nurture',
$body$Subject: The fastest referral you will ever make
Preview: For money in motion, speed and a clean hand-off matter most.

Hi {{first_name}},

When money is moving, timing is real. The clean move is fast and simple.

* What you can say: "That is important, and it is exactly what my Financial Services partner is licensed for. Let me connect you right now so nothing gets missed."
* What you must not do: suggest what to do with the money, name an option, or estimate anything. That is my licensed lane, entirely.
* How to introduce: reply immediately with the client's name and the situation, or send my scheduling link.

There is no gray area here, and that is a relief. You do not have to know the answer. You just have to make the call.

Connect a Client for a Rollover Conversation {{scheduling_link}}

Warm regards, {{fsa_name}} {{advisor_title}} {{advisor_phone}} {{advisor_email}}

This message is educational. It is not investment advice or a recommendation regarding any security or rollover.$body$,
'draft', 1, false),

-- ── Module 11 — Annuities & retirement-income planning ──────────────────────
('d2e00000-0000-4000-8000-000000000021', 'Second Conversation — M11 Email A — Turning savings into a paycheck', 'email',
'district_nurture',
$body$Subject: The fear behind every retirement question
Preview: "Will I run out of money?" is what retirement-income planning answers.

Hi {{first_name}},

Once someone stops working, the question changes from "how do I save?" to "how do I turn what I saved into a paycheck that lasts?" That is retirement-income planning.

* Annuities are one general category of tool some people use to create guaranteed income. They come with trade-offs, costs, and rules that must be understood.
* They are frequently misunderstood in both directions, which is exactly why they belong in a licensed conversation, never an email opinion.
* Client signals: "I am afraid of outliving my money." "I want something guaranteed." "I do not want to watch the market in retirement."

Your role: hear the fear of running out, and open the door. Whether an annuity or anything else fits is a suitability decision, and mine.

See How I Explain Income Planning {{scheduling_link}}

Warm regards, {{fsa_name}} {{advisor_title}} {{advisor_phone}} {{advisor_email}}

This message is educational and is not a recommendation regarding annuities or any income product.$body$,
'draft', 1, false),

('d2e00000-0000-4000-8000-000000000022', 'Second Conversation — M11 Email B — The income-conversation handoff', 'email',
'district_nurture',
$body$Subject: When a client wants "guaranteed," call me
Preview: The word "guaranteed" is a referral trigger, not a product to reach for.

Hi {{first_name}},

When retirement worry shows up, the temptation is to reassure with specifics. Resist it, and hand off instead.

* What you can say: "Making your savings last is a real skill, and my Financial Services partner does exactly this. It is a free conversation. Want me to introduce you?"
* What needs me: any product, any guarantee, any number, any comparison. Especially anything registered. Licensed, and mine.
* How to introduce: reply with the name, or send my scheduling link.

You are handing a worried person to someone whose whole job is to answer that worry responsibly. That is a good thing to be able to do.

Introduce a Retirement-Income Conversation {{scheduling_link}}

Warm regards, {{fsa_name}} {{advisor_title}} {{advisor_phone}} {{advisor_email}}

This message is educational and is not a recommendation regarding any product, guarantee, or strategy.$body$,
'draft', 1, false),

-- ── Module 12 — Education, legacy, beneficiaries & annual planning ───────────
('d2e00000-0000-4000-8000-000000000023', 'Second Conversation — M12 Email A — Beneficiaries and legacy', 'email',
'district_nurture',
$body$Subject: The five-minute check that prevents disasters
Preview: Beneficiary designations are the most-ignored, highest-stakes detail in any plan.

Hi {{first_name}},

We finish the year where careful planning either holds or falls apart: the paperwork nobody revisits.

* Beneficiary designations control who receives an account or policy, and they override a will. An outdated one sends money to an ex-spouse or a deceased relative.
* Legacy planning is the broader question of what someone leaves and how. It usually involves several professionals.
* Client signals: "I got divorced years ago." "I am not even sure who my beneficiary is." "I want to leave something for the grandkids."

What you can safely say: "It is worth checking those every few years." Beyond that reminder, the review and any changes are a licensed, sometimes legal, conversation.

Offer Clients a Beneficiary Check {{scheduling_link}}

Warm regards, {{fsa_name}} {{advisor_title}} {{advisor_phone}} {{advisor_email}}

This message is educational and is not legal, tax, or product advice.$body$,
'draft', 1, false),

('d2e00000-0000-4000-8000-000000000024', 'Second Conversation — M12 Email B — A standing partnership', 'email',
'district_nurture',
$body$Subject: Twelve months in: what we have built
Preview: The curriculum ends. The partnership does not.

Hi {{first_name}},

Over the past year we walked through the whole financial picture your clients live inside, and the one skill that ties it together: noticing the moment and making the introduction.

* You do not have to become a financial professional. You already are a trusted one.
* Every module came down to the same move: hear the signal, say one honest sentence, hand it to me.
* An annual review of each household is where these moments surface most reliably.

I would like this to be a standing relationship, not a campaign that ends. When you hear one of these signals, I am one message away, all year, every year.

Set Up an Annual Referral Rhythm {{scheduling_link}}

Warm regards, {{fsa_name}} {{advisor_title}} {{advisor_phone}} {{advisor_email}}

This message is educational and is not a recommendation regarding any product. Future communications follow your recorded preferences; you may unsubscribe using the link below.$body$,
'draft', 1, false)

on conflict (id) do nothing;

-- ══ SMS (12) — one per module. No opt-out text (dispatcher appends the footer). ══
insert into comm_templates (id, name, channel, category, body, approval_status, version, introduces_sender) values
('d3f00000-0000-4000-8000-000000000001', 'Second Conversation — M1 SMS — Notice the signal', 'sms', 'district_nurture',
$body$Hi {{first_name}}, it's {{fsa_name}}, your Financial Services partner. This year I'll send one quick idea a month to help you spot when a client needs a financial conversation. First one: when a client mentions money stress, that's a door. You notice it, I handle it. Sound good?$body$,
'draft', 1, true),
('d3f00000-0000-4000-8000-000000000002', 'Second Conversation — M2 SMS — Reserves and debt', 'sms', 'district_nurture',
$body$Hi {{first_name}}, {{fsa_name}} here. Two phrases to listen for this month: "every month is tight" and "we had to put it on a card." Both signal a reserve or debt conversation. You don't fix it, you just hand it to me. Want the intro script?$body$,
'draft', 1, false),
('d3f00000-0000-4000-8000-000000000003', 'Second Conversation — M3 SMS — Someday', 'sms', 'district_nurture',
$body$Hi {{first_name}}, quick one from {{fsa_name}}. When a client says "someday I'll retire" or "I have an old 401k," that's a retirement signal. Anything with "invest" in it is my licensed lane. Just connect us and I take it from there.$body$,
'draft', 1, false),
('d3f00000-0000-4000-8000-000000000004', 'Second Conversation — M4 SMS — New home', 'sms', 'district_nurture',
$body$Hi {{first_name}}, {{fsa_name}} here. A new mortgage or a refi is the perfect moment to ask if the family could keep the home on one income. I do that review free. Send me the client's name and I'll reach out gently.$body$,
'draft', 1, false),
('d3f00000-0000-4000-8000-000000000005', 'Second Conversation — M5 SMS — Growing family', 'sms', 'district_nurture',
$body$Hi {{first_name}}, {{fsa_name}} here. New baby, kids nearing college, "I want them to have it easier" - all family-protection signals. You just say congrats and offer an intro to a free review. Reply with a name anytime.$body$,
'draft', 1, false),
('d3f00000-0000-4000-8000-000000000006', 'Second Conversation — M6 SMS — The FNA', 'sms', 'district_nurture',
$body$Hi {{first_name}}, {{fsa_name}} here. The most valuable intro you can make is to a free Financial Needs Analysis: 20 minutes, and the client finally knows where they stand. You don't run the numbers, I do. Want me to book one?$body$,
'draft', 1, false),
('d3f00000-0000-4000-8000-000000000007', 'Second Conversation — M7 SMS — Business owners', 'sms', 'district_nurture',
$body$Hi {{first_name}}, {{fsa_name}} here. For your business-owner clients, listen for "it would all fall apart without me." That's a continuity signal. The plan is my licensed work; the introduction is yours. Send me a name?$body$,
'draft', 1, false),
('d3f00000-0000-4000-8000-000000000008', 'Second Conversation — M8 SMS — Which one', 'sms', 'district_nurture',
$body$Hi {{first_name}}, {{fsa_name}} here. When a client asks "which life policy should I get," the best answer is "let me connect you to someone who does this all day." Never pick or compare products yourself. Just route it to me.$body$,
'draft', 1, false),
('d3f00000-0000-4000-8000-000000000009', 'Second Conversation — M9 SMS — LIAM', 'sms', 'district_nurture',
$body$Hi {{first_name}}, {{fsa_name}} here. September is Life Insurance Awareness Month. One question all month: "If something happened to you, would your family be okay?" If they're unsure, I review it free. Send me those names.$body$,
'draft', 1, false),
('d3f00000-0000-4000-8000-000000000010', 'Second Conversation — M10 SMS — Money in motion', 'sms', 'district_nurture',
$body$Hi {{first_name}}, {{fsa_name}} here. Firmest rule of the year: job change, rollover, inheritance, maturing CD - never advise, just refer. Investments and IRAs are licensed work. Recognize the moment and connect us fast.$body$,
'draft', 1, false),
('d3f00000-0000-4000-8000-000000000011', 'Second Conversation — M11 SMS — Guaranteed', 'sms', 'district_nurture',
$body$Hi {{first_name}}, {{fsa_name}} here. When a retiree says "I want something guaranteed" or "afraid of outliving my money," that's an income-planning signal, not a product to reach for. Hand it to me and I'll handle it responsibly.$body$,
'draft', 1, false),
('d3f00000-0000-4000-8000-000000000012', 'Second Conversation — M12 SMS — Beneficiaries', 'sms', 'district_nurture',
$body$Hi {{first_name}}, {{fsa_name}} here, closing our year. Simplest high-value nudge: tell clients to check their beneficiaries every few years. When they're unsure, send them my way. Thanks for a great year of partnership.$body$,
'draft', 1, false)
on conflict (id) do nothing;

-- ══ CAMPAIGN + 40-TOUCH BLUEPRINT ═══════════════════════════════════════════
insert into district_nurture_campaigns (id, name, status, purpose, created_by)
values ('d1a00000-0000-4000-8000-000000000001', 'The Second Conversation', 'draft', 'MARKETING', 'seed')
on conflict (id) do nothing;

-- Touch blueprint: module m (base = (m-1)*30) → Email A day base+1, SMS day base+10,
-- Email B day base+20. Live touchpoints (advisor_outreach, template null) at the quarter
-- ends: Q1 day 90, Q2 day 180, Q3 day 270, Q4 day 365.
insert into district_nurture_touches (campaign_id, touch_no, module_no, day_offset, kind, template_id, asset_label) values
('d1a00000-0000-4000-8000-000000000001',  1,  1,   1, 'email',            'd2e00000-0000-4000-8000-000000000001', 'M1 Email A — Financial foundations'),
('d1a00000-0000-4000-8000-000000000001',  2,  1,  10, 'sms',              'd3f00000-0000-4000-8000-000000000001', 'M1 SMS — Notice the signal'),
('d1a00000-0000-4000-8000-000000000001',  3,  1,  20, 'email',            'd2e00000-0000-4000-8000-000000000002', 'M1 Email B — From signal to introduction'),
('d1a00000-0000-4000-8000-000000000001',  4,  2,  31, 'email',            'd2e00000-0000-4000-8000-000000000003', 'M2 Email A — Reserves and debt'),
('d1a00000-0000-4000-8000-000000000001',  5,  2,  40, 'sms',              'd3f00000-0000-4000-8000-000000000002', 'M2 SMS — Reserves and debt'),
('d1a00000-0000-4000-8000-000000000001',  6,  2,  50, 'email',            'd2e00000-0000-4000-8000-000000000004', 'M2 Email B — Handing off the money conversation'),
('d1a00000-0000-4000-8000-000000000001',  7,  3,  61, 'email',            'd2e00000-0000-4000-8000-000000000005', 'M3 Email A — Retirement, starting with you'),
('d1a00000-0000-4000-8000-000000000001',  8,  3,  70, 'sms',              'd3f00000-0000-4000-8000-000000000003', 'M3 SMS — Someday'),
('d1a00000-0000-4000-8000-000000000001',  9,  3,  80, 'email',            'd2e00000-0000-4000-8000-000000000006', 'M3 Email B — Retirement signals'),
('d1a00000-0000-4000-8000-000000000001', 10,  null,  90, 'advisor_outreach', null,                                 'Q1 Live Touchpoint — Quarterly partnership call'),
('d1a00000-0000-4000-8000-000000000001', 11,  4,  91, 'email',            'd2e00000-0000-4000-8000-000000000007', 'M4 Email A — Home and household protection'),
('d1a00000-0000-4000-8000-000000000001', 12,  4, 100, 'sms',              'd3f00000-0000-4000-8000-000000000004', 'M4 SMS — New home'),
('d1a00000-0000-4000-8000-000000000001', 13,  4, 110, 'email',            'd2e00000-0000-4000-8000-000000000008', 'M4 Email B — Refinance and closing handoff'),
('d1a00000-0000-4000-8000-000000000001', 14,  5, 121, 'email',            'd2e00000-0000-4000-8000-000000000009', 'M5 Email A — When the family grows'),
('d1a00000-0000-4000-8000-000000000001', 15,  5, 130, 'sms',              'd3f00000-0000-4000-8000-000000000005', 'M5 SMS — Growing family'),
('d1a00000-0000-4000-8000-000000000001', 16,  5, 140, 'email',            'd2e00000-0000-4000-8000-000000000010', 'M5 Email B — Introducing the family review'),
('d1a00000-0000-4000-8000-000000000001', 17,  6, 151, 'email',            'd2e00000-0000-4000-8000-000000000011', 'M6 Email A — What an FNA is'),
('d1a00000-0000-4000-8000-000000000001', 18,  6, 160, 'sms',              'd3f00000-0000-4000-8000-000000000006', 'M6 SMS — The FNA'),
('d1a00000-0000-4000-8000-000000000001', 19,  6, 170, 'email',            'd2e00000-0000-4000-8000-000000000012', 'M6 Email B — Teeing up the FNA'),
('d1a00000-0000-4000-8000-000000000001', 20,  null, 180, 'advisor_outreach', null,                                  'Q2 Live Touchpoint — Mid-year FNA workshop'),
('d1a00000-0000-4000-8000-000000000001', 21,  7, 181, 'email',            'd2e00000-0000-4000-8000-000000000013', 'M7 Email A — Business-owner clients'),
('d1a00000-0000-4000-8000-000000000001', 22,  7, 190, 'sms',              'd3f00000-0000-4000-8000-000000000007', 'M7 SMS — Business owners'),
('d1a00000-0000-4000-8000-000000000001', 23,  7, 200, 'email',            'd2e00000-0000-4000-8000-000000000014', 'M7 Email B — Introducing a business review'),
('d1a00000-0000-4000-8000-000000000001', 24,  8, 211, 'email',            'd2e00000-0000-4000-8000-000000000015', 'M8 Email A — The life insurance family'),
('d1a00000-0000-4000-8000-000000000001', 25,  8, 220, 'sms',              'd3f00000-0000-4000-8000-000000000008', 'M8 SMS — Which one'),
('d1a00000-0000-4000-8000-000000000001', 26,  8, 230, 'email',            'd2e00000-0000-4000-8000-000000000016', 'M8 Email B — Which one is not your call'),
('d1a00000-0000-4000-8000-000000000001', 27,  9, 241, 'email',            'd2e00000-0000-4000-8000-000000000017', 'M9 Email A — Protection planning and LIAM'),
('d1a00000-0000-4000-8000-000000000001', 28,  9, 250, 'sms',              'd3f00000-0000-4000-8000-000000000009', 'M9 SMS — LIAM'),
('d1a00000-0000-4000-8000-000000000001', 29,  9, 260, 'email',            'd2e00000-0000-4000-8000-000000000018', 'M9 Email B — Awareness-month introduction'),
('d1a00000-0000-4000-8000-000000000001', 30,  null, 270, 'advisor_outreach', null,                                  'Q3 Live Touchpoint — LIAM referral push review'),
('d1a00000-0000-4000-8000-000000000001', 31, 10, 271, 'email',            'd2e00000-0000-4000-8000-000000000019', 'M10 Email A — Money in motion'),
('d1a00000-0000-4000-8000-000000000001', 32, 10, 280, 'sms',              'd3f00000-0000-4000-8000-000000000010', 'M10 SMS — Money in motion'),
('d1a00000-0000-4000-8000-000000000001', 33, 10, 290, 'email',            'd2e00000-0000-4000-8000-000000000020', 'M10 Email B — The immediate hand-off'),
('d1a00000-0000-4000-8000-000000000001', 34, 11, 301, 'email',            'd2e00000-0000-4000-8000-000000000021', 'M11 Email A — Turning savings into a paycheck'),
('d1a00000-0000-4000-8000-000000000001', 35, 11, 310, 'sms',              'd3f00000-0000-4000-8000-000000000011', 'M11 SMS — Guaranteed'),
('d1a00000-0000-4000-8000-000000000001', 36, 11, 320, 'email',            'd2e00000-0000-4000-8000-000000000022', 'M11 Email B — Income-conversation handoff'),
('d1a00000-0000-4000-8000-000000000001', 37, 12, 331, 'email',            'd2e00000-0000-4000-8000-000000000023', 'M12 Email A — Beneficiaries and legacy'),
('d1a00000-0000-4000-8000-000000000001', 38, 12, 340, 'sms',              'd3f00000-0000-4000-8000-000000000012', 'M12 SMS — Beneficiaries'),
('d1a00000-0000-4000-8000-000000000001', 39, 12, 350, 'email',            'd2e00000-0000-4000-8000-000000000024', 'M12 Email B — A standing partnership'),
('d1a00000-0000-4000-8000-000000000001', 40,  null, 365, 'advisor_outreach', null,                                  'Q4 Live Touchpoint — Annual review and next-year plan')
on conflict (campaign_id, touch_no) do nothing;
