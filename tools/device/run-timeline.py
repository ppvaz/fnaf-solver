#!/usr/bin/env python3
"""Segment a recorded run into named phases, and name how it ended.

`grade-night.py` answers "how long was it alive". `grade-minus7.py` answers
"office, mask or camera". Neither answers the question a person actually asks
of a finished run -- *what happened, in order* -- and until the first cleared
Night 1 (`n1-full-1640`, 2026-08-26) neither could have, because nothing in the
repository could recognise a 6 AM. A won night and a death looked identical to
every instrument here.

    run-timeline.py VIDEO [--fps 2] [--cause-fps 12] [--min-dwell 1.0]
                    [--cause-model MODEL ...] [--json]

Phases, in the priority they are decided:

    sixam    the win screen: near-black, the clock in its band, win confetti
    intro    the story-night card: the same, with NO confetti (exactly zero)
    mask     near-black with the pink mask bar drawn: a mask response
    dark     near-black with neither text nor mask bar: a fade
    camera   a camera is selected: its map button is highlighted yellow
    office   the HUD is drawn and no camera is selected
    other    lit, but none of the above -- typically the title or menu
    unknown  dark text that matches neither the intro conjunction nor 6 AM

`static` is not among them, on purpose: this game's camera feed is grained, so
roughness fires on it constantly and cannot separate it from the death static,
which on this build is DARK (frame mean 34.1) and not bright. A death is
distinguished by being TERMINAL instead -- sustained static the HUD never
returns from -- which terminal_outcome() decides. Optional shadow-only visual
cause models may add Foxy, Marionette, or Withered Chica candidates to the
terminal evidence,
but no frame cause can make a live controller claim that the night is over.

The terminal outcome is reported with its evidence and never inferred from
duration. A recording that stops before anything terminal is `unknown`, which
is the honest answer for a run whose end was not captured.

**Resolution matters and is enforced.** The dark-screen signals were measured at
1280x576 and survive downsampling to 640x288 (17/17 and 5/5 on the retained
fixtures) but degrade at 320x144 (16/17) and collapse at 160x72 (11/17, 0/5).
grade-minus7.py's 160x72 working size is therefore NOT usable for this, and the
decode below is pinned at 640x288.
"""
import argparse
import importlib.util
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent / "../../packages/play/src/sensors/screencap"))  # Play's screencap readers
import framesource  # noqa: E402
import nightpredicate  # noqa: E402

W, H = 640, 288
DEFAULT_MODEL = os.path.join(HERE, "..", "..", "packages", "play", "profiles", "fnaf2", "moto-g56", "lifecycle-moto-g56-v207.json")
DEFAULT_CAUSE_FPS = 12.0
VISUAL_CAUSES = frozenset(("foxy", "marionette", "withered-chica"))


def _lifecycle():
    spec = importlib.util.spec_from_file_location(
        "lifecycle_observe", os.path.join(HERE, "..", "..", "packages", "play", "src", "sensors", "screencap", "lifecycle-observe.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _death_cause():
    spec = importlib.util.spec_from_file_location(
        "death_cause", os.path.join(HERE, "death-cause.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def decode(path, fps):
    """Yield frames; the timeline retains labels and roughness, never video."""
    yield from framesource.frames(path, f"fps={fps},scale={W}:{H}", "rgb24", W * H * 3)


NATIVE_W, NATIVE_H = 2400, 1080


def parse_rect(text):
    """`X0,Y0,X1,Y1` in native 2400x1080 pixels, half-open."""
    parts = text.split(",")
    if len(parts) != 4 or not all(p.strip().isdigit() for p in parts):
        raise argparse.ArgumentTypeError("--exclude-rect takes X0,Y0,X1,Y1 in native pixels")
    x0, y0, x1, y1 = (int(p) for p in parts)
    if not (0 <= x0 < x1 <= NATIVE_W and 0 <= y0 < y1 <= NATIVE_H):
        raise argparse.ArgumentTypeError("--exclude-rect must lie inside 2400x1080")
    return x0, y0, x1, y1


def exclude(frame, rect):
    """Black out a declared native rectangle before anything reads the frame.

    A teach run (night-run.sh --teach-overlay) carries the Companion's panel in
    its video, in the rectangle its run directory's teach-panel.json names.
    Every decoded pixel the rectangle touches, even partly, reads black, so no
    phase rule sees the panel. Under the mask that region of the game is black
    already, which is what keeps a teach run's dark frames comparable.
    """
    if rect is None:
        return frame
    x0, y0, x1, y1 = rect
    cx0, cy0 = x0 * W // NATIVE_W, y0 * H // NATIVE_H
    cx1, cy1 = -(-x1 * W // NATIVE_W), -(-y1 * H // NATIVE_H)
    out = bytearray(frame)
    blank = bytes((cx1 - cx0) * 3)
    for y in range(cy0, cy1):
        i = (y * W + cx0) * 3
        out[i:i + len(blank)] = blank
    return bytes(out)


def sampler(frame):
    """nightpredicate's fractional-box interface over a raw rgb24 buffer."""
    def sample(fx0, fy0, fx1, fy1):
        x0, y0 = int(fx0 * W), int(fy0 * H)
        x1, y1 = max(int(fx1 * W), x0 + 1), max(int(fy1 * H), y0 + 1)
        r = g = b = n = 0
        for y in range(y0, y1):
            base = (y * W) * 3
            for x in range(x0, x1):
                i = base + x * 3
                r += frame[i]; g += frame[i + 1]; b += frame[i + 2]
                n += 1
        n = max(n, 1)
        return (r / n, g / n, b / n)
    return sample


def _collapse_cause_hits(hits, fps):
    """Turn adjacent positive samples into inspectable cause episodes.

    A jumpscare is usually several decoded frames, not several independent
    causes.  Keeping the first timestamp and the best distance makes the JSON
    useful without allowing a long positive run to swamp the report.  A gap of
    one missing sample still belongs to the same episode; a larger gap starts
    a new one.
    """
    episodes = []
    max_gap = (2.0 / fps) + 1e-9
    for hit in sorted(hits, key=lambda row: (row["at_s"], row["cause"])):
        if (episodes and episodes[-1]["cause"] == hit["cause"] and
                hit["at_s"] - episodes[-1]["through_s"] <= max_gap):
            episode = episodes[-1]
            episode["through_s"] = hit["at_s"]
            episode["samples"] += 1
            if hit.get("distance", float("inf")) < episode.get("distance", float("inf")):
                for key in ("distance", "negativeDistance", "threshold"):
                    if key in hit:
                        episode[key] = hit[key]
        else:
            episodes.append(dict(hit, through_s=hit["at_s"], samples=1))
    return episodes


def scan_cause_frames(video, fps, cause_models, exclude_rect=None):
    """Scan cause models independently of the lifecycle decode cadence.

    ``cause_models`` contains ``(module, model)`` pairs.  The return value is
    a compact list of timestamped, shadow-only positive episodes.  No lifecycle
    conclusion is made here; ``terminal_outcome`` performs that separate gate.
    """
    if not cause_models:
        return []
    if fps <= 0:
        raise ValueError("cause sampling fps must be positive")
    hits = []
    for index, frame in enumerate(decode(video, fps)):
        frame = exclude(frame, exclude_rect)
        at_s = round(index / fps, 4)
        for module, model in cause_models:
            result = module.classify_bytes(frame, W, H, model)
            if result.get("state") != "OBSERVED":
                continue
            hit = {"cause": result["value"], "at_s": at_s,
                   "source": result.get("source", "visual-death-model"),
                   "authorizedFor": result.get("authorizedFor", "shadow")}
            for key in ("distance", "negativeDistance", "threshold"):
                if key in result:
                    hit[key] = result[key]
            hits.append(hit)
    return _collapse_cause_hits(hits, fps)


def mask_bar_pixels(frame):
    """The pink mask bar along the bottom. Positive anchor for the mask being up.

    Measured on the cleared Night 1: ~550-565 px during every mask response and
    EXACTLY 0 outside one. It is what separates a mask from a fade -- both are
    near-black frames, and the first version of this timeline called all seven
    of the run's mask responses `dark`.

    `mask` is the dump's own word (`mask`, `flip mask button`, `mmaskOn.Active`).
    Not `blackout`: in this project that means the office lights going out with
    an animatronic inside, and the dump carries it as a separate state object
    (`blackout`, `blackout timer`), distinct again from `signal out`, the camera
    feed loss. Three different things; do not merge their names.
    """
    n = 0
    for y in range(int(0.88 * H), H):
        for x in range(0, W, 2):
            i = (y * W + x) * 3
            r, g, b = frame[i], frame[i + 1], frame[i + 2]
            if r > 120 and r - g > 40 and b > 60 and b - g > 10:
                n += 1
    return n


def yellow_pixels(frame):
    """Highlighted (selected) camera buttons on the map. See phase_of()."""
    n = 0
    for y in range(0, H, 2):
        for x in range(0, W, 2):
            i = (y * W + x) * 3
            if frame[i] > 150 and frame[i + 1] > 150 and frame[i + 2] < 110:
                n += 1
    return n


def roughness(frame):
    tot = n = 0
    for y in range(0, H - 1, 3):
        for x in range(0, W, 3):
            i = (y * W + x) * 3
            j = ((y + 1) * W + x) * 3
            tot += abs(frame[i] - frame[j]); n += 1
    return tot / max(n, 1)


def phase_of(frame, lo, th):
    from PIL import Image
    im = Image.frombytes("RGB", (W, H), bytes(frame))
    dark = lo.dark_screen_state(im, th)
    if dark == "dark":
        # Near-black with no text. The mask bar tells a mask response apart
        # from a fade; both are otherwise identical.
        return "mask" if mask_bar_pixels(frame) >= th.get("maskBarMin", 200) else "dark"
    if dark in ("unclassified-dark-text", "intro-model-error"):
        # A readable-looking dark screen is not automatically an intro. Keep
        # the uncertainty visible in the timeline and, critically, terminal
        # grading will remain UNKNOWN.
        return "unknown"
    if dark:
        return dark
    # The monitor, by a POSITIVE anchor rather than by elimination: the
    # selected camera's button on the map is highlighted YELLOW (measured
    # (200,200,0) on this build, against browns and reds everywhere in the
    # office). Asking "is a camera selected" is generic across every camera and
    # every route -- camtrace.py answers the sharper question "WHICH of 10/04/
    # 07/11", which is Minus-7's four and not a general grader's business.
    #
    # This has to precede the HUD test, because the HUD does NOT go away when
    # the tablet comes up: the flashlight meter stays drawn over it. That is
    # why nightpredicate.is_night() reads True on 100% of this run's frames --
    # it is an ALIVE test, not an OFFICE test, and using it as one made the
    # first version of this timeline report 430 s of "office" with 10 s of
    # monitor, against the 3.5 s per 5 s cycle the route actually spends there.
    if yellow_pixels(frame) >= th.get("selectedCamYellowMin", 40):
        return "camera"
    if nightpredicate.is_night(sampler(frame)):
        return "office"
    # Everything else with light in it is unnamed. `other`, not `monitor`:
    # the monitor now has its own positive anchor above, and the leftover
    # bucket is mostly the title and menu screens either side of a night.
    #
    # `static` is deliberately NOT a per-frame phase. The camera feed in this
    # game is heavily grained, so roughness fires on it constantly -- the first
    # version of this timeline reported the cleared Night 1 flipping between
    # `office` and `static` about forty times, which is a route playing the
    # cams, not a game dying forty times. Brightness does not separate them
    # either: the death static on this build is DARK, frame mean 34.1, the same
    # as the office (ON-DEVICE-SCREEN-CHECKS).
    #
    # What does separate them is that a death is TERMINAL -- the HUD never
    # comes back. So roughness is consulted only by terminal_outcome(), over a
    # sustained tail, and never to label a frame mid-run.
    return "other"


def collapse(phases, fps, min_dwell):
    """Contiguous runs, with runs shorter than min_dwell folded into the
    previous phase. A single stray frame is a decode artifact, not an event."""
    runs = []
    for i, p in enumerate(phases):
        if runs and runs[-1][0] == p:
            runs[-1][2] = i + 1
        else:
            runs.append([p, i, i + 1])
    out = []
    for p, a, b in runs:
        if out and (b - a) / fps < min_dwell:
            out[-1][2] = b
        else:
            out.append([p, a, b])
    merged = []
    for p, a, b in out:
        if merged and merged[-1][0] == p:
            merged[-1][2] = b
        else:
            merged.append([p, a, b])
    return merged


def terminal_outcome(runs, phases, roughnesses, fps, th, cause_labels=None,
                     cause_events=None):
    """How the run ended, with its evidence. Never inferred from duration.

    The lifecycle evidence remains the 6 AM win screen or a sustained death
    static the HUD never returns from. An optional visual cause candidate can
    add attribution only when the terminal-tail context is present; it is not
    itself an alive/dead authority. Anything else is `unknown`, which is the
    honest answer for a recording that stops before the end of the night -- and
    is what this returns for every run this project made before 2026-08-26.
    """
    if cause_labels is not None and cause_events is not None:
        raise ValueError("supply cause labels or cause events, not both")
    if cause_labels is not None and len(cause_labels) != len(phases):
        raise ValueError("cause label count must match decoded frame count")

    if cause_events is None and cause_labels is not None:
        cause_events = [{"cause": cause, "at_s": round(index / fps, 4),
                         "through_s": round(index / fps, 4), "samples": 1}
                        for index, cause in enumerate(cause_labels) if cause]

    # The 6 AM card counts only AFTER the night was seen: a pre-night frame
    # (title, intro, the newspaper) that matches the sixam signature is not a
    # clear. night5-anchor4 (2026-09-12) graded "clear -- sixam at 24.5s" on a
    # recording whose night HUD first appeared at 29.2 s and whose death
    # static came at 368 s; with the survival grader now naming that death,
    # the same read would have called a death a win.
    first_office = next((a for p, a, b in runs if p == "office"), None)
    for p, a, b in reversed(runs):
        if p == "sixam":
            if first_office is None or a < first_office:
                continue
            return {"outcome": "clear", "evidence": "sixam",
                    "at_s": round(a / fps, 2), "positive": True,
                    "note": "the 6 AM win screen is in the recording, after the night"}

    # A visual cause is a candidate, not a lifecycle authority. Require
    # the candidate after the last positively observed office segment, require
    # at least one captured frame after it, and reject a candidate followed by
    # a return to the office. This keeps an isolated false match in a live
    # scene from terminating a run.
    if cause_events is not None:
        # The real Night 2 calibration produced lookalike hits during camera
        # and mask transitions.  "No office after it" is not enough to call
        # those terminal: only the final non-live-looking tail is eligible.
        # Allow one lifecycle sample immediately before that tail because the
        # jumpscare frame itself can still satisfy the alive predicate.
        final_phase = runs[-1][0] if runs else None
        final_tail_start = (runs[-1][1] / fps
                            if final_phase in ("other", "dark", "unknown")
                            else None)
        valid = []
        for event in sorted(cause_events, key=lambda row: row.get("at_s", float("inf"))):
            cause = event.get("cause", event.get("value"))
            at_s = event.get("at_s")
            if cause not in VISUAL_CAUSES or not isinstance(at_s, (int, float)):
                continue
            # The stock HUD remains drawn over the jumpscare, so this exact
            # frame may still satisfy the positive alive predicate. Compare
            # against office samples strictly before the candidate rather than
            # letting the candidate disqualify itself as "office".
            if not any(i / fps < at_s - 1e-9 and p == "office"
                       for i, p in enumerate(phases)):
                continue
            if final_tail_start is None or at_s < final_tail_start - (1.0 / fps) - 1e-9:
                continue
            if any(i / fps > at_s + 1e-9 and p == "office"
                   for i, p in enumerate(phases)):
                continue
            through_s = event.get("through_s", at_s)
            if not isinstance(through_s, (int, float)):
                through_s = at_s
            # At least one lifecycle sample must follow the candidate episode.
            # A cause hit on the final decoded frame is not enough to call the
            # recording terminal.
            if not any(i / fps > through_s + 1e-9
                       for i in range(len(phases))):
                continue
            valid.append(event)
        labels = {event.get("cause", event.get("value")) for event in valid}
        if len(labels) > 1:
            return {"outcome": "unknown", "evidence": None,
                    "at_s": None, "positive": False,
                    "note": "visual cause candidates disagree; lifecycle "
                            "evidence is insufficient to choose one"}
        if valid:
            # The final episode is the only one that can be the terminal
            # cause; earlier same-label matches are lookalike candidates.
            event = valid[-1]
            cause = event.get("cause", event.get("value"))
            return {"outcome": "death", "evidence": f"visual-{cause}-jumpscare",
                    "cause": cause, "at_s": round(event["at_s"], 2),
                    "positive": True,
                    "note": f"a shadow-only visual {cause} candidate followed "
                            "the last office segment and the recording continued"}

    # A terminal static: the tail of the recording, no HUD in it, and rough.
    last_office = max((i for i, p in enumerate(phases) if p == "office"),
                      default=None)
    if last_office is not None and last_office < len(phases) - 1:
        tail = range(last_office + 1, len(phases))
        rough = roughnesses[last_office + 1:]
        if rough and len(rough) / fps >= 2.0 and \
                sum(1 for r in rough if r >= th["staticRoughnessMin"]) >= len(rough) * 0.6:
            return {"outcome": "death", "evidence": "terminal-static",
                    "at_s": round((last_office + 1) / fps, 2), "positive": True,
                    "note": "the recording ends in sustained static the HUD "
                            "never returns from"}
    return {"outcome": "unknown", "evidence": None, "at_s": None,
            "positive": False,
            "note": "nothing terminal was captured; the recording may stop "
                    "before the end of the night"}


def main():
    p = argparse.ArgumentParser()
    p.add_argument("video")
    p.add_argument("--fps", type=float, default=2.0)
    p.add_argument("--min-dwell", type=float, default=1.5)
    p.add_argument("--cause-fps", type=float, default=DEFAULT_CAUSE_FPS,
                   help="independent sampling rate for transient cause models")
    p.add_argument("--cause-model", action="append", metavar="MODEL",
                   help="shadow-only visual death-cause model; repeat for labels")
    p.add_argument("--exclude-rect", type=parse_rect, metavar="X0,Y0,X1,Y1",
                   help="black out a native 2400x1080 rectangle (a teach run's panel) first")
    p.add_argument("--json", action="store_true")
    a = p.parse_args()

    lo = _lifecycle()
    with open(os.environ.get("LIFECYCLE_MODEL", DEFAULT_MODEL)) as fh:
        th = json.load(fh)["thresholds"]

    cause_model_paths = a.cause_model
    if not cause_model_paths and os.environ.get("DEATH_CAUSE_MODEL"):
        cause_model_paths = [os.environ["DEATH_CAUSE_MODEL"]]
    cause_models = []
    cause_model_meta = []
    if cause_model_paths:
        try:
            cause_mod = _death_cause()
            seen_labels = set()
            for cause_model_path in cause_model_paths:
                with open(cause_model_path, encoding="utf-8") as fh:
                    cause_model = json.load(fh)
                cause_mod._validate_model(cause_model)
                label = cause_model["label"]
                if label in seen_labels:
                    raise ValueError(f"duplicate cause model label: {label}")
                seen_labels.add(label)
                cause_models.append((cause_mod, cause_model))
                cause_model_meta.append({"path": cause_model_path,
                                         "label": label,
                                         "authorized_for": "shadow"})
        except (OSError, ValueError, json.JSONDecodeError) as exc:
            print(f"cause model: {exc}", file=sys.stderr)
            raise SystemExit(2)

    phases, roughnesses = [], []
    for frame in decode(a.video, a.fps):
        frame = exclude(frame, a.exclude_rect)
        phases.append(phase_of(frame, lo, th))
        roughnesses.append(roughness(frame))
    if not phases:
        print(f"{a.video}: no frames", file=sys.stderr)
        raise SystemExit(2)
    runs = collapse(phases, a.fps, a.min_dwell)
    cause_events = (scan_cause_frames(a.video, a.cause_fps, cause_models,
                                      a.exclude_rect)
                    if cause_models else None)
    res = terminal_outcome(runs, phases, roughnesses, a.fps, th,
                           cause_events=cause_events)

    if a.json:
        print(json.dumps({
            "video": a.video, "fps": a.fps, "frames": len(phases),
            **({"excludedRect": list(a.exclude_rect)} if a.exclude_rect else {}),
            "segments": [{"phase": p, "from_s": round(x / a.fps, 2),
                          "to_s": round(y / a.fps, 2),
                          "seconds": round((y - x) / a.fps, 2)}
                         for p, x, y in runs],
            "terminal": res,
            **({"cause_models": cause_model_meta,
                "cause_fps": a.cause_fps,
                "cause_candidates": cause_events}
               if cause_models else {})}, indent=2))
        return 0

    print(f"{a.video}: {len(phases)} frames at {a.fps} fps, {W}x{H}")
    for ph, x, y in runs:
        print(f"  {x / a.fps:7.1f}s -> {y / a.fps:7.1f}s  "
              f"({(y - x) / a.fps:6.1f}s)  {ph}")
    print(f"\n  TERMINAL: {res['outcome']}"
          + (f" -- {res['evidence']} at {res['at_s']}s" if res["evidence"] else "")
          + (f" (cause={res['cause']})" if res.get("cause") else "")
          + f"\n  {res['note']}")
    if cause_events:
        print("\n  VISUAL CAUSE CANDIDATES (shadow-only)")
        for event in cause_events:
            end = event.get("through_s", event["at_s"])
            span = (f" -> {end:.2f}s" if end != event["at_s"] else "")
            print(f"    {event['at_s']:.2f}s{span}  {event['cause']} "
                  f"({event['samples']} sample(s))")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
