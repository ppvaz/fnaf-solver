#!/usr/bin/env node
// Run the CI job locally, against the commits about to be pushed.
//
// The point is the CHECKOUT, not the commands. CI clones the pushed commit and
// runs there; a developer running the same `npm run` lines runs them against a
// working tree that also holds uncommitted edits, untracked files, and stale
// generated output. Those two answers differ, and the difference is not
// theoretical: `fcd4312` added `tools/nightloop-run.mjs` without its
// `command-registry.json` row and CI failed `git diff --exit-code` on every
// push for a day, while the same catalog command in the author's tree looked
// settled. `npm run catalog` in a dirty tree is a DIFFERENT MEASUREMENT from
// the one CI takes. So this gate builds a throwaway `git worktree` at the exact
// commit being pushed and runs the lanes there.
//
// Two deliberate differences from CI, both strictly more informative:
//
//   - CI stops the job at its first failed step. This runs every lane, because
//     a job that stops early reports one break and hides the rest.
//   - When a lane fails, its `&&` chain is re-run command by command to name
//     every failure in it. `deb6463` broke both `night-policy.test.js` and
//     `observationlanguagetest.mjs`; they sit in one `&&` chain, so CI only
//     ever named the first and the second stayed invisible for a day.
//
// The verdict itself is CI's: a lane is the step text from `ci.yml`, and
// `laneDrift` fails the run if the two drift apart, because a mirror that has
// stopped mirroring is worse than no mirror.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(join(fileURLToPath(new URL('.', import.meta.url)), '..'));
const ZERO = /^0+$/;

// Each lane is one `ci.yml` step. `needs` names a binary the lane cannot run
// without; a missing one is reported as SKIPPED rather than passed, because a
// gate that quietly drops a lane is how a green local run turns red online.
// `heavy` marks a lane the default (pre-push) run skips and reports as
// unverified: on 2026-09-28 the whole gate was measured at about six minutes,
// five of them the slow census gates (`npm run test:unit:slow`), and Pedro
// ruled that iteration time outranks re-running censuses that no ordinary
// commit changes. CI still runs every lane; `npm run push-gate -- --full`
// runs them all here.
export const LANES = [
  { name: 'Type and architecture contracts', run: 'npm run typecheck && npm run test:unit && npm run test:contracts' },
  { name: 'Slow census gates', run: 'npm run test:unit:slow', heavy: true },
  { name: 'Clean-checkout model lane', run: 'npm run test:core' },
  { name: 'Trainer build', run: 'npm run build:trainer' },
  { name: 'Campaign dry-run over a committed winner', run: 'd=$(mktemp -d) && trap \'rm -rf "$d"\' EXIT && npm run --silent device:emit -- --winner tools/device/campaign-night7-k3-winner.json --out "$d/k3" && npm run --silent device:campaign -- --bundle "$d/k3" --nights 7 --profile hid-mediaprojection' },
  { name: 'Documentation and catalog links', run: 'npm run catalog && npm run chronicle && git diff --exit-code -- docs/architecture/generated docs/portal && node tools/test-docs.mjs' },
  { name: 'ShellCheck critical diagnostics', needs: 'docker', multiline: true },
  { name: 'Shell footgun regressions', run: 'tools/device/test-shell-footguns.sh' },
  { name: 'Cue helper query (mock ADB)', run: 'tools/device/test-query-cue-helper.sh' },
  { name: 'Cue helper soak (mock ADB)', run: 'tools/device/test-soak-cue-helper.sh' },
];

// --- The gate must stay the job it claims to mirror ------------------------

/** Read `- name:` / `run:` pairs out of the CI job, without a YAML parser. */
function ciSteps(dir) {
  const lines = readFileSync(join(dir, '.github/workflows/ci.yml'), 'utf8').split('\n');
  const steps = [];
  for (let i = 0; i < lines.length; i += 1) {
    const named = lines[i].match(/^\s*- name:\s*(.+?)\s*$/);
    if (!named) continue;
    let run = null;
    for (let j = i + 1; j < lines.length && !/^\s*- /.test(lines[j]); j += 1) {
      const single = lines[j].match(/^\s*run:\s*(.+?)\s*$/);
      if (single) { run = single[1] === '|' ? null : single[1]; break; }
    }
    steps.push({ name: named[1], run });
  }
  return steps;
}

function laneDrift(dir) {
  const steps = ciSteps(dir).filter(step => !/^(Fixture rendering (dependency|and video dependencies)|Install the pinned workspace toolchain)$/.test(step.name));
  const drift = [];
  const ciNames = steps.map(step => step.name);
  const laneNames = LANES.map(lane => lane.name);
  if (ciNames.join('\n') !== laneNames.join('\n'))
    drift.push(`lane list differs from ci.yml\n  ci.yml: ${ciNames.join(' | ')}\n  gate:   ${laneNames.join(' | ')}`);
  for (const lane of LANES) {
    const step = steps.find(candidate => candidate.name === lane.name);
    if (!step || lane.multiline) continue;
    if (step.run !== lane.run)
      drift.push(`step "${lane.name}" runs a different command\n  ci.yml: ${step.run}\n  gate:   ${lane.run}`);
  }
  return drift;
}

/** The ShellCheck lane's script, taken verbatim from the `run: |` block. */
function shellcheckScript(dir) {
  const lines = readFileSync(join(dir, '.github/workflows/ci.yml'), 'utf8').split('\n');
  const at = lines.findIndex(line => /- name:\s*ShellCheck critical diagnostics\s*$/.test(line));
  const start = lines.findIndex((line, index) => index > at && /^\s*run:\s*\|\s*$/.test(line));
  const body = [];
  const indent = lines[start + 1].match(/^\s*/)[0];
  for (let i = start + 1; i < lines.length && (lines[i].startsWith(indent) || !lines[i].trim()); i += 1)
    body.push(lines[i].slice(indent.length));
  return body.join('\n').trim();
}

// --- A checkout that resolves its own packages -----------------------------

/**
 * Wire `node_modules` in a fresh worktree. The workspace links must point at
 * the WORKTREE's packages: symlinking the main repository's `node_modules`
 * wholesale makes `@fnaf2-1020/core` resolve back to the working tree, so the
 * gate would type-check and test the code it was built to ignore.
 */
function linkDependencies(worktree) {
  // The lockfile is what `npm ci` installs from, so an identical lockfile means
  // an identical tree and the existing one can be linked. `package.json` is not
  // the test: it changes whenever a script is added, and reinstalling for that
  // would cost minutes for nothing.
  const source = join(ROOT, 'node_modules');
  const same = existsSync(source) && readFileSync(join(ROOT, 'package-lock.json'), 'utf8')
    === readFileSync(join(worktree, 'package-lock.json'), 'utf8');
  if (!same) {
    console.log('  the lockfile differs from the working tree; running npm ci');
    execFileSync('npm', ['ci'], { cwd: worktree, stdio: 'inherit', env: withoutGit(process.env) });
    return;
  }
  mkdirSync(join(worktree, 'node_modules'), { recursive: true });
  for (const entry of readdirSync(source)) {
    const target = join(worktree, 'node_modules', entry);
    if (!entry.startsWith('@')) { symlinkSync(join(source, entry), target); continue; }
    // A scope directory holds the workspace links, and those are relative
    // (`../../packages/core`), so copying the link text re-points them at this
    // checkout. Anything else in the scope is a real dependency directory.
    mkdirSync(target, { recursive: true });
    for (const scoped of readdirSync(join(source, entry))) {
      const from = join(source, entry, scoped);
      symlinkSync(lstatSync(from).isSymbolicLink() ? readlinkSync(from) : from, join(target, scoped));
    }
  }
}

// --- CI's Python, not this machine's -----------------------------------------

// CI's runner gets setup-python's interpreter plus the `pip install` pins in
// ci.yml and nothing else. This machine's python3 carries numpy and more, so a
// test that imports an unpinned package passes here and fails online: on
// 2026-09-15 tools/device/test-cycle-ledger.py (numpy through cycle-ledger.py)
// failed CI on four pushes that this gate had passed. So the lanes run on an
// isolated interpreter whose packages are exactly the pins, or the gate says it
// could not check Python dependencies instead of passing them.
const CI_PYTHON = process.env.FNAF2_CI_PYTHON ?? join(homedir(), '.cache/fnaf2-ci-py312/bin/python3');

/** The Python version and exact pip pins ci.yml gives the runner. */
function ciPythonSpec(dir) {
  const text = readFileSync(join(dir, '.github/workflows/ci.yml'), 'utf8');
  const version = text.match(/python-version:\s*'([\d.]+)'/)?.[1] ?? null;
  const pins = {};
  for (const line of text.split('\n').filter(l => /pip install/.test(l)))
    for (const m of line.matchAll(/'([A-Za-z0-9_.-]+)==([^']+)'/g)) pins[m[1].toLowerCase()] = m[2];
  return { version, pins };
}

/** { env } running the lanes on the CI-like interpreter, or { why } it cannot be trusted. */
function ciPythonEnv(dir) {
  const { version, pins } = ciPythonSpec(dir);
  const build = `build it: micromamba create -p ~/.cache/fnaf2-ci-py312 -c conda-forge python=${version} pip, then pip install ${Object.entries(pins).map(([n, v]) => `'${n}==${v}'`).join(' ')} (or set FNAF2_CI_PYTHON)`;
  if (!existsSync(CI_PYTHON)) return { why: `no CI-like Python at ${CI_PYTHON}; ${build}` };
  const got = spawnSync(CI_PYTHON, ['-c', 'import sys; print("%d.%d" % sys.version_info[:2])'], { encoding: 'utf8' }).stdout?.trim();
  if (got !== version) return { why: `${CI_PYTHON} is Python ${got}, ci.yml pins ${version}; ${build}` };
  const freeze = spawnSync(CI_PYTHON, ['-m', 'pip', 'list', '--format=freeze', '--disable-pip-version-check'], { encoding: 'utf8' }).stdout ?? '';
  const installed = Object.fromEntries(freeze.split('\n').filter(Boolean).map(l => l.split('==')).map(([n, v]) => [n.toLowerCase(), v])
    .filter(([n]) => !['pip', 'setuptools', 'wheel'].includes(n)));
  const same = JSON.stringify(Object.entries(installed).sort()) === JSON.stringify(Object.entries(pins).sort());
  if (!same) return { why: `${CI_PYTHON} has ${JSON.stringify(installed)}, ci.yml pins ${JSON.stringify(pins)}; ${build}` };
  return { env: { ...withoutGit(process.env), PATH: `${dirname(CI_PYTHON)}:${process.env.PATH}` } };
}

// git runs a hook with the repository in its environment (GIT_DIR, and more),
// and every lane inherited it. CI's runner has none of it. On 2026-09-25
// vaulttest.mjs's `git init` in a temp directory therefore reinitialised the
// real repository -- core.bare=true, which stopped every checkout of it from
// working as one -- and its `commit -m root` landed on the pushing worktree's
// branch. A lane gets CI's environment: no GIT_* variables.
/** @param {NodeJS.ProcessEnv} env */
function withoutGit(env) {
  return Object.fromEntries(Object.entries(env).filter(([name]) => !name.startsWith('GIT_')));
}

let LANE_ENV = withoutGit(process.env);

// --- Running the lanes -----------------------------------------------------

function run(command, cwd, { live = false } = {}) {
  // A live lane streams its stdout (ShellCheck's findings appear as they are
  // produced) but its stderr is CAPTURED, because that is where a runner's own
  // refusal lands -- docker's `mounts denied`, a missing binary -- and a lane
  // that only streams cannot tell the caller why it failed. The capture is
  // printed on failure, so nothing that used to be visible is lost.
  const result = spawnSync('sh', ['-c', command], live
    ? { cwd, stdio: ['inherit', 'inherit', 'pipe'], encoding: 'utf8', env: LANE_ENV }
    : { cwd, encoding: 'utf8', env: LANE_ENV });
  return { status: result.status,
    output: live ? (result.stderr ?? '') : `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

// The scripts of the CHECKOUT being validated, not of the working tree: a
// pushed commit may have redefined the very chain the lane runs.
let SCRIPTS = {};

/**
 * The commands a failing command is made of, or null when it is a leaf. An
 * `npm run` name expands to its script body so the search reaches the actual
 * test file: `test:contracts` is a forty-command `&&` chain, and naming it as
 * one failure is the reporting CI already gives.
 */
function expand(command, depth) {
  if (depth <= 0) return null;
  const parts = command.split(' && ').filter(Boolean);
  if (parts.length > 1) return parts;
  const script = command.match(/^npm run ([\w:-]+)$/);
  return script && SCRIPTS[script[1]] ? [SCRIPTS[script[1]]] : null;
}

/**
 * Name every failure under a failed lane, not just the one that stopped it.
 * Long chains print their failures only: forty passing lines bury the two that
 * matter, and the count line still says nothing was skipped.
 */
function diagnose(command, worktree, indent, depth) {
  const result = run(command, worktree);
  if (result.status === 0) return true;
  const children = expand(command, depth);
  console.log(`${indent}FAIL ${command.length > 110 ? `${command.slice(0, 110)}...` : command}`);
  if (children) { walk(children, worktree, `${indent}  `, depth - 1); return false; }
  for (const line of result.output.trimEnd().split('\n').slice(-15))
    console.log(`${indent}     ${line}`);
  return false;
}

function walk(children, worktree, indent, depth) {
  let passed = 0;
  for (const child of children) {
    if (diagnose(child, worktree, indent, depth)) {
      passed += 1;
      if (children.length <= 6) console.log(`${indent}ok   ${child}`);
    }
  }
  if (children.length > 6) console.log(`${indent}(${passed} of ${children.length} commands passed)`);
}

/** A lane already ran, so open it up rather than paying for it a second time. */
function reportLane(command, worktree, result, depth) {
  const children = expand(command, depth);
  if (!children) {
    for (const line of result.output.trimEnd().split('\n').slice(-25))
      console.log(`      ${line}`);
    return;
  }
  console.log('      -- every command in this lane, not just the one that stopped it --');
  walk(children, worktree, '      ', depth - 1);
}

// Where the throwaway worktree goes, and why it is not `TMPDIR`.
//
// The ShellCheck lane is `docker run -v "$PWD:/mnt:ro"`, and Docker Desktop
// bind-mounts only paths in its file-sharing set. `/tmp` is not in it on this
// machine, so a worktree under `TMPDIR` makes that lane die with `mounts
// denied` -- a FAIL that looks exactly like a real ShellCheck finding and is
// one `--no-verify` away from being pushed past. The workaround (export a
// TMPDIR under $HOME) was known and written down, but it lived in an
// operator's habit, so it worked when a person ran `npm run push-gate` by hand
// and not when the pre-push hook ran the same gate with the environment git
// gives it. That is the whole failure: a fact the tool needed, kept somewhere
// the tool could not read. It picks its own base now.
const WORKTREE_BASE = process.env.FNAF2_PUSH_GATE_TMP ?? join(homedir(), '.cache/fnaf2-pushgate-tmp');

/** Docker Desktop's refusal to bind-mount a path outside its sharing set. It
 *  is a property of the host's configuration, not of the commit being pushed,
 *  so the lane is unverified rather than failed. */
const MOUNT_DENIED = /mounts denied|is not shared from the host/i;

function worktreeBase() {
  try { mkdirSync(WORKTREE_BASE, { recursive: true }); return WORKTREE_BASE; }
  catch { return tmpdir(); }
}

function validate(sha, subject) {
  const worktree = mkdtempSync(join(worktreeBase(), 'fnaf2-push-gate-'));
  rmSync(worktree, { recursive: true, force: true });
  execFileSync('git', ['worktree', 'add', '--detach', worktree, sha], { cwd: ROOT, stdio: ['ignore', 'ignore', 'pipe'] });
  console.log(`\npush-gate: ${sha.slice(0, 7)} ${subject}`);
  const failed = [];
  const skipped = [];
  try {
    // ci.yml comes from the commit under test, because that is the job GitHub
    // will run for it. A gate checking a stale copy is checking nothing.
    const drift = laneDrift(worktree);
    if (drift.length) {
      console.log('  FAIL push-gate is out of step with .github/workflows/ci.yml:');
      for (const item of drift) console.log(`      ${item}`);
      console.log('      Update LANES in tools/push-gate.mjs, or the gate no longer checks what CI checks.');
      return { failed: ['push-gate is out of step with ci.yml'], skipped: [] };
    }
    SCRIPTS = JSON.parse(readFileSync(join(worktree, 'package.json'), 'utf8')).scripts;
    linkDependencies(worktree);
    const python = ciPythonEnv(worktree);
    if (python.env) {
      LANE_ENV = python.env;
      console.log(`  python3 for every lane: ${CI_PYTHON} (the ci.yml version and pins, nothing else)`);
    } else {
      LANE_ENV = withoutGit(process.env);
      console.log(`  SKIP CI Python dependencies (${python.why}); the lanes run on this machine's python3, which may hold packages CI does not`);
      skipped.push('CI Python dependencies');
    }
    for (const lane of LANES) {
      if (lane.heavy && !FULL) {
        console.log(`  SKIP ${lane.name} (heavy; \`npm run push-gate -- --full\` runs it here, CI runs it on the push)`);
        skipped.push(lane.name);
        continue;
      }
      if (lane.needs && spawnSync('sh', ['-c', `command -v ${lane.needs} >/dev/null 2>&1 && ${lane.needs} info >/dev/null 2>&1`]).status !== 0) {
        console.log(`  SKIP ${lane.name} (${lane.needs} is not available here; CI still runs it)`);
        skipped.push(lane.name);
        continue;
      }
      const command = lane.multiline ? shellcheckScript(worktree) : lane.run;
      console.log(`  start ${lane.name}: ${command}`);
      const started = Date.now();
      const result = run(command, worktree, { live: true });
      const seconds = ((Date.now() - started) / 1000).toFixed(1);
      if (result.status !== 0 && MOUNT_DENIED.test(result.output)) {
        // Do not call this a failure of the commit. Name the host fact and the
        // one setting that changes it.
        console.log(`  SKIP ${lane.name} (${seconds}s): docker refused to mount ${worktree}.`);
        console.log(`      This worktree's base is ${WORKTREE_BASE}; add it to Docker's file sharing,`);
        console.log('      or set FNAF2_PUSH_GATE_TMP to a path Docker already shares. CI still runs this lane.');
        skipped.push(lane.name);
        continue;
      }
      console.log(`  ${result.status === 0 ? 'ok  ' : 'FAIL'} ${lane.name} (${seconds}s)`);
      if (result.status !== 0) {
        failed.push(lane.name);
        if (lane.multiline && result.output.trim())
          for (const line of result.output.trimEnd().split('\n')) console.log(`      ${line}`);
        reportLane(command, worktree, result, lane.multiline ? 0 : 4);
      }
    }
  } finally {
    execFileSync('git', ['worktree', 'remove', '--force', worktree], { cwd: ROOT, stdio: 'ignore' });
  }
  return { failed, skipped };
}

// --- The verdict -----------------------------------------------------------

/**
 * What reproduces a lane on this machine: the ci.yml step text itself, which
 * is what LANES holds, or for the ShellCheck lane the step's `run: |` block.
 * @param {string} name a lane name, or the drift failure's
 */
export function reproduceCommand(name) {
  const lane = LANES.find(item => item.name === name);
  if (!lane) return null;
  return lane.multiline ? `the \`run: |\` script of the "${lane.name}" step in .github/workflows/ci.yml (needs docker)` : lane.run;
}

/**
 * The closing lines for failed lanes: each lane with the command that
 * reproduces it, then how to re-run the whole gate on that commit. A red lane
 * is fixed, never sent past the hook: CLAUDE.md forbids bypassing a hook, so
 * no line here offers one.
 * @param {{sha: string, name: string}[]} broken
 * @returns {string[]}
 */
export function failureReport(broken) {
  const lines = ['', 'push-gate: these lanes would fail on GitHub:'];
  for (const { sha, name } of broken) {
    lines.push(`  ${sha.slice(0, 7)} ${name}`);
    const command = reproduceCommand(name);
    lines.push(command ? `      reproduce: ${command}`
      : `      reproduce: npm run push-gate -- ${sha.slice(0, 7)} (update LANES in tools/push-gate.mjs to match ci.yml)`);
  }
  const shas = [...new Set(broken.map(item => item.sha.slice(0, 7)))];
  lines.push(`Fix them and commit again. \`npm run push-gate -- ${shas.join(' ')}\` re-runs every lane in a clean checkout of `
    + `${shas.length === 1 ? 'that commit' : 'those commits'}; the working tree is a different measurement.`);
  return lines;
}

// --- Entry point -----------------------------------------------------------

/** Pre-push feeds `<local ref> <local sha> <remote ref> <remote sha>` on stdin. */
function commitsFromStdin() {
  let input = '';
  try { input = readFileSync(0, 'utf8'); } catch { input = ''; }
  const shas = [];
  for (const line of input.split('\n')) {
    const [, localSha] = line.split(/\s+/);
    if (localSha && !ZERO.test(localSha) && !shas.includes(localSha)) shas.push(localSha);
  }
  return shas;
}

const FULL = process.argv.includes('--full');
// Run as a program (the pre-push hook, `npm run push-gate`); importing the
// module -- tools/test-push-gate.mjs reads failureReport -- runs nothing.
const invoked = process.argv[1] && realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url));

if (invoked) {
  const argv = process.argv.slice(2).filter(arg => arg !== '--full');
  const commits = argv.includes('--stdin')
    ? commitsFromStdin()
    : (argv.length ? argv : ['HEAD']).map(ref =>
        execFileSync('git', ['rev-parse', ref], { cwd: ROOT, encoding: 'utf8' }).trim());

  if (!commits.length) {
    console.log('push-gate: nothing to validate');
    process.exit(0);
  }

  const broken = [];
  const notRun = [];
  for (const sha of commits) {
    const subject = execFileSync('git', ['log', '-1', '--format=%s', sha], { cwd: ROOT, encoding: 'utf8' }).trim();
    const { failed, skipped } = validate(sha, subject);
    broken.push(...failed.map(name => ({ sha, name })));
    notRun.push(...skipped);
  }

  if (notRun.length)
    console.log(`\npush-gate: ${notRun.length} lane(s) could not run here and are unverified: ${[...new Set(notRun)].join(', ')}`);
  if (broken.length) {
    for (const line of failureReport(broken)) console.log(line);
    process.exit(1);
  }
  console.log(FULL ? '\npush-gate: every lane CI runs passes on the pushed commit'
    : '\npush-gate: every fast lane passes on the pushed commit (heavy lanes are CI\'s; --full runs them here)');
}
