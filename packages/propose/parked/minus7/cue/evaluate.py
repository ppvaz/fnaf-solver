#!/usr/bin/env python3
"""Score cue detection against real device background at known SNRs.

ANDROID-AUDIO-CAPTURE.md records that internal capture on this phone carries
the music-box winding loop and Mangle's static even when the operator hears
neither. Plan 08 therefore requires the detector to be challenged with those
loops as negative background rather than evaluated on clean samples.

This injects a reference cue into a real captured window at a known offset and
a swept signal-to-background ratio, and reports whether the correct sample wins
and by how much. It is a controlled lower bound on the real problem, not a
substitute for labeled gameplay: the true mix also contains the game's own
concurrent voices.

  packages/propose/parked/minus7/cue/evaluate.py captures/cue-helper/calibration/title-*.wav
  packages/propose/parked/minus7/cue/evaluate.py bg.wav --cues 21 23 24 --snr 12 6 0 -6

The `background` column repeats the run with a per-run background profile
subtracted in the feature domain (plan 08 detector shape, step 3). Subtraction
is reported as an experiment, never assumed to have removed the artifact.
"""
import argparse
import pathlib
import statistics
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import detect  # noqa: E402
import features  # noqa: E402

# Gate 0 left the controller needing "a BB vocal happened", not which one:
# identity comes from controller state, and the cue only arms a visual check.
# So the scored decision is the class, and 23-mistaken-for-24 is a hit.
CLASSES = {
    "bb-vocal": (21, 23, 24),
    "thud": (17,),
    "taunt": (16,),
    "footstep": (25, 26, 27, 28, 29),
    "mangle-movement": (30, 31, 32),
    "mangle-static": (20,),
    "music-box": (15,),
    "winding": (33,),
}
DEFAULT_CUES = [21, 23, 24, 17]
DEFAULT_SNR = [18, 12, 6, 0, -6]


def inject(background, cue, offset_s, snr_db):
    """Add `cue` into a copy of `background` at the requested ratio."""
    out = list(background)
    start = int(offset_s * features.RATE)
    bg_rms = features.rms(background) or 1e-9
    cue_rms = features.rms(cue) or 1e-9
    gain = (bg_rms * (10.0 ** (snr_db / 20.0))) / cue_rms
    for i, value in enumerate(cue):
        target = start + i
        if target >= len(out):
            break
        out[target] += value * gain
    return [max(-1.0, min(1.0, v)) for v in out]


def background_profile(frames):
    """Per-band median across time: the stationary part of the window."""
    if not frames:
        return []
    return [statistics.median([f[b] for f in frames])
            for b in range(len(frames[0]))]


def subtract(frames, profile):
    out = []
    for frame in frames:
        row = [v - p for v, p in zip(frame, profile)]
        mean = sum(row) / len(row)
        out.append([v - mean for v in row])
    return out


def score_all(frames, refs):
    scores = {}
    for handle, template in refs.items():
        result = detect.best_alignment(frames, template)
        if result is not None:
            scores[handle] = result
    return scores


def class_of(handle):
    for name, members in CLASSES.items():
        if handle in members:
            return name
    return "other"


def class_scores(scores):
    """Best score per class, and where its winner landed."""
    best = {}
    for handle, (score, at) in scores.items():
        name = class_of(handle)
        if name not in best or score > best[name][0]:
            best[name] = (score, at, handle)
    return best


def report(label, scores, truth):
    if not scores:
        return "%-10s no-templates" % label
    best = class_scores(scores)
    order = sorted(best.items(), key=lambda kv: kv[1][0], reverse=True)
    name, (top_score, top_at, handle) = order[0]
    runner = order[1][1][0] if len(order) > 1 else 0.0
    want = class_of(truth) if truth >= 0 else None
    verdict = "-" if want is None else ("hit" if name == want else "MISS")
    return ("%-10s top=%-9s %6.3f (s%d)  margin %6.3f  onset %5.2fs  %s"
            % (label, name, top_score, handle, top_score - runner,
               top_at * features.HOP / float(features.RATE), verdict))


# Channel volumes from the event sheet: g60 defaults channel 15 (the thud) to
# 50, and g414-416 play a Balloon Boy route hop on channel 14 at 25. Played
# amplitude is the reference times volume/100, so the cue the controller needs
# is inherently quieter than the cue we can already find on device.
THUD_HANDLE = 17
THUD_VOLUME = 0.50
VOCAL_VOLUME = 0.25


def played_offset_db(refdir, handle):
    """How far below the thud this sample is played, in dB."""
    import math
    root = pathlib.Path(refdir)
    thud = THUD_VOLUME * features.rms(
        features.load_window(root / ("s%04d.wav" % THUD_HANDLE)))
    cue = VOCAL_VOLUME * features.rms(
        features.load_window(root / ("s%04d.wav" % handle)))
    if thud <= 0 or cue <= 0:
        return 0.0
    return 20.0 * math.log10(cue / thud)


def anchored_trial(background, refdir, refs, handle, level_db, offsets,
                   threshold):
    """Inject at an absolute level above background and count detections."""
    source = features.load_window(
        pathlib.Path(refdir) / ("s%04d.wav" % handle))
    found = 0
    best = 0.0
    for offset in offsets:
        mixed = inject(background, source, offset, level_db)
        frames = features.band_frames(mixed)
        frames = subtract(frames, background_profile(frames))
        curve = detect.score_curve(frames, refs[handle])
        want = int(offset * features.RATE / features.HOP)
        near = max(curve[max(0, want - 40):want + 120]) if curve else 0.0
        best = max(best, near)
        if near >= threshold:
            found += 1
    return found, best


def main():
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("background")
    parser.add_argument("--refs", default=detect.DEFAULT_REFS)
    parser.add_argument("--cues", type=int, nargs="+", default=DEFAULT_CUES)
    parser.add_argument("--snr", type=float, nargs="+", default=DEFAULT_SNR)
    parser.add_argument("--offset", type=float, default=1.5,
                        help="seconds into the window to place the cue")
    parser.add_argument("--anchor", type=float,
                        help="gate 1 mode: treat this dB level above background "
                             "as the measured level of a real thud detection, "
                             "and test each vocal at its own played level "
                             "relative to it")
    parser.add_argument("--threshold", type=float, default=0.60)
    opts = parser.parse_args()

    refs = detect.load_references(opts.refs)
    if not refs:
        sys.exit("no reference samples in %s" % opts.refs)
    background = features.load_window(opts.background)
    bad = detect.window_quality(background)
    if bad:
        sys.exit("background window is unusable: %s" % bad)

    if opts.anchor is not None:
        refs = detect.load_references(opts.refs)
        offsets = [3.0, 6.0, 9.0, 12.0, 15.0]
        offsets = [o for o in offsets
                   if o * features.RATE < len(background) - features.RATE]
        print("background %s  %.1fs  anchor %+.1f dB  threshold %.2f"
              % (pathlib.Path(opts.background).name,
                 len(background) / float(features.RATE), opts.anchor,
                 opts.threshold))
        found, best = anchored_trial(background, opts.refs, refs, THUD_HANDLE,
                                     opts.anchor, offsets, opts.threshold)
        print("  sample %-3d %+6.1f dB  positive control      %d/%d  best %.3f"
              % (THUD_HANDLE, opts.anchor, found, len(offsets), best))
        for handle in opts.cues:
            if handle == THUD_HANDLE or handle not in refs:
                continue
            drop = played_offset_db(opts.refs, handle)
            level = opts.anchor + drop
            found, best = anchored_trial(background, opts.refs, refs, handle,
                                         level, offsets, opts.threshold)
            # How much louder would it have to be played to be found?
            need = None
            for boost in range(0, 25):
                hit, _ = anchored_trial(background, opts.refs, refs, handle,
                                        level + boost, offsets[:2],
                                        opts.threshold)
                if hit == len(offsets[:2]):
                    need = boost
                    break
            print("  sample %-3d %+6.1f dB  at its played level   %d/%d  best %.3f"
                  "  needs %s"
                  % (handle, level, found, len(offsets), best,
                     ("+%d dB" % need) if need is not None else ">+24 dB"))
        return

    base_frames = features.band_frames(background)
    profile = background_profile(base_frames)
    print("background %s  %.2fs rms=%.4f"
          % (pathlib.Path(opts.background).name,
             len(background) / float(features.RATE), features.rms(background)))
    print()
    print("no cue injected (every hit here is a false positive):")
    print("  " + report("raw", score_all(base_frames, refs), -1))
    print("  " + report("subtracted",
                        score_all(subtract(base_frames, profile), refs), -1))

    for cue in opts.cues:
        if cue not in refs:
            print("\nsample %d: no reference" % cue)
            continue
        source = features.load_window(
            pathlib.Path(opts.refs) / ("s%04d.wav" % cue))
        print("\nsample %d injected at %.2fs:" % (cue, opts.offset))
        for snr in opts.snr:
            mixed = inject(background, source, opts.offset, snr)
            frames = features.band_frames(mixed)
            print("  %+5.0f dB  %s" % (snr, report("raw", score_all(frames, refs), cue)))
            print("           %s" % report(
                "subtracted",
                score_all(subtract(frames, background_profile(frames)), refs), cue))


if __name__ == "__main__":
    main()
