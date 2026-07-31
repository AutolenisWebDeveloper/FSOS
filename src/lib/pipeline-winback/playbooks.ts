// src/lib/pipeline-winback/playbooks.ts
// The six Win-Back AI conversation playbooks (spec §8) as PURE, versioned data. Each playbook
// is an internal script the AI conversation engine grounds on; every substantive/individualized
// question routes to advisor escalation (conversation.ts / §4.2 red-line). Content is verbatim
// intent from §8 — engineering does not rewrite it. The AI-conversation touch (§7) sends the
// playbook's opening line as an APPROVED comm_template; the tree/escalation metadata below drives
// classification and handoff. Kept as data (not prose in code) so the playbook set is auditable
// in one place and can be surfaced in the Conversation Center (§12).

export interface Playbook {
  key: string
  /** The §7 touch that fires this playbook. */
  touch_no: number
  title: string
  /** The opening line (seeded as an approved comm_template, category pipeline_winback_ai). */
  opening: string
  /** Discovery/branches the AI may explore with GENERAL educational information only. */
  explores: string[]
  /** Intents that end the AI's turn and hand to the advisor (mirrors WINBACK_ESCALATION_INTENTS). */
  escalateOn: string[]
  /** Conditions under which the playbook closes the conversation (feeds the §10 state machine). */
  exitConditions: string[]
}

export const PLAYBOOKS: Playbook[] = [
  {
    key: 'reconnect',
    touch_no: 3,
    title: 'Playbook #1 — Reconnect',
    opening:
      "Hi {{first_name}}, it's {{fsa_name}}'s assistant with {{agency_name}}. We noticed you looked into life insurance with us a while back — is now a better time to pick things back up?",
    explores: ['what prevented moving forward previously', 'general questions about the process', 'offer to schedule a review'],
    escalateOn: ['quote', 'coverage_question', 'budget', 'existing_coverage', 'unknown'],
    exitConditions: ['appointment booked', 'quote requested', 'not interested', 'future follow-up requested'],
  },
  {
    key: 'life_changes_discovery',
    touch_no: 6,
    title: 'Playbook #2 — Life Changes Discovery',
    opening: 'Hi {{first_name}}, have there been any big changes since we last talked — marriage, a new home, a growing family, a career move?',
    explores: ['marriage', 'children', 'homeownership', 'career changes', 'business ownership', 'retirement'],
    escalateOn: ['quote', 'coverage_question', 'budget', 'existing_coverage', 'unknown'],
    exitConditions: ['a relevant change surfaces → offer a review', 'not interested', 'future follow-up requested'],
  },
  {
    key: 'objection_handling',
    touch_no: 11,
    title: 'Playbook #3 — Objection Handling',
    opening: 'Hi {{first_name}}, a lot of people put this off for very understandable reasons. Is there anything specific holding you back that I can help clarify?',
    explores: ['cost', 'timing', 'existing work coverage', 'health concerns', '"need to think about it"'],
    escalateOn: ['quote', 'coverage_question', 'budget', 'existing_coverage', 'application', 'unknown'],
    exitConditions: ['objection resolved → offer a review', 'complex question → escalate', 'not interested'],
  },
  {
    key: 'education',
    touch_no: 16,
    title: 'Playbook #4 — Life Insurance Education',
    opening: 'Hi {{first_name}}, would it help if I explained, at a high level, how people usually think about life insurance and when a review makes sense?',
    explores: ['why people purchase life insurance', 'common policy types (high level)', 'the value of a periodic review'],
    escalateOn: ['quote', 'coverage_question', 'budget', 'existing_coverage', 'unknown'],
    exitConditions: ['client wants a personalized discussion → offer advisor', 'not interested'],
  },
  {
    key: 'scheduling',
    touch_no: 21,
    title: 'Playbook #5 — Scheduling & Next Steps',
    opening: 'Hi {{first_name}}, would you like to set up a quick call or virtual meeting, or have us send an updated look at your options?',
    explores: ['schedule a call', 'schedule a virtual meeting', 'request an updated quote', 'continue an application'],
    escalateOn: ['quote', 'application', 'coverage_question', 'budget', 'existing_coverage', 'unknown'],
    exitConditions: ['appointment booked', 'handoff to advisor per CRM workflow', 'not interested'],
  },
  {
    key: 'final_outreach',
    touch_no: 24,
    title: 'Playbook #6 — Respectful Final Outreach',
    opening:
      'Hi {{first_name}}, thank you for your time over the last few months. Would you like us to check back with you at a later date, or would you prefer that we close this follow-up for now?',
    explores: ['schedule a future follow-up', 'close the follow-up', 'connect with an advisor'],
    escalateOn: ['quote', 'coverage_question', 'budget', 'existing_coverage', 'unknown'],
    exitConditions: ['future follow-up scheduled', 'campaign ended', 'connect with advisor'],
  },
]

/** Look up a playbook by its scheduled touch number. */
export function playbookForTouch(touchNo: number): Playbook | null {
  return PLAYBOOKS.find((p) => p.touch_no === touchNo) ?? null
}
