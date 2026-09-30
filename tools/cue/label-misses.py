#!/usr/bin/env python3
"""Measure the bang detector's miss rate against visually labeled arrivals.

The miss rate is the only fatal direction for the bang-armed policy, and it
cannot be measured with the detector that is under test. So the label comes
from the other modality: the lit left opening is bright when empty and black
when Balloon Boy is in it, so a bright->dark transition in the projection
snapshot is a real g417 arrival, timestamped on the same monotonic clock the
audio log is anchored to.

  tools/device/query-companion.sh log start
  tools/device/query-companion.sh watch 300 visual.tsv     # in another shell
  tools/device/query-companion.sh log stop run1            # prints startNs=

  tools/cue/label-misses.py visual.tsv run1-*.wav --start-ns 95671421840625

The luma threshold is derived from the recording rather than assumed, because
the projection scaler's values have never been calibrated against the offline
simulation the published numbers came from. The split it finds is printed so it
can be sanity-checked before any rate is believed.
"""
import argparse
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import detect  # noqa: E402
import features  # noqa: E402

# A real arrival should produce a bang within this window. It covers the
# snapshot poll interval plus the detector's own alignment slack.
MATCH_WINDOW_S = 1.5


def read_visual(path):
    rows = []
    for line in pathlib.Path(path).read_text().splitlines()[1:]:
        field = line.split("\t")
        if len(field) < 4 or field[3] != "OBSERVED":
            continue
        try:
            rows.append((int(field[0]), int(field[2])))
        except ValueError:
            continue
    return rows


def split_threshold(values):
    """Otsu split. Returns (threshold, dark_mean, bright_mean)."""
    if not values:
        return None
    lo, hi = min(values), max(values)
    if hi - lo < 8:
        return None
    best = None
    for cut in range(lo + 1, hi):
        dark = [v for v in values if v <= cut]
        bright = [v for v in values if v > cut]
        if not dark or not bright:
            continue
        wd, wb = len(dark) / len(values), len(bright) / len(values)
        md, mb = sum(dark) / len(dark), sum(bright) / len(bright)
        between = wd * wb * (md - mb) ** 2
        if best is None or between > best[0]:
            best = (between, cut, md, mb)
    return None if best is None else (best[1], best[2], best[3])


def arrivals(rows, threshold, min_dwell_s):
    """bright -> dark transitions that persist: BB entering the lit opening.

    The dwell requirement is not a nicety. Run this against a menu and the
    screen's own flicker crosses the threshold several times a second, and the
    tool will report those as arrivals and compute a confident miss rate from
    noise. Balloon Boy sits in the opening until he is masked out, and the
    opening is lit for a while before he arrives, so a real arrival has a long
    bright run before it and a long dark run after it.
    """
    runs = []
    for ns, luma in rows:
        dark = luma <= threshold
        if runs and runs[-1][0] == dark:
            runs[-1][2] = ns
        else:
            runs.append([dark, ns, ns])
    out = []
    for i in range(1, len(runs)):
        was_dark, _, _ = runs[i - 1][0], runs[i - 1][1], runs[i - 1][2]
        bright_len = (runs[i - 1][2] - runs[i - 1][1]) / 1e9
        dark_len = (runs[i][2] - runs[i][1]) / 1e9
        if (not was_dark) and runs[i][0] \
                and bright_len >= min_dwell_s and dark_len >= min_dwell_s:
            out.append(runs[i][1])
    return out, len(runs)


def main():
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("visual")
    parser.add_argument("audio")
    parser.add_argument("--start-ns", type=int, required=True,
                        help="startNs reported by `log stop`")
    parser.add_argument("--refs", default=detect.DEFAULT_REFS)
    parser.add_argument("--threshold", type=float, default=0.60)
    parser.add_argument("--prominence", type=float, default=0.06)
    parser.add_argument("--min-dwell", type=float, default=2.0,
                        help="seconds each state must hold for a transition to "
                             "count as an arrival rather than flicker")
    opts = parser.parse_args()

    rows = read_visual(opts.visual)
    if not rows:
        sys.exit("no usable snapshots in %s (all UNKNOWN?)" % opts.visual)
    split = split_threshold([luma for _, luma in rows])
    if split is None:
        sys.exit("the snapshot luma never splits into two states -- the opening "
                 "was never lit, or Balloon Boy never entered it")
    cut, dark_mean, bright_mean = split
    events, runs = arrivals(rows, cut, opts.min_dwell)
    print("visual: %d snapshots over %.1fs, luma splits at %d "
          "(dark mean %.1f, bright mean %.1f)"
          % (len(rows), (rows[-1][0] - rows[0][0]) / 1e9, cut, dark_mean,
             bright_mean))
    print("state runs: %d, of which %d are arrivals holding >= %.1fs either side"
          % (runs, len(events), opts.min_dwell))
    if runs > 4 * max(1, len(events)) and len(events) == 0:
        print("The luma crosses the split constantly, which is what a menu or a "
              "flickering view looks like. This is not a lit opening.")
    if not events:
        sys.exit("no bright->dark transitions: nothing to score against")

    samples = features.load_window(opts.audio)
    frames = features.band_frames(samples)
    frames = detect.subtract(frames, detect.background_profile(frames))
    excluded = detect.clipped_frames(samples)
    refs = detect.load_references(opts.refs)
    curve = detect.score_curve(frames, refs[17])
    found = set(detect.peaks(curve, opts.threshold, len(refs[17]), excluded,
                             opts.prominence))
    found_s = sorted(i * features.HOP / float(features.RATE) for i in found)

    hits = 0
    print()
    print("  %-12s %-10s %s" % ("arrival", "audio t", "nearest bang"))
    for ns in events:
        when = (ns - opts.start_ns) / 1e9
        near = [t for t in found_s if abs(t - when) <= MATCH_WINDOW_S]
        if near:
            hits += 1
            closest = min(near, key=lambda t: abs(t - when))
            print("  %-12.2f %-10.2f hit  (%+.2fs)" % (when, when, closest - when))
        else:
            print("  %-12.2f %-10.2f MISS" % (when, when))

    total = len(events)
    misses = total - hits
    rate = misses / float(total)
    # Rule of three when nothing was missed; otherwise a plain point estimate,
    # which is all a handful of events can honestly support.
    if misses == 0:
        bound = 3.0 / total
        print("\n%d/%d detected. miss rate 0%%, 95%% upper bound %.1f%% (rule of three)"
              % (hits, total, 100 * bound))
    else:
        print("\n%d/%d detected. miss rate %.1f%% (%d of %d)"
              % (hits, total, 100 * rate, misses, total))
    if total < 60:
        print("Fewer than 60 labeled arrivals: too few to bound the rate below "
              "5%%. Collect more nights before believing this number.")


if __name__ == "__main__":
    main()
