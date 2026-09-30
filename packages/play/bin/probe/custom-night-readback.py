#!/usr/bin/env python3
"""Read the ten Custom Night dials off one screenshot: 0, 20, or UNKNOWN.

    custom-night-readback.py --calibration CAL.json --glyphs GLYPHS.json [--sensor screencap-2400x1080] < frame.png

Prints one JSON line last: {"status": "PASS"|"UNKNOWN", "dials": {...}, "puppet": 15, "scores": {...}}.
Each dial's readback box (custom-night-calibration-v1, measured on this build)
is compared by normalised correlation against two fingerprints
(custom-night-glyphs-v1: the "20" and the "0" glyph, 44x18 grey, taken from
the default 20/20/20/20 preset and the Golden Freddy preset on 2026-09-13).
A dial reads 20 or 0 only when its best score clears minNcc and beats the
other glyph by the margin; anything else is UNKNOWN and the whole readback is
UNKNOWN, so the configuration routine refuses rather than guesses. The 10/20
target needs only these two values: every dial starts at 0 or 20 and ends
at 20. The Puppet is not a dial; it is 15 on Night 7 (g821) and reported so.
"""
import argparse, base64, io, json, sys
import numpy as np
from PIL import Image

PUPPET = 15


def ncc(a, b):
    a = a - a.mean(); b = b - b.mean()
    n = np.linalg.norm(a) * np.linalg.norm(b)
    return float((a * b).sum() / n) if n else 0.0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--calibration', required=True); ap.add_argument('--glyphs', required=True)
    ap.add_argument('--sensor', default='screencap-2400x1080'); ap.add_argument('--frame')
    a = ap.parse_args()
    cal = json.load(open(a.calibration)); gl = json.load(open(a.glyphs))
    w, h = gl['size']
    templates = {k: np.frombuffer(base64.b64decode(v), np.uint8).reshape(h, w).astype(float) for k, v in gl['templates'].items()}
    data = open(a.frame, 'rb').read() if a.frame else sys.stdin.buffer.read()
    try:
        img = Image.open(io.BytesIO(data)).convert('L')
    except Exception as e:  # noqa: BLE001
        print(json.dumps({'status': 'UNKNOWN', 'reason': f'unreadable frame: {e}'})); return 0
    if img.size != (2400, 1080):
        img = img.resize((2400, 1080))
    dials, scores, unknown = {}, {}, []
    for dial, spec in cal['readback'].items():
        b = spec['box']
        crop = np.asarray(img.crop((b['x'], b['y'], b['x'] + b['width'], b['y'] + b['height'])).resize((w, h)), dtype=float)
        own = {k: np.frombuffer(base64.b64decode(v), np.uint8).reshape(h, w).astype(float)
               for k, v in gl.get('perDial', {}).get(dial, {}).items()}
        s = {k: round(ncc(crop, own.get(k, t)), 3) for k, t in templates.items()}
        best = max(s, key=s.get); other = min(s, key=s.get)
        scores[dial] = s
        if s[best] >= gl['minNcc'] and s[best] - s[other] >= gl['margin']:
            dials[dial] = int(best)
        else:
            unknown.append(dial)
    status = 'PASS' if not unknown else 'UNKNOWN'
    print(json.dumps({'status': status, 'dials': dials, 'puppet': PUPPET, 'unknown': unknown, 'scores': scores}))
    return 0


if __name__ == '__main__':
    sys.exit(main())
