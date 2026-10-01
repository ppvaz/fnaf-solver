#!/usr/bin/env node
// Every shell script runs under the Mac's /bin/bash, which is 3.2.
//
// macOS ships bash 3.2 and nothing on the lab Mac installs a newer one; CI's
// Linux bash is 5, so a bash-4 builtin passes every lane and fails only where
// the phone is plugged in. 8c331976 (2026-10-01) read the Companion's sources
// with `mapfile`, and android/companion/build.sh stopped at
// "mapfile: command not found" on the Mac the same morning. select-adb.sh had
// already been written "without arrays or mapfile" for the same reason, by
// hand. This makes that a rule: no bash-4-or-later construct in a tracked
// `.sh` file or a script whose shebang names bash. Whole-line comments are not
// read.
//
//   node tools/test-bash3.ts     exit 0 clean, 1 naming file and line
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, repoFiles, report } from './gate-kit.ts';

// Each construct with the bash release that introduced it.
const BASH4 = [
  [/\b(?:mapfile|readarray)\b/, 'mapfile/readarray (bash 4.0)'],
  [/\b(?:declare|local|typeset)\s+-[a-zA-Z]*A/, 'associative array (bash 4.0)'],
  [/\b(?:declare|local|typeset)\s+-[a-zA-Z]*n\b/, 'nameref (bash 4.3)'],
  [/\$\{[#!]?[A-Za-z_][A-Za-z0-9_]*(?:\[[^\]]*\])?(?:,,?|\^\^?)[^}]*\}/, 'case modification ${x,,} ${x^^} (bash 4.0)'],
  [/\$\{[A-Za-z_][A-Za-z0-9_]*(?:\[[^\]]*\])?@[QEPAaUuLK]\}/, 'parameter transformation ${x@Q} (bash 4.4)'],
  [/\$\{[A-Za-z_][A-Za-z0-9_]*\[-\d+\]\}/, 'negative array index (bash 4.3)'],
  [/\bcoproc\b/, 'coproc (bash 4.0)'],
  [/\bwait\s+-n\b/, 'wait -n (bash 4.3)'],
  [/\bglobstar\b/, 'globstar (bash 4.0)'],
  [/&>>/, '&>> (bash 4.0)'],
  [/[^|]\|&/, '|& (bash 4.0)'],
  [/;;&|;&\s*$/, 'case fall-through ;& ;;& (bash 4.0)'],
] as const;

export function bash4(path: string, text: string) {
  const found = [];
  text.split('\n').forEach((line, index) => {
    if (/^\s*#/.test(line)) return;
    for (const [pattern, name] of BASH4) {
      if (pattern.test(line)) found.push(`${path}:${index + 1}: ${name}: ${line.trim()}`);
    }
  });
  return found;
}

// Planted cases run first and must be caught.
assert.equal(bash4('a.sh', 'mapfile -t SOURCES < <(find src -name "*.java")').length, 1, 'mapfile must be caught');
assert.equal(bash4('a.sh', '  declare -A seen=()').length, 1, 'an associative array must be caught');
assert.equal(bash4('a.sh', 'echo "${mode,,}"').length, 1, 'lower-casing must be caught');
assert.equal(bash4('a.sh', 'echo "${mode^^}"').length, 1, 'upper-casing must be caught');
assert.equal(bash4('a.sh', 'printf %s "${arg@Q}"').length, 1, 'a parameter transformation must be caught');
assert.equal(bash4('a.sh', 'last="${items[-1]}"').length, 1, 'a negative index must be caught');
assert.equal(bash4('a.sh', 'make 2>&1 |& tee log').length, 1, '|& must be caught');
assert.equal(bash4('a.sh', 'wait -n').length, 1, 'wait -n must be caught');
assert.deepEqual(bash4('a.sh', [
  '# a Bash-3-compatible count without arrays or mapfile.',
  'SOURCES=()',
  'while IFS= read -r source; do SOURCES+=("$source"); done < <(find src | sort)',
  'echo "${#SOURCES[@]} ${SOURCES[0]} ${HOME:-/} ${name%%,*} ${x//,/ } $#"',
  'a || b & wait',
  'case "$1" in a) echo a ;; esac',
].join('\n')), [], 'bash 3.2 forms and a whole-line comment are not refused');

const BASH_SHEBANG = /^#!\s*(?:\/usr\/bin\/env\s+bash|\/(?:usr\/)?bin\/bash)\b/;
const files = repoFiles().filter(path => path !== 'tools/test-bash3.ts').filter(path => {
  if (path.endsWith('.sh')) return true;
  if (/\.[a-z]+$/.test(path) && !path.endsWith('.bash')) return false;
  try { return BASH_SHEBANG.test(readFileSync(join(ROOT, path), 'utf8').slice(0, 64)); } catch { return false; }
});
assert.ok(files.length > 0, 'the scan found no shell script: a gate that checks nothing must fail');
const failures = files.flatMap(path => bash4(path, readFileSync(join(ROOT, path), 'utf8')));
report('bash3', failures, `${files.length} shell scripts; none needs bash 4, so each runs under macOS /bin/bash 3.2`);
