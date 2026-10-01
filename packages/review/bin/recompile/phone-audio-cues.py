#!/usr/bin/env python3
"""Game sound cues in a phone's A2DP capture, on the game's own clock (ROADMAP S2b).

usage: phone-audio-cues.py CAPTURE.wav --refs DIR --cues s0017,s0023,... [--from S --to S] [--threshold 0.3]
                           [--anchor s0007=5.43,14.27,... ...] [--anchor-plays PLAYS.json --anchor-cues s0005,...]
                           [--json OUT]

For each cue the reference sample's most energetic 0.4 s core (extracted game audio, never committed) is
normalised-cross-correlated against the capture's mono downmix; onsets are local maxima above the threshold at
least 0.25 s apart, reported at the sample's start (core offset removed), with the capture's own near-silent
stretches excluded. Anchors are cues whose game-clock play times are known: `--anchor NAME=T,...` (repeatable) or
`--anchor-plays` with a rebuild-audio-plays-v1 record, whose plays of the `--anchor-cues` handles become the times.
The offset audio-minus-game is solved, not assumed: every (anchor onset, play) pair proposes an offset, the one
the most anchor onsets agree with (within ANCHOR_TOL_S) wins, and it is refused as AMBIGUOUS unless it beats every
offset more than 2 x ANCHOR_TOL_S away by ANCHOR_MARGIN onsets. A capture starts before its night and the mask
sound repeats every window, so a nearest-play pairing fits any whole number of windows; that is how the
2026-09-28 full-06 read landed three windows (30 s) late. Every onset is then also given on the game clock. A
matched onset is a sound that reached the phone's Bluetooth mix, not proof of which event played it; a missing
onset is UNKNOWN, never an absent event. Requires numpy and scipy (solve_offset does not). DEVICE_MEASURED audio;
the alignment is arithmetic."""
import argparse, hashlib, json, os, sys

CORE_S, MIN_GAP_S, SILENCE_MS_FLOOR = 0.4, 0.25, 30.0
# An anchor onset agrees with an offset when it lands within this of a known play: full-06's mask-sound onsets
# spread 26 ms about their median (2026-09-28), and this stays well inside the 0.25 s onset gap.
ANCHOR_TOL_S = 0.1
# How many more anchor onsets the winning offset needs than any offset more than 2 x ANCHOR_TOL_S away.
ANCHOR_MARGIN = 3

def agreeing(onsets_by_cue, anchors, offset, tol=ANCHOR_TOL_S):
    """The (anchor onset, play) pairs that agree with `offset` (audio minus game), nearest play per onset."""
    pairs = []
    for name, times in anchors.items():
        for a in onsets_by_cue.get(name, []):
            g = min(times, key=lambda t: abs(a - offset - t))
            if abs(a - offset - g) <= tol: pairs.append({'cue': name, 'audioS': a, 'gameS': g, 'diffS': round(a - g, 3)})
    return pairs

def solve_offset(onsets_by_cue, anchors, tol=ANCHOR_TOL_S, margin=ANCHOR_MARGIN):
    """Audio minus game from anchor onsets ({cue: [audioS]}) and known plays ({cue: [gameS]}): SOLVED with the
    median over the winning offset's pairs, or AMBIGUOUS / TOO_FEW with no offset."""
    candidates = sorted({round(a - g, 3) for name, times in anchors.items() for a in onsets_by_cue.get(name, []) for g in times})
    scored = [(len(agreeing(onsets_by_cue, anchors, c, tol)), c) for c in candidates]
    if not scored or max(scored)[0] < 3:
        return {'status': 'TOO_FEW', 'audioMinusGameS': None, 'matches': max(scored)[0] if scored else 0}
    best_n = max(n for n, _ in scored)
    seed = min(c for n, c in scored if n == best_n)
    diffs = sorted(p['diffS'] for p in agreeing(onsets_by_cue, anchors, seed, tol))
    offset = diffs[len(diffs) // 2]
    pairs = agreeing(onsets_by_cue, anchors, offset, tol)
    rivals = [(n, c) for n, c in scored if abs(c - offset) > 2 * tol]
    runner = max(rivals) if rivals else (0, None)
    out = {'audioMinusGameS': offset, 'matches': len(pairs), 'pairs': pairs, 'cues': sorted(anchors),
           'spreadS': round(max(p['diffS'] for p in pairs) - min(p['diffS'] for p in pairs), 3) if pairs else None,
           'runnerUp': {'audioMinusGameS': runner[1], 'matches': runner[0]}, 'toleranceS': tol, 'margin': margin}
    if len(pairs) - runner[0] < margin:
        return {**out, 'status': 'AMBIGUOUS', 'audioMinusGameS': None, 'bestAudioMinusGameS': offset}
    return {**out, 'status': 'SOLVED'}

# A phone onset and a rebuild play are the same sound when they are this close on the game clock: the anchors on
# full-06's corrected clock spread 0.084 s.
MATCH_TOL_S = 0.15

def compare_plays(onsets, plays, min_ncc, upto_s, tol=MATCH_TOL_S):
    """One sound's rebuild plays (gameS) against its phone onsets ({gameS, ncc}) up to `upto_s`: each play HEARD
    (an onset within tol at or above min_ncc) or UNKNOWN, and each such onset no play explains PHONE_ONLY."""
    heard = [o for o in onsets if o['ncc'] >= min_ncc and 0 <= o['gameS'] <= upto_s]
    rows = []
    for g in (g for g in plays if g <= upto_s):
        m = [o for o in heard if abs(o['gameS'] - g) <= tol]
        rows.append({'gameS': g, 'rebuild': True, 'phone': 'HEARD' if m else 'UNKNOWN', **({'phoneS': m[0]['gameS'], 'ncc': m[0]['ncc']} if m else {})})
    for o in heard:
        if not any(abs(o['gameS'] - g) <= tol for g in plays):
            rows.append({'gameS': o['gameS'], 'rebuild': False, 'phone': 'PHONE_ONLY', 'ncc': o['ncc']})
    return sorted(rows, key=lambda r: r['gameS'])

def load_ref(path, rate):
    import numpy as np
    from scipy.io import wavfile
    rr, t = wavfile.read(path); t = t.astype(np.float32)
    if t.ndim == 2: t = t.mean(axis=1)
    if rr != rate: raise SystemExit(f'{path}: rate {rr} is not the capture rate {rate}')
    cl = int(CORE_S * rate); off = 0.0
    if len(t) > cl:
        e = np.convolve(t ** 2, np.ones(cl), mode='valid'); s = int(np.argmax(e)); t = t[s:s + cl]; off = s / rate
    return t, off, len(t) / rate

def onsets(seg, tpl, rate, thr, t0, off):
    import numpy as np
    from scipy.signal import fftconvolve
    tpl = tpl - tpl.mean(); tn = np.sqrt((tpl ** 2).sum())
    num = fftconvolve(seg, tpl[::-1], mode='valid'); e = fftconvolve(seg ** 2, np.ones(len(tpl)), mode='valid')
    c = num / (np.sqrt(np.maximum(e, 1e-9)) * tn + 1e-9)
    c[e < len(tpl) * SILENCE_MS_FLOOR ** 2] = 0
    idx = np.where(c > thr)[0]; peaks = []; last = -10 ** 9; gap = int(MIN_GAP_S * rate)
    for i in idx:
        if i - last > gap:
            j = i + int(np.argmax(c[i:i + gap])); peaks.append({'audioS': round(t0 + j / rate - off, 3), 'ncc': round(float(c[j]), 3)}); last = j
    return peaks

def anchor_times(specs, plays_path, plays_cues):
    """{cue: sorted gameS} from repeated NAME=T,... specs and/or a rebuild-audio-plays-v1 record's plays."""
    out = {}
    for spec in specs or []:
        name, times = spec.split('=', 1)
        out.setdefault(name, []).extend(float(x) for x in times.split(','))
    if plays_path:
        plays = json.load(open(plays_path))
        if plays.get('schema') != 'rebuild-audio-plays-v1': raise SystemExit(f'{plays_path}: not a rebuild-audio-plays-v1 record')
        if not plays_cues: raise SystemExit('--anchor-plays needs --anchor-cues')
        for name in plays_cues.split(','):
            out.setdefault(name, []).extend(p['gameS'] for p in plays['plays'] if f"s{p['handle']:04d}" == name)
    return {k: sorted(v) for k, v in out.items() if v}

def main():
    ap = argparse.ArgumentParser(); ap.add_argument('capture'); ap.add_argument('--refs', required=True); ap.add_argument('--cues', required=True)
    ap.add_argument('--from', dest='t0', type=float, default=0.0); ap.add_argument('--to', dest='t1', type=float, default=None)
    ap.add_argument('--threshold', type=float, default=0.3); ap.add_argument('--anchor', action='append')
    ap.add_argument('--anchor-plays'); ap.add_argument('--anchor-cues'); ap.add_argument('--json')
    a = ap.parse_args()
    import numpy as np
    from scipy.io import wavfile
    rate, audio = wavfile.read(a.capture)
    audio = audio.astype(np.float32).mean(axis=1) if audio.ndim == 2 else audio.astype(np.float32)
    t1 = a.t1 if a.t1 is not None else len(audio) / rate
    seg = audio[int(a.t0 * rate):int(t1 * rate)]
    cues = {}
    anchors = anchor_times(a.anchor, a.anchor_plays, a.anchor_cues)
    names = a.cues.split(',') + [n for n in anchors if n not in a.cues.split(',')]
    for name in names:
        tpl, off, core_s = load_ref(os.path.join(a.refs, f'{name}.wav'), rate)
        cues[name] = {'coreS': round(core_s, 3), 'coreOffsetS': round(off, 3), 'onsets': onsets(seg, tpl, rate, a.threshold, a.t0, off)}
    offset = None
    if anchors:
        offset = solve_offset({n: [o['audioS'] for o in cues[n]['onsets']] for n in anchors}, anchors)
        offset['anchorSource'] = {'specs': a.anchor or [], 'plays': a.anchor_plays,
                                  'playsSha256': hashlib.sha256(open(a.anchor_plays, 'rb').read()).hexdigest() if a.anchor_plays else None}
    if offset and offset['status'] == 'SOLVED':
        for cue in cues.values():
            for o in cue['onsets']: o['gameS'] = round(o['audioS'] - offset['audioMinusGameS'], 2)
    out = {'schema': 'phone-audio-cues-v2', 'claimLevel': 'DEVICE_MEASURED audio, arithmetic alignment',
           'capture': {'path': a.capture, 'sha256': hashlib.sha256(open(a.capture, 'rb').read()).hexdigest(), 'rate': int(rate), 'fromS': a.t0, 'toS': round(t1, 3)},
           'rule': {'coreS': CORE_S, 'minGapS': MIN_GAP_S, 'threshold': a.threshold, 'silenceFloor': SILENCE_MS_FLOOR,
                    'anchorToleranceS': ANCHOR_TOL_S, 'anchorMargin': ANCHOR_MARGIN},
           'offset': offset, 'cues': cues}
    for name, cue in cues.items():
        print(name, ' '.join(f"{o.get('gameS', o['audioS'])}({o['ncc']})" for o in cue['onsets']))
    if offset and offset['status'] == 'SOLVED':
        print(f"offset audio-minus-game {offset['audioMinusGameS']} s: {offset['matches']} anchor onsets agree "
              f"(spread {offset['spreadS']} s); the best other offset, {offset['runnerUp']['audioMinusGameS']} s, has {offset['runnerUp']['matches']}")
    elif offset:
        print(f"offset {offset['status']}: {offset['matches']} anchor onsets for the best offset, {offset['runnerUp']['matches'] if 'runnerUp' in offset else 0} for "
              f"the best other; no game times given", file=sys.stderr)
    if a.json:
        with open(a.json, 'w') as f: json.dump(out, f, indent=1); f.write('\n')
    return 0 if not offset or offset['status'] == 'SOLVED' else 3

if __name__ == '__main__':
    sys.exit(main())
