#!/usr/bin/env python3
"""Game sound cues in a phone's A2DP capture, on the game's own clock (ROADMAP S2b).

usage: phone-audio-cues.py CAPTURE.wav --refs DIR --cues s0017,s0023,... [--from S --to S] [--threshold 0.3]
                           [--anchor s0007=34.27,44.27,...] [--json OUT]

For each cue the reference sample's most energetic 0.4 s core (extracted game audio, never committed) is
normalised-cross-correlated against the capture's mono downmix; onsets are local maxima above the threshold at
least 0.25 s apart, reported at the sample's start (core offset removed), with the capture's own near-silent
stretches excluded. `--anchor` names a cue whose game-clock play times are known from the rebuild's audio trace
(the mask put-on sound on every window press); the offset audio-minus-game is the median over the anchor onsets
within 1 s of a known time, and every onset is then also given on the game clock. A matched onset is a sound
that reached the phone's Bluetooth mix, not proof of which event played it; a missing onset is UNKNOWN, never an
absent event. Requires numpy and scipy. DEVICE_MEASURED audio; the alignment is arithmetic."""
import argparse, hashlib, json, os, sys
import numpy as np
from scipy.io import wavfile
from scipy.signal import fftconvolve

CORE_S, MIN_GAP_S, SILENCE_MS_FLOOR, ANCHOR_TOL_S = 0.4, 0.25, 30.0, 1.0

def load_ref(path, rate):
    rr, t = wavfile.read(path); t = t.astype(np.float32)
    if t.ndim == 2: t = t.mean(axis=1)
    if rr != rate: raise SystemExit(f'{path}: rate {rr} is not the capture rate {rate}')
    cl = int(CORE_S * rate); off = 0.0
    if len(t) > cl:
        e = np.convolve(t ** 2, np.ones(cl), mode='valid'); s = int(np.argmax(e)); t = t[s:s + cl]; off = s / rate
    return t, off, len(t) / rate

def onsets(seg, tpl, rate, thr, t0, off):
    tpl = tpl - tpl.mean(); tn = np.sqrt((tpl ** 2).sum())
    num = fftconvolve(seg, tpl[::-1], mode='valid'); e = fftconvolve(seg ** 2, np.ones(len(tpl)), mode='valid')
    c = num / (np.sqrt(np.maximum(e, 1e-9)) * tn + 1e-9)
    c[e < len(tpl) * SILENCE_MS_FLOOR ** 2] = 0
    idx = np.where(c > thr)[0]; peaks = []; last = -10 ** 9; gap = int(MIN_GAP_S * rate)
    for i in idx:
        if i - last > gap:
            j = i + int(np.argmax(c[i:i + gap])); peaks.append({'audioS': round(t0 + j / rate - off, 3), 'ncc': round(float(c[j]), 3)}); last = j
    return peaks

def main():
    ap = argparse.ArgumentParser(); ap.add_argument('capture'); ap.add_argument('--refs', required=True); ap.add_argument('--cues', required=True)
    ap.add_argument('--from', dest='t0', type=float, default=0.0); ap.add_argument('--to', dest='t1', type=float, default=None)
    ap.add_argument('--threshold', type=float, default=0.3); ap.add_argument('--anchor'); ap.add_argument('--json')
    a = ap.parse_args()
    rate, audio = wavfile.read(a.capture)
    audio = audio.astype(np.float32).mean(axis=1) if audio.ndim == 2 else audio.astype(np.float32)
    t1 = a.t1 if a.t1 is not None else len(audio) / rate
    seg = audio[int(a.t0 * rate):int(t1 * rate)]
    cues = {}
    anchor_name, anchor_times = (a.anchor.split('=')[0], [float(x) for x in a.anchor.split('=')[1].split(',')]) if a.anchor else (None, [])
    names = a.cues.split(',') + ([anchor_name] if anchor_name and anchor_name not in a.cues.split(',') else [])
    for name in names:
        tpl, off, core_s = load_ref(os.path.join(a.refs, f'{name}.wav'), rate)
        cues[name] = {'coreS': round(core_s, 3), 'coreOffsetS': round(off, 3), 'onsets': onsets(seg, tpl, rate, a.threshold, a.t0, off)}
    offset = None
    if anchor_name:
        pairs = []
        for o in cues[anchor_name]['onsets']:
            near = min(anchor_times, key=lambda g: abs(o['audioS'] - g))
            if abs(o['audioS'] - near) <= ANCHOR_TOL_S: pairs.append({'audioS': o['audioS'], 'gameS': near, 'diffS': round(o['audioS'] - near, 3)})
        if len(pairs) >= 3:
            diffs = sorted(p['diffS'] for p in pairs); offset = {'audioMinusGameS': diffs[len(diffs) // 2], 'pairs': pairs,
                                                                'spreadS': round(diffs[-1] - diffs[0], 3), 'cue': anchor_name}
    if offset:
        for cue in cues.values():
            for o in cue['onsets']: o['gameS'] = round(o['audioS'] - offset['audioMinusGameS'], 2)
    out = {'schema': 'phone-audio-cues-v1', 'claimLevel': 'DEVICE_MEASURED audio, arithmetic alignment',
           'capture': {'path': a.capture, 'sha256': hashlib.sha256(open(a.capture, 'rb').read()).hexdigest(), 'rate': int(rate), 'fromS': a.t0, 'toS': round(t1, 3)},
           'rule': {'coreS': CORE_S, 'minGapS': MIN_GAP_S, 'threshold': a.threshold, 'silenceFloor': SILENCE_MS_FLOOR, 'anchorToleranceS': ANCHOR_TOL_S},
           'offset': offset, 'cues': cues}
    for name, cue in cues.items():
        print(name, ' '.join(f"{o.get('gameS', o['audioS'])}({o['ncc']})" for o in cue['onsets']))
    if offset: print(f"offset audio-minus-game {offset['audioMinusGameS']} s over {len(offset['pairs'])} {anchor_name} onsets (spread {offset['spreadS']} s)")
    if a.json:
        with open(a.json, 'w') as f: json.dump(out, f, indent=1); f.write('\n')

if __name__ == '__main__':
    sys.exit(main())
