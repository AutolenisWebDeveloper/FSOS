"""
D41 master reconciliation — local parse + key derivation.

Key derivation is a faithful port of the repo's existing producers. It is NOT
inferred from sample values:
  ownerKey()           src/lib/import/inforceBook.ts:99
  conversionOwnerKey() src/lib/import/conversionList.ts:284  (ownerKey(name,''))
  book_key prefix      src/app/api/app/{book,conversions}/import/route.ts ('owner:')
  nameKey()            src/lib/import/crossSellList.ts:167, winBackList.ts:88
  crosssell_key        src/lib/import/crossSellList.ts:244   (`${nk}|${zip5}`)
  winback_key          src/lib/import/winBackList.ts:267     (`${nk}|${zip5}`)
  normZip()            src/lib/import/crossSellList.ts:145

No PII is printed by this script — counts and hashes only.
"""
import openpyxl, re, hashlib, json
from collections import defaultdict, Counter

import os, sys

# Path to the master workbook. Never committed to the repo — it is client PII.
PATH = os.environ.get('D41_MASTER_XLSX', '')
if not PATH or not os.path.exists(PATH):
    sys.exit('Set D41_MASTER_XLSX to the District 41 master workbook path.')

# ── repo-faithful normalizers ────────────────────────────────────────────────
def s(v):
    return '' if v is None else str(v).strip()

def owner_key(name, zip_):
    """inforceBook.ts ownerKey(): lower + collapse ws, | zip5(digits only)."""
    n = re.sub(r'\s+', ' ', (name or '').strip().lower())
    z = re.sub(r'\D', '', zip_ or '')[:5]
    return f'{n}|{z}'

def conversion_owner_key(name):
    """conversionList.ts conversionOwnerKey(): ownerKey(name, '')."""
    return owner_key(name, '')

def name_key(name):
    """crossSellList.ts/winBackList.ts nameKey(): strip everything but a-z."""
    return re.sub(r'[^a-z]', '', (name or '').lower())

def norm_zip(raw):
    """crossSellList.ts normZip(): first 5-digit run, optional +4."""
    m = re.search(r'(\d{5})(?:-?(\d{4}))?', re.sub(r'\s', '', raw or ''))
    if not m:
        return None, ''
    z5 = m.group(1)
    return (f'{z5}-{m.group(2)}' if m.group(2) else z5), z5

def strip_household(full):
    """Household-grain tabs: drop the trailing ' Household' token, collapse ws."""
    return re.sub(r'\s+', ' ', re.sub(r'\s+Household\s*$', '', full or '', flags=re.I)).strip()

def usable_name(full):
    """Importer row filter: must contain letters, must not be a total/footer row."""
    return bool(full) and bool(re.search(r'[A-Za-z]', full)) and not re.match(r'^total\b', full, re.I)

PHONE_RE = re.compile(r'\(?\d{3}\)?[\s.-]*\d{3}[\s.-]*\d{4}')
EMAIL_RE = re.compile(r'[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}')

def extract_phone(raw):
    m = PHONE_RE.search(raw or '')
    return (re.sub(r'\s+', ' ', m.group(0)).strip() if m else None,
            bool(re.search(r'\bDNC\b|\bRevoked\b', raw or '', re.I)))

def extract_email(raw):
    m = EMAIL_RE.search(raw or '')
    return (m.group(0) if m else None,
            bool(re.search(r'unsubscribed', raw or '', re.I)))

def phone_digits(p):
    d = re.sub(r'\D', '', p or '')
    return d[-10:] if len(d) >= 10 else (d if len(d) >= 7 else None)

def email_lc(e):
    return (e or '').strip().lower() or None

def h12(x):
    """Stable 48-bit hash — lets the live DB be compared without moving PII."""
    return hashlib.md5(x.encode()).hexdigest()[:12]

# ── load ─────────────────────────────────────────────────────────────────────
wb = openpyxl.load_workbook(PATH, read_only=True)

def tab(name):
    ws = wb[name]
    it = ws.iter_rows(values_only=True)
    hdr = [s(x) for x in next(it)]
    idx = {h: i for i, h in enumerate(hdr)}
    out = []
    for r in it:
        if r is None or all(x is None or str(x).strip() == '' for x in r):
            continue
        out.append(r)
    return idx, out

# ── In-Force Book (policy grain; owner is a person) ──────────────────────────
i_inf, r_inf = tab('In-Force Book')
inforce = []
for r in r_inf:
    g = lambda c: s(r[i_inf[c]]) if c in i_inf else ''
    owner = re.sub(r'\s+', ' ', g('Owner Name'))
    if not usable_name(owner):
        continue
    _, z5 = norm_zip(g('Owner Zip'))
    inforce.append({
        'policy_number': g('Policy Number'),
        'owner_name': owner,
        'zip5': z5,
        'book_owner_key': owner_key(owner, z5),
        'book_key': 'owner:' + owner_key(owner, z5),
        'status_group': g('Status Group'),
        'agency_norm': g('Agency (Normalized)'),
        'agent_code': g('Agent Code'),
        'principal_code': g('Principal Agency Code'),
        'series_code': g('Series Code'),
        'mapping_basis': g('Agency Mapping Basis'),
        'joint_owner': g('Joint Owner Name'),
        'phone_digits': phone_digits(g('Owner Phone Number')),
    })

# ── Conversion (policy grain; owner is a person; NO zip column) ──────────────
i_cnv, r_cnv = tab('Conversion Opportunities')
conversion = []
for r in r_cnv:
    g = lambda c: s(r[i_cnv[c]]) if c in i_cnv else ''
    owner = re.sub(r'\s+', ' ', g('Policy Owner'))
    if not usable_name(owner):
        continue
    em, _ = extract_email(g('Preferred Email'))
    ph, _ = extract_phone(g('Preferred Phone'))
    conversion.append({
        'policy_number': g('Policy Number'),
        'owner_name': owner,
        'book_owner_key': conversion_owner_key(owner),
        'book_key': 'owner:' + conversion_owner_key(owner),
        'email_lc': email_lc(em),
        'phone_digits': phone_digits(ph),
        'record_status': g('Record Status'),
        'in_0806': g('In 08/06 Extract'),
        'in_0726': g('In 07/26 Extract'),
        'wpc_full': g('Writing Producer Code (full)'),
        'aor_0806': g('AOR Code (08/06 Extract)'),
        'principal_code': g('Agency Principal Code'),
        'agency_norm': g('Agency (Normalized)'),
        'urgency': g('Urgency Bucket'),
        'expiry': g('Conversion Expiry Date'),
        'birth_md': g('Insured Birth (Mo/Day — NO YEAR)'),
    })

# ── Cross-Sell (HOUSEHOLD grain) ─────────────────────────────────────────────
i_xs, r_xs = tab('Cross-Sell Opportunities')
crosssell = []
for r in r_xs:
    g = lambda c: s(r[i_xs[c]]) if c in i_xs else ''
    full = strip_household(g('Account Name'))
    if not usable_name(full):
        continue
    _, z5 = norm_zip(g('Zip'))
    em, unsub = extract_email(g('Preferred Household Email'))
    ph, dnc = extract_phone(g('Preferred Household Phone'))
    crosssell.append({
        'full_name': full,
        'zip5': z5,
        'crosssell_key': f'{name_key(full)}|{z5}',
        'email_lc': email_lc(em),
        'phone_digits': phone_digits(ph),
        'phone_dnc': dnc,
        'email_unsub': unsub,
        'street': g('Street'),
        'active_lob': g('Active LOB'),
        'aor_code': g('Agency AOR Code'),
        'principal_code': g('Agency Principal Code'),
        'in_d41': g('In District 41?'),
        'dup_flag': g('Duplicate Account Name?'),
    })

# ── Win-Back (HOUSEHOLD grain) ───────────────────────────────────────────────
i_wb, r_wb = tab('Win-Back Opportunities')
winback = []
for r in r_wb:
    g = lambda c: s(r[i_wb[c]]) if c in i_wb else ''
    full = strip_household(g('Account Name'))
    if not usable_name(full):
        continue
    _, z5 = norm_zip(g('Zip Code'))
    em, unsub = extract_email(g('Preferred Email Address'))
    ph, dnc = extract_phone(g('Preferred Phone Number'))
    winback.append({
        'full_name': full,
        'zip5': z5,
        'winback_key': f'{name_key(full)}|{z5}',
        'email_lc': email_lc(em),
        'phone_digits': phone_digits(ph),
        'phone_dnc': dnc,
        'email_unsub': unsub,
        'inactive_lob': g('Inactive Agency LOB'),
        'life_lost': g('Life Lost?'),
        'principal_code': g('Agency Principal Code'),
        'in_d41': g('In District 41?'),
        'dup_flag': g('Duplicate Account Name?'),
    })

if __name__ == '__main__':
    print(json.dumps({
        'inforce_rows': len(inforce),
        'conversion_rows': len(conversion),
        'crosssell_rows': len(crosssell),
        'winback_rows': len(winback),
    }, indent=2))
