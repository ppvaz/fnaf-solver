// The push gate's closing lines, and what the gate and the hooks tell a person to do.
//
// Until 2026-09-29 a red run of tools/push-gate.ts ended with "Fix them, or push with
// --no-verify to send them anyway.", and .githooks/pre-push said to "bypass a known-red push
// with `git push --no-verify`". CLAUDE.md forbids bypassing a hook. Now the gate names each
// failed lane with the command that reproduces it, and no user-facing string in the gate or
// the hooks offers the bypass. A comment explaining why the bypass is forbidden is fine; the
// scan below reads code strings and, in shell hooks, the commands and any comment that tells
// the reader to use it.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mainCheckout } from '../packages/play/bin/phone/local-profile.ts';
import { LANES, failureReport, pythonPackageDrift, reproduceCommand } from './push-gate.ts';
import { DEFAULT_MEMORY_MAX, RUN_RECORD_SCHEMA, laneCommand, recordRun, runRecordPath } from '../apps/desktop/src/lane-kit.ts';

const ROOT = resolve(join(fileURLToPath(new URL('.', import.meta.url)), '..'));
const BYPASS = /--no-verify|\bcommit\s+-n\b/;

// pip installs mypy's dependencies too: direct pins alone are not the installed set.
const pins = { mypy: '2.3.1' };
const roots = [{ name: 'mypy', version: '2.3.1', requires: ['typing_extensions'] },
  { name: 'typing-extensions', version: '4.16.0', requires: [] }];
assert.equal(pythonPackageDrift(pins, roots), null, 'the exact pinned roots plus active transitive dependencies pass');
assert.match(pythonPackageDrift(pins, [...roots, { name: 'pytest', version: '9', requires: [] }]) ?? '', /unexpected/);
assert.match(pythonPackageDrift(pins, [{ ...roots[0], version: '2.3.0' }, roots[1]]) ?? '', /version/);
assert.match(pythonPackageDrift(pins, [roots[0]]) ?? '', /missing/);
assert.match(pythonPackageDrift(pins, [...roots, { name: 'cycle-a', version: '1', requires: ['cycle-b'] },
  { name: 'cycle-b', version: '1', requires: ['cycle-a'] }]) ?? '', /unexpected/, 'an unrelated dependency cycle is refused');
// A comment that tells the reader to take the bypass, as opposed to one that explains the rule.
const ADVICE = /(?:bypass|push|send|commit)\b[^.\n]*\b(?:with|using|via|or)\s+`?(?:git\s+(?:push|commit)\s+)?(?:--no-verify|-n\b)/i;

/** The string and template literals of a JavaScript source, comments removed first. */
function jsStrings(source: string) {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').split('\n')
    .filter(line => !/^\s*\/\//.test(line)).map(line => line.replace(/\s\/\/\s.*$/, '')).join('\n');
  return [...code.matchAll(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g)].map(match => match[0]);
}

/** What a JavaScript source or a shell hook says to its user that offers the bypass. */
function bypassSuggestions(name: string, source: string) {
  if (/\.m?[jt]s$/.test(name)) return jsStrings(source).filter(text => BYPASS.test(text));
  return source.split('\n').filter(line => /^\s*#/.test(line) ? ADVICE.test(line) : BYPASS.test(line));
}

// Positive controls: the scan catches a planted suggestion and passes an explanation.
assert.deepEqual(bypassSuggestions('x.mjs', "console.log('Fix them, or push with --no-verify to send them anyway.');"),
  ["'Fix them, or push with --no-verify to send them anyway.'"]);
assert.equal(bypassSuggestions('x.mjs', 'console.log(`or run git commit -n`);').length, 1);
assert.deepEqual(bypassSuggestions('x.mjs', "// one `--no-verify` away from being pushed past\nconst a = 'b';"), [],
  'a comment explaining the risk is not a suggestion');
assert.deepEqual(bypassSuggestions('x.ts', "// one `--no-verify` away from being pushed past\nconst a: string = 'b';"), [],
  'a TypeScript source reads its comments as JavaScript does');
assert.equal(bypassSuggestions('hook', '# and bypass a known-red push with `git push --no-verify`.').length, 1);
assert.equal(bypassSuggestions('hook', 'exec git push --no-verify').length, 1);
assert.deepEqual(bypassSuggestions('hook', '# the key and never bypass this hook (--no-verify, commit -n).'), [],
  'a comment stating the rule is not a suggestion');

// The gate, the hooks it installs, and the lab that predicts the hook and reads the gate's record.
for (const file of ['tools/push-gate.ts', '.githooks/pre-push', '.githooks/commit-msg', 'apps/desktop/src/lab.ts', 'apps/desktop/src/cli.ts'])
  assert.deepEqual(bypassSuggestions(file, readFileSync(join(ROOT, file), 'utf8')), [], `${file} suggests bypassing a hook`);

// Every lane has a command that reproduces it.
for (const lane of LANES) {
  const command = reproduceCommand(lane.name);
  assert.ok(command, `${lane.name} has a reproduce command`);
  if (!lane.multiline) assert.equal(command, lane.run, 'a lane is reproduced by its own ci.yml step text');
  else assert.match(command, /\.github\/workflows\/ci\.yml/);
}

// The closing lines: each failed lane, what reproduces it, and how to re-run the gate.
const sha = '0123456789abcdef0123456789abcdef01234567';
const other = 'fedcba9876543210fedcba9876543210fedcba98';
// Both lanes are in LANES, and the contracts lane is a one-line step with its command.
const contracts = LANES.find(lane => lane.name === 'Type and architecture contracts') as Extract<(typeof LANES)[number], { run: string }>;
const shellcheck = LANES.find(lane => lane.multiline) as (typeof LANES)[number];
const report = failureReport([{ sha, name: contracts.name }, { sha, name: shellcheck.name },
  { sha: other, name: 'push-gate is out of step with ci.yml' }]);
assert.deepEqual(report.slice(0, 8), [
  '',
  'push-gate: these lanes would fail on GitHub:',
  `  0123456 ${contracts.name}`,
  `      reproduce: ${contracts.run}`,
  `  0123456 ${shellcheck.name}`,
  `      reproduce: the \`run: |\` script of the "${shellcheck.name}" step in .github/workflows/ci.yml (needs docker)`,
  '  fedcba9 push-gate is out of step with ci.yml',
  '      reproduce: npm run push-gate -- fedcba9 (update LANES in tools/push-gate.ts to match ci.yml)',
]);
assert.match(report[8], /^Fix them and commit again\. `npm run push-gate -- 0123456 fedcba9` re-runs every lane in a clean checkout/);
assert.equal(report.length, 9);
assert.ok(report.every(line => !BYPASS.test(line)), 'the closing lines never offer the bypass');

// Each lane runs under a memory ceiling, so an OOM kills the lane and not the session
// running the gate (2026-09-29).
const tricky = "printf '%s|' 'a b' \"c'd\"";
assert.equal(laneCommand(tricky, { scoped: false }), tricky, 'unscoped, the command is unchanged');
assert.equal(laneCommand(tricky, { memoryMax: 'off', scoped: true }), tricky, 'PUSH_GATE_MEMORY_MAX=off runs unscoped');
const wrapped = laneCommand(tricky, { memoryMax: DEFAULT_MEMORY_MAX, scoped: true });
assert.match(wrapped, /^systemd-run --user --scope -q -p MemoryMax=3G -p MemorySwapMax=4G -- sh -c '/);
const unwrapped = wrapped.replace(/^systemd-run .*? -- /, '');
assert.equal(spawnSync('sh', ['-c', unwrapped], { encoding: 'utf8' }).stdout, "a b|c'd|", 'quoting survives the wrapper');
let scopedRun = 'no user manager here (CI), so lanes run unscoped';
if (spawnSync('systemd-run', ['--user', '--scope', '-q', '--', 'true'], { stdio: 'ignore' }).status === 0) {
  assert.equal(spawnSync('sh', ['-c', wrapped], { encoding: 'utf8' }).stdout, "a b|c'd|", 'a scoped lane runs and keeps its output');
  scopedRun = 'a scoped command ran and kept its output';
}

// Each validated commit leaves a record `npm run lab -- status` reads: host-wide by default,
// FNAF_LAB_DIR names another directory, and lines append.
const labDir = mkdtempSync(join(tmpdir(), 'push-gate-record-'));
try {
  const path = runRecordPath({ FNAF_LAB_DIR: labDir });
  assert.equal(path, join(labDir, 'push-gate.jsonl'));
  assert.equal(runRecordPath({}), join(mainCheckout(ROOT), 'artifacts/lab/push-gate.jsonl'), 'by default, the main checkout\'s artifacts/lab');
  recordRun({ sha, full: false, failed: [], skipped: ['Slow census gates'], at: new Date('2026-09-30T00:00:00Z') }, path);
  recordRun({ sha: other, full: true, failed: [contracts.name], skipped: [] }, path);
  const rows = readFileSync(path, 'utf8').trim().split('\n').map(line => JSON.parse(line));
  assert.deepEqual(rows.map(row => [row.schema, row.sha, row.full, row.failed]), [
    [RUN_RECORD_SCHEMA, sha, false, []], [RUN_RECORD_SCHEMA, other, true, [contracts.name]]]);
  assert.equal(rows[0].at, '2026-09-30T00:00:00.000Z');
} finally { rmSync(labDir, { recursive: true, force: true }); }

console.log(`push gate: ${LANES.length} lanes each name the command that reproduces them, and neither the gate nor its hooks `
  + `nor the lab suggest bypassing a hook (the scan catches a planted suggestion first); lanes run under MemoryMax=${DEFAULT_MEMORY_MAX} `
  + `(${scopedRun}); each validated commit appends a ${RUN_RECORD_SCHEMA} record`);
