#!/usr/bin/env python3
"""office-seed-bracket.py against the lines that fooled a timestamp-ordered read.

The fixture is full-06's office load (2026-09-15): a "startTheFrame() called"
line shares the millisecond with "Starting new frame" and precedes it. Read
by time, the bracket collapses to one candidate; read by line order it is the
14 ms pair that the helper onset sits 69-82 ms after. No phone, no game log.

The second fixture is the sourced bracket (2026-09-16): allocRunHeader is
instruction 0 of initRunLoop, which startTheFrame only calls at 231, after
logging "Starting new frame" (42) and running updateViewport (113). So the seed
sits between the last line logged before initRunLoop and the first logged
inside it -- "Created extension: " from createFrameObjects or "iPhoneOptions
are " from f_InitLoop -- which is one or two milliseconds, not fourteen.
"""
import importlib.util, json, os, pathlib, subprocess, sys, tempfile

HERE = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('osb', HERE / 'office-seed-bracket.py')
osb = importlib.util.module_from_spec(spec); spec.loader.exec_module(osb)

FULL06 = """         1789512692.806 26897 26897 I MMFRuntime: startTheFrame() called
         1789512692.920 26897 26897 I MMFRuntime: loading frame #:4
         1789512693.100 26897 26897 I MMFRuntime: (loading)
         1789512694.248 26897 26897 I MMFRuntime: startTheFrame() called
         1789512694.248 26897 26897 I MMFRuntime: Starting new frame
         1789512694.250 26897 26897 I MMFRuntime: (init)
         1789512694.261 26897 26897 I MMFRuntime: startTheFrame() called
         1789512694.261 26897 26897 I MMFRuntime: All loaded in frame: 4 and took: 1307 (msecs) ...
"""
failures = []
def check(ok, msg):
    if not ok: failures.append(msg)

lines = FULL06.splitlines()
check(osb.bracket(lines, legacy_pair=True) == (1789512694248, 1789512694261),
      f'full-06 pair by line order: {osb.bracket(lines, legacy_pair=True)}')
# With nothing logged from inside initRunLoop, the sourced rule falls back to that pair.
check(osb.bracket(lines) == (1789512694248, 1789512694261), f'fallback when initRunLoop logged nothing: {osb.bracket(lines)}')

# The sourced bracket: the viewport block is pre-seed, the first extension is post-seed.
SOURCED = """         1789598221.184 1 1 I MMFRuntime: loading frame #:4
         1789598222.512 1 1 I MMFRuntime: startTheFrame() called
         1789598222.512 1 1 I MMFRuntime: Starting new frame
         1789598222.512 1 1 I MMFRuntime: Thread Thread[main,5,main] updating viewport
         1789598222.512 1 1 I MMFRuntime: Setting renderer limits...
         1789598222.513 1 1 I MMFRuntime: Created extension: kcclock
         1789598222.515 1 1 I MMFRuntime: Created extension: Android
         1789598222.527 1 1 I MMFRuntime: startTheFrame() called
""".splitlines()
check(osb.bracket(SOURCED) == (1789598222512, 1789598222513), f'sourced bracket: {osb.bracket(SOURCED)}')
check(osb.bracket(SOURCED, legacy_pair=True) == (1789598222512, 1789598222527), 'legacy pair still available')
backwards = [line.replace('222.513', '222.507') for line in SOURCED]
check('backwards' in osb.bracket(backwards), 'a reversed bracket is UNKNOWN, never a negative candidate count')
check('backwards' in osb.bracket(backwards, legacy_pair=True),
      'increasing outer endpoints do not excuse an internal backwards step')
# f_InitLoop's line closes it too, and a viewport block that is absent leaves "Starting new frame" as the opener.
NOVIEWPORT = [l for l in SOURCED if 'viewport' not in l and 'renderer limits' not in l
              and 'Created extension' not in l]
NOVIEWPORT.insert(3, '         1789598222.513 1 1 I MMFRuntime: iPhoneOptions are 1024')
check(osb.bracket(NOVIEWPORT) == (1789598222512, 1789598222513), f'f_InitLoop closes the bracket: {osb.bracket(NOVIEWPORT)}')

# An earlier frame's load must not be taken for the office: the LAST office load wins.
earlier = ["         1789512680.000 1 1 I MMFRuntime: loading frame #:4",
           "         1789512680.100 1 1 I MMFRuntime: Starting new frame",
           "         1789512680.105 1 1 I MMFRuntime: startTheFrame() called"] + lines
check(osb.bracket(earlier) == (1789512694248, 1789512694261), 'the last office load is the bracket')

check(isinstance(osb.bracket(lines[:2]), str), 'a load without its pair is refused')
check(isinstance(osb.bracket(["         1.0 1 1 I MMFRuntime: Starting new frame"]), str), 'no office load is refused')

with tempfile.TemporaryDirectory() as d:
    p = os.path.join(d, 'x.logcat'); open(p, 'w').write(FULL06)
    out = subprocess.run([sys.executable, str(HERE / 'office-seed-bracket.py'), p, '--onset-ms', '1789512694330.005'],
                         capture_output=True, text=True)  # this fixture logs nothing from inside initRunLoop
    check(out.returncode == 0, f'cli exit {out.returncode}: {out.stderr}')
    j = json.loads(out.stdout or '{}')
    check(j.get('candidates') == 14 and j.get('low16') == [47592, 47605], f'cli bracket: {j}')
    check('legacy' not in j.get('rule', ''), f'cli names its rule: {j.get("rule")}')
    check(j.get('beforeOnsetMs') == [69.0, 82.0], f'before onset: {j.get("beforeOnsetMs")}')
    out = subprocess.run([sys.executable, str(HERE / 'office-seed-bracket.py'), p, '--clock-pinned', '--json', os.path.join(d, 'unknown.json')],
                         capture_output=True, text=True)
    j = json.loads(out.stdout or '{}')
    check(out.returncode == 1 and j.get('status') == 'UNKNOWN' and j.get('seedProvenance') == 'pinned',
          'a known pin is refused even with increasing endpoints')
    check(j.get('candidates') is None and j.get('low16') is None, 'UNKNOWN supplies no seed candidates')
    check(json.loads(pathlib.Path(d, 'unknown.json').read_text()) == j, 'the retained diagnostic matches stdout')
    pathlib.Path(p).write_text('\n'.join(backwards))
    out = subprocess.run([sys.executable, str(HERE / 'office-seed-bracket.py'), p], capture_output=True, text=True)
    check(out.returncode == 1 and json.loads(out.stdout)['status'] == 'UNKNOWN', 'a detected reversal emits a refused diagnostic')
    out = subprocess.run([sys.executable, str(HERE / 'office-seed-bracket.py'), os.path.join(d, 'missing.logcat')], capture_output=True, text=True)
    check(out.returncode == 1, 'a missing log exits 1')

for f in failures: print('FAIL', f)
print('office-seed-bracket: sourced initRunLoop bracket, legacy pair, fallback, last load, refusals, cli json' if not failures else f'{len(failures)} failures')
sys.exit(1 if failures else 0)
