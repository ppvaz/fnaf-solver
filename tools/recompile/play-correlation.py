#!/usr/bin/env python3
"""Which sample did the rebuilt runtime's mixer actually play? (content-free numbers)

For every `play` line of one sound id in a CHOWDREN_AUDIO_TRACE, cut the mixer's
own output (openal-soft's wave backend) around the trace's wall time and score
it against reference samples (the APK's res/raw files, extracted outside the
repository): normalized cross-correlation of the mono waveforms over the
reference's length (at most --window-ms), best over lags of +-lag-ms (the trace
stamps a play after the call returns; the mix can lead it by tens of ms). Run
it on a capture made with CHOWDREN_AUDIO_SOLO=<id> so the mix holds only that
sound. Each reference is also scored against the mix 1 s before each play, as
a control. Prints one JSON object of scores only.

  play-correlation.py --trace AUDIO_TRACE --mix MIX.wav --asset ID \\
      --ref NAME=FILE [--ref NAME=FILE ...] [--lag-ms 80] [--window-ms 400]

References are decoded with ffmpeg to mono 16-bit at the mix's rate.
"""
import argparse
import array
import json
import math
import subprocess
import wave

try:
    import numpy as np
except ImportError:  # pure Python fallback, slower
    np = None


def mono_from_wave(path):
    with wave.open(path, 'rb') as w:
        rate, ch = w.getframerate(), w.getnchannels()
        a = array.array('h')
        a.frombytes(w.readframes(w.getnframes()))
    if ch == 1:
        return rate, [float(x) for x in a]
    return rate, [(a[i] + a[i + 1]) / 2.0 for i in range(0, len(a) - 1, ch)]


def mono_from_file(path, rate):
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-f', 's16le', '-ac', '1', '-ar', str(rate), '-'],
                         capture_output=True, check=True).stdout
    a = array.array('h')
    a.frombytes(raw[:len(raw) // 2 * 2])
    return [float(x) for x in a]


def ncc(x, y):
    n = min(len(x), len(y))
    if n == 0:
        return 0.0
    if np is not None:
        x, y = np.asarray(x[:n]), np.asarray(y[:n])
        x, y = x - x.mean(), y - y.mean()
        den = math.sqrt(float((x * x).sum() * (y * y).sum()))
        return float((x * y).sum()) / den if den else 0.0
    x, y = x[:n], y[:n]
    mx, my = sum(x) / n, sum(y) / n
    num = sum((a - mx) * (b - my) for a, b in zip(x, y))
    den = math.sqrt(sum((a - mx) ** 2 for a in x) * sum((b - my) ** 2 for b in y))
    return num / den if den else 0.0


def best(mix, start, ref, lag, step):
    top, at = -1.0, 0
    for off in range(-lag, lag + 1, step):
        a = start + off
        if a < 0 or a + len(ref) > len(mix):
            continue
        c = ncc(mix[a:a + len(ref)], ref)
        if c > top:
            top, at = c, off
    return top, at


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--trace', required=True)
    ap.add_argument('--mix', required=True)
    ap.add_argument('--asset', type=int, required=True)
    ap.add_argument('--ref', action='append', required=True)
    ap.add_argument('--lag-ms', type=int, default=80)
    ap.add_argument('--window-ms', type=int, default=400)
    opts = ap.parse_args()
    rate, mix = mono_from_wave(opts.mix)
    if np is not None:
        mix = np.asarray(mix)
    refs = {}
    for spec in opts.ref:
        name, path = spec.split('=', 1)
        ref = mono_from_file(path, rate)
        refs[name] = ref[:int(opts.window_ms * rate / 1000)]
    plays = []
    for line in open(opts.trace):
        if line.startswith('#'):
            continue
        f = line.split()
        if f[3] == 'play' and int(f[4]) == opts.asset:
            plays.append(float(f[2]))
    lag, step = int(opts.lag_ms * rate / 1000), max(1, rate // 4000)
    out = {'asset': opts.asset, 'rate': rate, 'windowMs': opts.window_ms, 'lagMs': opts.lag_ms,
           'plays': len(plays), 'scores': {}, 'controls': {}, 'summary': {}}
    for name, ref in refs.items():
        scores, ctl = [], []
        for wall in plays:
            c, off = best(mix, int(wall * rate), ref, lag, step)
            scores.append({'wallS': round(wall, 3), 'ncc': round(c, 3), 'lagMs': round(1000.0 * off / rate, 1)})
            if wall >= 1.0:
                c, _ = best(mix, int((wall - 1.0) * rate), ref, lag, step)
                ctl.append(round(c, 3))
        out['scores'][name] = scores
        out['controls'][name] = ctl
        s = sorted(x['ncc'] for x in scores)
        out['summary'][name] = {'nccMin': s[0] if s else None, 'nccMedian': s[len(s) // 2] if s else None,
                                'controlMax': max(ctl) if ctl else None}
    print(json.dumps(out, indent=1))


if __name__ == '__main__':
    main()
