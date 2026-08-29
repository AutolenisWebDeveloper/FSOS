// src/lib/comms/recipient-timezone.ts
// Recipient timezone resolution — PURE (no DB, no clock, no env, no I/O), so it is
// unit-testable offline (tests/recipient-timezone.test.mjs).
//
// WHY THIS EXISTS. The TCPA quiet-hours floor is defined in the RECIPIENT's local time.
// Before this module FSOS could not resolve that at all: there is no timezone column on
// the contact spine, and no NPA or ZIP map existed anywhere in the codebase. Every send
// therefore evaluated the floor at `America/Chicago` — the practice's own zone — which is
// AGENCY-local time wearing the appearance of recipient-local enforcement.
//
// THE INVARIANT: FAIL CLOSED. An input this module cannot place returns `resolved: false`
// and carries NO `timeZone`. It must never fall back to Central, because a silent default
// reproduces exactly the defect above while looking like a resolution. Callers decide what
// a non-resolution means (the dispatch chokepoint withholds the send and escalates).
//
// ZONE NAMES, NEVER OFFSETS. Every value here is an IANA identifier (`America/Denver`),
// not a UTC offset. DST is the tz database's job; a fixed offset is wrong for half the
// year and was the root of an earlier defect (see local-time.ts).
//
// RESOLUTION INPUTS — and one deliberate exclusion:
//   • phone NPA  (PRIMARY)   — `phone` is on both `contacts` and `household_members`, and
//                              the member-keyed path is how automated outreach resolves a
//                              recipient, so it is the only input available there.
//   • ZIP        (SECONDARY) — present on `contacts` and `households` where an address was
//                              captured. Used when the phone yields nothing.
//   • state      (NEVER)     — `contacts.state` and `households.state` are both
//                              `default 'TX'`. A row imported without a state reads as
//                              Texas, so state cannot distinguish evidence from a default.
//                              This module accepts no state parameter at all.
//
// KNOWN PRECISION LIMITS. An NPA is not a timezone boundary and neither is a ZIP3. Where a
// numbering plan area or ZIP prefix straddles a zone line, the map takes the majority side
// and the case is named below. These are accepted, documented approximations — NOT silent
// ones. Each is marked `approximate` on the result so a caller can report or tighten it.
//
//   • Arizona (480/520/602/623/928 → America/Phoenix): Arizona does not observe DST, but
//     the Navajo Nation within it DOES. That boundary is ZIP-level, not NPA-level, and is
//     out of scope by decision. An affected recipient is off by one hour during DST.
//   • Indiana (812/930): Evansville is Central, Bloomington is Eastern, same NPA → Eastern.
//   • Michigan (906): four western UP counties are Central → Eastern.
//   • Kansas (620), Nebraska (308), Oregon (541), Idaho (208), North/South Dakota (701/605):
//     each straddles Mountain/Central or Mountain/Pacific → majority side.
//   • Canada 867 (Yukon / NWT / Nunavut) spans several zones with no majority → deliberately
//     UNRESOLVED rather than guessed. Failing closed is the correct answer there.

/** An IANA timezone identifier. Named for readability at the call sites below. */
export type IanaZone = string

export type TimezoneMethod = 'npa' | 'zip' | 'both'

export type TimezoneUnresolvedReason =
  /** Neither a phone nor a ZIP was supplied. */
  | 'no_input'
  /** A phone was supplied but carries no parseable NANP area code. */
  | 'unparseable_phone'
  /** The NPA is real but has no geography (toll-free, premium, service code). */
  | 'non_geographic_npa'
  /** A parseable NPA that this map does not place (unassigned, or spans zones). */
  | 'unknown_npa'
  /** A ZIP was supplied but is not five digits. */
  | 'unparseable_zip'
  /** A well-formed ZIP this map does not place (military APO/FPO, unassigned). */
  | 'unknown_zip'

export interface TimezoneResolved {
  resolved: true
  /** The IANA zone name (the NPA's zone when both inputs resolved and disagree). */
  timeZone: IanaZone
  /** Which input(s) produced it: 'npa', 'zip', or 'both' when phone AND ZIP each resolved. */
  method: TimezoneMethod
  /**
   * The exact input value(s) used — the NPA ('214'), the ZIP3 ('752'), or, for method
   * 'both', the pair joined as '<npa>+<zip3>' ('214+900'). Recorded on the send.
   */
  input: string
  /**
   * Present ONLY when method is 'both' and the two inputs DISAGREE: the ZIP's zone, which
   * the quiet-hours evaluation must satisfy IN ADDITION to `timeZone`. Two conflicting
   * pieces of evidence mean neither can be trusted alone — a phone kept from a previous
   * state, or a mailing address that is not where the person lives — so the send must be
   * permissible in BOTH zones (the intersection of the two windows). Absent when the
   * inputs agree or only one resolved.
   */
  secondaryTimeZone?: IanaZone
  /**
   * True when the NPA or ZIP3 straddles a zone boundary and the map took the majority
   * side (see KNOWN PRECISION LIMITS above). For method 'both' it is the OR of the two.
   */
  approximate: boolean
}

export interface TimezoneUnresolved {
  resolved: false
  reason: TimezoneUnresolvedReason
  /** Which inputs were tried, in order, for the audit trail. */
  attempted: TimezoneMethod[]
}

export type TimezoneResolution = TimezoneResolved | TimezoneUnresolved

export interface TimezoneResolutionInput {
  /** Recipient phone in any format (E.164, bare 10-digit, punctuated). */
  phone?: string | null
  /** Recipient ZIP — 5-digit or ZIP+4. */
  zip?: string | null
}

// ─────────────────────────────────────────────────────────────────────────────
// NANP area codes
// ─────────────────────────────────────────────────────────────────────────────

/**
 * NPAs with no geography. These MUST NOT resolve: a toll-free number tells you nothing
 * about where its owner is, and guessing would place a recipient in the wrong zone with
 * full confidence. Toll-free (incl. reserved future codes), premium, personal-communication
 * services, carrier-specific, US-Government, and the 988 crisis line.
 */
export const NON_GEOGRAPHIC_NPAS: ReadonlySet<string> = new Set([
  // toll-free, current and reserved
  '800', '833', '844', '855', '866', '877', '888',
  '822', '880', '881', '882', '889',
  // premium-rate
  '900',
  // personal communication services
  '500', '521', '522', '523', '524', '525', '526', '527', '528', '529',
  '533', '544', '566', '577', '588',
  // carrier-specific / government / service
  '700', '710', '988',
  // inbound international, directory/fictional-use
  '456', '555',
  // Canadian non-geographic
  '600', '622',
])

const NPA_BY_ZONE: Readonly<Record<IanaZone, readonly string[]>> = {
  'America/New_York': [
    // CT, DE, DC
    '203', '475', '860', '959', '302', '202',
    // FL (peninsula — the panhandle is Central, below)
    '239', '305', '321', '352', '386', '407', '561', '656', '689', '727',
    '754', '772', '786', '813', '863', '904', '941', '954',
    // GA
    '229', '404', '470', '478', '678', '706', '762', '770', '912', '943',
    // IN (Eastern-majority; 812/930 straddle — see precision limits)
    '219', '260', '317', '463', '574', '765', '812', '930',
    // KY (Eastern half)
    '502', '606', '859',
    // ME, MD
    '207', '227', '240', '301', '410', '443', '667',
    // MA
    '339', '351', '413', '508', '617', '774', '781', '857', '978',
    // MI (906 straddles — see precision limits)
    '231', '248', '269', '313', '517', '586', '616', '679', '734', '810',
    '906', '947', '989',
    // NH, NJ
    '603',
    '201', '551', '609', '640', '732', '848', '856', '862', '908', '973',
    // NY
    '212', '315', '332', '347', '516', '518', '585', '607', '631', '646',
    '680', '716', '718', '838', '845', '914', '917', '929', '934',
    // NC
    '252', '336', '704', '743', '828', '910', '919', '980', '984',
    // OH
    '216', '220', '234', '326', '330', '380', '419', '440', '513', '567',
    '614', '740', '937',
    // PA
    '215', '223', '267', '272', '412', '445', '484', '570', '582', '610',
    '717', '724', '814', '835', '878',
    // RI, SC
    '401', '803', '839', '843', '854', '864',
    // TN (Eastern third)
    '423', '865',
    // VT, VA, WV
    '802',
    '276', '434', '540', '571', '703', '757', '804', '826', '948',
    '304', '681',
  ],
  'America/Chicago': [
    // AL
    '205', '251', '256', '334', '659', '938',
    // AR
    '479', '501', '870',
    // FL panhandle
    '448', '850',
    // IL
    '217', '224', '309', '312', '331', '447', '464', '618', '630', '708',
    '730', '773', '779', '815', '847', '872',
    // IA
    '319', '515', '563', '641', '712',
    // KS (620 straddles — see precision limits)
    '316', '620', '785', '913',
    // KY (Western)
    '270', '364',
    // LA
    '225', '318', '337', '504', '985',
    // MN
    '218', '320', '507', '612', '651', '763', '924', '952',
    // MS
    '228', '601', '662', '769',
    // MO
    '314', '417', '557', '573', '636', '660', '816',
    // NE (308 straddles), ND (701 straddles), SD (605 straddles)
    '308', '402', '531', '701', '605',
    // OK
    '405', '539', '572', '580', '918',
    // TN (Middle + West)
    '615', '629', '731', '901', '931',
    // TX — all Central EXCEPT 915 (El Paso), which is Mountain, below
    '210', '214', '254', '281', '325', '346', '361', '409', '430', '432',
    '469', '512', '682', '713', '726', '737', '806', '817', '830', '832',
    '903', '936', '940', '945', '956', '972', '979',
    // WI
    '262', '274', '353', '414', '534', '608', '715', '920',
  ],
  'America/Denver': [
    '303', '719', '720', '970', '983',          // CO
    '208', '986',                               // ID (panhandle is Pacific — precision limit)
    '406',                                      // MT
    '505', '575',                               // NM
    '385', '435', '801',                        // UT
    '307',                                      // WY
    '915',                                      // TX — El Paso only
  ],
  'America/Phoenix': ['480', '520', '602', '623', '928'], // AZ — Mountain, no DST
  'America/Los_Angeles': [
    // CA
    '209', '213', '279', '310', '323', '341', '350', '408', '415', '424',
    '442', '510', '530', '559', '562', '619', '626', '628', '650', '657',
    '661', '669', '707', '714', '738', '747', '760', '805', '818', '820',
    '831', '837', '840', '858', '909', '916', '925', '949', '951',
    // NV
    '702', '725', '775',
    // OR (541 straddles — see precision limits)
    '458', '503', '541', '971',
    // WA
    '206', '253', '360', '425', '509', '564',
  ],
  'America/Anchorage': ['907'],
  'Pacific/Honolulu': ['808'],
  'America/Puerto_Rico': ['787', '939', '340'], // PR + USVI (AST, no DST)
  'Pacific/Guam': ['671'],
  'Pacific/Saipan': ['670'],
  'Pacific/Pago_Pago': ['684'],
  // Canada
  'America/Toronto': [
    '226', '249', '289', '343', '365', '382', '416', '437', '438', '450',
    '468', '514', '519', '548', '579', '581', '613', '647', '683', '705',
    '742', '753', '807', '819', '873', '905', '942',
  ],
  'America/Halifax': ['506', '782', '902'],
  'America/St_Johns': ['709'],
  'America/Winnipeg': ['204', '431', '584'],
  'America/Regina': ['306', '474', '639'],      // Saskatchewan — no DST
  'America/Edmonton': ['368', '403', '587', '780', '825'],
  'America/Vancouver': ['236', '250', '604', '672', '778'],
}

/** NPAs whose area straddles a zone boundary; the map takes the majority side. */
const APPROXIMATE_NPAS: ReadonlySet<string> = new Set([
  '812', '930',                 // IN — Evansville (Central) vs Bloomington (Eastern)
  '906',                        // MI — western UP counties are Central
  '620',                        // KS — far-west counties are Mountain
  '308',                        // NE — Panhandle is Mountain
  '701',                        // ND — southwest corner is Mountain
  '605',                        // SD — western half is Mountain
  '208', '986',                 // ID — northern panhandle is Pacific
  '541', '458',                 // OR — Malheur County is Mountain
  '480', '520', '602', '623', '928', // AZ — Navajo Nation observes DST
])

const NPA_TO_ZONE: ReadonlyMap<string, IanaZone> = (() => {
  const m = new Map<string, IanaZone>()
  for (const [zone, npas] of Object.entries(NPA_BY_ZONE)) {
    for (const npa of npas) m.set(npa, zone)
  }
  return m
})()

/**
 * Extract the NANP area code from a phone in any format, or null when there isn't one.
 * Accepts bare 10-digit, 11-digit with the country code, and E.164 `+1…`. Anything else —
 * a fragment, a non-NANP international number, an invalid NPA — is null, never a guess.
 */
export function npaOf(phone: string | null | undefined): string | null {
  if (!phone) return null
  const digits = String(phone).replace(/\D/g, '')
  let national: string
  if (digits.length === 10) national = digits
  else if (digits.length === 11 && digits.startsWith('1')) national = digits.slice(1)
  else return null
  const npa = national.slice(0, 3)
  // A valid NPA is [2-9][0-9][0-9] and is never an N11 service code (211, 911, …).
  if (!/^[2-9]\d\d$/.test(npa)) return null
  if (npa[1] === '1' && npa[2] === '1') return null
  return npa
}

/**
 * IANA zone for an area code, or null when it is non-geographic, unassigned, or spans
 * zones with no majority (Canadian 867). Null is a real answer — do not substitute a
 * default for it.
 */
export function timeZoneForNpa(npa: string | null | undefined): IanaZone | null {
  if (!npa) return null
  if (NON_GEOGRAPHIC_NPAS.has(npa)) return null
  return NPA_TO_ZONE.get(npa) ?? null
}

// ─────────────────────────────────────────────────────────────────────────────
// ZIP codes — mapped by ZIP3 range (US ZIPs are geographically ordered)
// ─────────────────────────────────────────────────────────────────────────────

interface ZipRange {
  /** Inclusive ZIP3 bounds. */
  from: number
  to: number
  zone: IanaZone
  /** The range straddles a zone boundary and takes the majority side. */
  approximate?: boolean
}

/**
 * Ordered ZIP3 → zone ranges. Gaps are intentional: an unlisted prefix is unassigned or
 * non-geographic (military APO/FPO 090–098 and 962–966) and must NOT resolve.
 */
const ZIP_RANGES: readonly ZipRange[] = [
  { from: 6, to: 9, zone: 'America/Puerto_Rico' },       // PR + USVI
  { from: 5, to: 5, zone: 'America/New_York' },          // Holtsville NY
  { from: 10, to: 89, zone: 'America/New_York' },        // New England + NY metro + NJ
  // 090–098 military (AE/AA) — deliberately absent
  { from: 100, to: 149, zone: 'America/New_York' },      // NY
  { from: 150, to: 196, zone: 'America/New_York' },      // PA
  { from: 197, to: 199, zone: 'America/New_York' },      // DE
  { from: 200, to: 219, zone: 'America/New_York' },      // DC + MD
  { from: 220, to: 246, zone: 'America/New_York' },      // VA
  { from: 247, to: 268, zone: 'America/New_York' },      // WV
  { from: 270, to: 289, zone: 'America/New_York' },      // NC
  { from: 290, to: 299, zone: 'America/New_York' },      // SC
  { from: 300, to: 319, zone: 'America/New_York' },      // GA
  { from: 320, to: 323, zone: 'America/New_York' },      // FL — incl. Tallahassee (Eastern)
  { from: 324, to: 325, zone: 'America/Chicago', approximate: true }, // FL panhandle
  { from: 326, to: 349, zone: 'America/New_York' },      // FL peninsula
  { from: 350, to: 369, zone: 'America/Chicago' },       // AL
  { from: 370, to: 372, zone: 'America/Chicago' },       // TN — Nashville
  { from: 373, to: 374, zone: 'America/New_York' },      // TN — Chattanooga
  { from: 376, to: 379, zone: 'America/New_York' },      // TN — Knoxville / Tri-Cities
  { from: 380, to: 385, zone: 'America/Chicago' },       // TN — Memphis / Jackson
  { from: 386, to: 397, zone: 'America/Chicago' },       // MS
  { from: 398, to: 399, zone: 'America/New_York' },      // GA
  { from: 400, to: 418, zone: 'America/New_York', approximate: true },  // KY east
  { from: 420, to: 427, zone: 'America/Chicago', approximate: true },   // KY west
  { from: 430, to: 459, zone: 'America/New_York' },      // OH
  { from: 460, to: 475, zone: 'America/New_York', approximate: true },  // IN
  { from: 476, to: 477, zone: 'America/Chicago' },       // IN — Evansville
  { from: 478, to: 479, zone: 'America/New_York' },      // IN
  { from: 480, to: 499, zone: 'America/New_York', approximate: true },  // MI (western UP Central)
  { from: 500, to: 528, zone: 'America/Chicago' },       // IA
  { from: 530, to: 549, zone: 'America/Chicago' },       // WI
  { from: 550, to: 567, zone: 'America/Chicago' },       // MN
  { from: 570, to: 574, zone: 'America/Chicago' },       // SD east
  { from: 575, to: 577, zone: 'America/Denver' },        // SD west
  { from: 580, to: 585, zone: 'America/Chicago' },       // ND
  { from: 586, to: 586, zone: 'America/Denver' },        // ND — Dickinson
  { from: 587, to: 588, zone: 'America/Chicago' },       // ND — Williston
  { from: 590, to: 599, zone: 'America/Denver' },        // MT
  { from: 600, to: 629, zone: 'America/Chicago' },       // IL
  { from: 630, to: 658, zone: 'America/Chicago' },       // MO
  { from: 660, to: 676, zone: 'America/Chicago' },       // KS east
  { from: 677, to: 679, zone: 'America/Denver', approximate: true },    // KS west
  { from: 680, to: 689, zone: 'America/Chicago' },       // NE east
  { from: 690, to: 693, zone: 'America/Denver', approximate: true },    // NE panhandle
  { from: 700, to: 714, zone: 'America/Chicago' },       // LA
  { from: 716, to: 729, zone: 'America/Chicago' },       // AR
  { from: 730, to: 749, zone: 'America/Chicago' },       // OK
  { from: 750, to: 797, zone: 'America/Chicago' },       // TX
  { from: 798, to: 799, zone: 'America/Denver' },        // TX — El Paso
  { from: 800, to: 816, zone: 'America/Denver' },        // CO
  { from: 820, to: 831, zone: 'America/Denver' },        // WY
  { from: 832, to: 837, zone: 'America/Denver', approximate: true },    // ID
  { from: 838, to: 838, zone: 'America/Los_Angeles' },   // ID — Lewiston (panhandle)
  { from: 840, to: 847, zone: 'America/Denver' },        // UT
  { from: 850, to: 865, zone: 'America/Phoenix', approximate: true },   // AZ (Navajo Nation DST)
  { from: 870, to: 884, zone: 'America/Denver' },        // NM
  { from: 885, to: 885, zone: 'America/Denver' },        // TX — El Paso
  { from: 889, to: 898, zone: 'America/Los_Angeles' },   // NV
  { from: 900, to: 961, zone: 'America/Los_Angeles' },   // CA
  // 962–966 military (AP) — deliberately absent
  { from: 967, to: 968, zone: 'Pacific/Honolulu' },      // HI
  { from: 969, to: 969, zone: 'Pacific/Guam' },          // GU / MP
  { from: 970, to: 979, zone: 'America/Los_Angeles', approximate: true }, // OR
  { from: 980, to: 994, zone: 'America/Los_Angeles' },   // WA
  { from: 995, to: 999, zone: 'America/Anchorage', approximate: true },   // AK (Aleutians differ)
]

/** The leading 3 digits of a well-formed 5-digit ZIP (ZIP+4 accepted), or null. */
export function zip3Of(zip: string | null | undefined): string | null {
  if (!zip) return null
  const digits = String(zip).replace(/\D/g, '')
  if (digits.length < 5) return null
  return digits.slice(0, 3)
}

function zipRangeFor(zip: string | null | undefined): ZipRange | null {
  const z3 = zip3Of(zip)
  if (!z3) return null
  const n = Number(z3)
  for (const r of ZIP_RANGES) if (n >= r.from && n <= r.to) return r
  return null
}

/**
 * IANA zone for a ZIP, or null for a malformed ZIP, a military APO/FPO prefix, or an
 * unassigned range. Null is a real answer — never substitute a default.
 */
export function timeZoneForZip(zip: string | null | undefined): IanaZone | null {
  return zipRangeFor(zip)?.zone ?? null
}

// ─────────────────────────────────────────────────────────────────────────────
// Composed resolution
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolve a recipient's IANA timezone from their phone NPA (primary) or ZIP (secondary).
 *
 * Order and fall-through: the phone is tried first because it is the only contact field
 * present on `household_members`, which is how automated outreach resolves a recipient. A
 * phone that yields nothing — non-geographic, unknown, unparseable — falls through to the
 * ZIP rather than failing outright, so a toll-free number on a contact that DOES have an
 * address still resolves.
 *
 * FAILS CLOSED. When neither input places the recipient, the result carries no `timeZone`
 * and names why. The dispatch chokepoint treats that as "no send" plus an escalation,
 * distinct from "outside window".
 */
export function resolveRecipientTimeZone(input: TimezoneResolutionInput): TimezoneResolution {
  const attempted: TimezoneMethod[] = []

  // Both inputs are resolved INDEPENDENTLY, then reconciled. Taking the NPA and never
  // consulting the ZIP would silently discard disagreeing evidence — and a phone kept from
  // a previous state is exactly the case where the ZIP is the truer signal.
  let npaZone: IanaZone | null = null
  let npaValue: string | null = null
  let npaApprox = false
  let npaReason: TimezoneUnresolvedReason | null = null
  if (input.phone) {
    attempted.push('npa')
    const npa = npaOf(input.phone)
    if (!npa) {
      npaReason = 'unparseable_phone'
    } else if (NON_GEOGRAPHIC_NPAS.has(npa)) {
      npaReason = 'non_geographic_npa'
    } else {
      const zone = NPA_TO_ZONE.get(npa)
      if (zone) {
        npaZone = zone
        npaValue = npa
        npaApprox = APPROXIMATE_NPAS.has(npa)
      } else {
        npaReason = 'unknown_npa'
      }
    }
  }

  let zipZone: IanaZone | null = null
  let zipValue: string | null = null
  let zipApprox = false
  let zipReason: TimezoneUnresolvedReason | null = null
  if (input.zip) {
    attempted.push('zip')
    const z3 = zip3Of(input.zip)
    if (!z3) {
      zipReason = 'unparseable_zip'
    } else {
      const range = zipRangeFor(input.zip)
      if (range) {
        zipZone = range.zone
        zipValue = z3
        zipApprox = range.approximate === true
      } else {
        zipReason = 'unknown_zip'
      }
    }
  }

  if (npaZone && zipZone) {
    // Both resolved. Agreement → one zone, method 'both' (both pieces of evidence are
    // recorded). Disagreement → the NPA zone stays primary and the ZIP zone rides along as
    // `secondaryTimeZone`; the caller must satisfy BOTH windows (quiet-hours-window.ts
    // combineQuietHoursDecisions), which can only be narrower than either alone.
    return {
      resolved: true,
      timeZone: npaZone,
      ...(npaZone === zipZone ? {} : { secondaryTimeZone: zipZone }),
      method: 'both',
      input: `${npaValue}+${zipValue}`,
      approximate: npaApprox || zipApprox,
    }
  }
  if (npaZone) {
    return { resolved: true, timeZone: npaZone, method: 'npa', input: npaValue as string, approximate: npaApprox }
  }
  if (zipZone) {
    return { resolved: true, timeZone: zipZone, method: 'zip', input: zipValue as string, approximate: zipApprox }
  }

  // Report the PRIMARY input's failure when one was supplied — it is the more actionable
  // signal (a bad phone on the spine is the fixable thing) — else the ZIP's, else no input.
  const reason: TimezoneUnresolvedReason = npaReason ?? zipReason ?? 'no_input'
  return { resolved: false, reason, attempted }
}
