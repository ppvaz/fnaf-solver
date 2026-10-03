#!/usr/bin/env node
// The mistake registers in CLAUDE.md, as far as a machine can hold them.
//
// ROADMAP S7: "The mistake registers become executable gates." Most entries are
// judgement at a live attempt -- read the usage, observe the state, re-derive
// the deadline -- and no static check can hold those. The ones below can, and
// each check fails on a real violation:
//
//   item 13  "A gate registered only in a lane CI does not run is not a gate."
//            Every test file in the repository is reached from a CI step
//            (.github/workflows/ci.yml, through `npm run` scripts and through
//            `node tools/test.ts --gates`, whose own `--list` says what it
//            selects), or is exempt below, one file at a time, with a reason.
//            A Java test counts only when its test.sh EXECUTES the class;
//            compiling it is not running it.
//   item 5   "Never report a test PASS you did not see print." The incident
//            was a wrong test path failing silently. Every script path a
//            package.json script, a CI step or a tools/test.ts entry names
//            must exist, and every `npm run X` must name a script that exists.
//   item 12  "An absent observation is evidence only when the rule has read the
//            positive state in the same run." run-report.mjs's five-read
//            threshold is exercised on both sides of the boundary; before this
//            nothing asserted it.
//   item 1   "Read a tool's own usage before the first invocation." The incident
//            was title-observe.py ignoring a positional frame path and reading
//            stdin; it now refuses any token it does not consume, and
//            packages/play/src/sensors/screencap/test-sensor.py runs it with one.
//   items 3, 6  are apps/lab/test/test-night-job.py's: the night job refuses on an
//            observed title that does not offer the night and on a Continue
//            night it cannot read (never assumed), and after an abort or a killed
//            runner the game is driven back to an observed title. It runs in
//            test:unit:slow, which CI's slow lane runs.
//   item 2   "An observation-based rule must cite the measured row that backs
//            it." Every committed title model is either held to a calibration
//            record (its sha256 is the one measured, every row re-derives its
//            read, none sits between the thresholds) or listed with what it
//            lacks. FNaF 2's rows (89 retained title frames) show Continue on
//            every one, so the menu fixture's fresh save draws it.
//   item 4   "Re-derive every deadline when a port crosses executors." Every
//            executor returns to one port, whose NIGHT_TERMINAL_WAIT_MS has to
//            answer for the plan that ends earliest; test-terminal-deadline.ts
//            measures the latest 6 AM from the won packs and holds every
//            committed plan's end plus that wait above it (a planted 2026-09-06
//            shape first).
//   item 8   "Ask the phone what it offers before proposing an instrument."
//            night-run.sh asks capabilities.ts traceDecision whether a run
//            carries the Perfetto input trace; it kept the trace on when the
//            data sources could not be read until 2026-10-01. The check below
//            holds traceDecision to Review's checkCapabilitiesFirst on an
//            advertised, an absent and an unreadable source.
//   item 11  "Read a tool's own computed output before deriving the same
//            quantity by hand." The incident was minus-toys-margin.ts's edge(),
//            which stopped at its first failure and so printed a banded phase
//            response as a "408 ms cliff". The margin scans now go through
//            packages/propose/bin/plans/basin-edge.ts, which keeps scanning and
//            prints a response that clears again as banded; the check below
//            plants the 2026-09-11 shape against it.
//   item 10  "A number measured in one direction does not transfer to the
//            other." Every seam artifact-commands.ts compiles names its floor
//            and the order of the two events its gap runs between, read from
//            the compiler's own state, and test-seam-slack.ts holds each one
//            to Review's DIRECTIONAL_CONSTANTS (a planted reverse first).
//   items 7, 9  are packages/propose/test/test-seam-slack.ts's: every compiled plan
//            clears every floor by the allowance, and the mask floor IS its
//            measurement, read from SEAM_FLOORS rather than from a comment.
//            That equality was checked in one direction only; a floor BELOW
//            its measurement passed. It is two-sided now, in that file, where
//            the rule lives. A second copy here would be redundant. What this
//            file adds is item 13 applied to the register itself: every gate a
//            register item relies on is reached from a CI step.
//
// Every check first runs against a planted violation and must catch it. A
// checker that cannot fail measures documentation, not coverage.
//
//   node tools/test-mistake-register.ts [--explain]
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { report } from '../packages/review/bin/grade/run-report.ts';
import type { RunEvent } from '../packages/review/bin/grade/run-report.ts';
import { formatEdge, scanEdge } from '../packages/propose/bin/plans/basin-edge.ts';
import { report as capabilityReport, traceDecision } from '../packages/play/bin/phone/capabilities.ts';
import { checkCapabilitiesFirst } from '@sixam/review/refusals';
import { readLanes } from '@sixam/review/lanes';
import { ciReach, ciSteps, readCiExemptions, walk, walkContext } from '@sixam/review/ci-reach';
import type { Sink } from '@sixam/review/ci-reach';
import { readMistakes } from '@sixam/review/mistakes';
import { MISTAKE_GATES_FILE, REGISTER_GATES } from '@sixam/review/mistake-gates';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SELF = MISTAKE_GATES_FILE;
const explain = process.argv.includes('--explain');

// --- Test files that no CI step runs, one decision each --------------------
// tools/ci-exemptions.json, read through Review's CI reader: the grade-run coverage gate reads the same
// decisions. A stale entry -- the file now runs, or is gone -- fails here.
const EXEMPT = readCiExemptions(ROOT);

// --- The gates each register item relies on --------------------------------
// Item 13 applied to the register: a register entry whose gate no CI step runs has no gate. The rows
// are Review's (packages/review/src/mistake-gates.ts), which its S7 row reads too.

// Register entries no gate holds yet (ROADMAP S7 closes when this is empty).
// A ratchet: an entry leaves it when a REGISTER_GATES row lands, and a new
// register entry fails until it has a row or is listed here with its reason.
const OPEN_ENTRIES = new Map<number, string>([]);

// --- item 2: every title model's item thresholds stand on measured rows ------
// A model listed here is held to its calibration record below; one listed in
// TITLE_MODELS_UNMEASURED is debt, named with what it lacks. A title model in
// neither fails, so a new one arrives with its rows or with its reason.
const TITLE_CALIBRATIONS = new Map([
  ['packages/play/profiles/fnaf2/moto-g56/title-moto-g56-v207.json', 'docs/evidence/fnaf2-title-items-calibration-20261001.json'],
]);
const TITLE_MODELS_UNMEASURED = new Map([
  ['packages/play/profiles/fnaf1/moto-g56/title-fnaf1-moto-g56-v207.json', 'item and continue_subtitle thresholds are justified by notes only; no record holds the rows'],
  ['packages/play/profiles/fnaf1/moto-g56/title-stars-fnaf1-moto-g56-v207.json', 'measured, by its own gate: packages/play/games/fnaf1/test-fnaf1-title-stars.py re-derives it from docs/evidence/fnaf1-title-stars-calibration-20261001.json'],
  ['packages/play/profiles/fnaf3/moto-g56/title-fnaf3-moto-g56-v204.json', 'cites no calibration; its item thresholds have no committed rows'],
  ['packages/play/profiles/fnaf4/moto-g56/title-fnaf4-moto-g56-v204.json', 'cites docs/evidence/companion-game-screen-20260927.json, which holds gate fractions but no item-band rows'],
]);
/** A title model's items and the two thresholds that read an item present or absent. */
interface TitleModel { readonly items: Readonly<Record<string, unknown>>, readonly present_min: number, readonly absent_max: number }
/** A measured title frame: its name, the read the observer made, and its items' fractions. */
interface TitleRow { readonly frame: string, readonly read: string, readonly fractions: Readonly<Record<string, number>> }

/** The read title-observe.py makes of one row's fractions: its items, or the item it refuses as undecided. */
function titleRead(model: TitleModel, fractions: Readonly<Record<string, unknown>>): { undecided?: string, items?: string[] } {
  const present: string[] = [];
  for (const name of Object.keys(model.items)) {
    const value = fractions[name];
    if (typeof value !== 'number') return { undecided: name };
    if (value >= model.present_min) present.push(name);
    else if (value > model.absent_max) return { undecided: name };
  }
  return { items: present.sort() };
}

let failed = 0;
const fail = (message: string) => { failed += 1; console.error(`  FAIL ${message}`); };

// --- The registries a command line can reach -------------------------------
// Read through Review's one CI reader (packages/review/src/ci-reach.ts): the coverage gate and the S7 row ask it too.
const CONTEXT = walkContext(ROOT);
const SCRIPTS = CONTEXT.scripts;
const LANES = CONTEXT.lanes;

// --- The test files ---------------------------------------------------------

const TEST_FILE = [
  // Wherever the ADR 0002 moves put them: tools/, a package or an application.
  /^(?:tools|packages|apps)\/(?:[\w.-]+\/)*test-[\w.-]+\.(?:mjs|js|ts|mts|py|sh)$/,
  /^(?:tools|packages\/propose)\/(?:[\w.-]+\/)*[a-z0-9-]*test\.(?:mjs|js|ts|mts)$/,
  /(?:^|\/)test_[\w.-]+\.py$|_test\.py$/,
  /^(?:packages|apps)\/[\w.-]+\/test\/(?:[\w.-]+\/)*[\w.-]+\.test\.(?:mjs|js|ts|mts)$/,
  /^android\/[\w.-]+\/test\.sh$/,
];
const JAVA_TEST = /^android\/([\w.-]+)\/test\/(?:[\w.-]+\/)*(\w+Test)\.java$/;
export const isTestFile = (path: string) => TEST_FILE.some(re => re.test(path));

/** Tracked files only: CI and push-gate measure a commit, and a concurrent
 *  session's untracked test is not yet a claim that anything runs it. */
function trackedFiles() {
  try {
    return execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 28 })
      .split('\0').filter(Boolean).filter(path => existsSync(join(ROOT, path)));
  } catch {
    const out: string[] = [];
    const skip = new Set(['.git', 'node_modules', 'artifacts', 'captures', 'dist']);
    const visit = (dir: string) => {
      for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
        if (skip.has(entry.name)) continue;
        const path = dir ? `${dir}/${entry.name}` : entry.name;
        if (entry.isDirectory()) visit(path); else out.push(path);
      }
    };
    visit('');
    return out;
  }
}

/**
 * The fully qualified classes a test.sh hands to `java`, not just to `javac`.
 * A test.sh that finds every `*Test.java` and hands `java` the class through a
 * variable (`"pkg.$class"`) runs each one it finds: that is `pkg.*`.
 */
export function javaExecuted(shellText: string) {
  const run = new Set<string>();
  const findsTests = /\bfind\s[^\n]*-name\s+['"]?\*Test\.java\b/.test(shellText);
  for (const line of shellText.replace(/\\\r?\n/g, ' ').split('\n')) {
    if (/^\s*#/.test(line)) continue;
    if (!/(?:^|[\s"])\$\{?JAVA\b\}?"?\s|(?:^|\s)java\s/.test(line)) continue;
    for (const m of line.matchAll(/\b((?:[a-z_]\w*\.)+[A-Z]\w*)\b/g)) run.add(m[1]);
    const each = line.match(/\b((?:[a-z_]\w*\.)+)\$\{?\w+\}?/);
    if (findsTests && each) run.add(`${each[1]}*`);
  }
  return run;
}

/** Item 13 over one inventory. Returns what reaches each test, or why not. */
/** Whether a test is run (by which route) or exempt (why), or why nothing runs it. */
interface Verdict { readonly ok: boolean, readonly via?: string, readonly exempt?: string, readonly why?: string }

export function coverage({ files, reached, backlog, exempt, readText }: {
  files: readonly string[], reached: ReadonlyMap<string, string>, backlog: ReadonlyMap<string, string>,
  exempt: ReadonlyMap<string, string>, readText: (path: string) => string,
}) {
  const verdicts = new Map<string, Verdict>();
  const executedBy = new Map<string, Set<string>>();
  const tracked = new Set(files);
  for (const path of files) {
    const java = path.match(JAVA_TEST);
    if (java) {
      const runner = `android/${java[1]}/test.sh`;
      if (!tracked.has(runner)) {
        verdicts.set(path, { ok: false, why: `no ${runner} to run it` });
        continue;
      }
      if (!executedBy.has(runner)) executedBy.set(runner, javaExecuted(readText(runner)));
      const pkg = readText(path).match(/^\s*package\s+([\w.]+)\s*;/m)?.[1];
      const fqcn = pkg ? `${pkg}.${java[2]}` : java[2];
      const executed = executedBy.get(runner) as Set<string>; // set just above when missing
      if (!executed.has(fqcn) && !(pkg && executed.has(`${pkg}.*`))) {
        verdicts.set(path, exempt.has(path) ? { ok: true, exempt: exempt.get(path) }
          : { ok: false, why: `${runner} never executes ${fqcn} (compiling a test is not running it)` });
        continue;
      }
      if (reached.has(runner)) verdicts.set(path, { ok: true, via: `${reached.get(runner)} > java ${fqcn}` });
      else verdicts.set(path, exempt.has(path) ? { ok: true, exempt: exempt.get(path) }
        : { ok: false, why: `${runner} runs it, but no CI step runs ${runner}` });
      continue;
    }
    if (!isTestFile(path)) continue;
    if (reached.has(path)) verdicts.set(path, { ok: true, via: reached.get(path) });
    else if (exempt.has(path)) verdicts.set(path, { ok: true, exempt: exempt.get(path) });
    else if (backlog.has(path)) verdicts.set(path, { ok: true, exempt: `tools/test.ts BACKLOG: ${backlog.get(path)}` });
    else verdicts.set(path, { ok: false, why: 'no CI step reaches it' });
  }
  const stale: string[] = [];
  for (const [path, reason] of exempt) {
    const runs = verdicts.get(path)?.via;
    if (!tracked.has(path)) stale.push(`${path} is exempt but no such tracked file exists`);
    else if (runs) stale.push(`${path} is exempt but ${runs} runs it -- delete the stale exemption`);
    else if (!isTestFile(path) && !JAVA_TEST.test(path)) stale.push(`${path} is exempt but is not a test file by any convention here`);
    if (!String(reason).trim()) stale.push(`${path} is exempt with no reason`);
    if (backlog.has(path)) stale.push(`${path} is exempt in tools/ci-exemptions.json AND by tools/test.ts BACKLOG -- keep one`);
  }
  return { verdicts, stale };
}

/** Item 5: every script path package.json / CI / tools/test.ts names exists. */
export function missingPaths({ scripts, ciText, exists, lanes = LANES }: {
  scripts: Readonly<Record<string, string>>, ciText: string | null, exists: (path: string) => boolean,
  lanes?: ReturnType<typeof readLanes>,
}) {
  // One message per missing target, at the first line that names it: the
  // same path reached through `npm run test` and CI is one defect, not three.
  const problems = new Map<string, string>();
  const sink: Sink = {
    script: (name, via, known) => {
      if (!known && !problems.has(`npm:${name}`))
        problems.set(`npm:${name}`, `${via} runs \`npm run ${name}\`, which package.json does not define`);
    },
    file: (path, via) => {
      if (!exists(path) && !problems.has(path)) problems.set(path, `${via} names ${path}, which does not exist`);
    },
  };
  const context = { scripts, lanes, suite: CONTEXT.suite };
  if (ciText) for (const step of ciSteps(ciText)) walk(step.run, `ci.yml "${step.name}"`, sink, context);
  for (const [name, body] of Object.entries(scripts)) walk(body, `package.json "${name}"`, sink, context);
  return [...problems.values()];
}

// --- Positive controls: each check must catch a planted violation -----------
{
  // A test that moves to TypeScript stays a test: the conventions read .ts as they read .js.
  for (const path of ['packages/play/test/planted.test.ts', 'tools/test-planted.ts', 'packages/propose/test/plantedtest.mts'])
    if (!isTestFile(path)) throw new Error(`mistake register: ${path} is a test by the conventions here, and is not recognised`);
}
{
  // item 5, the incident itself: tools/test-bundle.ts for packages/propose/test/test-bundle.ts.
  const planted = missingPaths({
    scripts: { 'test:planted': 'node tools/test-bundle.ts > /dev/null 2>&1 && echo PASS', 'test:alias': 'npm run test:nope' },
    ciText: null, exists: path => existsSync(join(ROOT, path)),
  });
  if (!planted.some(p => p.includes('tools/test-bundle.ts')))
    fail('control: a package.json script naming tools/test-bundle.ts (the item-5 wrong path) was not caught');
  if (!planted.some(p => p.includes('npm run test:nope')))
    fail('control: `npm run` of an undefined script was not caught');
  // The lane table (tools/lanes.json) is read as the command lines are: a missing node file, a missing
  // step's script and an unknown lane are each caught.
  const plantedLanes = missingPaths({
    scripts: { 'test:planted': 'node tools/lanes.ts planted' }, ciText: null, exists: path => existsSync(join(ROOT, path)),
    lanes: { planted: { node: ['tools/test-planted-lane.ts'], steps: [['python3', 'tools/test-planted-step.py'], ['lane', 'nope']] } },
  });
  for (const want of ['tools/test-planted-lane.ts', 'tools/test-planted-step.py', 'tools/lanes.json#nope'])
    if (!plantedLanes.some(p => p.includes(want))) fail(`control: a lane naming ${want} was not caught`);

  // item 13: an unregistered test, a compiled-but-never-run Java test, and a stale exemption.
  const shell = '"$JAVAC" -d "$T" "$HERE/test/a/b/RunTest.java" "$HERE/test/a/b/IdleTest.java"\n'
    + '"$JAVA" -cp "$T" a.b.RunTest\n# "$JAVA" -cp "$T" a.b.IdleTest\n';
  // A test.sh that finds its tests and runs each one it found, by a variable class name.
  const loop = 'while IFS= read -r t; do TESTS+=("$t"); done < <(find "$HERE/test" -name \'*Test.java\')\n'
    + 'for test in "${TESTS[@]}"; do\n  class="$(basename "$test" .java)"\n'
    + '  "$JAVA" -cp "$T" "c.d.$class"\ndone\n';
  const texts: Readonly<Record<string, string>> = {
    'android/x/test.sh': shell,
    'android/x/test/a/b/RunTest.java': 'package a.b;\n',
    'android/x/test/a/b/IdleTest.java': 'package a.b;\n',
    'android/y/test.sh': loop,
    'android/y/test/c/d/FoundTest.java': 'package c.d;\n',
  };
  const files = ['tools/device/test-planted-orphan.mjs', 'tools/test-registered.mjs',
    'android/x/test.sh', 'android/x/test/a/b/RunTest.java', 'android/x/test/a/b/IdleTest.java',
    'android/y/test.sh', 'android/y/test/c/d/FoundTest.java', 'tools/device/test-stale.mjs'];
  const reached = new Map([['tools/test-registered.mjs', 'ci'], ['android/x/test.sh', 'ci'],
    ['android/y/test.sh', 'ci'], ['tools/device/test-stale.mjs', 'ci']]);
  const { verdicts, stale } = coverage({ files, reached, backlog: new Map(),
    exempt: new Map([['tools/device/test-stale.mjs', 'planted']]), readText: path => texts[path] });
  if (verdicts.get('tools/device/test-planted-orphan.mjs')?.ok !== false)
    fail('control: an unregistered test file was not caught');
  if (verdicts.get('tools/test-registered.mjs')?.ok !== true)
    fail('control: a test a CI step runs was reported as an orphan');
  if (verdicts.get('android/x/test/a/b/IdleTest.java')?.ok !== false)
    fail('control: a Java test that test.sh compiles but never executes was not caught');
  if (verdicts.get('android/x/test/a/b/RunTest.java')?.ok !== true)
    fail('control: a Java test that test.sh executes was reported as an orphan');
  if (verdicts.get('android/y/test/c/d/FoundTest.java')?.ok !== true)
    fail('control: a Java test that test.sh finds and runs in its loop was reported as an orphan');
  if (!stale.some(s => s.startsWith('tools/device/test-stale.mjs')))
    fail('control: an exemption for a test a CI step runs was not reported stale');

  // The reader itself: a prose mention is not an invocation.
  const sink = { names: [] as string[], script() {}, file(path: string) { this.names.push(path); } };
  walk('echo "see tools/device/test-x.mjs" && node tools/device/test-y.mjs --flag && python3 -m pip install x', 'ctl', sink, { ...CONTEXT, scripts: {} });
  if (sink.names.join() !== 'tools/device/test-y.mjs')
    fail(`control: the command reader named ${JSON.stringify(sink.names)} (want only tools/device/test-y.mjs)`);
}

// --- item 13 and item 5 on the tree -----------------------------------------
const ciText = readFileSync(join(ROOT, '.github/workflows/ci.yml'), 'utf8');
const { reached, backlog } = ciReach(ROOT, { context: CONTEXT });
const files = trackedFiles();
const { verdicts, stale } = coverage({ files, reached, backlog, exempt: EXEMPT,
  readText: path => readFileSync(join(ROOT, path), 'utf8') });

for (const [path, verdict] of [...verdicts].sort(([a], [b]) => a.localeCompare(b))) {
  if (!verdict.ok) fail(`${path}: ${verdict.why}. Register it in a CI lane (npm run test:unit ` +
    'or test:contracts, or tools/test.ts ENGINE), or exempt it in this file with a reason.');
  else if (explain) console.log(`  ${verdict.via ? 'runs  ' : 'exempt'} ${path}  <- ${verdict.via ?? verdict.exempt}`);
}
for (const message of stale) fail(message);

const missing = missingPaths({ scripts: SCRIPTS, ciText, exists: path => existsSync(join(ROOT, path)) });
// This includes every tools/test.ts entry, selected or not (`--list` prints
// all of them): an unselected entry's path is checked by nothing else until
// the day someone runs its group.
for (const message of missing) fail(`${message} -- a wrong path fails silently behind \`> /dev/null && echo\` (item 5)`);

for (const [item, gate] of REGISTER_GATES) {
  if (!existsSync(join(ROOT, gate))) fail(`register item ${item} relies on ${gate}, which does not exist`);
  else if (!reached.has(gate)) fail(`register item ${item} relies on ${gate}, which no CI step runs (item 13)`);
}
// Every entry the registers hold (read where they are written) names a gate or
// is open with a reason; an open entry that has a gate is stale.
{
  const gated = new Set(REGISTER_GATES.map(([item]) => item));
  const { source, entries } = readMistakes(ROOT);
  if (!entries.length) fail(`no mistake-register entry was read (${source ?? 'no source'})`);
  for (const { n } of entries) {
    if (!gated.has(n) && !OPEN_ENTRIES.has(n)) fail(`register entry ${n} names no gate and is not listed open (ROADMAP S7)`);
    if (gated.has(n) && OPEN_ENTRIES.has(n)) fail(`register entry ${n} has a gate and is still listed open`);
  }
  for (const n of [...gated, ...OPEN_ENTRIES.keys()])
    if (!entries.some(entry => entry.n === n)) fail(`register entry ${n} is gated or listed open but the registers hold no such entry`);
}

// --- item 12 on the tree: the five-read threshold, both sides ----------------
{
  // Five cycles of one raise, four graded MISSING: a systematic miss by count.
  // What decides the verdict is how often the rule read `monitorUp: true` at all.
  const verdict = (positiveReads: number) => {
    const events: RunEvent[] = [];
    for (let cycle = 0; cycle < 5; cycle += 1) {
      events.push({ type: 'control.effect.result', actionId: 'raise', signal: 'monitorUp', target: true,
        status: cycle === 0 ? 'PASS' : 'MISSING',
        samples: cycle === 0 ? Array.from({ length: positiveReads }, () => ({ monitorUp: true })) : [{ monitorUp: false }] });
    }
    return report(events).effects.systematicMisses.find(row => row.signal === 'monitorUp')?.verdict ?? 'NOT-LISTED';
  };
  // 2 is the 2026-09-12 run: `true` read twice in 266 samples, a blind rule.
  for (const [reads, want] of [[2, 'UNPROVEN-OBSERVER-BLIND'], [4, 'UNPROVEN-OBSERVER-BLIND'], [5, 'ACTUATOR-GAP']] as const) {
    const got = verdict(reads);
    if (got !== want)
      fail(`run-report.mjs calls 4 MISSING of 5 with ${reads} positive read(s) ${got}; item 12 says ${want}`);
  }
}

// --- item 2 on the tree: title thresholds against their measured rows -------
{
  const models = execFileSync('git', ['ls-files', 'packages/play/profiles/*/*/title-*.json'], { cwd: ROOT, encoding: 'utf8' })
    .split('\n').filter(Boolean);
  if (!models.length) fail('no title model was found to hold to its rows (item 2)');
  for (const path of models)
    if (!TITLE_CALIBRATIONS.has(path) && !TITLE_MODELS_UNMEASURED.has(path))
      fail(`${path} reads title items with thresholds no record measured, and is not listed with a reason (item 2)`);
  for (const path of [...TITLE_CALIBRATIONS.keys(), ...TITLE_MODELS_UNMEASURED.keys()])
    if (!models.includes(path)) fail(`${path} is listed for item 2 but is not a committed title model`);
  for (const [path, recordPath] of TITLE_CALIBRATIONS) {
    const bytes = readFileSync(join(ROOT, path));
    const model: TitleModel = JSON.parse(bytes.toString('utf8'));
    const record: { readonly model?: { readonly path?: string, readonly sha256?: string }, readonly rows?: readonly TitleRow[] } =
      JSON.parse(readFileSync(join(ROOT, recordPath), 'utf8'));
    if (record.model?.path !== path || record.model?.sha256 !== createHash('sha256').update(bytes).digest('hex'))
      fail(`${path} is not the model ${recordPath} measured: re-measure its rows before changing its thresholds`);
    if (!Array.isArray(record.rows) || record.rows.length < 20) fail(`${recordPath}: fewer than 20 measured rows`);
    const reads = (rows: readonly TitleRow[], m: TitleModel) => rows.map(row => ({ row, read: titleRead(m, row.fractions) }));
    for (const { row, read } of reads(record.rows ?? [], model)) {
      // A read that is not undecided names its items.
      if (read.undecided) fail(`${recordPath}: ${row.frame} puts ${read.undecided} between the thresholds of ${path}`);
      else if (row.read !== `items=${(read.items as string[]).join(',')}`) fail(`${recordPath}: ${row.frame} was read ${row.read}, its fractions say items=${(read.items as string[]).join(',')}`);
    }
    // The planted violation: a present threshold above the narrowest measured
    // Continue must leave a measured row undecided.
    const narrowest = Math.min(...(record.rows ?? []).map(row => row.fractions.continue).filter(v => v >= model.present_min));
    if (!reads(record.rows ?? [], { ...model, present_min: narrowest + 0.001 }).some(({ read }) => read.undecided))
      fail(`${recordPath}: a present threshold above every measured Continue still left no row undecided; the check cannot fail`);
    // The rows' own finding: Continue on every title frame read. A fixture that
    // names a save state must draw what was measured for it.
    if (path.includes('/fnaf2/') && (record.rows ?? []).every(row => row.fractions.continue >= model.present_min)) {
      const fixture = readFileSync(join(ROOT, 'packages/play/test/testdata/make-title-fixture.py'), 'utf8');
      const fresh = fixture.match(/^\s*"fresh-save":\s*\{([^}]*)\}/m);
      if (!fresh || !/"continue"/.test(fresh[1]))
        fail('make-title-fixture.py draws a fresh save without Continue; every measured FNaF 2 title frame shows it (item 2)');
    }
  }
}

// --- item 8 on the tree: the trace runs only on a capability read as present -
{
  // The handset as recorded on 2026-09-27 advertises android.inputmethod and no
  // android.input.inputevent; the planted case is the one night-run.sh got
  // wrong until 2026-10-01, a phone whose data sources could not be read.
  const base = { serial: 'UNKNOWN', hidBinary: true, screenrecord: true, cueHelper: 'versionName=0.1.14', targetInstalled: true };
  type Probed = Parameters<typeof traceDecision>[0];
  const devices: [string, Partial<Probed>, boolean][] = [
    ['advertised', { ...base, perfettoDataSources: ['android.input.inputevent', 'android.inputmethod'] }, true],
    ['absent', { ...base, perfettoDataSources: ['android.inputmethod'] }, false],
    ['unreadable', { ...base, perfettoDataSources: null }, false],
  ];
  for (const [name, partial, want] of devices) {
    const device = partial as Probed; // the probe's fields the decision and the report read
    const decided = traceDecision(device).trace;
    const allowed = !checkCapabilitiesFirst({ instrument: 'packages/play/bin/probe/inputtrace.py', capabilities: capabilityReport(device) }).refused;
    if (decided !== want) fail(`capabilities.ts traceDecision runs the input trace on a phone whose input source is ${name}: ${decided}; item 8 says ${want}`);
    if (decided !== allowed) fail(`traceDecision (${decided}) and Review's checkCapabilitiesFirst (${allowed}) disagree on a phone whose input source is ${name}`);
  }
  // night-run.sh asks traceDecision; a shell that re-derives the answer is how
  // the unreadable case went the other way.
  const nightRun = readFileSync(join(ROOT, 'packages/play/bin/phone/night-run.sh'), 'utf8');
  if (!nightRun.includes('m.traceDecision(m.probe(') || /perfettoDataSources/.test(nightRun))
    fail('night-run.sh decides the input trace itself instead of asking capabilities.ts traceDecision (item 8)');
}

// --- item 11 on the tree: a margin scan does not hide a banded response -----
{
  // The 2026-09-11 response: clears to 99 ms, loses 132-198, clears again from
  // 231. A scan that stops at its first failure reads "99", the "cliff" that
  // would have condemned a run the model wins; basin-edge.ts must not.
  const banded = (k: number) => k <= 99 || k >= 231;
  const firstFailure = (clears: (k: number) => boolean) => { let last = 0; for (let k = 33; k <= 330; k += 33) { if (!clears(k)) break; last = k; } return String(last); };
  if (firstFailure(banded) !== '99') fail('the planted stop-at-first-failure scan no longer reproduces the 2026-09-11 reading');
  const read = scanEdge(banded, { step: 33, max: 330 });
  if (read.resumesAt !== 231 || formatEdge(read) === firstFailure(banded))
    fail(`basin-edge.ts reads a banded response as ${formatEdge(read)}; item 11 says it is banded, not a budget`);
  if (formatEdge(scanEdge((k) => k <= 99, { step: 33, max: 330 })) !== '99') fail('basin-edge.ts no longer reads a contiguous basin as its edge');
  // An uncut basin is capped even when max is not a multiple of the step (the
  // margin tool's default 800 ms over 33 ms steps never printed ">=").
  if (formatEdge(scanEdge(() => true, { step: 33, max: 800 })) !== '>=792') fail('basin-edge.ts does not mark an uncut scan as capped');
  for (const tool of ['packages/propose/bin/plans/minus-toys-margin.ts', 'packages/propose/bin/plans/minus-toys-jitter.ts'])
    if (!/from '\.\/basin-edge\.ts'/.test(readFileSync(join(ROOT, tool), 'utf8'))) fail(`${tool} scans a margin without basin-edge.ts (item 11)`);
}

const counts = [...verdicts.values()].reduce((into: Record<'runs' | 'exempt' | 'backlog' | 'orphan', number>, v) => {
  into[v.via ? 'runs' : v.exempt?.startsWith('tools/test.ts BACKLOG') ? 'backlog' : v.exempt ? 'exempt' : 'orphan'] += 1;
  return into;
}, { runs: 0, exempt: 0, backlog: 0, orphan: 0 });

if (failed) {
  console.error(`\nmistake register: ${failed} violation(s)`);
  process.exit(1);
}
console.log(`mistake register: item 13 -- ${verdicts.size} test files, ${counts.runs} run by a CI step, ` +
  `${counts.exempt} exempt in tools/ci-exemptions.json and ${counts.backlog} by tools/test.ts BACKLOG, each with a reason; ` +
  'item 5 -- every script path and npm script named exists; item 8 -- the input trace runs only on a ' +
  `capability read as present; item 11 -- a margin scan reads a banded ` +
  'response as banded; item 12 -- the five-read threshold holds ' +
  `on both sides; items ${[...new Set(REGISTER_GATES.map(([item]) => item))].sort((a, b) => a - b).join(', ')} rely only on ` +
  `gates a CI step runs; open (no gate yet): ${[...OPEN_ENTRIES.keys()].join(', ') || 'none'}`);
