-- ─────────────────────────────────────────────────────────
-- Migration: 106_pipeline_winback_messaging_v3
--
-- Corrects WHO the Pipeline Win-Back copy says is writing (ADR-031, ADR-016). Migrations 084
-- (seed) and 099 (v2 copy) are applied and are NOT modified — this migration UPDATEs the same
-- comm_templates rows IN PLACE, the repo's versioning idiom: bump `version`, reset approval on
-- any body change. Template IDs are preserved, so pipeline_winback_touches keeps resolving the
-- same rows and the 24-touch schedule and automation are untouched.
--
-- Every row lands at version 3 / approval_status='draft' with prior approval cleared.
-- sendThroughGate() refuses an unapproved template, so nothing dispatches until a reviewer
-- approves it. This migration approves nothing and activates nothing.
--
-- ── WHAT WAS WRONG ──────────────────────────────────────────────────────────
-- 1. IDENTITY. The copy read "It's {{fsa_name}} with {{agency_name}}" and "I work alongside
--    your Farmers agent", which casts the FSA as the recipient's own local agent and casts
--    "Markist Athelus Farmers Agency" as the recipient's own Farmers agency. Neither is true:
--    the FSA is a life- and securities-licensed specialist who partners WITH the agency owner
--    the client already has (CLAUDE.md §0). The client's assigned agent is a per-recipient
--    fact on the spine, not a phrase to be guessed at in copy.
-- 2. REPEATED INTRODUCTION. Every touch re-introduced the sender, and the platform identity
--    disclosure (ADR-016) prepended a second introduction on top of it.
--
-- ── WHAT THIS CHANGES ───────────────────────────────────────────────────────
-- • The recipient's own agent is now named by {{agent_of_record_reference}}, resolved per
--   recipient from the spine (households.referring_agency_id → agency_owners, via
--   buildRecipientContext). It renders "your Farmers agent, Jane Smith" when the name is on
--   file and the approved generic "your Farmers agent" when it is not, so the sentence is
--   correct either way and NO agent name is ever guessed (§4.3).
-- • The FSA is identified by name and role — {{fsa_name}}, {{advisor_title}} — as the person
--   working WITH that agent, never as the agent.
-- • {{agency_name}} ("Markist Athelus Farmers Agency") no longer appears in ANY customer-facing
--   body. It was only ever the SENDER's practice name, and beside "your Farmers agent" it read
--   as the recipient's agency. The branded email signature still carries the FSA's identity.
-- • The introduction appears ONCE per channel — Email #1, SMS #1 and Conversation #1 — which
--   are flagged introduces_sender = true (migration 105) so the platform records the
--   introduction and stamps the thread instead of prepending a duplicate. Every later touch
--   continues the relationship without re-introducing anyone.
--
-- COPY CONTRACT unchanged from v2: email bodies keep the wrapMarketingEmailBody vocabulary
-- (leading Subject:/Preview: lines, "* " bullets, exactly ONE "Label {{scheduling_link}}" CTA,
-- exactly ONE closer); SMS bodies carry no opt-out text because dispatcher.ts appends
-- SMS_OPT_OUT_FOOTER; every merge token is proven-resolvable by the campaign send path.
--
-- GUARDRAILS: green-zone only — educate, invite, schedule, follow up. No product, carrier,
-- coverage-amount, premium, or replacement recommendation; no suitability determination; no
-- invented Farmers/FNWL data; no specific claim about the recipient's own coverage (ADR-020).
-- Verified by tests/lifecycle-campaign-messaging.test.mjs.
--
-- Idempotent; transaction-safe; no explicit BEGIN/COMMIT.
-- ─────────────────────────────────────────────────────────

-- ── Emails (8) — touches 1, 4, 7, 10, 13, 17, 19, 22 ────────────────────────
update comm_templates set
  name = 'Win-Back — Email #1 — Picking This Back Up',
  body = $body$Subject: Picking this back up?
Preview: No pressure at all. I just wanted to leave the door open.

Hi {{first_name}},

I am {{fsa_name}}, the {{advisor_title}} working with {{agent_of_record_reference}}. I handle the life insurance and financial services side for the agency's clients, so I am a different name from the person you deal with about your auto or home policy.

A while back you started looking into life insurance with us, and then things went quiet. That happens far more often than you would think, and part of my job is making sure nobody is left in limbo on something they once cared about.

So, one honest question: is this still on your list, or should I let it go for now?

Either answer is completely fine. Hit reply and tell me which one. It takes five seconds.

If you would rather just talk it through, you can pick a time that suits you.

Find a Time That Works {{scheduling_link}}

Warm regards, {{fsa_name}}

This email is an invitation to continue a prior conversation about life insurance. It is not a recommendation regarding any product, coverage amount, or premium.$body$,
  introduces_sender = true,
  approval_status = 'draft', version = 3, approved_at = null, approved_by = null,
  updated_by = 'messaging-v3-identity', updated_at = now()
where id = 'a2b00000-0000-4000-8000-000000000001';

update comm_templates set
  name = 'Win-Back — Email #2 — Has Anything Changed',
  body = $body$Subject: Has anything changed since we talked?
Preview: A lot can shift in a few months, and that is usually what makes this worth another look.

Hi {{first_name}},

When someone tells me "now isn't a great time," they are almost always right. Timing matters more than people give it credit for.

But timing also changes. Since we last spoke, you may have:

* Gotten married, or welcomed a child
* Bought a home, or taken on a mortgage
* Changed jobs, or started something of your own
* Paid off a significant debt
* Started thinking harder about retirement

None of those mean anything is wrong. They simply change the shape of what you would want to protect, which is why a second look is usually worth twenty minutes.

If something on that list happened to you, I would genuinely like to hear about it. Reply and tell me which one, and I will take it from there.

Tell Me What Changed {{scheduling_link}}

Warm regards, {{fsa_name}}

This email is educational and is not a recommendation regarding any specific policy, coverage amount, or premium.$body$,
  introduces_sender = false,
  approval_status = 'draft', version = 3, approved_at = null, approved_by = null,
  updated_by = 'messaging-v3-identity', updated_at = now()
where id = 'a2b00000-0000-4000-8000-000000000002';

update comm_templates set
  name = 'Win-Back — Email #3 — What Usually Stalls This',
  body = $body$Subject: The four things that usually stall this
Preview: In my experience it is almost never the reason people say out loud.

Hi {{first_name}},

After enough of these conversations, you start to notice the same four things get in the way.

* "It is probably expensive." Cost depends on the type of coverage, the amount, your age, your health, and underwriting. There is no single price, which is exactly why guessing at it feels unsatisfying.
* "I have some through work." That is real coverage. It is also usually tied to the job, and it is worth understanding on its own terms.
* "I do not know what to ask." Fair enough. Knowing the questions is my job, not yours.
* "I will get to it." The most honest one. Nothing forces the issue, so it waits.

I am not writing to argue with any of these. I am writing because every one of them gets easier once someone walks you through it plainly.

If one of those four is yours, reply with it in a few words and I will answer it directly. No meeting required.

Ask Me One Question {{scheduling_link}}

Warm regards, {{fsa_name}}

This email is for general educational purposes only and is not a recommendation regarding any specific product, coverage amount, or premium.$body$,
  introduces_sender = false,
  approval_status = 'draft', version = 3, approved_at = null, approved_by = null,
  updated_by = 'messaging-v3-identity', updated_at = now()
where id = 'a2b00000-0000-4000-8000-000000000003';

update comm_templates set
  name = 'Win-Back — Email #4 — Who Were You Thinking About',
  body = $body$Subject: Who were you thinking about?
Preview: This is rarely about insurance. It is about a person.

Hi {{first_name}},

Here is something I have noticed over the years: nobody actually wants life insurance.

What people want is for someone specific to be okay. A spouse who would not have to sell the house. Children who could still go to school where they planned. A business partner who is not suddenly carrying the whole thing alone.

The policy is only the mechanism. The person is the point.

When you first reached out, there was probably someone in mind. That person has not changed, even if the timing has.

If you would like to sit down and talk about what looking after them could involve, with no obligation and no pitch, I would be glad to.

Schedule a Conversation {{scheduling_link}}

Warm regards, {{fsa_name}}

This communication is intended to invite a review of your options and is not a recommendation to purchase any specific product.$body$,
  introduces_sender = false,
  approval_status = 'draft', version = 3, approved_at = null, approved_by = null,
  updated_by = 'messaging-v3-identity', updated_at = now()
where id = 'a2b00000-0000-4000-8000-000000000004';

update comm_templates set
  name = 'Win-Back — Email #5 — How People Land on the Number',
  body = $body$Subject: How people land on the number
Preview: There is no universal answer, but there is a straightforward way to think it through.

Hi {{first_name}},

The most common question I get is some version of "how much do I even need?"

There is no universal answer, and anyone who hands you one without asking about your life is guessing. But there is a straightforward way to think it through. Most people work from:

* Income, and how many years of it would need to be replaced
* Debt, including a mortgage or anything else that would not disappear
* Final expenses, which arrive regardless of planning
* Education, if that is part of your plan for someone
* Time, meaning how long the people who depend on you would need support

That is the whole framework. It is arithmetic and honesty, not a sales process.

If you would like, we can walk your own situation through it together and you can decide what to do with the result. These usually take about twenty minutes.

Walk Through It With Me {{scheduling_link}}

Warm regards, {{fsa_name}}

Any recommendation would be made only after a personal review of your individual needs, objectives, and circumstances.$body$,
  introduces_sender = false,
  approval_status = 'draft', version = 3, approved_at = null, approved_by = null,
  updated_by = 'messaging-v3-identity', updated_at = now()
where id = 'a2b00000-0000-4000-8000-000000000005';

update comm_templates set
  name = 'Win-Back — Email #6 — Why This One Always Slides',
  body = $body$Subject: Why this one always slides
Preview: There is no deadline, which is exactly the problem.

Hi {{first_name}},

Most decisions get made because something forces them. A lease ends. A bill arrives. A deadline lands on a calendar.

This one has none of that. Nothing breaks if you put it off another month, which is precisely how months turn into years. That is not procrastination. It is just how attention works.

The only thing I would point out is this: waiting does not make the decision easier. It only delays having the information you would want either way.

And you do not have to decide anything in order to have a conversation. That is rather the point of a conversation.

Twenty Minutes, No Decisions {{scheduling_link}}

Warm regards, {{fsa_name}}

This email is intended to invite a review of a prior inquiry and is not a recommendation to purchase any specific product.$body$,
  introduces_sender = false,
  approval_status = 'draft', version = 3, approved_at = null, approved_by = null,
  updated_by = 'messaging-v3-identity', updated_at = now()
where id = 'a2b00000-0000-4000-8000-000000000006';

update comm_templates set
  name = 'Win-Back — Email #7 — Twenty Minutes No Obligation',
  body = $body$Subject: Twenty minutes, no obligation
Preview: Here is exactly what happens on the call, so there are no surprises.

Hi {{first_name}},

Let me be specific about what I am offering, so there is no mystery in it.

A complimentary review is one conversation, usually about twenty minutes, in which we:

* Pick up wherever your earlier inquiry left off
* Answer whatever questions you have been carrying around
* Look at what options exist for someone in your circumstances
* Decide together whether anything is worth doing next

That last one matters. "Nothing, for now" is a completely legitimate outcome, and it happens often. You would simply be making that call with real information instead of a guess.

There is no cost and no obligation attached to any of it.

Book Your Complimentary Review {{scheduling_link}}

If you would rather start with a single question by email, reply here and I will answer it.

Sincerely, {{fsa_name}}

Any recommendation would be made only after a personal review of your individual needs, objectives, and circumstances.$body$,
  introduces_sender = false,
  approval_status = 'draft', version = 3, approved_at = null, approved_by = null,
  updated_by = 'messaging-v3-identity', updated_at = now()
where id = 'a2b00000-0000-4000-8000-000000000007';

update comm_templates set
  name = 'Win-Back — Email #8 — Last Note From Me',
  body = $body$Subject: Last note from me
Preview: I will stop here, but the door stays open.

Hi {{first_name}},

This is the last email I will send about this.

I do not want to be the person cluttering your inbox with something you have already decided against. If life insurance is not where your attention belongs right now, that is a completely reasonable place to land, and I would rather you tell me so than feel followed around.

Here is what I will say instead: things change. If a year from now something shifts, whether that is a child, a house, a new job, or a quiet Sunday where it starts nagging at you, write to this address and I will pick it straight back up. No re-explaining, no starting over.

Until then, thank you for your time. I mean that sincerely.

Reach Me Whenever You Are Ready {{scheduling_link}}

Warm regards, {{fsa_name}}

This email concludes this outreach. Future communications will follow your recorded communication preferences and any applicable consent. You may unsubscribe from marketing email using the link below.$body$,
  introduces_sender = false,
  approval_status = 'draft', version = 3, approved_at = null, approved_by = null,
  updated_by = 'messaging-v3-identity', updated_at = now()
where id = 'a2b00000-0000-4000-8000-000000000008';

-- ── SMS (8) — touches 2, 5, 9, 12, 15, 18, 20, 23 ───────────────────────────
--    No opt-out text: dispatcher.ts appends SMS_OPT_OUT_FOOTER.
--    SMS #1 carries the introduction for this channel; the rest continue it.
update comm_templates set
  name = 'Win-Back — SMS #1 — Introduction and Still On Your List',
  body = $body$Hi {{first_name}}, this is {{fsa_name}}, the {{advisor_title}} working with {{agent_of_record_reference}}. You looked into life insurance with us a while back, then things went quiet. Still on your list, or should I close it out?$body$,
  introduces_sender = true,
  approval_status = 'draft', version = 3, approved_at = null, approved_by = null,
  updated_by = 'messaging-v3-identity', updated_at = now()
where id = 'b2c00000-0000-4000-8000-000000000001';

update comm_templates set
  name = 'Win-Back — SMS #2 — What Changed',
  body = $body$Hi {{first_name}}, quick one from {{fsa_name}}. Has anything changed since we talked, like a move, a new job, a baby, or a mortgage? Those are usually what make this worth a second look. Reply and tell me which.$body$,
  introduces_sender = false,
  approval_status = 'draft', version = 3, approved_at = null, approved_by = null,
  updated_by = 'messaging-v3-identity', updated_at = now()
where id = 'b2c00000-0000-4000-8000-000000000002';

update comm_templates set
  name = 'Win-Back — SMS #3 — The Cost Question',
  body = $body$Hi {{first_name}}, most people stall on this because they assume it is expensive. Cost depends on the type and amount of coverage, your age, and your health, so guessing rarely helps. Want me to walk you through how it actually works?$body$,
  introduces_sender = false,
  approval_status = 'draft', version = 3, approved_at = null, approved_by = null,
  updated_by = 'messaging-v3-identity', updated_at = now()
where id = 'b2c00000-0000-4000-8000-000000000003';

update comm_templates set
  name = 'Win-Back — SMS #4 — The Person You Had in Mind',
  body = $body$Hi {{first_name}}, when you first reached out there was probably someone specific in mind. That person has not changed, even if the timing has. Happy to pick this back up whenever you are ready. Just reply.$body$,
  introduces_sender = false,
  approval_status = 'draft', version = 3, approved_at = null, approved_by = null,
  updated_by = 'messaging-v3-identity', updated_at = now()
where id = 'b2c00000-0000-4000-8000-000000000004';

update comm_templates set
  name = 'Win-Back — SMS #5 — Complimentary Review',
  body = $body$Hi {{first_name}}, {{fsa_name}} here. I would like to offer you a complimentary review: about 20 minutes, no cost, no obligation, and "nothing for now" is a perfectly good outcome. Pick a time here: {{scheduling_link}}$body$,
  introduces_sender = false,
  approval_status = 'draft', version = 3, approved_at = null, approved_by = null,
  updated_by = 'messaging-v3-identity', updated_at = now()
where id = 'b2c00000-0000-4000-8000-000000000005';

update comm_templates set
  name = 'Win-Back — SMS #6 — Still On Your Radar',
  body = $body$Hi {{first_name}}, is life insurance still on your radar at all? A yes, a no, or a "not yet" all help me know how to follow up properly. Just reply with whichever one fits.$body$,
  introduces_sender = false,
  approval_status = 'draft', version = 3, approved_at = null, approved_by = null,
  updated_by = 'messaging-v3-identity', updated_at = now()
where id = 'b2c00000-0000-4000-8000-000000000006';

update comm_templates set
  name = 'Win-Back — SMS #7 — One Unanswered Question',
  body = $body$Hi {{first_name}}, is there one question about life insurance you never got a straight answer to? Reply with it and I will answer it directly. No meeting needed.$body$,
  introduces_sender = false,
  approval_status = 'draft', version = 3, approved_at = null, approved_by = null,
  updated_by = 'messaging-v3-identity', updated_at = now()
where id = 'b2c00000-0000-4000-8000-000000000007';

update comm_templates set
  name = 'Win-Back — SMS #8 — Last Message',
  body = $body$Hi {{first_name}}, last message from me on this. If it is not the right time, no problem at all. If it ever becomes the right time, reply here and I will pick it straight back up. Thanks for your time.$body$,
  introduces_sender = false,
  approval_status = 'draft', version = 3, approved_at = null, approved_by = null,
  updated_by = 'messaging-v3-identity', updated_at = now()
where id = 'b2c00000-0000-4000-8000-000000000008';

-- ── AI conversation openers (6) — touches 3, 6, 11, 16, 21, 24 ──────────────
--    Every opener self-identifies as an automated assistant (§4.2 / TRAIGA).
--    Conversation #1 introduces the assistant AND whose assistant it is; #2-#6 continue.
--    Bodies mirror PLAYBOOKS[].opening in src/lib/pipeline-winback/playbooks.ts.
update comm_templates set
  name = 'Win-Back — Playbook #1 — Reconnect',
  body = $body$Hi {{first_name}}, I'm the automated assistant for {{fsa_name}}, the {{advisor_title}} working with {{agent_of_record_reference}}. You looked into life insurance with us a while back. Pick it back up, or close it out?$body$,
  introduces_sender = true,
  approval_status = 'draft', version = 3, approved_at = null, approved_by = null,
  updated_by = 'messaging-v3-identity', updated_at = now()
where id = 'c2d00000-0000-4000-8000-000000000001';

update comm_templates set
  name = 'Win-Back — Playbook #2 — Life Changes Discovery',
  body = $body$Hi {{first_name}}, {{fsa_name}}'s automated assistant here. Has anything big changed since you last spoke with us, such as marriage, a new home, a growing family, or a career move?$body$,
  introduces_sender = false,
  approval_status = 'draft', version = 3, approved_at = null, approved_by = null,
  updated_by = 'messaging-v3-identity', updated_at = now()
where id = 'c2d00000-0000-4000-8000-000000000002';

update comm_templates set
  name = 'Win-Back — Playbook #3 — Objection Handling',
  body = $body$Hi {{first_name}}, this is {{fsa_name}}'s automated assistant. Most people who pause on this have one specific reason. Is there something particular holding you back that I can help clear up?$body$,
  introduces_sender = false,
  approval_status = 'draft', version = 3, approved_at = null, approved_by = null,
  updated_by = 'messaging-v3-identity', updated_at = now()
where id = 'c2d00000-0000-4000-8000-000000000003';

update comm_templates set
  name = 'Win-Back — Playbook #4 — Plain-Terms Education',
  body = $body$Hi {{first_name}}, {{fsa_name}}'s automated assistant here. Would it help if I explained, in plain terms, how people usually think about life insurance and when a review is worth doing?$body$,
  introduces_sender = false,
  approval_status = 'draft', version = 3, approved_at = null, approved_by = null,
  updated_by = 'messaging-v3-identity', updated_at = now()
where id = 'c2d00000-0000-4000-8000-000000000004';

update comm_templates set
  name = 'Win-Back — Playbook #5 — Scheduling and Next Steps',
  body = $body$Hi {{first_name}}, this is {{fsa_name}}'s automated assistant. Would you like to set up a short call or video meeting with {{fsa_name}}, or would you rather I pass along a few general answers by text first?$body$,
  introduces_sender = false,
  approval_status = 'draft', version = 3, approved_at = null, approved_by = null,
  updated_by = 'messaging-v3-identity', updated_at = now()
where id = 'c2d00000-0000-4000-8000-000000000005';

update comm_templates set
  name = 'Win-Back — Playbook #6 — Respectful Final Outreach',
  body = $body$Hi {{first_name}}, {{fsa_name}}'s automated assistant one last time. Would you like us to check back with you later on, or should we close out this follow-up for now? Either is completely fine.$body$,
  introduces_sender = false,
  approval_status = 'draft', version = 3, approved_at = null, approved_by = null,
  updated_by = 'messaging-v3-identity', updated_at = now()
where id = 'c2d00000-0000-4000-8000-000000000006';

-- ── ROLLBACK (manual) ───────────────────────────────────────────────────────
--   Re-apply 099_pipeline_winback_messaging_v2.sql, then set introduces_sender = false for
--   the template IDs above (all remain approval_status='draft' either way).
