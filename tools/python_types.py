#!/usr/bin/env python3
"""mypy --strict over the repository's Python, counted per area (tools/test-python-types.ts holds the count).

The Python here is scripts, not packages: each imports its siblings, and Play's shared screencap, safety and
testdata modules, by inserting their directories into sys.path, which mypy cannot follow. So each directory is
checked on its own, with itself and those three shared directories as its import path, and one directory's
module names never meet another's (two `overnight-window.py` exist). Strict mode with explicit Any refused is
Pedro's rule of 2026-10-01 ("real types everywhere") applied to Python.

    python3 tools/python_types.py            one JSON object: {"areas": {area: errors}, "errors": [...]}
    python3 tools/python_types.py --list     one line per error
    PYTHON_TYPES_ROOT=DIR                    check another repository (the gate's planted fixture)
"""
import json
import os
import subprocess
import sys
from collections import Counter, defaultdict
from pathlib import Path

from mypy import api

ROOT = Path(os.environ.get('PYTHON_TYPES_ROOT') or Path(__file__).resolve().parent.parent)
SHARED = ['packages/play/src/sensors/screencap', 'packages/play/src/safety', 'packages/play/test/testdata']
# Sources that run under Python 2.7, which mypy cannot check, each with what runs it.
PYTHON2 = {
    'packages/source/recompile/fnaf2-config.py': 'a Chowdren --config, loaded by the pinned converter under Python 2.7',
    'packages/source/recompile/game-config.py': 'a Chowdren --config, loaded by the pinned converter under Python 2.7',
    'packages/source/recompile/probe-onloop.py': 'a probe run under Python 2.7 against the patched mmfparser',
    'packages/source/recompile/probe-sounds.py': 'a probe run under Python 2.7 against the patched mmfparser',
    'packages/source/recompile/probe-unknown-params.py': 'a probe run under Python 2.7 against the patched mmfparser',
    'packages/source/recompile/test-child-events.py': 'a fixture run under Python 2.7 through the patched Chowdren emitter',
    'packages/source/recompile/test-mobile-parser.py': 'a fixture run under Python 2.7 against the patched mmfparser',
}
# Linux, whatever the host: mypy checks the branches of the platform it is told, and CI is Linux.
# Counted on the Mac, os.sched_setaffinity (Linux-only) was one more error than CI saw, and every
# push since 8e6d03fa failed on a baseline the Mac had written.
FLAGS = ['--strict', '--disallow-any-explicit', '--no-error-summary', '--show-error-codes', '--no-color-output',
         '--hide-error-context', '--python-version', '3.12', '--platform', 'linux', '--cache-dir', str(ROOT / '.mypy_cache')]


def area_of(path: str) -> str:
    """The area a file's errors are counted in, as tools/test-type-debt.ts names TypeScript's."""
    parts = path.split('/')
    if parts[0] == 'tools':
        return 'tools'
    if parts[0] in ('packages', 'apps') and len(parts) > 3:
        return '/'.join(parts[:3])
    return '/'.join(parts[:2])


def tracked() -> list[str]:
    out = subprocess.run(['git', 'ls-files', '-z', '--', '*.py'], cwd=ROOT, capture_output=True, text=True, check=True)
    # A tracked file deleted from the working tree is not Python to check, and mypy cannot read it.
    return sorted(path for path in out.stdout.split('\0') if path and path not in PYTHON2 and (ROOT / path).is_file())


def check(directory: str, files: list[str]) -> list[str]:
    """mypy's error lines for one directory's files, with paths relative to the repository.

    A blocking error (a file mypy cannot parse or read) stops mypy before the rest of the directory, which would
    then count as clean: that exits instead, naming the directory.
    """
    path = os.pathsep.join([directory, *(shared for shared in SHARED if shared != directory)])
    os.environ['MYPYPATH'] = path
    stdout, stderr, status = api.run([*FLAGS, *files])
    if status == 2:
        sys.exit(f'python_types.py: mypy stopped in {directory} before checking it (exit 2):\n{stdout}{stderr}')
    return [line for line in stdout.splitlines() if ': error: ' in line]


def main() -> None:
    os.chdir(ROOT)
    by_directory: defaultdict[str, list[str]] = defaultdict(list)
    for path in tracked():
        by_directory[str(Path(path).parent)].append(path)
    errors: list[str] = []
    for directory, files in sorted(by_directory.items()):
        errors.extend(line for line in check(directory, files) if line.split(':', 1)[0] in files)
    if '--list' in sys.argv:
        print('\n'.join(errors))
        return
    areas = Counter(area_of(line.split(':', 1)[0]) for line in errors)
    print(json.dumps({'areas': dict(sorted(areas.items())), 'errors': errors}))


if __name__ == '__main__':
    main()
