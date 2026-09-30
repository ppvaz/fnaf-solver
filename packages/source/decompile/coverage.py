#!/usr/bin/env python3
"""Classify every event group and report what the project has actually read.

Targeted lookups answer a question but never tell you what you have not looked
at. This walks the whole office frame, sorts each group by what it can change,
and cross-references the group numbers cited anywhere in the repo -- so the
blind spots are a list instead of a feeling.

    packages/source/decompile/coverage.py            # summary + the unread state clusters
    packages/source/decompile/coverage.py --map      # the full per-cluster map (Markdown)

Classes, in order of how much a missing group would matter:

  state         writes a character's position or alterable values, or one of
                the named gameplay counters -- a mechanic can hide here
  setup         per-night constants (AI levels, battery, fuse length)
  input         reads a touch or key and writes player-facing state
  presentation  only draws: view frames, animations, sounds, transparency
"""
import argparse
import glob
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
_reader = open(os.path.join(os.path.dirname(os.path.abspath(__file__)),
                            'readdump.py')).read().split('def main()')[0]
_ns = {}
exec(_reader, _ns)
Dump = _ns['Dump']

OFFICE_FRAME = 3

CHARACTERS = {
    'old freddy', 'old bonnie', 'old chica', 'old foxy',
    'new freddy', 'new bonnie', 'new chica', 'new foxy',
    'balloon boy', 'sockpuppet', 'paper pals', 'golden', 'yellowbear', 'JJ',
}
COUNTERS = {
    'in danger', 'being attacked by', 'drop everything', 'got you stage',
    'check and move', 'viewing', 'lit?', 'battery life', 'time left',
    'time allowed', 'viewing hall light', 'left light', 'right light', 'mask',
    'flip panel button', 'your view', 'hall movement', 'blackout',
}
SETUP = {'night', 'time of the night'}
AI_COUNTERS = re.compile(r'\bAI$')

# Action numbers that only draw something.
PRESENTATION_ACTIONS = {'11', '17', '35', '26', '27', '24', '65', '13', '36',
                        '41', '57', '40', '3', '23', '25'}
POSITION = '1'
SET_ALTERABLE = {'31', '32'}
SET_COUNTER = '80'


def classify(dump, group):
    """Return (class, subsystem-ish targets) for one group."""
    state, setup, presentation, touches_input = set(), set(), False, False

    for line in group['lines']:
        field = line.split('\t')
        cell = dict(zip(field[1::2], field[2::2]))
        name = dump.name(int(cell.get('OI', '0')))
        num = cell.get('NUM')
        if line.startswith(' C'):
            if cell.get('OT') in ('-6', '46'):
                touches_input = True
            continue
        if name in CHARACTERS and (num == POSITION or num in SET_ALTERABLE):
            state.add(name)
        elif name in COUNTERS and (num == SET_COUNTER or num in SET_ALTERABLE):
            state.add(name)
        elif AI_COUNTERS.search(name) or name in SETUP:
            setup.add(name)
        elif num in PRESENTATION_ACTIONS:
            presentation = True

    if state and touches_input:
        return 'input', sorted(state)
    if state:
        return 'state', sorted(state)
    if setup:
        return 'setup', sorted(setup)
    if presentation:
        return 'presentation', []
    return 'other', []


def cited_groups():
    """Every group number referenced in the repo's docs and engine."""
    found = set()
    pattern = re.compile(r'(?:\bg|\bgroups?\s*)(\d{2,4})(?:\s*[-–]\s*(\d{2,4}))?', re.I)
    paths = (glob.glob('**/*.md', recursive=True) + glob.glob('src/*.js') +
             glob.glob('tools/*.mjs'))
    generated_map = os.path.normpath('docs/android/ANDROID-GROUP-MAP.md')
    for path in paths:
        # The report lists every group by construction; counting it would make
        # the coverage map cite itself and erase every blind spot.
        if os.path.normpath(path) == generated_map:
            continue
        try:
            text = open(path, errors='replace').read()
        except OSError:
            continue
        for match in pattern.finditer(text):
            low = int(match.group(1))
            high = int(match.group(2) or low)
            if low <= 2000 and high <= 2000 and high >= low:
                found.update(range(low, high + 1))
    return found


def cluster(rows, gap=3):
    """Group consecutive indices into runs, so the report reads as blocks."""
    runs, current = [], [rows[0]]
    for row in rows[1:]:
        if row[0] - current[-1][0] <= gap:
            current.append(row)
        else:
            runs.append(current)
            current = [row]
    runs.append(current)
    return runs


def main():
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--dump', default=os.environ.get(
        'FNAF2_DUMP', '/private/tmp/fnaf2-android-dump/events-android.txt'))
    parser.add_argument('--frame', type=int, default=OFFICE_FRAME)
    parser.add_argument('--map', action='store_true', help='print the full cluster map')
    opts = parser.parse_args()

    if not os.path.exists(opts.dump):
        sys.exit('no dump at %s -- see docs/android/SOURCE-DUMP-GUIDE.md' % opts.dump)
    dump = Dump(opts.dump)
    frame = dump.frames[opts.frame]
    cited = cited_groups()

    buckets = {}
    for group in frame['groups']:
        kind, targets = classify(dump, group)
        buckets.setdefault(kind, []).append((group['idx'], targets))

    total = len(frame['groups'])
    print(f"frame {opts.frame} ({frame['name']}): {total} groups")
    for kind in ('state', 'input', 'setup', 'presentation', 'other'):
        rows = buckets.get(kind, [])
        if not rows:
            continue
        seen = sum(1 for idx, _ in rows if idx in cited)
        pct = 100 * seen // len(rows)
        print(f"  {kind:<13} {len(rows):>5}   cited {seen:>4} ({pct}%)")

    risky = sorted((r for r in buckets.get('state', []) + buckets.get('input', [])
                    if r[0] not in cited), key=lambda r: r[0])
    print(f"\nunread groups that can change the game: {len(risky)}")
    if risky:
        for run in cluster(risky):
            low, high = run[0][0], run[-1][0]
            targets = sorted({t for _, ts in run for t in ts})
            span = f"g{low}" if low == high else f"g{low}-{high}"
            print(f"  {span:<14} {len(run):>3} groups  {', '.join(targets)[:70]}")

    if opts.map:
        print("\n## Full cluster map\n")
        print("| Groups | Class | Cited | Touches |")
        print("| --- | --- | --- | --- |")
        for kind in ('state', 'input', 'setup', 'presentation'):
            rows = buckets.get(kind, [])
            if not rows:
                continue
            for run in cluster(sorted(rows, key=lambda r: r[0])):
                low, high = run[0][0], run[-1][0]
                span = f"g{low}" if low == high else f"g{low}-{high}"
                seen = sum(1 for idx, _ in run if idx in cited)
                mark = 'yes' if seen == len(run) else ('partial' if seen else '**no**')
                targets = sorted({t for _, ts in run for t in ts})
                print(f"| {span} | {kind} | {mark} | {', '.join(targets)[:60] or '—'} |")


if __name__ == '__main__':
    main()
