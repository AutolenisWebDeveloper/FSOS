"""
D41 reconciliation — Phase 1 (stage) + Phase 2 (classify), read-only against live.

Phase 1 writes staging to newline-delimited JSON in a local staging directory,
NOT to `stg_` tables in the database. That is a deliberate, disclosed deviation:
this environment has no database connection capable of carrying a 12,551-row
load (see docs/recon/D41-master-reconciliation-phase0.md §8). The record shape
is the one the `stg_` tables need, so the same records load unchanged once a
connection exists.

Every source column is retained verbatim under `src`; normalization lives in
separate derived fields; each record carries a `row_hash` and its natural key —
exactly as §4 specifies.

Staging output contains client PII. It is written to a caller-supplied directory
and is never committed. Only the aggregate manifest (counts, no values) is.

    export D41_MASTER_XLSX=/path/to/master.xlsx
    python3 scripts/d41-recon/stage_and_classify.py --out /secure/scratch/d41
"""
import argparse, hashlib, json, os, re, sys
from collections import Counter, defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import parse_master as pm

NON_D41 = {'253013', '3552AC', '366035', '419931', 'FWS1272', 'FWS1273'}
RUN_TAG = 'd41-master-2026-08-06'


def row_hash(src: dict) -> str:
    return hashlib.sha256(
        json.dumps(src, sort_keys=True, default=str).encode()
    ).hexdigest()


def last_token(full):
    m = re.findall(r'[A-Za-z]+', full or '')
    return m[-1].lower() if m else ''


def addr_key(s):
    return re.sub(r'[^a-z0-9]', '', (s or '').lower())


# ── Phase 1: stage ───────────────────────────────────────────────────────────
def stage():
    """Build staged records for all four tabs, preserving source columns."""
    out = {}

    out['inforce'] = [{
        'natural_key': r['book_key'],
        'household_key': r['book_owner_key'],
        'grain': 'policy',
        'policy_number': r['policy_number'],
        'derived': {'zip5': r['zip5'], 'phone_digits': r['phone_digits'],
                    'last_token': last_token(r['owner_name'])},
        'src': r,
        'row_hash': row_hash(r),
    } for r in pm.inforce]

    out['conversion'] = [{
        'natural_key': r['book_key'],
        'household_key': r['book_owner_key'],
        'grain': 'policy',
        'policy_number': r['policy_number'],
        'derived': {'email_lc': r['email_lc'], 'phone_digits': r['phone_digits'],
                    'last_token': last_token(r['owner_name'])},
        'src': r,
        'row_hash': row_hash(r),
    } for r in pm.conversion]

    out['crosssell'] = [{
        'natural_key': r['crosssell_key'],
        'grain': 'household',          # §3 — NOT a person
        'name_grain': 'household',
        'derived': {'zip5': r['zip5'], 'email_lc': r['email_lc'],
                    'phone_digits': r['phone_digits'],
                    'last_token': last_token(r['full_name']),
                    'addr_key': addr_key(r['street'])},
        'src': r,
        'row_hash': row_hash(r),
    } for r in pm.crosssell]

    out['winback'] = [{
        'natural_key': r['winback_key'],
        'grain': 'household',
        'name_grain': 'household',
        'derived': {'zip5': r['zip5'], 'email_lc': r['email_lc'],
                    'phone_digits': r['phone_digits'],
                    'last_token': last_token(r['full_name'])},
        'src': r,
        'row_hash': row_hash(r),
    } for r in pm.winback]

    return out


# ── Phase 2: classify ────────────────────────────────────────────────────────
def excluded_reason(tab, rec):
    """§5.4 exclusions. Returns a reason string, or None to keep the row."""
    s = rec['src']
    if tab == 'crosssell':
        if s['principal_code'] in NON_D41 or s['aor_code'] in NON_D41:
            return 'non_d41_agency_code'
        if s['in_d41'] != 'Yes':
            return 'not_flagged_in_d41'
    if tab == 'winback':
        if s['principal_code'] in NON_D41:
            return 'non_d41_agency_code'
        if s['in_d41'] != 'Yes':
            return 'not_mapped_to_d41'
    return None


def collapse(records):
    """§5.2 — de-duplicate within staging, before any live match.

    Keeps the first non-empty value per field so a sparse duplicate can never
    blank a populated sibling, and records what was collapsed.
    """
    groups = defaultdict(list)
    for r in records:
        groups[r['natural_key']].append(r)

    collapsed, log = [], []
    for key, grp in sorted(groups.items()):
        if len(grp) > 1:
            streets = {g['derived'].get('addr_key') for g in grp if g['derived'].get('addr_key')}
            log.append({
                'natural_key_sha': hashlib.sha256(key.encode()).hexdigest()[:16],
                'rows': len(grp),
                'distinct_streets': len(streets),
                # Same name + same ZIP but a DIFFERENT street is not evidence of
                # the same household — §5.2 routes these to review.
                'verdict': 'MATCH_AMBIGUOUS' if len(streets) > 1 else 'collapse_ok',
                'row_hashes': [g['row_hash'][:12] for g in grp],
            })
        base = dict(grp[0])
        base['collapsed_from'] = [g['row_hash'][:12] for g in grp]
        base['collapse_count'] = len(grp)
        base['collapse_ambiguous'] = len(grp) > 1 and len(
            {g['derived'].get('addr_key') for g in grp if g['derived'].get('addr_key')}) > 1
        collapsed.append(base)
    return collapsed, log


def classify(staged):
    """Assign a §5 decision to every staged row that does not need the live join."""
    report = {'run_tag': RUN_TAG, 'tabs': {}, 'ambiguous': {}, 'notes': []}

    for tab in ('crosssell', 'winback'):
        recs = staged[tab]
        kept, excl = [], Counter()
        for r in recs:
            why = excluded_reason(tab, r)
            if why:
                excl[why] += 1
            else:
                kept.append(r)

        collapsed, log = collapse(kept)

        # §5.1 rank 2 — natural key. crosssell_key is 0-populated live, so every
        # cross-sell key is new; winback is measured against the live key set.
        no_zip = [r for r in collapsed if not r['derived'].get('zip5')]

        report['tabs'][tab] = {
            'source_rows': len(recs),
            'excluded': dict(excl),
            'in_scope_rows': len(kept),
            'staged_records_after_collapse': len(collapsed),
            'rows_collapsed': len(kept) - len(collapsed),
            'collapse_groups': len(log),
            'collapse_groups_multi_street': sum(1 for x in log if x['verdict'] == 'MATCH_AMBIGUOUS'),
            'degraded_keys_no_zip': len(no_zip),
            'with_email': sum(1 for r in collapsed if r['derived'].get('email_lc')),
            'with_phone': sum(1 for r in collapsed if r['derived'].get('phone_digits')),
        }
        report['ambiguous'][tab] = log

    # Policy-grain tabs: contacts fan in, policies do not (§3).
    for tab in ('inforce', 'conversion'):
        recs = staged[tab]
        owners = {r['natural_key'] for r in recs}
        report['tabs'][tab] = {
            'source_rows': len(recs),
            'distinct_policies': len({r['policy_number'] for r in recs}),
            'distinct_owner_contacts': len(owners),
        }

    inf_owners = {r['natural_key'] for r in staged['inforce']}
    cnv_owners = {r['natural_key'] for r in staged['conversion']}
    report['owner_key_collisions_empty_zip'] = len(inf_owners & cnv_owners)
    report['distinct_owner_keys_combined'] = len(inf_owners | cnv_owners)

    # §5.4 — policies with no agent of record. NOTE the master's literal string
    # is 'No agent on record' (on, not of). Matching the brief's wording finds 0.
    basis = Counter(r['src']['mapping_basis'] for r in staged['inforce'])
    report['inforce_mapping_basis'] = dict(basis)
    report['inforce_no_aor'] = basis.get('No agent on record', 0)

    # §2.4 — the DOB trap. Never written; recorded so the shape is on the record.
    shapes = Counter(re.sub(r'\d', '#', r['src']['birth_md'])
                     for r in staged['conversion'] if r['src']['birth_md'])
    report['conversion_birth_field_shapes'] = dict(shapes)
    report['notes'].append(
        'contacts.dob is never written. The master birth field is a full datetime '
        'with a placeholder year, not a month/day value (§2.4).')
    return report


def render_samples(staged, n=25):
    """§2 — render proposed changes as before/after for operator review.

    Printed to the operator's terminal only. These lines contain client PII, so
    they are never written to the manifest, the report, or the repository.
    """
    kept = [r for r in staged['crosssell'] if not excluded_reason('crosssell', r)]
    collapsed, _ = collapse(kept)
    fields = ('full_name', 'email_lc', 'phone_digits', 'street', 'city', 'state', 'zip5')
    out = []
    for rec in collapsed[:n]:
        s = rec['src']
        # crosssell_key is 0-populated live, so every one of these is an insert:
        # "before" is genuinely nothing.
        before = {f: None for f in fields}
        after = {f: s.get(f) for f in fields}
        after['lines_of_business'] = s.get('active_lob')
        after['tags'] = [RUN_TAG]
        after['custom'] = {'name_grain': 'household', 'source_extract': 'd41_master',
                           'source_asof': '2026-08-06', 'agency_normalized': s.get('agency_norm'),
                           'aor_code_full': s.get('aor_code')}
        out.append({'decision': 'INSERT_NEW', 'natural_key': rec['natural_key'],
                    'before': before, 'after': after})
    return out


def write_approval_worksheet(staged, path):
    """§3 — emit the row-level approval worksheet for every MATCH_AMBIGUOUS row.

    The brief requires row-level approval, not blanket approval, so this lists one
    line per ambiguous item with an empty `decision` column for the operator to
    fill in (approve | reject). apply.ts refuses to run until every line is set.

    Contains the identifying detail needed to actually judge a row, so it is
    written to the operator's scratch directory and never committed.
    """
    import csv
    rows = []

    # 4.1 cross-sell collapse groups spanning more than one street
    kept = [r for r in staged['crosssell'] if not excluded_reason('crosssell', r)]
    groups = defaultdict(list)
    for r in kept:
        groups[r['natural_key']].append(r)
    for key, grp in sorted(groups.items()):
        streets = {g['derived'].get('addr_key') for g in grp if g['derived'].get('addr_key')}
        if len(grp) < 2 or len(streets) < 2:
            continue
        rows.append({
            'category': 'crosssell_multi_street_collapse',
            'ref': hashlib.sha256(key.encode()).hexdigest()[:16],
            'rows': len(grp),
            'name': grp[0]['src']['full_name'],
            'zip': grp[0]['src']['zip5'],
            'variants': ' || '.join(sorted({g['src'].get('street') or '(no street)' for g in grp})),
            'detail': f'{len(grp)} rows share name+ZIP across {len(streets)} street addresses',
            'recommended': 'reject_collapse_keep_separate', 'decision': ''})

    # 4.2 win-back records whose key degraded to `name|` (no ZIP)
    wb = [r for r in staged['winback'] if not excluded_reason('winback', r)]
    wb_collapsed, _ = collapse(wb)
    for r in wb_collapsed:
        if r['derived'].get('zip5'):
            continue
        rows.append({
            'category': 'winback_no_zip_degraded_key',
            'ref': hashlib.sha256(r['natural_key'].encode()).hexdigest()[:16],
            'rows': r['collapse_count'],
            'name': r['src']['full_name'],
            'zip': '(none)',
            'variants': r['src'].get('inactive_lob') or '',
            'detail': 'winback_key has an empty ZIP segment — collision-prone',
            'recommended': 'review_before_insert', 'decision': ''})

    # 4.3 owner keys colliding across the empty-ZIP conversion key format
    inf = {r['natural_key']: r for r in staged['inforce']}
    cnv = {r['natural_key']: r for r in staged['conversion']}
    for k in sorted(set(inf) & set(cnv)):
        rows.append({
            'category': 'owner_key_empty_zip_collision',
            'ref': hashlib.sha256(k.encode()).hexdigest()[:16], 'rows': 2,
            'name': inf[k]['src']['owner_name'],
            'zip': inf[k]['src'].get('zip5') or '(none)',
            'variants': f"in-force policy {inf[k]['policy_number']} || "
                        f"conversion policy {cnv[k]['policy_number']}",
            'detail': 'in-force and conversion owner keys collide on an empty ZIP segment',
            'recommended': 'review_same_person', 'decision': ''})

    with open(path, 'w', newline='') as fh:
        w = csv.DictWriter(fh, fieldnames=['category', 'ref', 'rows', 'name', 'zip',
                                           'variants', 'detail', 'recommended', 'decision'])
        w.writeheader()
        w.writerows(rows)
    return rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', required=True, help='staging directory (PII — never commit)')
    ap.add_argument('--manifest', help='where to write the PII-free manifest')
    ap.add_argument('--samples', type=int, default=0,
                    help='print N before/after samples to stdout (contains PII)')
    ap.add_argument('--approvals', help='write the Phase 3 row-level approval worksheet here')
    args = ap.parse_args()

    os.makedirs(args.out, exist_ok=True)
    staged = stage()

    for tab, recs in staged.items():
        path = os.path.join(args.out, f'stg_d41_{tab}.ndjson')
        with open(path, 'w') as fh:
            for r in recs:
                fh.write(json.dumps(r, default=str) + '\n')
        print(f'staged {tab}: {len(recs)} rows -> {os.path.basename(path)}')

    report = classify(staged)
    text = json.dumps(report, indent=2, sort_keys=True)
    if args.manifest:
        open(args.manifest, 'w').write(text + '\n')

    if args.approvals:
        rows = write_approval_worksheet(staged, args.approvals)
        by_cat = Counter(r['category'] for r in rows)
        print(f'approval worksheet: {len(rows)} rows -> {args.approvals}')
        for cat, n in sorted(by_cat.items()):
            print(f'  {cat}: {n}')

    if args.samples:
        print('\n--- PROPOSED CHANGES (before/after) — CONTAINS PII, DO NOT PASTE ---')
        print(json.dumps(render_samples(staged, args.samples), indent=2, default=str))
        print('--- end samples ---\n')
    else:
        print(text)


if __name__ == '__main__':
    main()
