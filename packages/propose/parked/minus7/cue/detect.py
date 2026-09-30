#!/usr/bin/env python3
"""Template-match reference cue samples against a captured window.

Plan 08's detector shape, implemented as written there: deterministic features,
a score margin rather than a bare threshold, and `UNKNOWN` for any window the
front end cannot vouch for. It reports onsets; it does not decide anything.

  packages/propose/parked/minus7/cue/detect.py captures/cue-helper/calibration/*.wav
  packages/propose/parked/minus7/cue/detect.py --scan --subtract night.wav      # onsets over a long file
  packages/propose/parked/minus7/cue/detect.py --refs /private/tmp/fnaf2-cue-refs window.wav

A match is the mean per-frame cosine similarity between a reference's
log-band frames and the window's, at the best alignment. Because each frame
has its own mean removed, the score is a shape agreement: playing the cue
quieter does not lower it, and turning the whole mix up cannot raise it.
"""
import argparse
import pathlib
import re
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import correlate  # noqa: E402
import features  # noqa: E402

DEFAULT_REFS = "/private/tmp/fnaf2-cue-refs"
# A window that is clipped, silent, or too short to hold the shortest template
# is not a negative observation -- it is no observation.
CLIP_LEVEL = 0.995
CLIP_FRACTION = 0.001
SILENCE_RMS = 1e-4
# Match the reference's transient core, not the whole sample. Measured on 286 s
# of device audio: whole-sample templates found the shared thud 0.4 times a
# minute, a 0.40 s core found it 7.6 times a minute with a higher peak score.
# Characters hop every five seconds, so the whole-sample rate was plainly wrong.
CORE_FRAMES = 25


def core_of(frames, levels, count):
    """The reference's most energetic contiguous run of `count` frames.

    Matching a whole sample is what made the first device pass insensitive: a
    three-second template averaged over a mix where other sounds dominate most
    of its span scores like background even when the cue is plainly there. The
    transient core is the part that is actually distinctive, and it is the part
    that survives being mixed with everything else.
    """
    if count <= 0 or count >= len(frames):
        return frames
    best_at = 0
    best_sum = None
    running = sum(levels[:count])
    best_sum = running
    for start in range(1, len(levels) - count + 1):
        running += levels[start + count - 1] - levels[start - 1]
        if running > best_sum:
            best_sum = running
            best_at = start
    return frames[best_at:best_at + count]


def load_references(refdir, core=CORE_FRAMES):
    root = pathlib.Path(refdir)
    refs = {}
    for path in sorted(root.glob("s*.wav")):
        match = re.fullmatch(r"s(\d+)\.wav", path.name)
        if not match:
            continue
        samples = features.load_window(path)
        frames = features.band_frames(samples)
        if not frames:
            continue
        if core:
            frames = core_of(frames, features.frame_levels(samples), core)
        refs[int(match.group(1))] = frames
    return refs


def window_quality(samples):
    """Return None if the window is usable, else the reason it is not."""
    if not samples:
        return "empty"
    clipped = sum(1 for v in samples if abs(v) >= CLIP_LEVEL)
    if clipped > len(samples) * CLIP_FRACTION:
        return "clipped"
    if features.rms(samples) < SILENCE_RMS:
        return "silent"
    if len(samples) < features.FRAME * 4:
        return "too-short"
    return None


def _cosine(a, b):
    dot = 0.0
    na = 0.0
    nb = 0.0
    for x, y in zip(a, b):
        dot += x * y
        na += x * x
        nb += y * y
    if na <= 0.0 or nb <= 0.0:
        return 0.0
    return dot / ((na ** 0.5) * (nb ** 0.5))


def score_curve(window_frames, template):
    """Mean-cosine score at every alignment."""
    span = len(window_frames) - len(template) + 1
    if span <= 0:
        return []
    out = [0.0] * span
    for offset in range(span):
        total = 0.0
        for i, row in enumerate(template):
            total += _cosine(window_frames[offset + i], row)
        out[offset] = total / len(template)
    return out


def clipped_frames(samples, frame=None, hop=None):
    """Frame indices whose source samples contain a clipped sample.

    A long collection recording is not one observation, so a clipped burst
    should cost the frames it touches rather than the whole file. The game's
    internal mix sums hot enough to reach full scale, and per
    ANDROID-AUDIO-CAPTURE.md the capture level does not follow device volume,
    so this cannot be turned down -- only excluded.
    """
    frame = frame or features.FRAME
    hop = hop or features.HOP
    bad = set()
    span = range(0, max(0, len(samples) - frame + 1), hop)
    for index, start in enumerate(span):
        for i in range(start, start + frame):
            if abs(samples[i]) >= CLIP_LEVEL:
                bad.add(index)
                break
    return bad


def peaks(curve, threshold, min_gap_frames, excluded=(), prominence=0.05):
    """Prominent local maxima above `threshold`.

    Thresholding alone is not enough. A broad region of mediocre agreement sits
    above any useful threshold for many consecutive alignments, and picking the
    best point every `min_gap_frames` chops that plateau into evenly spaced
    "events" with near-identical scores -- which is exactly what a first pass
    over a real recording produced. A cue is a *peak*: strictly the maximum of
    its neighbourhood, and standing clear of the surrounding baseline.
    """
    chosen = []
    span = len(curve)
    for index in range(span):
        value = curve[index]
        if value < threshold:
            continue
        low = max(0, index - min_gap_frames)
        high = min(span, index + min_gap_frames + 1)
        window = curve[low:high]
        if value < max(window):
            continue
        # Ties inside a plateau: keep only the first.
        if index > low and curve[index - 1] == value:
            continue
        if value - min(window) < prominence:
            continue
        if any(low <= bad < high for bad in excluded):
            continue
        chosen.append(index)
    return chosen


def level_above_background(levels, start, length):
    """How far a match stands above the recording's own median loudness, in dB."""
    if not levels:
        return 0.0
    span = levels[start:start + length]
    if not span:
        return 0.0
    ordered = sorted(levels)
    baseline = ordered[len(ordered) // 2]
    return sum(span) / len(span) - baseline


def background_profile(frames):
    """Per-band median across time: the stationary part of the recording."""
    if not frames:
        return []
    bands = len(frames[0])
    out = []
    for b in range(bands):
        column = sorted(f[b] for f in frames)
        out.append(column[len(column) // 2])
    return out


def subtract(frames, profile):
    out = []
    for frame in frames:
        row = [v - p for v, p in zip(frame, profile)]
        mean = sum(row) / len(row)
        out.append([v - mean for v in row])
    return out


def best_alignment(window_frames, template):
    """Best mean-cosine score and its onset frame, over all alignments."""
    span = len(window_frames) - len(template) + 1
    if span <= 0:
        return None
    best_score = -1.0
    best_at = 0
    for offset in range(span):
        total = 0.0
        for i, row in enumerate(template):
            total += _cosine(window_frames[offset + i], row)
        score = total / len(template)
        if score > best_score:
            best_score = score
            best_at = offset
    return best_score, best_at


def analyse(path, refs):
    samples = features.load_window(path)
    bad = window_quality(samples)
    if bad:
        return {"file": pathlib.Path(path).name, "state": "UNKNOWN",
                "reason": bad, "scores": {}}
    frames = features.band_frames(samples)
    scores = {}
    for handle, template in refs.items():
        result = best_alignment(frames, template)
        if result is None:
            continue
        score, offset = result
        scores[handle] = {
            "score": round(score, 4),
            "onset_s": round(offset * features.HOP / float(features.RATE), 3),
        }
    return {
        "file": pathlib.Path(path).name,
        "state": "OBSERVED",
        "seconds": round(len(samples) / float(features.RATE), 3),
        "rms": round(features.rms(samples), 4),
        "scores": scores,
    }


def ranked(result):
    return sorted(result["scores"].items(),
                  key=lambda kv: kv[1]["score"], reverse=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("windows", nargs="+")
    parser.add_argument("--refs", default=DEFAULT_REFS)
    parser.add_argument("--top", type=int, default=4)
    parser.add_argument("--scan", action="store_true",
                        help="report every onset over time, not one best match")
    parser.add_argument("--subtract", action="store_true",
                        help="remove the per-run background profile first")
    parser.add_argument("--threshold", type=float, default=0.45)
    parser.add_argument("--prominence", type=float, default=0.05,
                        help="how far a peak must stand above its neighbourhood")
    parser.add_argument("--confirm", type=float, default=0.35,
                        help="minimum waveform correlation to accept a band "
                             "candidate; 0 disables the confirming stage")
    parser.add_argument("--core", type=int, default=CORE_FRAMES,
                        help="match only the reference's N most energetic frames "
                             "(0 matches the whole sample, which is far less sensitive)")
    parser.add_argument("--only", type=int, nargs="+",
                        help="restrict to these sample handles")
    opts = parser.parse_args()

    refs = load_references(opts.refs, opts.core)
    if not refs:
        sys.exit("no reference samples in %s -- run packages/source/decompile/extract-samples.sh"
                 % opts.refs)

    if opts.only:
        refs = {h: v for h, v in refs.items() if h in opts.only}

    if opts.scan:
        for target in opts.windows:
            samples = features.load_window(target)
            if not samples or features.rms(samples) < SILENCE_RMS:
                print("%s  UNKNOWN (empty or silent)" % pathlib.Path(target).name)
                continue
            frames = features.band_frames(samples)
            levels = features.frame_levels(samples)
            excluded = clipped_frames(samples)
            if opts.subtract:
                frames = subtract(frames, background_profile(frames))
            print("%s  %.1fs  threshold %.2f%s  clipped frames %d/%d (%.1f%%)"
                  % (pathlib.Path(target).name,
                     len(samples) / float(features.RATE), opts.threshold,
                     "  background-subtracted" if opts.subtract else "",
                     len(excluded), len(frames),
                     100.0 * len(excluded) / max(1, len(frames))))
            hits = []
            raw = {}
            for handle, template in sorted(refs.items()):
                curve = score_curve(frames, template)
                gap = max(1, len(template))
                for index in peaks(curve, opts.threshold, gap, excluded,
                                   opts.prominence):
                    when = index * features.HOP / float(features.RATE)
                    # The band stage proposes, the waveform stage confirms.
                    # Band agreement alone calls menu audio a thud at 0.900.
                    conf, onset = 1.0, when
                    if opts.confirm > 0:
                        if handle not in raw:
                            raw[handle] = features.load_window(
                                pathlib.Path(opts.refs) / ("s%04d.wav" % handle))
                        conf, onset = correlate.best_match(samples, raw[handle], when)
                    hits.append((onset, handle, curve[index],
                                 level_above_background(levels, index, gap), conf))
            kept = [h for h in hits if h[4] >= opts.confirm]
            for when, handle, score, level, conf in sorted(kept):
                print("    %7.2fs  sample %-3d band %.3f  corr %.3f  level %+5.1f dB"
                      % (when, handle, score, conf, level))
            if opts.confirm > 0:
                print("    (%d of %d band candidates confirmed at corr >= %.2f)"
                      % (len(kept), len(hits), opts.confirm))
            if not hits:
                print("    (nothing above threshold)")
        return

    for target in opts.windows:
        result = analyse(target, refs)
        if result["state"] != "OBSERVED":
            print("%s  UNKNOWN (%s)" % (result["file"], result["reason"]))
            continue
        top = ranked(result)[:opts.top]
        head = "%s  %.3fs rms=%.4f" % (
            result["file"], result["seconds"], result["rms"])
        margin = (top[0][1]["score"] - top[1][1]["score"]) if len(top) > 1 else 0.0
        print("%s  margin=%.3f" % (head, margin))
        for handle, item in top:
            print("    sample %-3d score %6.3f  onset %6.3fs"
                  % (handle, item["score"], item["onset_s"]))


if __name__ == "__main__":
    main()
