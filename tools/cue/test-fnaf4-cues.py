#!/usr/bin/env python3
"""No-device, no-sample checks of tools/cue/fnaf4-cues.py's Fredbear families.

The game's samples live outside the repository, so the templates here are
synthetic: seeded noise bursts stand in for s0025/s0026 and a laugh. What is
checked is the detector's arithmetic, on the hearing model the runner binds:

* the model's families are exactly the detector's (handles included), and a
  file that disagrees is refused;
* a side sound buried 5 dB under the room (n5b's level) is published as a
  candidate, with its onset, from a 1.0 s window -- and would not be at the
  old 0.55 floor with the old 0.6 s window;
* a 6 s laugh is published within its hop cap, not when the sample ends.
"""
import importlib.util
import json
import os
import sys
import tempfile

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("fnaf4_cues", os.path.join(HERE, "fnaf4-cues.py"))
cues = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cues)

failures = []
checks = 0


def ok(what, cond):
    global checks
    checks += 1
    if not cond:
        failures.append(what)


# --- the model the runner binds ----------------------------------------------------
model = json.load(open(cues.HEARING))
fams = cues.load_hearing(cues.HEARING)
ok("the model names fb-left, fb-right and laugh", set(fams) == {"fb-left", "fb-right", "laugh"})
ok("the detector's hop is the model's", abs(cues.HOP_S - model["hopS"]) < 1e-9)
for family, (win_s, emit, hops) in fams.items():
    ok(f"{family}: publishing floor under the runner's acceptance floor",
       emit < (model["laughGrid"] if family == "laugh" else model["sideGrid"])["minNcc"])
    ok(f"{family}: published within the runner's decision time",
       (win_s + hops * cues.HOP_S) * 1000 + (model["laughGrid"] if family == "laugh" else model["sideGrid"])["halfWidthMs"]
       <= (model["laughGrid"] if family == "laugh" else model["sideGrid"])["decideAfterMs"])

bad = json.loads(json.dumps(model))
bad["families"]["fb-left"]["handles"] = [25]
with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as f:
    json.dump(bad, f)
try:
    cues.load_hearing(f.name)
    ok("a family whose handles are not the detector's is refused", False)
except ValueError:
    ok("a family whose handles are not the detector's is refused", True)
finally:
    os.unlink(f.name)

# --- synthetic samples ----------------------------------------------------------------
SR = cues.SR
rng = np.random.default_rng(20260927)


def burst(seed, seconds):
    g = np.random.default_rng(seed)
    x = g.standard_normal(int(seconds * SR))
    # footstep-like: 0.25 s pulses, as s0025/s0026 are
    env = (np.sin(np.arange(len(x)) / SR * 2 * np.pi * 4) > 0.3).astype(float)
    return x * (0.2 + env)


SYNTH = {h: burst(h, 1.6) for h in {h for _, h, _ in cues.TEMPLATES}}
SYNTH[38] = burst(38, 6.3)      # the longest laugh
SYNTH[22] = burst(22, 17.7)     # the breathing loop (circular)
cues.load_ref = lambda refs, handle: SYNTH[handle]


def run(signal, onsets):
    out = []
    det = cues.Detector("synthetic", 0.55, out.append)
    step = int(0.05 * SR)
    for i in range(0, len(signal), step):
        det.feed(signal[i:i + step], lambda s: round(s * 1000 / SR, 1))
    return [e for e in out if "onsetMs" in e]


def at_level(template, snr_db, onset_s, total_s=8.0):
    noise = rng.standard_normal(int(total_s * SR))
    t = template / np.sqrt((template ** 2).mean())
    t = t * np.sqrt((noise ** 2).mean()) * 10 ** (snr_db / 20)
    x = noise.copy()
    a = int(onset_s * SR)
    x[a:a + len(t)] += t[: len(x) - a]
    return x


# The old detector: 0.6 s window, 0.55 floor -- a -5 dB landing is not published.
cues.FAMILY_WIN_S.clear(); cues.FAMILY_MAX_HOPS.clear()
cues.FAMILY_THRESHOLD.clear(); cues.FAMILY_THRESHOLD.update({"step": 0.33})
sig = at_level(SYNTH[26], -5.0, 3.0)
old = [e for e in run(sig, None) if e["cue"] == "fb-left"]
ok(f"at -5 dB the old floor publishes no landing ({[e['ncc'] for e in old]})", not old)

# The model's detector publishes it, at its onset.
cues.apply_hearing(cues.HEARING)
new = [e for e in run(sig, None) if e["cue"] == "fb-left"]
best = max(new, key=lambda e: e["ncc"]) if new else None
ok(f"at -5 dB the model publishes the landing (best {best and best['ncc']})", best is not None and best["ncc"] >= model["sideGrid"]["minNcc"])
ok(f"its onset is the sample's (3000 ms, got {best and best['onsetMs']})", best is not None and abs(best["onsetMs"] - 3000) <= 20)
right = [e for e in run(sig, None) if e["cue"] == "fb-right"]
ok("the other side stays under the acceptance floor", all(e["ncc"] < model["sideGrid"]["minNcc"] for e in right))

# A 6.3 s laugh is published within the hop cap, not after the sample ends.
out = []
det = cues.Detector("synthetic", 0.55, out.append)
lsig = at_level(SYNTH[38], -3.0, 2.0, total_s=10.0)
first_pub = None
step = int(0.05 * SR)
for i in range(0, len(lsig), step):
    det.feed(lsig[i:i + step], lambda s: round(s * 1000 / SR, 1))
    hit = [e for e in out if e.get("cue") == "laugh" and e.get("handle") == 38 and abs(e["onsetMs"] - 2000) <= 20]
    if hit and first_pub is None:
        first_pub = (i + step) / SR
ok(f"a 6.3 s laugh is published {first_pub} s in, within window + cap of its onset",
   first_pub is not None and first_pub - 2.0 <= fams["laugh"][0] + fams["laugh"][2] * cues.HOP_S + 0.2)

print(f"test-fnaf4-cues: {checks - len(failures)}/{checks} checks passed")
for f in failures:
    print("FAIL", f)
sys.exit(1 if failures else 0)
