#!/usr/bin/env python3
"""FNaF 1's title stars, read from helper native frames (the save's persistent completion marks).

usage: fnaf1-title-stars.py read FRAME.png [--model FILE]
       fnaf1-title-stars.py calibrate FRAME_DIR... --json OUT [--model FILE]
       fnaf1-title-stars.py run RUN_RECORD_DIR --frames FRAME_DIR --json OUT [--model FILE]

`read` prints one frame's count. `calibrate` measures every `*title*.png` under the given capture directories and
writes the per-slot core fractions by frame sha256 (no pixels). `run` reads a FNaF 1 runner's title frames before and
after its night: it takes the `title-before-*` and `title-after*` captures its probe.json names, refuses a frame whose
sha256 differs from the record, counts stars only on frames the run's own title-read events read confidently as the
title, and writes `title-stars.json` (schema fnaf1-title-stars-v1) beside the record: each frame's sha256, phase and
count, and each phase's consensus (null unless every counted frame agrees). Frames and pixels never leave the capture
directory. DEVICE_MEASURED frames; the reading is a per-pixel brightness rule on text-like solid shapes."""
import argparse, glob, hashlib, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
MODEL = os.path.join(HERE, '..', '..', 'profiles', 'fnaf1', 'moto-g56', 'title-stars-fnaf1-moto-g56-v207.json')
SCHEMA = 'fnaf1-title-stars-v1'

def load_model(path=MODEL):
    model = json.load(open(path))
    if model.get('schema') != 'title-stars-model-v1': raise SystemExit(f'{path}: not a title-stars-model-v1')
    return model

def fractions(rgb, model):
    """Per slot, the fraction of the core box whose every channel is at least white_min. rgb: HxWx3 uint8 array."""
    import numpy as np
    h = model['half']
    white = rgb.min(axis=2) >= model['white_min']
    return [round(float(white[y - h:y + h, x - h:x + h].mean()), 4) for x, y in model['slots']]

def count(fracs, model):
    """The star count, and whether the stars fill the slots left to right (a gap is not a reading)."""
    present = [f >= model['present_min'] for f in fracs]
    n = sum(present)
    return {'stars': n if present == [True] * n + [False] * (len(present) - n) else None, 'fractions': fracs}

def read_png(path, model):
    import numpy as np
    from PIL import Image
    image = Image.open(path).convert('RGB')
    if list(image.size) != model['frame']: raise ValueError(f'{path}: {image.size} is not the model frame {model["frame"]}')
    return count(fractions(np.asarray(image), model), model)

def sha256(path):
    return hashlib.sha256(open(path, 'rb').read()).hexdigest()

def run_reading(record_dir, frame_dir, model, model_path):
    probe = json.load(open(os.path.join(record_dir, 'probe.json')))
    reads = {}
    for line in open(os.path.join(record_dir, 'events.jsonl')):
        event = json.loads(line)
        if event.get('type') == 'title-read' and event.get('frame'): reads[os.path.basename(event['frame'])] = event
    rows = []
    for frame in probe['capture']['frames']:
        name = frame['name']
        phase = 'before' if name.startswith('title-before') else 'after' if name.startswith('title-after') else None
        if phase is None: continue
        path = os.path.join(frame_dir, os.path.basename(frame['path']))
        if sha256(path) != frame['sha256']: raise SystemExit(f'{path}: sha256 differs from the run record')
        title = reads.get(os.path.basename(frame['path']))
        confident = bool(title and title.get('confident') and str(title.get('output', '')).startswith('items='))
        row = {'name': name, 'sha256': frame['sha256'], 'phase': phase, 'titleRead': title.get('output') if title else None, 'confident': confident}
        row.update(read_png(path, model) if confident else {'stars': None, 'fractions': None})
        rows.append(row)
    def consensus(phase):
        counted = [r['stars'] for r in rows if r['phase'] == phase and r['confident']]
        return counted[0] if counted and None not in counted and len(set(counted)) == 1 else None
    before, after = consensus('before'), consensus('after')
    return {'schema': SCHEMA, 'run': probe['id'], 'model': {'path': os.path.relpath(model_path, os.path.join(HERE, '..', '..', '..', '..')), 'sha256': sha256(model_path)},
            'reader': {'path': 'packages/play/games/fnaf1/fnaf1-title-stars.py', 'sha256': sha256(os.path.abspath(__file__))},
            'frames': rows, 'before': before, 'after': after,
            'earned': after - before if before is not None and after is not None else None}

def main():
    ap = argparse.ArgumentParser(); ap.add_argument('mode', choices=['read', 'calibrate', 'run']); ap.add_argument('paths', nargs='+')
    ap.add_argument('--model', default=MODEL); ap.add_argument('--frames'); ap.add_argument('--json')
    a = ap.parse_args()
    model = load_model(a.model)
    if a.mode == 'read':
        for p in a.paths: print(p, json.dumps(read_png(p, model)))
        return 0
    if a.mode == 'calibrate':
        rows = []
        for d in a.paths:
            for p in sorted(glob.glob(os.path.join(d, '*title*.png'))):
                r = read_png(p, model)
                rows.append({'capture': os.path.basename(os.path.normpath(d)), 'name': os.path.basename(p), 'sha256': sha256(p), **r})
        out = {'schema': 'fnaf1-title-stars-calibration-v1', 'model': {'sha256': sha256(a.model)}, 'frames': rows}
        with open(a.json, 'w') as f: json.dump(out, f, indent=1); f.write('\n')
        print(f'{len(rows)} frames, {sum(1 for r in rows if r["stars"] is None)} with a gap')
        return 0
    if not a.frames or not a.json: raise SystemExit('run needs --frames and --json')
    out = run_reading(a.paths[0], a.frames, model, a.model)
    with open(a.json, 'w') as f: json.dump(out, f, indent=1); f.write('\n')
    print(f"{out['run']}: before {out['before']} after {out['after']} earned {out['earned']}")
    return 0

if __name__ == '__main__':
    sys.exit(main())
