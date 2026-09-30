#!/usr/bin/env python3
"""The game's five-second grid, read off the retained Bluetooth audio.

    tickphase.py RUN_DIR [--refs DIR] [--rate 16000] [--json OUT]

RUN_DIR is a night-run.sh run directory holding `bt-audio.json` (the capture
sidecar: host wall-clock start stamp, path base) and `campaign.log` (the HID
release event, same wall clock). The wav is `<base>.bt.wav` beside the raw,
outside the repository.

What it measures, and nothing else:

- every onset of the vent bang (s0017) and Withered Foxy's footsteps
  (s0025..s0029), which the event sheet plays on the `Every 5000 ms` rolls
  (g337-342 -> route moves -> g691-694 / g704-708); and of the winding ratchet
  (s0033), played on the `Every 500 ms` timer while the wind button is held
  (g637/g644). Detection is normalised cross-correlation of the APK's own PCM
  against the capture (packages/propose/parked/minus7/cue/correlate.py's method, vectorised), peaks
  above a per-handle threshold with a refractory gap.
- `gridPhaseMs`: the circular mean of the roll-onset times modulo 5000 ms,
  measured from the HID release. This is the quantity the Night 6 anchor aims
  at, on the game's own clock instead of the helper's latched onset.
- `windTicksPerCycle`: WinD onsets inside each emitted wind hold, and the
  offset of the first tick from the hold's press: the alignment check between
  the audio clock and the schedule. If this offset is not inside [0, 500) ms
  the audio clock is not aligned and gridPhaseMs must not be read.

Clock: audio sample i is at startWallMs + 1000*i/rate; the sidecar's stamp is
an UPPER bound on the first sample (the transport was already streaming), so
every audio time here is LATE by an unknown 0..~200 ms unless the WinD check
pins it. UNKNOWN is printed where a number cannot be supported.
"""
import argparse, json, math, pathlib, re, subprocess, sys
import numpy as np
from numpy.fft import rfft, irfft

ROLL_HANDLES = {17: 'vent-bang', 25: 'footsteps-1', 26: 'footsteps-2', 27: 'footsteps-3', 28: 'footsteps-4', 29: 'footsteps-5'}
WIND_HANDLE = 33
THRESH = {17: 0.30, 25: 0.25, 26: 0.25, 27: 0.25, 28: 0.25, 29: 0.25, 33: 0.30}
REFRACTORY_S = {17: 0.5, 25: 1.0, 26: 1.0, 27: 1.0, 28: 1.0, 29: 1.0, 33: 0.25}
GRID_MS = 5000
CORE_S = 0.25


def load_mono(path, rate):
    out = subprocess.run(['ffmpeg', '-nostdin', '-loglevel', 'error', '-i', str(path), '-ac', '1', '-ar', str(rate), '-f', 'f32le', '-'],
                         capture_output=True, check=True).stdout
    return np.frombuffer(out, np.float32).astype(np.float64)


def core_window(ref, rate, seconds=CORE_S):
    n = int(seconds * rate)
    if n >= len(ref):
        return ref, 0
    sq = np.cumsum(np.concatenate([[0.0], ref * ref]))
    energy = sq[n:] - sq[:-n]
    at = int(np.argmax(energy))
    return ref[at:at + n], at


def ncc(signal, template):
    """Normalised cross-correlation at every lag, FFT overlap-save."""
    m = len(template)
    e_t = math.sqrt(float(np.dot(template, template)))
    if e_t == 0 or len(signal) < m:
        return np.zeros(0)
    size = 1 << int(math.ceil(math.log2(max(1 << 16, 2 * m))))
    hop = size - m + 1
    tb = np.conj(rfft(template, size))
    sq = np.cumsum(np.concatenate([[0.0], signal * signal]))
    local = sq[m:] - sq[:-m]
    out = np.zeros(len(signal) - m + 1)
    for start in range(0, len(out), hop):
        chunk = signal[start:start + size]
        if len(chunk) < size:
            chunk = np.concatenate([chunk, np.zeros(size - len(chunk))])
        corr = irfft(rfft(chunk) * tb, size)[:hop]
        take = min(hop, len(out) - start)
        out[start:start + take] = corr[:take]
    with np.errstate(divide='ignore', invalid='ignore'):
        out = np.where(local > 0, out / (e_t * np.sqrt(local)), 0.0)
    return out


def peaks(curve, rate, threshold, refractory_s):
    hits = np.flatnonzero(curve >= threshold)
    onsets = []
    last = -1e9
    gap = int(refractory_s * rate)
    i = 0
    while i < len(hits):
        j = i
        while j + 1 < len(hits) and hits[j + 1] - hits[j] <= gap:
            j += 1
        seg = hits[i:j + 1]
        best = seg[int(np.argmax(curve[seg]))]
        if best - last > gap:
            onsets.append((int(best), float(curve[best])))
            last = best
        i = j + 1
    return onsets


def circular_mean_ms(values_ms, period):
    if not values_ms:
        return None, 0.0
    ang = np.array(values_ms) / period * 2 * math.pi
    c, s = np.cos(ang).mean(), np.sin(ang).mean()
    r = math.hypot(c, s)
    mean = (math.atan2(s, c) / (2 * math.pi) * period) % period
    return mean, r


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('run_dir')
    ap.add_argument('--refs', default=str(pathlib.Path.home() / 'fnaf-apks/cue-refs'))
    ap.add_argument('--rate', type=int, default=16000)
    ap.add_argument('--json')
    a = ap.parse_args()
    run = pathlib.Path(a.run_dir)
    side = json.load(open(run / 'bt-audio.json'))
    base = pathlib.Path(side['pcm']).name  # not the base path; find the wav by run id
    wav = None
    for cand in pathlib.Path.home().glob('fnaf-apks/bt-audio-captures/*.bt.wav'):
        if cand.name.startswith(run.name):
            wav = cand
    if wav is None:
        print('UNKNOWN  no bt wav for', run.name); return 3
    log = (run / 'campaign.log').read_text(errors='ignore')
    m = re.search(r'\{"at":(\d+),"type":"hid\.night-go-released"', log)
    if not m:
        print('UNKNOWN  no hid.night-go-released in campaign.log'); return 3
    release_wall = int(m.group(1))
    start_wall = int(side['startWallMs'])
    # A capture that lost samples has no usable time axis (see capture-bt-audio.sh --stop).
    if side.get('timeAxis') == 'BROKEN' or (side.get('missingFraction') is not None and abs(side['missingFraction']) > 0.005):
        print(f"UNKNOWN  the capture lost {side.get('missingMs')} ms of samples ({100*side.get('missingFraction', 0):.1f} %): "
              "the audio time axis is broken; onsets can be listed but no phase can be read")
        broken = True
    else:
        broken = False
    rate = a.rate
    sig = load_mono(wav, rate)
    t0_rel = (start_wall - release_wall) / 1000.0  # audio t=0 in release-relative seconds (upper bound)
    result = {'schema': 'tickphase-v1', 'run': run.name, 'wav': str(wav), 'rate': rate, 'timeAxis': 'BROKEN' if broken else 'CONTINUOUS',
              'missingFraction': side.get('missingFraction'),
              'audioStartVsReleaseS': t0_rel, 'startIsUpperBound': True, 'handles': {}}
    all_roll = []
    for h in list(ROLL_HANDLES) + [WIND_HANDLE]:
        refp = pathlib.Path(a.refs) / f's{h:04d}.wav'
        if not refp.exists():
            result['handles'][h] = {'status': 'UNKNOWN', 'reason': 'reference missing'}; continue
        ref = load_mono(refp, rate)
        tpl, core_at = core_window(ref, rate)
        curve = ncc(sig, tpl)
        ons = [((i - core_at) / rate + t0_rel, s) for i, s in peaks(curve, rate, THRESH[h], REFRACTORY_S[h])]
        ons = [(t, s) for t, s in ons if t >= 0]
        result['handles'][h] = {'name': ROLL_HANDLES.get(h, 'wind'), 'threshold': THRESH[h], 'onsets': [[round(t, 3), round(s, 3)] for t, s in ons],
                                'curveMax': round(float(curve.max()) if len(curve) else 0.0, 3)}
        if h in ROLL_HANDLES:
            all_roll += [t for t, _ in ons]
    phases = [(t * 1000) % GRID_MS for t in all_roll]
    mean, r = circular_mean_ms(phases, GRID_MS)
    result['rollOnsets'] = len(all_roll)
    result['gridPhaseMs'] = None if mean is None else round(mean, 1)
    result['gridPhaseConcentration'] = round(r, 3)
    # WinD alignment: ticks are on a global 500 ms timer; their phase mod 500 is the sub-grid.
    wind = [t for t, _ in result['handles'].get(WIND_HANDLE, {}).get('onsets', [])]
    wmean, wr = circular_mean_ms([(t * 1000) % 500 for t in wind], 500)
    result['windTicks'] = len(wind)
    result['windPhaseMod500Ms'] = None if wmean is None else round(wmean, 1)
    result['windPhaseConcentration'] = round(wr, 3)
    if broken:
        result['gridPhaseMs'] = None; result['windPhaseMod500Ms'] = None
    print(f"tickphase {run.name}: audio starts {t0_rel:+.3f} s vs release (upper bound); time axis {result['timeAxis']}")
    for h, v in result['handles'].items():
        if 'onsets' in v:
            print(f"  s{int(h):04d} {v['name']:<12} onsets {len(v['onsets']):3d}  curve max {v['curveMax']:.3f}  thr {v['threshold']}")
    if broken:
        print('  gridPhaseMs UNKNOWN (broken time axis)'); mean = None; wmean = None
    elif mean is None:
        print('  gridPhaseMs UNKNOWN (no roll onsets above threshold)')
    else:
        print(f"  gridPhaseMs {mean:.1f} (mod 5000 from release; concentration {r:.2f} over {len(all_roll)} onsets)")
    print(f"  WinD ticks {len(wind)}; phase mod 500 {'UNKNOWN' if wmean is None else f'{wmean:.1f} ms (concentration {wr:.2f})'}")
    if a.json:
        json.dump(result, open(a.json, 'w'), indent=1)
    return 0


if __name__ == '__main__':
    sys.exit(main())
