-- ─────────────────────────────────────────────────────────
-- Migration: 084_pipeline_winback_seed
--
-- Seeds the Pipeline Win-Back Campaign (ADR-031): one pipeline_winback_campaigns row (status
-- 'draft'), its 24 pipeline_winback_touches (spec §7), and the §8 message assets as DRAFT
-- comm_templates (8 emails, 8 SMS, 6 AI conversation-starter openings).
--
-- "Final copy" (spec §1) means engineering does NOT rewrite the wording — it does NOT skip
-- approval. Every template lands as approval_status='draft' and must pass the existing human
-- approval gate before the campaign can dispatch it (ADR-023); sendThroughGate() refuses an
-- unapproved template regardless. The bodies are verbatim §8 copy; only merge-token SYNTAX is
-- mapped to the repo-native snake_case tokens ({{FirstName}}→{{first_name}}, AdvisorName→
-- fsa_name, AgencyName→agency_name, SchedulingLink→scheduling_link, AdvisorPhone→advisor_phone,
-- AdvisorEmail→advisor_email) so tokens actually resolve — the delivered message is identical.
--
-- Only the §8 8-message SMS set is implemented (the superseded 5-message draft is NOT seeded).
-- The AI conversation-starter openings are the §8 playbook opening lines (see playbooks.ts).
--
-- Fixed UUIDs make this fully idempotent (re-run = no-op via primary-key conflict).
-- Transaction-safe; no explicit BEGIN/COMMIT.
-- ─────────────────────────────────────────────────────────

-- ── Emails (8) — channel 'email', category 'pipeline_winback' ───────────────
insert into comm_templates (id, name, channel, category, body, approval_status, version) values
('a2b00000-0000-4000-8000-000000000001', 'Win-Back — Email #1 — Welcome Back', 'email', 'pipeline_winback',
$body$Subject: We'd Love to Reconnect
Preview: We're here whenever you're ready to pick things back up.

Hi {{first_name}},

It's {{fsa_name}} with {{agency_name}}. A little while back, you looked into life insurance with us, and I wanted to personally reach back out.

Life gets busy, and it's common for something like this to get set aside — no judgment at all. I just wanted to check in and let you know we're still here if you'd like to pick things back up.

There's no pressure and no obligation. If now's a good time, we'd be happy to offer a complimentary review of your options.

Schedule a Complimentary Review {{scheduling_link}}

If you have any questions in the meantime, just reply to this email.

Warm regards, {{fsa_name}} {{agency_name}} {{advisor_phone}} {{advisor_email}}

This email is provided for informational purposes to reconnect regarding a prior life insurance inquiry. Any recommendations would be based on your individual needs and circumstances after a personal consultation. If you no longer wish to receive these emails, you may unsubscribe using the link below.$body$, 'draft', 1),

('a2b00000-0000-4000-8000-000000000002', 'Win-Back — Email #2 — Life Changes', 'email', 'pipeline_winback',
$body$Subject: Has Anything Changed Since We Last Talked?
Preview: Life insurance needs tend to shift as life does.

Hi {{first_name}},

A lot can change in a short amount of time. Since we last spoke, you may have:
- Gotten married or grown your family
- Bought a home
- Changed jobs or started a business
- Begun thinking more seriously about retirement

Any one of these is a reasonable reason to take another look at your coverage needs — not because something is wrong with your previous plans, but because your life today may call for something different than it did before.

If you'd like to talk through what's changed and what that might mean for your coverage, we're happy to help.

Review My Coverage Needs {{scheduling_link}}

Feel free to reply with any questions.

Warm regards, {{fsa_name}} {{agency_name}}

This email is educational and does not constitute a recommendation. Any discussion of your coverage needs will be based on your individual circumstances.$body$, 'draft', 1),

('a2b00000-0000-4000-8000-000000000003', 'Win-Back — Email #3 — Common Life Insurance Myths', 'email', 'pipeline_winback',
$body$Subject: 4 Life Insurance Myths Worth Rethinking
Preview: A few common assumptions that may not hold up.

Hi {{first_name}},

When people put off looking into life insurance, it's often because of a few common assumptions. Here's a closer look at some of them.

"I'm too young to need it." Life insurance is often more accessible earlier in life — waiting doesn't necessarily make things simpler.

"It's too expensive." Costs vary widely based on the type and amount of coverage. What fits one household's budget may look very different from what fits another's.

"I already have coverage through work." Employer coverage is often limited in amount and usually doesn't carry over if you change jobs — it's worth understanding what you'd actually have if that coverage went away.

"I'll get to it eventually." That's completely understandable — we just wanted to offer this as a reminder that we're here whenever "eventually" arrives.

This email is meant purely to inform, not to push any particular product or amount of coverage. If any of this raises questions, we're glad to talk it through.

Ask Us Anything {{scheduling_link}}

Sincerely, {{fsa_name}} {{agency_name}}

This email is for general educational purposes only and is not a recommendation regarding any specific product, coverage amount, or premium.$body$, 'draft', 1),

('a2b00000-0000-4000-8000-000000000004', 'Win-Back — Email #4 — Protect What Matters Most', 'email', 'pipeline_winback',
$body$Subject: The People and Plans You're Working Toward
Preview: A short reminder of why coverage matters to the people who count on you.

Hi {{first_name}},

Life insurance isn't really about the policy — it's about the people and plans it's meant to protect: your family, your income, your home, your children's future, or whatever legacy matters most to you.

We're not writing this to create worry — just to offer a gentle reminder of what a policy review is ultimately in service of.

If you've been meaning to make sure that protection still matches what matters most to you today, we'd be glad to help you take a look.

Schedule a Conversation {{scheduling_link}}

Warm regards, {{fsa_name}} {{agency_name}}

This communication is intended to encourage a review of your coverage and is not a recommendation to purchase any specific product.$body$, 'draft', 1),

('a2b00000-0000-4000-8000-000000000005', 'Win-Back — Email #5 — Understanding Coverage Needs', 'email', 'pipeline_winback',
$body$Subject: How Much Coverage Do People Typically Consider?
Preview: A quick primer on how coverage needs are usually thought through.

Hi {{first_name}},

One of the most common questions we hear is "how much coverage do I actually need?" There's no single right answer, but here are the factors people typically consider:
- Income replacement — how many years of income the policy would need to replace
- Debt — mortgage, loans, or other obligations that would remain
- Final expenses — costs that come up regardless of planning
- Children's education — if that's part of your goals
- Long-term goals — anything else you're planning toward

This is general information, not a recommendation — the right amount for you depends entirely on your own situation. If you'd like to walk through these factors together, we're happy to help you think it through.

Talk Through My Coverage Needs {{scheduling_link}}

Sincerely, {{fsa_name}} {{agency_name}}

This email is educational only. Any specific coverage recommendation would be made after a personal review of your individual circumstances.$body$, 'draft', 1),

('a2b00000-0000-4000-8000-000000000006', 'Win-Back — Email #6 — Why People Wait', 'email', 'pipeline_winback',
$body$Subject: Why We Often Put Off Decisions Like This
Preview: Waiting rarely makes the decision easier — here's a small way to move forward.

Hi {{first_name}},

If you've been meaning to revisit life insurance but haven't gotten around to it, you're far from alone. Life gets busy, and something without an urgent deadline is easy to set aside.

The honest truth is that waiting rarely makes the decision simpler — it just delays having the information you'd want either way.

You don't have to make any decisions today. A short conversation is often all it takes to get unstuck.

Schedule a Review {{scheduling_link}}

Whenever you're ready, we're here.

Warm regards, {{fsa_name}} {{agency_name}}

This email is intended to encourage a review of your existing coverage or a prior inquiry and is not a recommendation to purchase any specific product.$body$, 'draft', 1),

('a2b00000-0000-4000-8000-000000000007', 'Win-Back — Email #7 — Complimentary Policy Review', 'email', 'pipeline_winback',
$body$Subject: Let's Review Your Options — No Obligation
Preview: A short, no-pressure conversation to see where things stand.

Hi {{first_name}},

We'd like to offer you a complimentary review of your life insurance options. During this conversation, we can:
- Review where things stood with your previous inquiry
- Answer any questions you have
- Walk through what options might be available to you now

There's no obligation attached — this is simply an opportunity to get clear, current information so you can decide what, if anything, makes sense for you.

Book Your Complimentary Review {{scheduling_link}}

If you'd rather just ask a quick question first, simply reply to this email.

Sincerely, {{fsa_name}} {{agency_name}} {{advisor_phone}} {{advisor_email}}

Any recommendations would be made only after a personal review of your individual needs, objectives, and circumstances.$body$, 'draft', 1),

('a2b00000-0000-4000-8000-000000000008', 'Win-Back — Email #8 — Final Follow-Up', 'email', 'pipeline_winback',
$body$Subject: One Last Note Before We Close This Out
Preview: We don't want to overwhelm your inbox — here's where things stand.

Hi {{first_name}},

This will be our last email as part of this outreach. We don't want to overwhelm your inbox, and if now simply isn't the right time for life insurance, that's completely okay.

If you'd still like to talk it through, we're always happy to help — now or down the road.

Schedule a Conversation {{scheduling_link}}

Thank you for your time, and we wish you and your family all the best.

Warm regards, {{fsa_name}} {{agency_name}} {{advisor_phone}} {{advisor_email}}

This email concludes this outreach. Future communications will be sent according to your communication preferences and any applicable consent you've provided. You may unsubscribe using the link below; transactional or legally required communications may still be sent when applicable.$body$, 'draft', 1)
on conflict (id) do nothing;

-- ── SMS (8) — channel 'sms', category 'pipeline_winback' ────────────────────
--    Only the §8 8-message set (the superseded 5-message draft is NOT seeded).
insert into comm_templates (id, name, channel, category, body, approval_status, version) values
('b2c00000-0000-4000-8000-000000000001', 'Win-Back — SMS #1 — Welcome Back', 'sms', 'pipeline_winback',
$body$Hi {{first_name}}, this is {{fsa_name}} with {{agency_name}}. We noticed you previously explored life insurance with us. If you'd still like to review your options, simply reply to this message. We're happy to help. Reply STOP to opt out.$body$, 'draft', 1),
('b2c00000-0000-4000-8000-000000000002', 'Win-Back — SMS #2 — Life Changes', 'sms', 'pipeline_winback',
$body$Hi {{first_name}}, life changes quickly. If you've changed jobs, purchased a home, grown your family, or experienced other major milestones, it may be time to review your coverage. Reply STOP to opt out.$body$, 'draft', 1),
('b2c00000-0000-4000-8000-000000000003', 'Win-Back — SMS #3 — Cost', 'sms', 'pipeline_winback',
$body$Hi {{first_name}}, many people are surprised to learn that life insurance may be more affordable than they expected. If you'd like to explore options that fit your goals, just reply here. Reply STOP to opt out.$body$, 'draft', 1),
('b2c00000-0000-4000-8000-000000000004', 'Win-Back — SMS #4 — Protection', 'sms', 'pipeline_winback',
$body$Hi {{first_name}}, protecting the people you care about is one of life's most important financial decisions. If you have questions, simply reply to this message. Reply STOP to opt out.$body$, 'draft', 1),
('b2c00000-0000-4000-8000-000000000005', 'Win-Back — SMS #5 — Review', 'sms', 'pipeline_winback',
$body$Hi {{first_name}}, we'd be happy to provide a complimentary life insurance review whenever you're ready. Reply REVIEW if you'd like to schedule a convenient time. Reply STOP to opt out.$body$, 'draft', 1),
('b2c00000-0000-4000-8000-000000000006', 'Win-Back — SMS #6 — Still Interested', 'sms', 'pipeline_winback',
$body$Hi {{first_name}}, just checking in to see whether life insurance is still on your radar. If you're ready to continue where you left off, we'd be happy to help. Reply STOP to opt out.$body$, 'draft', 1),
('b2c00000-0000-4000-8000-000000000007', 'Win-Back — SMS #7 — Questions', 'sms', 'pipeline_winback',
$body$Hi {{first_name}}, do you have any questions about life insurance or your previous quote? Simply reply to this message and we'll be happy to assist. Reply STOP to opt out.$body$, 'draft', 1),
('b2c00000-0000-4000-8000-000000000008', 'Win-Back — SMS #8 — Final Check-In', 'sms', 'pipeline_winback',
$body$Hi {{first_name}}, this is our final follow-up regarding your previous interest in life insurance. If you'd ever like to revisit your options, we're always here to help. Thank you for your time. Reply STOP to opt out.$body$, 'draft', 1)
on conflict (id) do nothing;

-- ── AI conversation starters (6) — channel 'sms' (conversational), category 'pipeline_winback_ai' ──
--    The §8 playbook opening lines (see src/lib/pipeline-winback/playbooks.ts).
insert into comm_templates (id, name, channel, category, body, approval_status, version) values
('c2d00000-0000-4000-8000-000000000001', 'Win-Back — Playbook #1 — Reconnect', 'sms', 'pipeline_winback_ai',
$body$Hi {{first_name}}, it's {{fsa_name}}'s assistant with {{agency_name}}. We noticed you looked into life insurance with us a while back — is now a better time to pick things back up?$body$, 'draft', 1),
('c2d00000-0000-4000-8000-000000000002', 'Win-Back — Playbook #2 — Life Changes Discovery', 'sms', 'pipeline_winback_ai',
$body$Hi {{first_name}}, have there been any big changes since we last talked — marriage, a new home, a growing family, a career move?$body$, 'draft', 1),
('c2d00000-0000-4000-8000-000000000003', 'Win-Back — Playbook #3 — Objection Handling', 'sms', 'pipeline_winback_ai',
$body$Hi {{first_name}}, a lot of people put this off for very understandable reasons. Is there anything specific holding you back that I can help clarify?$body$, 'draft', 1),
('c2d00000-0000-4000-8000-000000000004', 'Win-Back — Playbook #4 — Life Insurance Education', 'sms', 'pipeline_winback_ai',
$body$Hi {{first_name}}, would it help if I explained, at a high level, how people usually think about life insurance and when a review makes sense?$body$, 'draft', 1),
('c2d00000-0000-4000-8000-000000000005', 'Win-Back — Playbook #5 — Scheduling and Next Steps', 'sms', 'pipeline_winback_ai',
$body$Hi {{first_name}}, would you like to set up a quick call or virtual meeting, or have us send an updated look at your options?$body$, 'draft', 1),
('c2d00000-0000-4000-8000-000000000006', 'Win-Back — Playbook #6 — Respectful Final Outreach', 'sms', 'pipeline_winback_ai',
$body$Hi {{first_name}}, thank you for your time over the last few months. Would you like us to check back with you at a later date, or would you prefer that we close this follow-up for now?$body$, 'draft', 1)
on conflict (id) do nothing;

-- ── The campaign (status 'draft') ───────────────────────────────────────────
insert into pipeline_winback_campaigns (id, name, status, purpose, created_by) values
('e2f00000-0000-4000-8000-000000000001', 'Win-Back Campaign', 'draft', 'MARKETING', 'seed')
on conflict (id) do nothing;

-- ── The 24-touch timeline (spec §7), linking templates by touch ─────────────
insert into pipeline_winback_touches (campaign_id, touch_no, day_offset, kind, template_id, asset_label) values
('e2f00000-0000-4000-8000-000000000001', 1, 1, 'email', 'a2b00000-0000-4000-8000-000000000001', 'Email #1 — Welcome Back'),
('e2f00000-0000-4000-8000-000000000001', 2, 3, 'sms', 'b2c00000-0000-4000-8000-000000000001', 'SMS #1 — Welcome Back / Reconnect'),
('e2f00000-0000-4000-8000-000000000001', 3, 7, 'ai_conversation', 'c2d00000-0000-4000-8000-000000000001', 'Playbook #1 — Reconnect'),
('e2f00000-0000-4000-8000-000000000001', 4, 14, 'email', 'a2b00000-0000-4000-8000-000000000002', 'Email #2 — Life Changes'),
('e2f00000-0000-4000-8000-000000000001', 5, 18, 'sms', 'b2c00000-0000-4000-8000-000000000002', 'SMS #2 — Life Changes'),
('e2f00000-0000-4000-8000-000000000001', 6, 25, 'ai_conversation', 'c2d00000-0000-4000-8000-000000000002', 'Playbook #2 — Life Changes Discovery'),
('e2f00000-0000-4000-8000-000000000001', 7, 35, 'email', 'a2b00000-0000-4000-8000-000000000003', 'Email #3 — Common Life Insurance Myths'),
('e2f00000-0000-4000-8000-000000000001', 8, 42, 'advisor_outreach', null, 'Advisor Script #1 — Relationship Reconnect'),
('e2f00000-0000-4000-8000-000000000001', 9, 49, 'sms', 'b2c00000-0000-4000-8000-000000000003', 'SMS #3 — Cost / Affordability'),
('e2f00000-0000-4000-8000-000000000001', 10, 60, 'email', 'a2b00000-0000-4000-8000-000000000004', 'Email #4 — Protect What Matters Most'),
('e2f00000-0000-4000-8000-000000000001', 11, 70, 'ai_conversation', 'c2d00000-0000-4000-8000-000000000003', 'Playbook #3 — Objection Handling'),
('e2f00000-0000-4000-8000-000000000001', 12, 80, 'sms', 'b2c00000-0000-4000-8000-000000000004', 'SMS #4 — Protection'),
('e2f00000-0000-4000-8000-000000000001', 13, 90, 'email', 'a2b00000-0000-4000-8000-000000000005', 'Email #5 — Understanding Coverage Needs'),
('e2f00000-0000-4000-8000-000000000001', 14, 93, 'advisor_outreach', null, 'Advisor Script #2 — Final Personal Follow-Up'),
('e2f00000-0000-4000-8000-000000000001', 15, 96, 'sms', 'b2c00000-0000-4000-8000-000000000005', 'SMS #5 — Complimentary Review'),
('e2f00000-0000-4000-8000-000000000001', 16, 99, 'ai_conversation', 'c2d00000-0000-4000-8000-000000000004', 'Playbook #4 — Life Insurance Education'),
('e2f00000-0000-4000-8000-000000000001', 17, 102, 'email', 'a2b00000-0000-4000-8000-000000000006', 'Email #6 — Why People Wait'),
('e2f00000-0000-4000-8000-000000000001', 18, 105, 'sms', 'b2c00000-0000-4000-8000-000000000006', 'SMS #6 — Still Interested?'),
('e2f00000-0000-4000-8000-000000000001', 19, 108, 'email', 'a2b00000-0000-4000-8000-000000000007', 'Email #7 — Complimentary Policy Review'),
('e2f00000-0000-4000-8000-000000000001', 20, 111, 'sms', 'b2c00000-0000-4000-8000-000000000007', 'SMS #7 — Questions?'),
('e2f00000-0000-4000-8000-000000000001', 21, 114, 'ai_conversation', 'c2d00000-0000-4000-8000-000000000005', 'Playbook #5 — Scheduling & Next Steps'),
('e2f00000-0000-4000-8000-000000000001', 22, 117, 'email', 'a2b00000-0000-4000-8000-000000000008', 'Email #8 — Final Follow-Up'),
('e2f00000-0000-4000-8000-000000000001', 23, 119, 'sms', 'b2c00000-0000-4000-8000-000000000008', 'SMS #8 — Final Check-In'),
('e2f00000-0000-4000-8000-000000000001', 24, 120, 'ai_conversation', 'c2d00000-0000-4000-8000-000000000006', 'Playbook #6 — Respectful Final Outreach')
on conflict (campaign_id, touch_no) do nothing;

-- ── ROLLBACK (manual) ───────────────────────────────────────────────────────
--   delete from pipeline_winback_touches where campaign_id = 'e2f00000-0000-4000-8000-000000000001';
--   delete from pipeline_winback_campaigns where id = 'e2f00000-0000-4000-8000-000000000001';
--   delete from comm_templates where category in ('pipeline_winback','pipeline_winback_ai');
