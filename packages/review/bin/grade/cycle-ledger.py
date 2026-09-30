#!/usr/bin/env python3
"""Per-cycle ledger of a minus-toys run from its retained video (and audio when present).

    cycle-ledger.py RUN_DIR [--release-video-s S] [--cycles N] [--json OUT]

For every 10 s cycle after the release it reads, at 60 fps on the retained
1280x576 recording (scaled to 640x288):
  - the office at the camdrop (+0.62..+0.82 s after the camdrop press): the
    occupant by the encounter corpus' colour rule (docs/evidence/
    encounter-corpus-20260912.json: Chica hue 30-52, Bonnie 225-250, Freddy
    <= 21; ~15 k saturated px is the empty office's own warm lamp);
  - the post-mask hall flash (+0.05..+0.18 s after its press, before the raise
    white-out) against the 0.2 s before it: LIT (~+19 on this geometry),
    DIM (~+6), FLAT (< +3) -- the three classes measured on night6-anchorede2;
  - the office brightness just after the mask-off press: ~16 normal, ~3.3
    after a defended encounter (the darker office of the 2026-09-12 census);
  - when `audio-census.json` is beside the run: the blackout / signal-lost
    loop (s0010) onsets mapped to schedule time through the mask-on touch
    sound (s0007, g267) as the per-cycle anchor.
The release's video time is HUD-first (grade.log clocktrace) + the delivered
epoch (grade.log phase reconstruction) unless --release-video-s is given.

The cycle timings (mask on, mask off, hall flash, camdrop) are the RUN's own:
read from the minus-toys winner of the bundle named in the run's verdict.txt,
or from --winner. Until 2026-09-14 they were constants copied from Night 6
bindings e/f (4249/9460/10060/13650); every Night 7 k2 read was then sampled
2.5 s after its event (docs/evidence/night7-cohort-k2-result-20260914.json,
corrections). A run whose timings cannot be resolved is refused, never
defaulted.
Reads only; every number is a measurement on this recording's geometry.
"""
import argparse, json, pathlib, re, subprocess, sys, colorsys
# numpy is imported where video is decoded: the timing resolution and refusals need only the standard library

LOOP_PERIOD_MS = 10000
TIMING_KNOBS = ('maskOnMs', 'maskOffMs', 'hallOffsetMs', 'camdropMs')


def timings_from_winner(winner):
    """(MASK_ON_MS, MASK_OFF_MS, FLASH_MS, CAMDROP_MS) of a minus-toys winner, or a refusal string."""
    if not isinstance(winner, dict) or winner.get('strategy') != 'minus-toys':
        return f"winner strategy {winner.get('strategy') if isinstance(winner, dict) else None!r} is not minus-toys; this ledger reads the minus-toys loop only"
    knobs = winner.get('knobs')
    if not isinstance(knobs, dict):
        return 'winner knobs are not an object (a named preset cannot be read for timings)'
    if knobs.get('loopPeriodMs') != LOOP_PERIOD_MS:
        return f"loopPeriodMs {knobs.get('loopPeriodMs')!r} is not {LOOP_PERIOD_MS}; the ledger counts 10 s cycles"
    values = []
    for name in TIMING_KNOBS:
        v = knobs.get(name)
        if not isinstance(v, (int, float)) or isinstance(v, bool) or v < 0:
            return f'winner knob {name} is missing or not a non-negative number'
        values.append(v)
    return tuple(values)


def death_video_s(grade_text):
    """Video second the survival instrument saw the HUD leave for good, or None (a clear or an unread run)."""
    m = re.search(r'HUD gone for good from ([0-9.]+)s', grade_text or '')
    return float(m.group(1)) if m else None


def resolve_timings(run, winner_path=None):
    """Timings for this run from --winner, else the bundle its verdict.txt names; a string is a refusal."""
    if winner_path is None:
        verdict = run / 'verdict.txt'
        if not verdict.exists():
            return f'no verdict.txt in {run} to name the bundle; pass --winner'
        m = re.search(r'^bundle\s+(\S+)', verdict.read_text(errors='ignore'), re.M)
        if not m:
            return f'{verdict} names no bundle; pass --winner'
        winner_path = pathlib.Path(m.group(1)) / 'winner.json'
    winner_path = pathlib.Path(winner_path)
    if not winner_path.exists():
        return f'winner {winner_path} does not exist; pass --winner'
    try:
        winner = json.load(open(winner_path))
    except ValueError as error:
        return f'winner {winner_path} is not JSON: {error}'
    return timings_from_winner(winner)



def series(video, t0, t1):
    import numpy as np
    n = max(1, int((t1 - t0) * 60))
    out = subprocess.run(['ffmpeg', '-nostdin', '-loglevel', 'error', '-ss', f'{t0:.3f}', '-i', str(video), '-frames:v', str(n),
                          '-vf', 'scale=640:288', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], capture_output=True).stdout
    return np.frombuffer(out, np.uint8).reshape(-1, 288, 640, 3)


def door(a): return a[:, 80:213, 240:453].mean(axis=(1, 2, 3))


def occupant(frame):
    import numpy as np
    f = frame[30:260].astype(float) / 255
    mx, mn = f.max(2), f.min(2)
    sat = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1e-6), 0)
    m = (sat > 0.35) & (mx > 0.18)
    px = int(m.sum())
    if px < 20000:
        return 'empty', px, None
    r, g, b = f[..., 0][m], f[..., 1][m], f[..., 2][m]
    hues = np.array([colorsys.rgb_to_hsv(x, y, z)[0] * 360 for x, y, z in zip(r[::7], g[::7], b[::7])])
    h = float(np.median(hues))
    who = 'W.Chica' if 30 <= h <= 52 else 'W.Bonnie' if 225 <= h <= 250 else 'W.Freddy' if h <= 21 else f'unlabelled hue {h:.0f}'
    return who, px, round(h, 1)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('run_dir'); ap.add_argument('--release-video-s', type=float); ap.add_argument('--cycles', type=int, default=42); ap.add_argument('--json')
    ap.add_argument('--winner', help='winner.json whose knobs time the cycle (default: the bundle named in RUN_DIR/verdict.txt)')
    a = ap.parse_args()
    run = pathlib.Path(a.run_dir)
    timings = resolve_timings(run, a.winner)
    if isinstance(timings, str):
        print('UNKNOWN  cycle timings:', timings); return 3
    MASK_ON_MS, MASK_OFF_MS, FLASH_MS, CAMDROP_MS = timings
    print(f'timings  mask on {MASK_ON_MS} ms, mask off {MASK_OFF_MS} ms, hall flash {FLASH_MS} ms, camdrop {CAMDROP_MS} ms (from the run\'s winner)')
    video = pathlib.Path('captures') / f'{run.name}.mp4'
    if not video.exists():
        print('UNKNOWN  no retained video at', video); return 3
    rel = a.release_video_s; epoch_s = None
    if rel is None:
        g = (run / 'grade.log').read_text(errors='ignore')
        # errorVersusFirstNightFrameMs is the full delivered epoch (negated);
        # deliveredEpochMs in the same block is that value mod 1000.
        hud = re.search(r'HUD first=(\d+)ms', g); ep = re.search(r'"errorVersusFirstNightFrameMs": (-?[0-9.]+)', g)
        if not (hud and ep):
            print('UNKNOWN  release video time needs HUD first and errorVersusFirstNightFrameMs in grade.log, or --release-video-s'); return 3
        epoch_s = -float(ep.group(1)) / 1000
        rel = int(hud.group(1)) / 1000 + epoch_s
    dur = float(subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', str(video)], capture_output=True, text=True).stdout or 0)
    anchors, enc = [], []
    cpath = run / 'audio-census.json'
    if cpath.exists():
        c = json.load(open(cpath))
        anchors = [t for t, _ in c.get('7', [])]
        # The first mask-on sound is the first loop mask-on the capture holds,
        # early by less than half a cycle: that fixes its cycle index; every
        # later anchor is counted from it in whole cycles.
        if anchors and epoch_s is not None:
            n0 = round((anchors[0] - (MASK_ON_MS / 1000 + epoch_s)) / 10)
            for t, s in c.get('10', []):
                prev = [x for x in anchors if x <= t]
                if prev:
                    x = prev[-1]; n = n0 + round((x - anchors[0]) / 10)
                    enc.append({'audioS': t, 'nc': s, 'anchorAudioS': x, 'cycle': n,
                                'scheduleS': round(t - x + (MASK_ON_MS / 1000 + epoch_s + 10 * n), 2)})
    rows = []
    grade = run / 'grade.log'
    death_s = death_video_s(grade.read_text(errors='ignore')) if grade.exists() else None
    if death_s is not None:
        print(f'death    HUD gone for good at video {death_s} s: cycles whose reads fall after it are not read (static and restart frames)')
    print('cycle | occupant at drop | flash door/pre class | office after mask-off')
    for n in range(a.cycles):
        base = rel + 10 * n
        if base + CAMDROP_MS / 1000 + 0.9 > dur: break
        if death_s is not None and base + CAMDROP_MS / 1000 + 0.82 > death_s:
            print(f'{n:5d} | not read: its camdrop read ends after the death at {death_s} s')
            break
        drop = series(video, base + CAMDROP_MS / 1000 + 0.62, base + CAMDROP_MS / 1000 + 0.82)
        who, px, h = occupant(drop[len(drop) // 2])
        fl = series(video, base + FLASH_MS / 1000 + 0.05, base + FLASH_MS / 1000 + 0.19)
        pre = series(video, base + FLASH_MS / 1000 - 0.30, base + FLASH_MS / 1000 - 0.10)
        after = series(video, base + MASK_OFF_MS / 1000 + 0.35, base + MASK_OFF_MS / 1000 + 0.55)
        d_flash, d_pre = float(door(fl).max()), float(door(pre).mean())
        gain = d_flash - d_pre
        cls = 'LIT' if gain > 12 else 'DIM' if gain > 3 else 'FLAT'
        w_after = float(after[:, 30:260].mean())
        rows.append({'cycle': n, 'occupant': who, 'occupantPx': px, 'hue': h, 'flashDoor': round(d_flash, 1), 'flashPreDoor': round(d_pre, 1),
                     'flash': cls, 'officeAfterMaskOff': round(w_after, 1), 'defended': w_after < 8})
        print(f'{n:5d} | {who:22s} | {d_flash:5.1f}/{d_pre:5.1f} {cls:4s} | {w_after:5.1f}{"  defended" if w_after < 8 else ""}')
    if enc:
        print('blackout loop (s0010) onsets in schedule time:', [(e['scheduleS'], e['nc']) for e in enc])
    if a.json:
        json.dump({'schema': 'cycle-ledger-v1', 'run': run.name, 'releaseVideoS': rel,
                   'timingsMs': dict(zip(('maskOn', 'maskOff', 'hallFlash', 'camdrop'), (MASK_ON_MS, MASK_OFF_MS, FLASH_MS, CAMDROP_MS))),
                   'encountersFromAudio': enc, 'cycles': rows}, open(a.json, 'w'), indent=1)
    return 0


if __name__ == '__main__':
    sys.exit(main())
