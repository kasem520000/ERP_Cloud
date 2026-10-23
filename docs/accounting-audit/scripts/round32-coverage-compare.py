#!/usr/bin/env python3
"""R32 prep — compare our DEFECTS.md (this checkout) against the remediation
branch's docs/accounting-remediation/DEFECTS_MATRIX.md (read via `git show`,
no checkout).  Prints: coverage, defects missing from the matrix (grouped by
round/severity), and matrix rows whose status is not "fixed".

Usage:  python3 docs/accounting-audit/scripts/round32-coverage-compare.py \
            [git-ref=origin/arena/163dfc4b-erp-cloud] [--json out.json]
Run from the repository root after:
    git fetch origin +refs/heads/arena/163dfc4b-erp-cloud:refs/remotes/origin/arena/163dfc4b-erp-cloud
"""
import json
import re
import subprocess
import sys
from collections import Counter, defaultdict

OUT = sys.argv[sys.argv.index('--json') + 1] if '--json' in sys.argv else None
REF = next((a for a in sys.argv[1:] if not a.startswith('--') and a != OUT), 'origin/arena/163dfc4b-erp-cloud')
SEV_ORDER = {'CRITICAL': 0, 'HIGH': 1, 'MEDIUM': 2, 'LOW': 3, 'ENHANCEMENT': 4}


def parse_defects(path='docs/accounting-audit/DEFECTS.md'):
    items, cur, rnd = [], None, None
    for line in open(path, encoding='utf-8').read().splitlines():
        if re.match(r'^#{1,2} (?!(ACC|UI)-)', line):
            m = re.search(r'(?:الجولة|R)\s?(\d+)', line)
            if m:
                rnd = int(m.group(1))
        h = re.match(r'^#{2,3} ([A-Z]+-\d+)\s*[—-]+\s*([A-Z]+)\s*(.*)$', line)
        if h:
            cur = {'id': h.group(1), 'sev': h.group(2), 'title': h.group(3).strip(' —-'), 'round': rnd}
            items.append(cur)
        elif cur is not None and re.match(r'^#{1,3} ', line):
            cur = None
    return items


def parse_matrix(ref):
    text = subprocess.run(['git', 'show', f'{ref}:docs/accounting-remediation/DEFECTS_MATRIX.md'],
                          capture_output=True, text=True, check=True).stdout
    rows = {}
    for line in text.splitlines():
        if not line.startswith('| **'):
            continue
        cells = [c.strip() for c in line.strip().strip('|').split('|')]
        raw_id = cells[0].strip('*')
        base = raw_id.split('-B')[0]
        rows.setdefault(base, []).append({'id': raw_id, 'status': cells[-1], 'component': cells[4] if len(cells) > 4 else ''})
    return rows


def key(i):
    return (i.split('-')[0], int(i.split('-')[1]))


ours = {d['id']: d for d in parse_defects()}
matrix = parse_matrix(REF)
tip = subprocess.run(['git', 'log', '-1', '--format=%h %ad %s', '--date=short', REF], capture_output=True, text=True).stdout.strip()
missing = sorted(set(ours) - set(matrix), key=key)
not_fixed = [(i, r['status']) for i in sorted(matrix, key=key) for r in matrix[i] if not r['status'].startswith('تم الإصلاح')]

print(f'remediation ref: {REF} -> {tip}')
print(f'our defects: {len(ours)} | in matrix: {len(set(ours) & set(matrix))} | missing from matrix: {len(missing)}')
by_round = defaultdict(list)
for i in missing:
    by_round[ours[i]['round']].append(i)
for rnd in sorted(by_round, key=lambda r: r or 0):
    sev = Counter(ours[i]['sev'] for i in by_round[rnd])
    print(f'  R{rnd}: {len(by_round[rnd])} -> ' + ', '.join(f'{i}({ours[i]["sev"][0]})' for i in sorted(by_round[rnd], key=key)))
print(f'matrix rows not marked fixed: {len(not_fixed)}')
for i, st in not_fixed:
    print(f'  {i}: {st}')
extra = sorted(set(matrix) - set(ours), key=key)
if extra:
    print('matrix ids unknown to our DEFECTS.md:', extra)
if OUT:
    json.dump({'ref': REF, 'tip': tip, 'missing': missing, 'not_fixed': not_fixed,
               'severity_of_missing': dict(Counter(ours[i]['sev'] for i in missing))},
              open(OUT, 'w'), ensure_ascii=False, indent=1)
    print('written', OUT)
