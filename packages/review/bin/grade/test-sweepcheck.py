#!/usr/bin/env python3
"""Gate for sweepcheck's per-camera lit/dark rule. No phone, no video decode.

The old sweepcheck measured feed brightness and could not resolve the c33
LIGHT_AFTER geometry (cam07 read lit on every NO_LIGHT sweep; ALT_LIGHT was
coin-flip; the cleared n1-grey-2202 was 5/73).

The new one fits a per-camera rule from an ALT_LIGHT run:
    lit iff  bf >= A  and  (pve >= B  or  rv <= C)
    sweep lit iff >= 2 of 3 cameras lit.
This pins the bundled signature, the three window features on synthetic
frames, the rule, and the >=2/3 vote.
"""
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import sweepcheck  # noqa: E402

fail = []

# --- 1. the bundled signature ---------------------------------------------
sig = json.loads(Path(sweepcheck.DEFAULT_SIG).read_text())
if sorted(sig["cams"]) != ["10", "4", "7"]:
    fail.append(f"signature must cover cams 10/4/7, has {sorted(sig['cams'])}")
for cam, r in sig["cams"].items():
    if r.get("shape") == "flash":
        if not (1 <= r["flash"] <= 3):
            fail.append(f"cam {cam}: implausible flash-frame count {r['flash']}")
    else:
        for k in ("bf", "pve", "rv"):
            if k not in r:
                fail.append(f"cam {cam}: rule missing {k}")
    if r.get("specificity", 0) < 1.0:
        fail.append(f"cam {cam}: signature rejects only {r.get('specificity')} of dark sweeps -- "
                    "the ALT_LIGHT calibration must be a clean 0")
# CAM 07 (Main Hall, black without the light) is the camera brightness alone
# cannot classify -- its rule must lean on pve (edges) or rv (uniformity).
r7 = sig["cams"]["7"]
if r7.get("shape") != "flash" and r7.get("pve", 0) < 2 and r7.get("rv", 99) > 70:
    fail.append("cam 07's rule collapsed to brightness -- it must use the edge "
                "spike or the uniformity term")

# --- 2. window features on synthetic frames ------------------------------
def gray(fn):
    b = bytearray(sweepcheck.WIDTH * sweepcheck.HEIGHT)
    for y in range(sweepcheck.HEIGHT):
        for x in range(sweepcheck.WIDTH):
            b[y * sweepcheck.WIDTH + x] = fn(x, y)
    return bytes(b)

black = gray(lambda x, y: 4)
# uniform lit room: mid-grey with fine vertical structure, same every row
lit_room = gray(lambda x, y: 70 + (55 if (x // 5) % 2 else 0))
# a tear frame: alternating all-white / all-black rows -> huge row variance
tear = gray(lambda x, y: 250 if (y // 4) % 2 else 4)

bm, bv, bb, brv = sweepcheck.frame_features(black)
lm, lv, lb, lrv = sweepcheck.frame_features(lit_room)
tm, tv, tb, trv = sweepcheck.frame_features(tear)
if not (bv < 3 and bb < 0.05):
    fail.append(f"black frame must read low edges + low brightfrac, got vedge={bv:.1f} bf={bb:.2f}")
if not (lb > 0.8 and lrv < 5):
    fail.append(f"a uniform lit room must read high brightfrac + LOW row-variance, "
                f"got bf={lb:.2f} rv={lrv:.1f}")
if not (trv > 80):
    fail.append(f"a tear frame (white/black bands) must read HIGH row-variance, got rv={trv:.1f}")

# window_stats: pve is a peak-minus-median, so a flat window -> ~0, a window
# with one high-edge frame -> positive.
flat = [(50, 5.0, 0.5, 20.0)] * 6
spike = [(50, 5.0, 0.5, 20.0)] * 5 + [(90, 12.0, 0.7, 20.0)]
if sweepcheck.window_stats(flat)["pve"] > 0.01:
    fail.append("window_stats.pve must be ~0 for a flat window")
if sweepcheck.window_stats(spike)["pve"] < 5:
    fail.append("window_stats.pve must spike when one frame has high edges")

# --- 3. the rule + the >=2/3 vote --------------------------------------
def cam_lit(cam, bf, pve, rv):
    return sweepcheck.cam_lit(sig["cams"][str(cam)], {"bf": bf, "pve": pve, "rv": rv})

r = sig["cams"]["7"]
if cam_lit(7, r["bf"] - 0.05, 99, 0):
    fail.append("cam_lit must require bf >= A")
if not cam_lit(7, r["bf"] + 0.05, r["pve"] + 1, 999):
    fail.append("cam_lit must accept a clear edge spike")
if not cam_lit(7, r["bf"] + 0.05, 0, r["rv"] - 1):
    fail.append("cam_lit must accept a low-variance (uniform) bright frame")

# the sweep vote: two lit cameras carry a sweep even if the third is dark
per = {10: True, 4: True, 7: False}
if sum(per.values()) < 2:
    fail.append("two lit cameras must be enough for a lit sweep")
per = {10: True, 4: False, 7: False}
if sum(per.values()) >= 2:
    fail.append("one lit camera must NOT be enough for a lit sweep")

if fail:
    for f in fail:
        print("FAIL " + f, file=sys.stderr)
    raise SystemExit(1)
print("sweepcheck classifier: signature complete (spec 1.0 all cams), "
      "cam07 leans on edge/uniformity, synthetic features + >=2/3 vote OK")
