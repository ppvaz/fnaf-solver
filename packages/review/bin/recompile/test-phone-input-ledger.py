#!/usr/bin/env python3
"""Gate for the phone input ledger and audio cue records: the frame classifiers on synthetic cells, then every
difference, alignment and hash of docs/evidence/full06-input-registration-20260928.json re-derived from the
retained result rows. Needs no frame trace, capture, numpy or binary. Runs in `npm run test:unit`."""
import hashlib, importlib.util, json, os, sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..', '..')
def load(path):
    return json.load(open(os.path.join(ROOT, path)))
def sha(path):
    return hashlib.sha256(open(os.path.join(ROOT, path), 'rb').read()).hexdigest()
spec = importlib.util.spec_from_file_location('ledger', os.path.join(ROOT, 'packages/review/bin/recompile/phone-input-ledger.py'))
ledger = importlib.util.module_from_spec(spec); spec.loader.exec_module(ledger)

# --- classifiers
assert ledger.signature(142, 144) == 'office' and ledger.signature(4, 144) == 'monitor-up' and ledger.signature(142, 0) == 'mask-on'
assert ledger.signature(60, 144) is None and ledger.signature(4, 4) is None, 'transitional and both-absent frames withhold an answer'
def grid(cells):   # {(row, col): (r, g, b)} -> 20x9 RGB hex, everything else black
    return ''.join(f'{v:02x}' for r in range(9) for c in range(20) for v in cells.get((r, c), (0, 0, 0)))
blue = grid({(r, c): (40, 40, 120) for r in range(3, 6) for c in range(11, 15)})       # 12 cells, hue 240
yellow = grid({(r, c): (120, 100, 20) for r in range(3, 6) for c in range(11, 15)})    # hue 48, sat 0.83
rim = grid({(r, c): (60, 20, 25) for r in range(3, 6) for c in range(11, 15)})         # hue 352: the mask rim
few = grid({(3, 11): (40, 40, 120), (3, 12): (40, 40, 120)})
assert ledger.eyehole_letter(blue) == 'B' and ledger.eyehole_letter(yellow) == 'C'
assert ledger.eyehole_letter(rim) is None and ledger.eyehole_letter(few) is None, 'the rim and a two-cell fleck are not an occupant'
# --- the office clock: catch-up splits a 33 ms interval into two updates (32 + 1 ms) and never past three
ns = [0, 16_700_000, 50_000_000, 66_700_000, 150_000_000]
deltas, pass_start, cum = ledger.office_clock(ns, 0)
assert pass_start == [0, 1, 2, 4, 5] and abs(deltas[2] - 32.3) < 0.01 and deltas[3] == 1.0 and len(deltas) == 8, (deltas, pass_start)
assert abs(cum[-1] - (150.0 + 1000 / 60)) < 1e-6, 'the clock spends one 60 Hz frame for update 0 and then exactly the captured time'

# --- the record against its rows
rec = load('docs/evidence/full06-input-registration-20260928.json')
body = json.dumps({k: v for k, v in rec.items() if k != 'id'}, sort_keys=True).encode()
assert rec['id'] == 's2-input-registration-' + hashlib.sha256(body).hexdigest()[:16], 'the record id is not its own hash'
for r in rec['results']:
    assert sha(r['path']) == r['sha256'], f"{r['path']} changed since the record was written"
L = load('tools/recompile/results/phone-input-ledger-full-06-20260928.json')
assert L['schema'] == 'phone-input-ledger-v1' and len(L['cycles']) == 7
for c in L['cycles']:
    for name, e in c['events'].items():
        if e['phone'] and e['rebuild']:
            assert e['phoneMinusRebuildUpdates'] == e['phone']['update'] - e['rebuild']['update'], (c['cycle'], name)
        else:
            assert e['phoneMinusRebuildUpdates'] is None
        d = rec['measurements']['inputRegistration']['phoneMinusRebuildUpdates']
        if name in d:
            assert d[name].get(str(c['cycle'])) == e['phoneMinusRebuildUpdates'], (name, c['cycle'])
    eye = rec['measurements']['eyehole'][str(c['cycle'])]
    assert eye['phone'] == ((c['occupant']['phone'] or {}).get('letter')) and eye['rebuild'] == ((c['occupant']['rebuild'] or {}).get('letter'))
off = {int(k): v for k, v in rec['measurements']['inputRegistration']['phoneMinusRebuildUpdates']['hallFlashOff'].items()}
assert off == {1: -3, 3: -5, 4: -5, 6: -4}, 'the phone flash ends 3-5 updates before the replayed hall release in every flashed cycle'
assert all(-2 <= v <= 1 for k, v in rec['measurements']['inputRegistration']['phoneMinusRebuildUpdates']['monitorUp'].items() if k != '0')
assert rec['measurements']['eyehole']['3'] == {'phone': 'B', 'rebuild': 'B'} and rec['measurements']['eyehole']['4'] == {'phone': 'C', 'rebuild': 'C'}
assert rec['measurements']['eyehole']['6'] == {'phone': None, 'rebuild': 'B'}, 'window 6: the phone eyehole is empty where the rebuild has Bonnie'
A = load('tools/recompile/results/phone-audio-cues-full-06-20260928.json')
o = A['offset']; diffs = sorted(p['diffS'] for p in o['pairs'])
assert o['audioMinusGameS'] == diffs[len(diffs) // 2] and len(o['pairs']) >= 3 and all(abs(p['diffS']) <= A['rule']['anchorToleranceS'] for p in o['pairs'])
assert all(abs(p['audioS'] - p['gameS'] - p['diffS']) < 1e-6 for p in o['pairs'])
for cue in A['cues'].values():
    for on in cue['onsets']:
        assert abs(on['gameS'] - round(on['audioS'] - o['audioMinusGameS'], 2)) < 0.011
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
strong = [on['gameS'] for on in A['cues']['s0017']['onsets'] if on['ncc'] >= 0.5]
assert strong == rec['measurements']['phoneCues']['bangsGameS_ncc>=0.5'] and strong[:3] == [50.04, 55.01, 60.38]
vocals = rec['measurements']['phoneCues']['balloonBoyVocalsGameS']
assert [v[0] for v in vocals['s0024']] == [40.04] and [v[0] for v in vocals['s0023']] == [45.08, 50.04]
R = load('tools/recompile/results/rebuild-audio-full-06-landed-20260928.json')
assert [p['gameS'] for p in R['plays'] if p['assetId'] == 22] == R['bangsGameS'] == rec['measurements']['rebuildCues']['bangsGameS']
assert R['balloonBoy']['hopsAfterLeaveGameS'][0] == 50.02 and R['balloonBoy']['officeArrivalGameS'] == 70.32, 'the rebuild holds Balloon Boy through the 40 and 45 s rolls'
H = load('tools/recompile/results/hall-shift-sensitivity-full-06-20260928.json')
for k, v in H['variants'].items():
    assert v['rebuiltWindows'][6] != '.', f'{k}: a hall shift emptied window 6, the record says none does'
    assert rec['measurements']['hallShiftSensitivity']['variants'][k]['window6'] == v['rebuiltWindows'][6]
assert H['variants']['v-hallLight_down_0_up_0']['rebuiltWindows'].startswith('...BC.BC.BC.BC.C..BC'), 'the 0/0 control is the retained landed replay'
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
print('phone-input-ledger: classifiers, clock, and the full06-input-registration record, the audio offset rule and the full06-audio-realignment record rechecked from their rows')
