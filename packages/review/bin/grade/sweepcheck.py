#!/usr/bin/env python3
"""Did the sweep actually *flash* each camera, not merely select it?

camtrace.py reads the lime highlight on the camera map ("which camera is
selected"). A Minus 7 sweep exists to apply the camera-light stun, which needs
the light on *while* that camera is the selected feed.

WHY THIS IS NOT A BRIGHTNESS MEASURE ANYMORE (2026-08-27). The old mean-feed
version could not resolve the c33 LIGHT_AFTER geometry (each camera lit for
2-4 frames on a tearing transition): on the NO_LIGHT control it read cam07 lit
every sweep, on ALT_LIGHT it was coin-flip, and on the *cleared* n1-grey-2202
it was 5/73.

The NO_LIGHT / ALT_LIGHT controls are the fix. ALT_LIGHT lights EVEN sweeps
and leaves ODD ones select-only under one night's feed content -- a clean A/B.
`--recalibrate ALT.mp4` fits, per camera, a rule over three window features of
the feed CENTRE (300,150)-(980,340) -- the tear bands are horizontal and live
at the ROI edges:

  bf   max over the window of the mid-grey fraction (45..200)         -- the
       flashlight adds lit room content
  pve  the window's PEAK vertical-edge density minus its median       -- the
       flashlight reveals room edges a black feed does not have; the median
       subtraction removes the feed's own baseline structure
  rv   row-to-row variance of the window's brightest frame            -- real
       illumination is spatially uniform (low rv); a "bright" dark frame is
       bright because of tear BANDS (high rv)

  a camera is lit iff  bf >= A  and  (pve >= B  or  rv <= C)

and a SWEEP is lit iff at least two of the three cameras are -- the one weak
camera (usually CAM 10, the brightest room, least contrast from the light)
cannot flip the verdict. On the c33 controls: NO_LIGHT 25/25 sweeps correctly
dark, ALT_LIGHT 25/25, all-lit 23/25 (the 2 misses call a lit sweep dark --
the safe direction).

CAVEATS -- read before trusting a number.

1. EVERY calibration frame is an EMPTY ROOM. The c33-dark/alt/stable runs are
   early Night 2 on Continue, before the animatronics leave the stage. A real
   Minus 7 night has Toy Bonnie on CAM 04, Toy Chica returning to CAM 07,
   Withereds moving through -- and an animatronic in the feed CHANGES every
   feature this classifier reads: a dark figure lowers `bf`, adds or destroys
   edges (`pve`), and breaks the spatial uniformity (`rv`). The thresholds
   here may be overfit to empty rooms and quietly fail when the room is
   occupied -- which is exactly the case the sweep exists to handle. This is
   unmeasured. Do not treat a clean sweepcheck pass on an occupied-room night
   as validation until the classifier has been re-checked against labelled
   frames with animatronics present (the same control gap CLAUDE.md records
   for `grey=` and the yellow anchor).

2. CAM 07 (Main Hall) does not transfer across nights. Its lit and dark feeds
   overlap on brightness (both ~178 mean, n=275); the only separator is the
   edge spike / uniformity, and Main Hall's tearing edge-density varies night
   to night, so a threshold fit on one recording false-positives on another
   (7/25 on c33-dark with the c33-alt threshold). CAM 07 is only reliable
   when SELF-calibrated from the same night's own dark sweeps -- i.e. on an
   ALT_LIGHT run. CAM 10 / CAM 04 use the (mean, bf) sweet-spot frame count,
   which is more absolute and did hold across the c33 runs.

3. The sweep verdict is a >=2/3 vote precisely because of (2): a real all-lit
   night cannot self-calibrate CAM 07, so the two reliable cameras carry it.
   A sweep where CAM 10 and CAM 04 both flash almost certainly flashed CAM 07
   too -- same light contact, same geometry.

Usage:
  sweepcheck.py VIDEO [--fps 60] [--expect 10,4,7] [--signature FILE]
  sweepcheck.py --recalibrate ALT.mp4 [--out FILE]   (ALT.mp4 from ALT_LIGHT=1)
"""
import argparse
import json
import os
import statistics
import subprocess
import sys

import framesource

WIDTH, HEIGHT = 1280, 576
MAP = {10: (1091, 384), 4: (923, 379), 7: (947, 328), 11: (1213, 365)}
CROP = (300, 150, 980, 340)
DEFAULT_SIG = os.path.join(os.path.dirname(__file__), "sweepcheck-signature.json")


def stream(path, fps, pix, depth):
    yield from framesource.frames(path, f"fps={fps},scale={WIDTH}:{HEIGHT}", pix, WIDTH * HEIGHT * depth)


def selected(frame):
    best, score = None, 0
    for cam, (cx, cy) in MAP.items():
        s = 0
        for y in range(max(0, cy - 24), min(HEIGHT, cy + 25), 2):
            for x in range(max(0, cx - 48), min(WIDTH, cx + 49), 2):
                i = (y * WIDTH + x) * 3
                r, g, b = frame[i:i + 3]
                if r > 100 and g > 100 and b < 100 and g > b * 1.5:
                    s += 1
        if s > score:
            best, score = cam, s
    return best if score >= 30 else None


def frame_features(gray):
    """(row_mean, vedge, brightfrac, row_variance) over the feed centre."""
    x0, y0, x1, y1 = CROP
    rms, vedge, n, bright, tot = [], 0, 0, 0, 0
    for y in range(y0, y1, 3):
        r = y * WIDTH
        vals = [gray[r + x] for x in range(x0, x1, 6)]
        rms.append(sum(vals) / len(vals))
        for x in range(x0, x1 - 4, 4):
            a = gray[r + x]
            vedge += abs(a - gray[r + x + 4])
            n += 1
            tot += 1
            if 45 <= a <= 200:
                bright += 1
    return (sum(rms) / len(rms), vedge / n, bright / tot,
            statistics.pstdev(rms) if len(rms) > 1 else 0.0)


def window_stats(frames):
    """Per-camera features from a list of frame_features (mean, vedge, bf, rv).

    `flash` counts frames in the (mean, bf) SWEET SPOT: a real flash frame sits
    between the dark settled feed (mean ~80, bf ~0.2) and a white-blowout tear
    (mean ~218, bf ~0.05) -- mean 85..175 with bf >= 0.45. This is the single
    cleanest signal for CAM 10 / CAM 04; it does not save CAM 07 (Main Hall is
    near-black lit or dark, and its 2-4 torn flash frames overlap both ways --
    see the docstring), which is why the sweep verdict is a >=2/3 vote.
    """
    means = [f[0] for f in frames]
    vedges = [f[1] for f in frames]
    brightest = means.index(max(means))
    return {
        "bf": max(f[2] for f in frames),
        "pve": max(vedges) - statistics.median(vedges),
        "rv": frames[brightest][3],
        "flash": sum(1 for (m, _v, bf, _r) in frames if 85 <= m <= 175 and bf >= 0.45),
    }


def sweep_windows(video, fps):
    """Yield (sweep_index, {cam: window_stats or None})."""
    # Keep only a camera label and a four-number feature vector per frame.  A
    # full night at 59 fps is tens of gigabytes as rgb24; making `list()` from
    # a streaming decoder merely moves the old OOM from ffmpeg into Python.
    sel = [selected(f) for f in stream(video, fps, "rgb24", 3)]
    features = [frame_features(f) for f in stream(video, fps, "gray", 1)]
    n = len(sel)
    i = s = 0
    while i < n:
        if sel[i] != 11:
            i += 1
            continue
        while i < n and sel[i] in (11, None):
            i += 1
        start = i
        while i < n and not (i + 3 < n and all(sel[j] == 11 for j in range(i, i + 3))):
            i += 1
        out = {}
        for cam in (10, 4, 7):
            firsts = [k for k in range(start, i) if sel[k] == cam]
            if not firsts:
                out[cam] = None
                continue
            lo, hi = max(0, firsts[0] - 8), min(n, firsts[0] + 5)
            out[cam] = window_stats(features[lo:hi])
        if any(out.values()):
            yield s, out
            s += 1


def cam_lit(rule, w):
    if not w:
        return False
    if rule.get("shape") == "flash":
        return w["flash"] >= rule["flash"]
    return w["bf"] >= rule["bf"] and (w["pve"] >= rule["pve"] or w["rv"] <= rule["rv"])


def cmd_recalibrate(a):
    lit = {c: [] for c in (10, 4, 7)}
    dark = {c: [] for c in (10, 4, 7)}
    for s, w in sweep_windows(a.alt, a.fps):
        (lit if s % 2 == 0 else dark)  # even sweeps are lit
        for cam, stats in w.items():
            if stats:
                (lit if s % 2 == 0 else dark)[cam].append(stats)

    sig = {"_source": os.path.basename(a.alt), "_crop": list(CROP),
           "_rule": "bf>=A and (pve>=B or rv<=C); sweep lit iff >=2 of 3 cams",
           "cams": {}}
    for cam in (10, 4, 7):
        L, D = lit[cam], dark[cam]
        best = None

        def consider(rule):
            nonlocal best
            tp = sum(1 for w in L if cam_lit(rule, w))
            tn = sum(1 for w in D if not cam_lit(rule, w))
            score = tn * 2 + tp   # a false "lit" is the dangerous error
            if best is None or score > best[0]:
                best = (score, rule, tp, tn)

        # shape 1: the (mean, bf) sweet-spot frame count -- cleanest for the
        # rooms with ambient structure (CAM 10, CAM 04).
        for k in range(1, 4):
            consider({"shape": "flash", "flash": k})
        # shape 2: bf floor with an edge-spike / uniformity escape hatch --
        # the only thing that touches CAM 07 at all.
        for A in [x / 100 for x in range(28, 80, 2)]:
            for B in [x / 4 for x in range(0, 40)]:
                for C in range(43, 85, 2):
                    consider({"bf": A, "pve": B, "rv": C})
        _, rule, tp, tn = best
        rule.update(lit_n=len(L), dark_n=len(D),
                    recall=round(tp / len(L), 2) if L else None,
                    specificity=round(tn / len(D), 2) if D else None)
        sig["cams"][str(cam)] = rule
        if rule.get("shape") == "flash":
            desc = f"flash-frames >= {rule['flash']}"
        else:
            desc = f"bf>={rule['bf']} and (pve>={rule['pve']} or rv<={rule['rv']})"
        print(f"CAM {cam:02d}: {desc}   lit {tp}/{len(L)}  dark-rejected {tn}/{len(D)}")

    out = a.out or DEFAULT_SIG
    with open(out, "w") as fh:
        json.dump(sig, fh, indent=1)
    print(f"wrote {out}")


def cmd_grade(a):
    if not os.path.exists(a.signature):
        print(f"no signature at {a.signature} -- run `--recalibrate ALT.mp4` on an "
              f"ALT_LIGHT=1 recording first", file=sys.stderr)
        raise SystemExit(2)
    cams = json.load(open(a.signature))["cams"]
    want = [int(v) for v in a.expect.split(",")]
    lit_sweeps = total = 0
    print(f"{a.video}: signature {os.path.basename(a.signature)}  (sweep lit iff >=2/3 cams)")
    for s, w in sweep_windows(a.video, a.fps):
        total += 1
        per = {}
        for cam in want:
            r = cams.get(str(cam))
            per[cam] = cam_lit(r, w.get(cam)) if r else None
        votes = sum(1 for v in per.values() if v)
        ok = votes >= 2
        lit_sweeps += ok
        detail = "  ".join(f"cam{c:02d}={'lit' if per[c] else 'dark'}" for c in want)
        print(f"  sweep {s + 1:2d}: {detail}   -> {'LIT' if ok else 'DARK'}")
    print(f"summary: {lit_sweeps}/{total} sweeps lit (>=2 of 3 cameras)")
    # Exit 3 is grade-run.sh's "information about the run, not an instrument
    # failure" code, the same one clocktrace.mjs uses for a night that died
    # before 1 AM. A dark sweep IS the finding: the camera light did not
    # render. Exiting 1 made grade-run print "FAILED (resource-limited or
    # diagnostic error)" over a real result, which is an invitation to
    # dismiss it -- on 2026-09-12 (night5-strokes3) all three cameras read
    # dark and the line was labelled a tool fault.
    if total == 0:
        # And this used to pass SILENTLY: `0 < 0` is false, so a run with no
        # gradable sweep at all -- the louder of the two outcomes -- exited 0
        # and said nothing (night5-strokes2, same day).
        print("NO GRADABLE SWEEP: no sweep window was found in this run, so "
              "this instrument says nothing about whether the light fired.")
        sys.exit(3)
    if lit_sweeps < total:
        sys.exit(3)


def main():
    p = argparse.ArgumentParser()
    p.add_argument("video", nargs="?")
    p.add_argument("--fps", type=int, default=60)
    p.add_argument("--expect", default="10,4,7")
    p.add_argument("--signature", default=DEFAULT_SIG)
    p.add_argument("--recalibrate", dest="alt", metavar="ALT.mp4")
    p.add_argument("--out")
    a = p.parse_args()
    if a.alt:
        cmd_recalibrate(a)
    elif a.video:
        cmd_grade(a)
    else:
        p.error("give a VIDEO to grade, or --recalibrate ALT.mp4")


if __name__ == "__main__":
    main()
