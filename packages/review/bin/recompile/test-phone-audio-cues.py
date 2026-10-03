#!/usr/bin/env python3
"""Gate for phone-audio-cues.py's offset rule: solve_offset and compare_plays on synthetic and retained onsets, and every
number of docs/evidence/full06-audio-realignment-20261001.json re-derived from the cue reads, the rebuild's plays and
the run pack. Needs no capture or binary (solve_offset and compare_plays use no numpy). Runs in `npm run test:unit`;
test-phone-input-ledger.ts checks the input-registration record and the cue records it cites."""
import hashlib, importlib.util, json, os

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..', '..')
def load(path):
    return json.load(open(os.path.join(ROOT, path)))
A = load('tools/recompile/results/phone-audio-cues-full-06-20260928.json')
o = A['offset']
# --- the audio offset is solved over every pairing, and refused when another offset fits as well
spec = importlib.util.spec_from_file_location('cues', os.path.join(ROOT, 'packages/review/bin/recompile/phone-audio-cues.py'))
cues = importlib.util.module_from_spec(spec); spec.loader.exec_module(cues)
masks, raises, lead = [5.43 + 10 * k for k in range(40)], [2.53, 4.13, 10.13, 20.12], 29.754
solved = cues.solve_offset({'s0007': [g + lead for g in masks], 's0005': [g + lead for g in raises]}, {'s0007': masks, 's0005': raises})
assert solved['status'] == 'SOLVED' and solved['audioMinusGameS'] == lead and solved['matches'] == 44
assert cues.solve_offset({'s0007': [g + lead for g in masks]}, {'s0007': masks})['status'] == 'AMBIGUOUS', 'a periodic anchor fits every whole period'
old = cues.solve_offset({'s0007': [on['audioS'] for on in A['cues']['s0007']['onsets']]}, {'s0007': sorted({p['gameS'] for p in o['pairs']})})
assert old['status'] == 'AMBIGUOUS' and old['bestAudioMinusGameS'] == o['audioMinusGameS'] and abs(old['runnerUp']['audioMinusGameS'] - 29.77) < 0.02, \
    'the 2026-09-28 read cannot tell its own offset from one three windows later'
R = load('tools/recompile/results/rebuild-audio-full-06-landed-20260928.json')
# --- the realignment record: every number re-derived from the cue reads, the rebuild's plays and the run pack
Q = load('docs/evidence/full06-audio-realignment-20261001.json')
N = load('tools/recompile/results/phone-audio-cues-full-06-20261001.json')
plays = {h: [p['gameS'] for p in R['plays'] if p['handle'] == h] for h in {p['handle'] for p in R['plays']}}
anchors = {c: plays[int(c[1:])] for c in ('s0005', 's0006', 's0007', 's0008') if int(c[1:]) in plays}
resolved = cues.solve_offset({c: [on['audioS'] for on in N['cues'][c]['onsets']] for c in anchors}, anchors)
assert resolved['status'] == 'SOLVED' and resolved['audioMinusGameS'] == N['offset']['audioMinusGameS'] == Q['measurements']['offset']['solved'] == 29.754
assert resolved['runnerUp'] == N['offset']['runnerUp'] == Q['measurements']['offset']['runnerUp'] and resolved['matches'] == Q['measurements']['offset']['matches']
assert all(abs(on['gameS'] - round(on['audioS'] - resolved['audioMinusGameS'], 2)) < 0.011 for c in N['cues'].values() for on in c['onsets'])
pack = 'docs/evidence/runs/night7-night7-k3-full-06-20260915T225056Z/run'
bt, w = load(f'{pack}/bt-audio.json'), Q['measurements']['wallClock']
assert (w['captureStopHostWallMs'], w['audioDurationMs'], w['missingMs']) == (bt['stopWallMs'], bt['audioDurationMs'], bt['missingMs'])
br = load(f'{pack}/office-seed-bracket.json')
assert br['fromMs'] <= w['seedStampPhoneWallMs'] <= br['toMs']
game0 = w['seedStampPhoneWallMs'] + w['hostMinusPhoneSkewMs'] + w['seedToFirstOfficeFrameMs']
low = round(bt['audioDurationMs'] / 1000 - (bt['stopWallMs'] - game0) / 1000, 3)
assert w['game0AudioS']['bound'] == [low, round(low + bt['missingMs'] / 1000, 3)]
assert low <= resolved['audioMinusGameS'] <= low + bt['missingMs'] / 1000 and not (low <= o['audioMinusGameS'] <= low + bt['missingMs'] / 1000), \
    'the wall clock admits the solved offset and excludes the 2026-09-28 one'
assert [(x['gameS'], x['phoneS']) for x in Q['measurements']['opening']] == [(2.53, 2.57), (3.43, 3.41), (4.13, 4.15), (4.88, 4.84), (5.43, 5.43)]
for c, rows in Q['measurements']['comparison'].items():
    assert rows == cues.compare_plays(N['cues'][c]['onsets'], plays.get(int(c[1:]), []), Q['measurements']['ncFloors'][c], Q['measurements']['comparisonUptoS']), c
vocals = sorted((on['gameS'], c) for c in ('s0021', 's0023', 's0024') for on in N['cues'][c]['onsets'] if 0 <= on['gameS'] <= 423)
assert [(v['gameS'], v['cue']) for v in Q['measurements']['balloonBoyVocals']] == vocals == [(10.04, 's0024'), (15.08, 's0023'), (20.04, 's0023'), (300.04, 's0024')]
assert all(0 < round(g - 5 * round(g / 5), 2) <= 0.1 for g, _ in vocals), 'every hop vocal sits just after a 5 s roll'
assert 10.0 in R['balloonBoy']['hopsGameS'] and not any(abs(g - 10.04) <= 0.15 for h in (21, 23, 24) for g in plays.get(h, [])), \
    'the rebuild hops Balloon Boy at 10.0 s without a vocal (CAM 10 to 7), where the phone has one'
body = {k: v for k, v in Q.items() if k != 'id'}
assert Q['id'] == 's2-audio-realignment-' + hashlib.sha256(json.dumps(body, sort_keys=True).encode()).hexdigest()[:16]
print('phone-audio-cues: the audio offset rule and the full06-audio-realignment record rechecked from their rows')
