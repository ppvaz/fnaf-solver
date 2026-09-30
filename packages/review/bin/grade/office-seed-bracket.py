#!/usr/bin/env python3
"""The office frame's RNG seed bracket, from the game's own log.

  packages/review/bin/grade/office-seed-bracket.py LOGCAT [--onset-ms MS] [--clock-pinned] [--json OUT]

LOGCAT is `adb logcat -v epoch -s MMFRuntime:V` captured live around a run
(the phone's 256 KiB log ring rolls over in about a minute, so it must be
streamed, not read back). The Fusion runtime seeds its one 16-bit LCG with
the low 16 bits of currentTimeMillis in CRun.allocRunHeader, the first call of
initRunLoop, which runs between the office frame's "Starting new frame" line
and the "startTheFrame() called" line that follows it (docs/evidence/
night7-k3-seedlog-nights-20260915.json). The bracket is that pair, and every
whole millisecond in it is a candidate seed.

The pair is found by LINE ORDER, never by timestamp: a "startTheFrame()
called" line precedes "Starting new frame" in the same millisecond on every
load, and picking it by time collapses the bracket to one wrong candidate
(2026-09-15, full-06). The office is Fusion frame 4 here ("loading frame #:4").

Read from the bytecode on 2026-09-16, the bracket is much tighter than that
pair, and this is now the default. CRunApp.startTheFrame logs "Starting new
frame" at instruction 42, calls MMFRuntime.updateViewport (which logs the
viewport block, last line "Setting renderer limits...") at 113, and only calls
CRun.initRunLoop at 231. allocRunHeader -- the one currentTimeMillis that
becomes rh3Graine -- is instruction 0 of initRunLoop, ahead of initAsmLoop,
y_InitLevel, prepareFrame and createFrameObjects (29, whose object creation
reaches CExtLoad.loadRunObject and logs "Created extension: ") and ahead of
f_InitLoop (57, which logs "iPhoneOptions are "). So the seed is taken strictly
between the last line logged before initRunLoop and the first line logged
inside it, which on the moto g56 is one or two milliseconds rather than the
sixteen the startTheFrame pair gives. Pass --legacy-pair for the old, wider
bracket.

Prints one JSON object: fromMs, toMs, candidates, low16 [first, last], and
with --onset-ms the bracket's distance before the helper's night onset
(beforeOnsetMs [min, max]); exits 1 with a reason when the office load or its
pair is not in the log.

This interval requires a monotonic wall clock through the seed read. A visible
backwards step is refused. With --clock-pinned, even increasing endpoints are
UNKNOWN: a set-time loop can reset between log calls without exposing that
reset in their timestamps. Neither one nor two endpoint candidates proves a
pinned seed. The diagnostic JSON retains no candidate seed.
"""
import argparse, json, sys

OFFICE_LOAD = 'loading frame #:4'
START = 'Starting new frame'
CALLED = 'startTheFrame() called'
# logged before initRunLoop is entered (CRunApp.startTheFrame 42 and 113)
PRE = ('Starting new frame', 'updating viewport', 'Updating window dimensions',
       'uV: initialUpdateDone', 'Setting renderer limits')
# logged inside initRunLoop, after allocRunHeader took the seed (29 -> loadRunObject, 57 -> f_InitLoop)
POST = ('Created extension:', 'iPhoneOptions are')


def epoch_ms(line):
    return int(round(float(line.split()[0]) * 1000))


def checked_interval(lines, start, end):
    stamps = [epoch_ms(line) for line in lines[start:end + 1]]
    if any(after < before for before, after in zip(stamps, stamps[1:])):
        return 'UNKNOWN: wall clock moved backwards across the seed bracket'
    return stamps[0], stamps[-1]


def bracket(lines, legacy_pair=False):
    """(from_ms, to_ms) of the office frame's seed, or a refusal string."""
    loads = [i for i, l in enumerate(lines) if OFFICE_LOAD in l]
    if not loads:
        return 'no office load ("loading frame #:4") in the log'
    i = loads[-1]
    start = next((k for k in range(i, len(lines)) if START in lines[k]), None)
    if start is None:
        return 'office load without a following "Starting new frame"'
    called = next((k for k in range(start + 1, len(lines)) if CALLED in lines[k]), None)
    if called is None:
        return '"Starting new frame" without a following "startTheFrame() called"'
    if legacy_pair:
        return checked_interval(lines, start, called)
    close = next((k for k in range(start + 1, called + 1)
                  if any(t in lines[k] for t in POST)), None)
    if close is None:
        # nothing inside initRunLoop was logged before the next frame start: fall back to the pair
        return checked_interval(lines, start, called)
    opens = [k for k in range(start, close) if any(t in lines[k] for t in PRE)]
    return checked_interval(lines, opens[-1], close)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('logcat'); ap.add_argument('--onset-ms', type=float); ap.add_argument('--json')
    ap.add_argument('--clock-pinned', action='store_true',
                    help='retain UNKNOWN instead of inferring a seed from a clock changed during the read')
    ap.add_argument('--legacy-pair', action='store_true',
                    help='the pre-2026-09-16 bracket: "Starting new frame" to the next "startTheFrame() called"')
    a = ap.parse_args()
    try:
        lines = [l for l in open(a.logcat, errors='ignore').read().splitlines() if 'MMFRuntime' in l]
    except OSError as e:
        print(f'cannot read {a.logcat}: {e}', file=sys.stderr); return 1
    got = bracket(lines, a.legacy_pair)
    if isinstance(got, str) or a.clock_pinned:
        reason = got if isinstance(got, str) else 'UNKNOWN: pinned wall-clock endpoints cannot bound the seed read'
        out = {'schema': 'office-seed-bracket-v1', 'status': 'UNKNOWN',
               'seedProvenance': 'pinned' if a.clock_pinned else 'unverified',
               'candidates': None, 'low16': None, 'reason': reason}
        text = json.dumps(out)
        print(text)
        print(reason, file=sys.stderr)
        if a.json:
            open(a.json, 'w').write(text + '\n')
        return 1
    lo, hi = got
    out = {'schema': 'office-seed-bracket-v1', 'fromMs': lo, 'toMs': hi, 'candidates': hi - lo + 1,
           'low16': [lo & 0xffff, hi & 0xffff],
           'rule': 'startTheFrame-pair (legacy)' if a.legacy_pair else
                   'last line before initRunLoop to first line inside it (allocRunHeader is initRunLoop instruction 0)'}
    if a.onset_ms is not None:
        out['onsetPhoneWallMs'] = a.onset_ms
        out['beforeOnsetMs'] = [round(a.onset_ms - hi, 1), round(a.onset_ms - lo, 1)]
    text = json.dumps(out)
    print(text)
    if a.json:
        open(a.json, 'w').write(text + '\n')
    return 0


if __name__ == '__main__':
    sys.exit(main())
