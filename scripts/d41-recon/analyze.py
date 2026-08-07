"""Phase 0/2 analysis — staging-internal dedup, exclusions, grain collapse.
Counts only; no PII printed."""
from parse_master import *
from collections import Counter, defaultdict

R = {}

# ── §5.4 exclusions ──────────────────────────────────────────────────────────
NON_D41 = {'253013', '3552AC', '366035', '419931', 'FWS1272', 'FWS1273'}

xs_excl = [r for r in crosssell if r['principal_code'] in NON_D41 or r['aor_code'] in NON_D41]
xs_incl = [r for r in crosssell if r not in xs_excl]
R['crosssell_excluded_non_d41'] = len(xs_excl)
R['crosssell_excluded_codes'] = sorted(Counter(
    [r['principal_code'] for r in xs_excl] + [r['aor_code'] for r in xs_excl]
).items())
R['crosssell_in_d41_flag'] = Counter(r['in_d41'] for r in crosssell)

wb_excl = [r for r in winback if r['principal_code'] in NON_D41]
R['winback_excluded_non_d41'] = len(wb_excl)
R['winback_in_d41_flag'] = Counter(r['in_d41'] for r in winback)

# ── conversion record status (§5.4 dropped rows) ─────────────────────────────
R['conversion_record_status'] = Counter(r['record_status'] for r in conversion)
R['conversion_in_0806'] = Counter(r['in_0806'] for r in conversion)
R['conversion_wpc_full_present'] = sum(1 for r in conversion if r['wpc_full'])
R['conversion_aor_0806_present'] = sum(1 for r in conversion if r['aor_0806'])

# ── §5.4 no-agent-of-record policies ─────────────────────────────────────────
R['inforce_mapping_basis'] = Counter(r['mapping_basis'] for r in inforce).most_common(10)
R['inforce_no_aor'] = sum(1 for r in inforce if r['mapping_basis'] == 'No agent of record')

# ── §3 grain: policies fan out, contacts do not ──────────────────────────────
inf_owner = defaultdict(list)
for r in inforce:
    inf_owner[r['book_key']].append(r)
R['inforce_policies'] = len(inforce)
R['inforce_distinct_owner_contacts'] = len(inf_owner)

cnv_owner = defaultdict(list)
for r in conversion:
    cnv_owner[r['book_key']].append(r)
R['conversion_policies'] = len(conversion)
R['conversion_distinct_owner_contacts'] = len(cnv_owner)

# owners appearing in BOTH policy tabs (same book_key)? NB: conversion keys have
# an empty zip segment, so they can only collide with in-force owners whose zip
# is also empty — the known key-format asymmetry.
R['owner_key_overlap_inforce_vs_conversion'] = len(set(inf_owner) & set(cnv_owner))
R['inforce_owners_with_empty_zip'] = sum(1 for k in inf_owner if k.endswith('|'))

# ── §5.2 staging-internal duplicate keys ─────────────────────────────────────
xs_key = Counter(r['crosssell_key'] for r in xs_incl)
R['crosssell_rows_in_scope'] = len(xs_incl)
R['crosssell_distinct_keys'] = len(xs_key)
R['crosssell_key_collisions'] = sum(v - 1 for v in xs_key.values() if v > 1)
R['crosssell_keys_with_collision'] = sum(1 for v in xs_key.values() if v > 1)
R['crosssell_blank_zip'] = sum(1 for r in xs_incl if not r['zip5'])
R['crosssell_dup_name_flag'] = Counter(r['dup_flag'] for r in crosssell)

wb_key = Counter(r['winback_key'] for r in winback)
R['winback_distinct_keys'] = len(wb_key)
R['winback_key_collisions'] = sum(v - 1 for v in wb_key.values() if v > 1)
R['winback_keys_with_collision'] = sum(1 for v in wb_key.values() if v > 1)
R['winback_blank_zip'] = sum(1 for r in winback if not r['zip5'])

# collapse detail: do colliding rows agree on street/contact points?
def collapse_detail(rows, key):
    g = defaultdict(list)
    for r in rows:
        g[r[key]].append(r)
    same_street = diff_street = 0
    for k, v in g.items():
        if len(v) < 2:
            continue
        streets = {r.get('street', '') for r in v}
        if len(streets) == 1:
            same_street += len(v) - 1
        else:
            diff_street += len(v) - 1
    return same_street, diff_street

R['crosssell_collapse_same_street'], R['crosssell_collapse_diff_street'] = collapse_detail(xs_incl, 'crosssell_key')

# ── contactability (drives fill-gain, NOT consent) ───────────────────────────
for nm, rows in (('crosssell', xs_incl), ('winback', winback)):
    R[f'{nm}_with_email'] = sum(1 for r in rows if r['email_lc'])
    R[f'{nm}_with_phone'] = sum(1 for r in rows if r['phone_digits'])
    R[f'{nm}_phone_dnc_flag'] = sum(1 for r in rows if r['phone_dnc'])
    R[f'{nm}_email_unsub_flag'] = sum(1 for r in rows if r['email_unsub'])

R['conversion_with_email'] = sum(1 for r in conversion if r['email_lc'])
R['conversion_with_phone'] = sum(1 for r in conversion if r['phone_digits'])

# ── §2.4 the DOB trap ────────────────────────────────────────────────────────
R['conversion_birth_md_present'] = sum(1 for r in conversion if r['birth_md'])
R['conversion_birth_md_samples_shape'] = Counter(
    re.sub(r'\d', '#', r['birth_md'])[:12] for r in conversion if r['birth_md']
).most_common(5)

for k, v in R.items():
    print(f'{k}: {v}')
