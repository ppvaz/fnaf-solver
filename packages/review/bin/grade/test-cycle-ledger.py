#!/usr/bin/env python3
"""cycle-ledger reads each run's own cycle timings, and refuses when it cannot.

Until 2026-09-14 the ledger used Night 6 binding e/f constants on every run,
so Night 7 k2 reads were sampled 2.5 s after their events. These fixtures pin
the resolution from a winner and every refusal. No video, no device.
"""
import importlib.util, json, pathlib, sys, tempfile

HERE = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('cycle_ledger', HERE / 'cycle-ledger.py')
ledger = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ledger)

failures = []
def check(ok, message):
    if not ok: failures.append(message)

def winner(**knobs):
    base = {'loopPeriodMs': 10000, 'maskOnMs': 1749, 'maskOffMs': 7000, 'hallOffsetMs': 7460, 'camdropMs': 11150}
    base.update(knobs)
    return {'schema': 'winner-v1', 'strategy': 'minus-toys', 'knobs': base}

# The two bindings the bug confused: Night 6 e and Night 7 k2.
check(ledger.timings_from_winner(winner(maskOnMs=4249, maskOffMs=9460, hallOffsetMs=10060, camdropMs=13650)) == (4249, 9460, 10060, 13650),
      'Night 6 binding e timings must resolve to 4249/9460/10060/13650')
check(ledger.timings_from_winner(winner()) == (1749, 7000, 7460, 11150), 'Night 7 k2 timings must resolve to 1749/7000/7460/11150')

# Refusals: never a silent default.
check(isinstance(ledger.timings_from_winner({'strategy': 'minus3', 'knobs': {}}), str), 'a minus3 winner must be refused')
check(isinstance(ledger.timings_from_winner({'strategy': 'minus-toys', 'knobs': 'KNOBS0'}), str), 'a named preset must be refused')
check(isinstance(ledger.timings_from_winner(winner(loopPeriodMs=5000)), str), 'a non-10 s loop must be refused')
bad = winner(); del bad['knobs']['camdropMs']
check(isinstance(ledger.timings_from_winner(bad), str), 'a missing timing knob must be refused')

with tempfile.TemporaryDirectory() as tmp:
    tmp = pathlib.Path(tmp)
    bundle = tmp / 'bundle'; bundle.mkdir()
    (bundle / 'winner.json').write_text(json.dumps(winner()))
    run = tmp / 'run'; run.mkdir()
    check(isinstance(ledger.resolve_timings(run), str), 'a run without verdict.txt and without --winner must be refused')
    (run / 'verdict.txt').write_text(f'run          fixture\nbundle       {bundle}\ncampaign exit 0\n')
    check(ledger.resolve_timings(run) == (1749, 7000, 7460, 11150), 'timings must come from the bundle named in verdict.txt')
    (run / 'verdict.txt').write_text(f'run          fixture\nbundle       {tmp / "missing"}\n')
    check(isinstance(ledger.resolve_timings(run), str), 'a verdict naming a missing bundle must be refused')
    check(ledger.resolve_timings(run, bundle / 'winner.json') == (1749, 7000, 7460, 11150), '--winner must override the verdict')

# A death stops the ledger: rows read after the HUD leaves are static and restart frames.
check(ledger.death_video_s('  HUD gone for good from 332.8s: death static (temporal: 21 frames, 5.2s, mean 35, tdiff 36)') == 332.8,
      'the survival instrument line must parse to its video second')
check(ledger.death_video_s('  TERMINAL: clear -- sixam at 454.5s') is None, 'a clear has no death second')

if failures:
    for f in failures: print('FAIL', f)
    sys.exit(1)
print('cycle-ledger: timings come from the run\'s winner; presets, other strategies, other loop periods and missing bundles are refused; reads stop at the death')
