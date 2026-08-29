// src/lib/comms/recipient-timezone.ts
// RECIPIENT-local timezone resolution for quiet-hours enforcement (WS-005, Gate 1
// decision: "quiet hours → RECIPIENT-local TZ via NPA→IANA. Never venue TZ, never a
// hardcoded default. Unresolved → fail closed, no send.").
//
// Resolution is by NANP area code (NPA) → IANA zone, grouped by state/province below.
// A handful of NPAs straddle a zone boundary (e.g. 850 Tallahassee/Pensacola, 906
// Michigan UP); each carries its DOMINANT zone — standard NPA-based practice for TCPA
// quiet-hour windows. Toll-free, premium, non-NANP and unknown NPAs resolve to null,
// and the CALLER MUST FAIL CLOSED on null (defer, never send) — there is deliberately
// no default zone in this module.
//
// DST correctness comes free: offsets are computed from the IANA zone at the moment of
// dispatch via Intl (no fixed offsets stored).

const ZONES: Record<string, string> = {}
function assign(zone: string, npas: string) {
  for (const npa of npas.split(/[\s,]+/).filter(Boolean)) ZONES[npa] = zone
}

// ── US Eastern ─────────────────────────────────────────────────────────────────
assign('America/New_York', `
  203 475 860 959                       ` /* CT */ + `
  302                                   ` /* DE */ + `
  202 771                               ` /* DC */ + `
  239 305 321 352 386 407 448 561 656 689 727 754 772 786 813 863 904 941 954 ` /* FL (east/peninsula) */ + `
  850                                   ` /* FL panhandle — Tallahassee-dominant */ + `
  229 404 470 478 678 706 762 770 912 943 ` /* GA */ + `
  260 317 463 574 765 812 930           ` /* IN (Eastern; 219 is Central) */ + `
  502 606 859                           ` /* KY (east) */ + `
  207                                   ` /* ME */ + `
  240 301 410 443 667               ` /* MD */ + `
  339 351 413 508 617 774 781 857 978   ` /* MA */ + `
  231 248 269 313 517 586 616 734 810 906 947 989 ` /* MI (Eastern-dominant) */ + `
  603                                   ` /* NH */ + `
  201 551 609 640 732 848 856 862 908 973 ` /* NJ */ + `
  212 315 332 347 363 516 518 585 607 631 646 680 716 718 838 845 914 917 929 934 ` /* NY */ + `
  252 336 704 743 828 910 919 980 984 ` /* NC */ + `
  216 220 234 283 326 330 380 419 440 513 567 614 740 937 ` /* OH */ + `
  215 223 267 272 412 445 484 570 582 610 717 724 814 835 878 ` /* PA */ + `
  401                                   ` /* RI */ + `
  803 839 843 854 864               ` /* SC */ + `
  423 865                               ` /* TN (east) */ + `
  802                                   ` /* VT */ + `
  276 434 540 571 703 757 804 826 948 ` /* VA */ + `
  304 681                               ` /* WV */)

// ── US Central ─────────────────────────────────────────────────────────────────
assign('America/Chicago', `
  205 251 256 334 659 938           ` /* AL */ + `
  327 479 501 870                       ` /* AR */ + `
  217 224 309 312 331 447 464 618 630 708 730 773 779 815 847 872 ` /* IL */ + `
  219                                   ` /* IN (NW corner) */ + `
  319 515 563 641 712                   ` /* IA */ + `
  316 620 785 913                       ` /* KS */ + `
  270 364                              ` /* KY (west) */ + `
  225 318 337 504 985               ` /* LA */ + `
  218 320 507 612 651 763 952       ` /* MN */ + `
  228 601 662 769                       ` /* MS */ + `
  314 417 557 573 636 660 816 975   ` /* MO */ + `
  308 402 531                           ` /* NE */ + `
  701                                   ` /* ND */ + `
  405 539 572 580 918                   ` /* OK */ + `
  605                                   ` /* SD */ + `
  615 629 731 901 931                   ` /* TN (west/middle) */ + `
  210 214 254 281 325 346 361 409 430 432 469 512 682 713 726 737 806 817 830 832 903 936 940 945 956 972 979 ` /* TX (Central; 915 is Mountain) */ + `
  262 414 534 608 715 920       ` /* WI */)

// ── US Mountain ────────────────────────────────────────────────────────────────
assign('America/Denver', `
  303 719 720 970 983               ` /* CO */ + `
  208 986                               ` /* ID (Boise-dominant) */ + `
  406                                   ` /* MT */ + `
  505 575                               ` /* NM */ + `
  915                                   ` /* TX — El Paso */ + `
  385 435 801                           ` /* UT */ + `
  307                                   ` /* WY */)
assign('America/Phoenix', `480 520 602 623 928`) /* AZ — no DST */

// ── US Pacific ─────────────────────────────────────────────────────────────────
assign('America/Los_Angeles', `
  209 213 279 310 323 341 350 408 415 424 442 510 530 559 562 619 626 628 650 657 661 669 707 714 747 760 805 818 820 831 840 858 909 916 925 949 951 ` /* CA */ + `
  702 725 775                           ` /* NV */ + `
  458 503 541 971                       ` /* OR */ + `
  206 253 360 425 509 564               ` /* WA */)

// ── US Alaska / Hawaii / territories ───────────────────────────────────────────
assign('America/Anchorage', `907`)
assign('Pacific/Honolulu', `808`)
assign('America/Puerto_Rico', `787 939 340`) /* PR + USVI (AST, no DST) */
assign('Pacific/Guam', `671`)
assign('Pacific/Saipan', `670`)
assign('Pacific/Pago_Pago', `684`)

// ── Canada (dominant zone per NPA) ─────────────────────────────────────────────
assign('America/Toronto', `226 249 289 343 365 382 416 437 519 548 613 647 705 742 753 807 905`) /* ON */
assign('America/Toronto', `263 354 367 418 438 450 468 514 579 581 819 873`) /* QC (same zone) */
assign('America/Vancouver', `236 250 257 604 672 778`)
assign('America/Edmonton', `368 403 587 780 825`)
assign('America/Regina', `306 474 639`) /* SK — no DST */
assign('America/Winnipeg', `204 431 584`)
assign('America/Halifax', `506 782 902`) /* NB + NS/PEI */
assign('America/St_Johns', `709`)

/** Extract the NANP area code from a phone number in any common format. */
export function npaOf(phone: string | null | undefined): string | null {
  if (!phone) return null
  const digits = phone.replace(/\D/g, '')
  if (digits.length === 11 && digits.startsWith('1')) return digits.slice(1, 4)
  if (digits.length === 10) return digits.slice(0, 3)
  return null
}

/**
 * IANA zone for a recipient phone number, or null when it cannot be resolved
 * (non-NANP, toll-free, unknown NPA). NULL MEANS FAIL CLOSED — the caller must not
 * send; there is deliberately no default zone.
 */
export function ianaZoneForPhone(phone: string | null | undefined): string | null {
  const npa = npaOf(phone)
  if (!npa) return null
  return ZONES[npa] ?? null
}

/**
 * Whole-hour UTC offset for an IANA zone at an instant, DST-correct via Intl.
 * Returns null (fail closed) when the zone cannot be resolved by Intl.
 */
export function utcOffsetHoursForZone(timeZone: string, atMs: number): number | null {
  try {
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    })
    const parts = dtf.formatToParts(new Date(atMs))
    const map: Record<string, number> = {}
    for (const p of parts) if (p.type !== 'literal') map[p.type] = Number(p.value)
    const asUtc = Date.UTC(map.year, (map.month ?? 1) - 1, map.day, map.hour === 24 ? 0 : map.hour, map.minute, map.second)
    return Math.round((asUtc - atMs) / 3_600_000)
  } catch {
    return null
  }
}
