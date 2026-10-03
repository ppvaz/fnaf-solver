#!/usr/bin/env node
// The repository's Python under mypy --strict with explicit Any refused, counted per area so the count only
// shrinks, to none: Pedro's 2026-10-01 rule for TypeScript ("real types everywhere"), applied to Python
// alongside it. tools/python_types.py runs the checker one script directory at a time (the scripts import
// their siblings through sys.path, which mypy cannot follow); this holds each area to its entry in
// tools/quality-baseline.json (`pythonTypes`, through tools/gate-kit.ts). A new error fails unless one is
// paid elsewhere in the area, a paid one lowers the entry, and an area with no entry carries none. mypy is
// pinned in CI's Python beside Pillow, NumPy and SciPy.
//
//   node tools/test-python-types.ts          exit 0 when no area's count grew, 1 naming each area that did
//   node tools/test-python-types.ts --list   print each area's count
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ROOT, gitFreeEnv, loadBaseline, ratchet, report } from './gate-kit.ts';

const DRIVER = join(ROOT, 'tools', 'python_types.py');

/** Run the driver over a repository. */
function check(root: string): { areas: Record<string, number>, errors: string[], casts: Record<string, number> } {
  const run = spawnSync('python3', [DRIVER], { cwd: root, encoding: 'utf8', env: { ...gitFreeEnv(), PYTHON_TYPES_ROOT: root },
    maxBuffer: 64 * 1024 * 1024 });
  if (run.status !== 0)
    throw new Error(`python_types.py failed${/No module named 'mypy'/.test(run.stderr) ? ' (install CI\'s pin: python3 -m pip install mypy==2.3.1)' : ''}:\n${run.stderr}`);
  return JSON.parse(run.stdout);
}

// Planted cases run first: two script directories whose files share a name, one typed, one not. The typed
// one also calls os.sched_setaffinity, which only Linux has: it stays clean on any host only because the
// driver checks for Linux, CI's platform, so a count can never depend on the machine that took it.
{
  const repo = realpathSync(mkdtempSync(join(tmpdir(), 'python-types-')));
  try {
    const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', env: gitFreeEnv() });
    git('init', '-q');
    for (const dir of ['packages/demo/bin/typed', 'packages/demo/bin/loose']) mkdirSync(join(repo, dir), { recursive: true });
    writeFileSync(join(repo, 'packages/demo/bin/typed/tool.py'), 'import os\n\n\ndef double(value: int) -> int:\n    return value * 2\n\n\n'
      + 'def pin() -> None:\n    os.sched_setaffinity(0, {0})\n');
    writeFileSync(join(repo, 'packages/demo/bin/loose/tool.py'),
      'from typing import Any\n\ndef double(value):\n    return value * 2\n\ndef widen(value: Any) -> Any:\n    return value\n');
    // A tracked file deleted from the working tree is not Python to check: mypy cannot read it, and a file it
    // cannot read stopped it before the rest of the directory, whose one error then went uncounted.
    mkdirSync(join(repo, 'packages/demo/bin/gone'), { recursive: true });
    writeFileSync(join(repo, 'packages/demo/bin/gone/kept.py'), 'def double(value):\n    return value * 2\n');
    writeFileSync(join(repo, 'packages/demo/bin/gone/deleted.py'), 'VALUE = 1\n');
    git('add', '.');
    rmSync(join(repo, 'packages/demo/bin/gone/deleted.py'));
    // An untracked script is checked as a tracked one is, and its typing.cast calls are counted.
    mkdirSync(join(repo, 'packages/demo/src'), { recursive: true });
    writeFileSync(join(repo, 'packages/demo/src/new.py'), 'import typing\nfrom typing import cast\n\n\n'
      + 'def half(value):\n    return value / 2\n\n\ndef narrow(value: object) -> int:\n    return cast(int, value) + typing.cast(int, value)\n');
    const { areas, errors, casts } = check(repo);
    assert.deepEqual(areas, { 'packages/demo/bin': 3, 'packages/demo/src': 1 },
      `an untyped def and a signature with explicit Any are counted, beside a deleted file and in an untracked one:\n${errors.join('\n')}`);
    assert.ok(errors.every(line => /^packages\/demo\/(?:bin\/(?:loose\/tool|gone\/kept)|src\/new)\.py:/.test(line)), 'the typed file is clean');
    assert.deepEqual(casts, { 'packages/demo/src': 2 }, 'both spellings of typing.cast are counted');
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
}

// Any other error that stops mypy (here Python 2 syntax not named in PYTHON2) is refused, naming the directory,
// rather than counted as a directory with one error and none behind it.
{
  const repo = realpathSync(mkdtempSync(join(tmpdir(), 'python-types-')));
  try {
    const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', env: gitFreeEnv() });
    git('init', '-q');
    mkdirSync(join(repo, 'packages/demo/bin/stopped'), { recursive: true });
    writeFileSync(join(repo, 'packages/demo/bin/stopped/a.py'), 'def double(value):\n    return value * 2\n');
    writeFileSync(join(repo, 'packages/demo/bin/stopped/b.py'), 'print "python 2"\n');
    git('add', '.');
    assert.throws(() => check(repo), /mypy stopped in packages\/demo\/bin\/stopped/, 'a blocking error is refused, not counted');
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
}

const { areas, casts } = check(ROOT);
const found = new Map(Object.entries(areas).map(([area, count]) => [`py:${area}`, { count, detail: `${count} mypy --strict errors` }]));
const castFound = new Map(Object.entries(casts).map(([area, count]) => [`py-cast:${area}`, { count, detail: `${count} typing.cast calls` }]));
if (process.argv.includes('--list')) for (const [key, { count }] of [...found, ...castFound].sort()) console.log(`${count}\t${key}`);
const total = [...found.values()].reduce((sum, { count }) => sum + count, 0);
const castTotal = [...castFound.values()].reduce((sum, { count }) => sum + count, 0);
report('python-types', [...ratchet(found, loadBaseline('pythonTypes')), ...ratchet(castFound, loadBaseline('pythonCasts'))],
  `${found.size} areas carry ${total} mypy --strict errors and ${castTotal} typing.cast calls, none growing`);
