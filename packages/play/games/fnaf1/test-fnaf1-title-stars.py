#!/usr/bin/env python3
"""Gate for fnaf1-title-stars.py: FIXTURE frames (filled stars on static) read to their star count and a gap refused,
then docs/evidence/fnaf1-title-stars-calibration-20261001.json and the packed title-stars.json of the FNaF 1 4/20 run
rechecked from their rows. No retained frame needed. Runs in `npm run test:unit`."""
import hashlib, importlib.util, json, math, os, sys
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, '..', '..', '..', '..')
spec = importlib.util.spec_from_file_location('stars', os.path.join(HERE, 'fnaf1-title-stars.py'))
stars = importlib.util.module_from_spec(spec); spec.loader.exec_module(stars)
model = stars.load_model()

def frame(filled, seed=0):
    """Static (grey noise with white specks), with a filled five-point star of radius 40 at each filled slot."""
    rng = np.random.default_rng(seed)
    w, h = model['frame']
    img = rng.integers(0, 200, size=(h, w, 3), dtype=np.uint8)
    img[rng.random((h, w)) < 0.05] = 255
    yy, xx = np.mgrid[0:h, 0:w]
    for k, (cx, cy) in enumerate(model['slots']):
        if not filled[k]: continue
        pts = [(cx + (40 if i % 2 == 0 else 16) * math.sin(math.pi * i / 5), cy - (40 if i % 2 == 0 else 16) * math.cos(math.pi * i / 5)) for i in range(10)]
        inside = np.zeros((h, w), bool)
        for i in range(10):   # even-odd rule over the star's ten edges, on a box around it
            (x1, y1), (x2, y2) = pts[i], pts[(i + 1) % 10]
            box = (slice(cy - 45, cy + 45), slice(cx - 45, cx + 45))
            Y, X = yy[box], xx[box]
            cross = ((y1 > Y) != (y2 > Y)) & (X < (x2 - x1) * (Y - y1) / (y2 - y1 + 1e-9) + x1)
            inside[box] ^= cross
        img[inside] = 255
    return img

for filled, expected in [((1, 1, 1), 3), ((1, 1, 0), 2), ((1, 0, 0), 1), ((0, 0, 0), 0), ((1, 0, 1), None), ((0, 1, 1), None)]:
    got = stars.count(stars.fractions(frame(filled, seed=sum(filled)), model), model)
    assert got['stars'] == expected, f'{filled}: read {got}'
assert all(f < model['present_min'] for f in stars.fractions(frame((0, 0, 0), seed=7), model)), 'static alone never fills a core box'

# --- the calibration record, from its rows
def load(path): return json.load(open(os.path.join(ROOT, path)))
cal = load('docs/evidence/fnaf1-title-stars-calibration-20261001.json')
assert cal['model']['sha256'] == hashlib.sha256(open(os.path.join(ROOT, cal['model']['path']), 'rb').read()).hexdigest(), 'the calibration measured this model'
values = [f for row in cal['frames'] for f in row['fractions']]
assert len(values) == cal['summary']['slotReads'] == 3 * len(cal['frames']) == 291
assert sorted(set(values)) == cal['summary']['values'] == [0.0, 1.0], 'every slot read is 0.0 or 1.0'
for row in cal['frames']:
    assert row['stars'] is not None, f"{row['name']}: a gap"
    assert row['stars'] == stars.count(row['fractions'], model)['stars'], f"{row['name']}: the count is the model's reading of its fractions"
by = {}
for row in cal['frames']: by.setdefault(row['capture'], {}).setdefault(str(row['stars']), 0); by[row['capture']][str(row['stars'])] += 1
assert by == cal['summary']['byCapture']

# --- the packed reading of the 4/20 night
run = 'fnaf1-custom-grid420-420-a-20260925T024452598Z'
packed = load(f'docs/evidence/runs/{run}/title-stars.json')
probe = load(f'docs/evidence/runs/{run}/probe.json')
captured = {f['name']: f['sha256'] for f in probe['capture']['frames']}
for row in packed['frames']:
    assert captured[row['name']] == row['sha256'], f"{row['name']} is the frame the run captured"
    calibrated = [c for c in cal['frames'] if c['sha256'] == row['sha256']]
    assert len(calibrated) == 1 and calibrated[0]['stars'] == row['stars'] and calibrated[0]['fractions'] == row['fractions'], 'the packed read is the calibrated read'
assert (packed['before'], packed['after'], packed['earned']) == (2, 3, 1)
print('fnaf1-title-stars: fixture stars and gaps, the 291-read calibration, and the 4/20 night\'s packed 2 -> 3 read rechecked')
