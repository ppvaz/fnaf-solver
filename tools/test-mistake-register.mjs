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
//            `node tools/test.mjs --gates`, whose own `--list` says what it
//            selects), or is exempt below, one file at a time, with a reason.
//            A Java test counts only when its test.sh EXECUTES the class;
//            compiling it is not running it.
//   item 5   "Never report a test PASS you did not see print." The incident
//            was a wrong test path failing silently. Every script path a
//            package.json script, a CI step or a tools/test.mjs entry names
//            must exist, and every `npm run X` must name a script that exists.
//   item 12  "An absent observation is evidence only when the rule has read the
//            positive state in the same run." run-report.mjs's five-read
//            threshold is exercised on both sides of the boundary; before this
//            nothing asserted it.
//   items 7, 9  are packages/propose/test/test-seam-slack.mjs's: every compiled plan
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
//   node tools/test-mistake-register.mjs [--explain]
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { report } from '../packages/review/bin/grade/run-report.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SELF = 'tools/test-mistake-register.mjs';
const explain = process.argv.includes('--explain');

// --- Test files that no CI step runs, one decision each --------------------
//
// An entry is a decision, not a formality: deleting one is how a test gets
// promoted into a lane. A stale entry -- the file now runs, or is gone -- fails.
// tools/test.mjs's BACKLOG is the other exemption table, and it is read rather
// than copied here: an engine check red on purpose carries its reason there.
const EXEMPT = new Map([
  ['packages/source/recompile/test-child-events.py', 'external-toolchain fixture: emits C++ with the pinned patched Chowdren converter under Python 2.7 and compiles it with C++; toolchain is external and absent from CI; run explicitly per packages/source/recompile/README.md, never count as a CI pass'],
  ['packages/source/recompile/test-mobile-parser.py', 'external-toolchain fixture: imports the pinned patched Anaconda parser and its compiled Cython modules under Python 2.7, absent from this repository and CI; run explicitly per packages/source/recompile/README.md, never count as a CI pass'],
  // tools/test.mjs's BROWSER group. ci.yml's header gives the reason: a
  // trainer graded in real-time milliseconds on a shared runner says nothing
  // about the code when it fails.
  ['apps/trainer/test/browser.test.mjs', 'browser group: real-time graded in Chrome; ci.yml excludes it on purpose (npm run test:browser:realtime)'],
  ['apps/trainer/test/calibration.test.mjs', 'browser group: real-time graded in Chrome; ci.yml excludes it on purpose (npm run test:browser:realtime)'],
  ['apps/trainer/test/phase.test.mjs', 'browser group: real-time graded in Chrome; ci.yml excludes it on purpose (npm run test:browser:realtime)'],
  ['apps/trainer/test/lesson.test.mjs', 'browser group: real-time graded in Chrome; ci.yml excludes it on purpose (npm run test:browser:realtime)'],
  ['apps/trainer/test/light.test.mjs', 'browser group: real-time graded in Chrome; ci.yml excludes it on purpose (npm run test:browser:realtime)'],
  ['apps/trainer/test/pages.test.mjs', 'browser group: needs Chrome, like its siblings, and runs with them (npm run test:browser:realtime); not timing-sensitive, so a CI step could run it'],
  // tools/test.mjs's REPORTS group: named like tests, but they print numbers
  // and always exit 0, so a lane would count a verdict that does not exist.
  ['packages/propose/bin/minus2test.mjs', 'report, not a check: tools/test.mjs --reports prints it and never judges it'],
  ['packages/propose/bin/minus6test.mjs', 'report, not a check: tools/test.mjs --reports prints it and never judges it'],
  ['packages/propose/bin/rvctest.mjs', 'report, not a check: tools/test.mjs --reports prints it and never judges it'],
  ['packages/propose/test/androidstalltest.mjs', 'report, not a check: tools/test.mjs --reports prints it and never judges it'],
  // tools/test.mjs's EXTENDED_ENGINE: "green, but four minutes on its own
  // (2026-09-24): too slow for --gates". No CI step runs --extended either, so
  // these four are item 13's open debt, recorded rather than hidden.
  ['packages/propose/bin/plans/test-minus-toys-plan.mjs', 'extended tier (minutes): only `npm run test:simulation` runs it, and no CI step does -- open item-13 debt'],
  ['packages/propose/bin/plans/test-minus-toys-margin.mjs', 'extended tier (minutes): only `npm run test:simulation` runs it, and no CI step does -- open item-13 debt'],
  ['packages/propose/bin/plans/test-minus-toys-jitter.mjs', 'extended tier (minutes): only `npm run test:simulation` runs it, and no CI step does -- open item-13 debt'],
  ['packages/propose/bin/plans/test-night-matrix.mjs', 'extended tier (minutes): only `npm run test:simulation` runs it, and no CI step does -- open item-13 debt'],
  // Named like a test, but a runner: it picks gates from the working tree's
  // diff, so its answer depends on what is dirty, and every gate it can pick
  // is judged by this file on its own.
  ['tools/affected-test.js', 'edit-time runner (`npm run test:affected`) that selects gates from the working-tree diff; not itself a gate'],
]);

// --- The gates each register item relies on --------------------------------
// Item 13 applied to the register: a register entry whose gate no CI step runs
// has no gate.
const REGISTER_GATES = [
  [5, SELF],
  [7, 'packages/propose/test/test-seam-slack.mjs'],
  [9, 'packages/propose/test/test-seam-slack.mjs'],
  [12, SELF],
  [13, SELF],
  [13, 'packages/review/bin/grade/test-grade-run-coverage.mjs'],
  [14, 'tools/test-sibling-paths.js'],
  [15, 'apps/desktop/test/test-fnaf1-winner.mjs'],
];

let failed = 0;
const fail = (message) => { failed += 1; console.error(`  FAIL ${message}`); };

// --- Reading shell command lines -------------------------------------------

/** Split shell text into simple commands (arrays of words). Quote-aware,
 *  keeps `$(...)` as one word, and treats && || ; | & and newlines as
 *  separators. It reads command lines; it is not a shell. */
export function simpleCommands(text) {
  const commands = [];
  let words = [];
  let word = '';
  let inWord = false;
  let quote = null;
  let depth = 0;
  const endWord = () => { if (inWord) words.push(word); word = ''; inWord = false; };
  const endCommand = () => { endWord(); if (words.length) commands.push(words); words = []; };
  const src = text.replace(/\\\r?\n/g, ' ');
  for (let i = 0; i < src.length; i += 1) {
    const c = src[i];
    if (quote) { if (c === quote) quote = null; else word += c; continue; }
    if (depth > 0) {
      word += c;
      if (c === '(') depth += 1;
      else if (c === ')') depth -= 1;
      continue;
    }
    if (c === "'" || c === '"') { quote = c; inWord = true; continue; }
    if (c === '$' && src[i + 1] === '(') { word += '$('; i += 1; depth = 1; inWord = true; continue; }
    if (c === '#' && !inWord) { while (i < src.length && src[i] !== '\n') i += 1; endCommand(); continue; }
    if (c === '&' && (word.endsWith('>') || src[i + 1] === '>')) { word += c; inWord = true; continue; }
    if (c === '\n' || c === ';' || c === '|' || c === '&') {
      endCommand();
      if ((c === '|' || c === '&') && src[i + 1] === c) i += 1;
      continue;
    }
    if (/\s/.test(c)) { endWord(); continue; }
    word += c;
    inWord = true;
  }
  endCommand();
  return commands;
}

const INTERPRETERS = new Set(['node', 'python3', 'python', 'bash', 'sh']);

/** What one simple command runs: an npm script, a file, or nothing we track. */
export function classify(words) {
  let i = 0;
  while (i < words.length && /^[A-Za-z_]\w*=/.test(words[i])) i += 1;
  const [command, ...rest] = words.slice(i);
  if (!command) return null;
  if (command === 'npm') {
    const at = rest.findIndex(word => word === 'run' || word === 'run-script');
    if (at < 0) return null;
    const script = rest.slice(at + 1).find(word => !word.startsWith('-'));
    return script ? { kind: 'npm', script } : null;
  }
  if (INTERPRETERS.has(command)) {
    const at = rest.findIndex(word => !word.startsWith('-'));
    const flags = rest.slice(0, at < 0 ? rest.length : at);
    // Inline code or a module, not a file: `node -e`, `python3 -m pip`, `sh -c`.
    if (at < 0 || flags.some(flag => ['-e', '-p', '-c', '-m', '--eval', '--print'].includes(flag)))
      return null;
    return { kind: 'file', path: rest[at], args: rest.slice(at + 1) };
  }
  if (command.includes('/') && /\.(?:sh|py|mjs|js)$/.test(command))
    return { kind: 'file', path: command, args: rest };
  return null;
}

// --- The registries a command line can reach -------------------------------

const readJson = path => JSON.parse(readFileSync(join(ROOT, path), 'utf8'));
const SCRIPTS = readJson('package.json').scripts ?? {};

/** `- name:` / `run:` pairs of the CI job, single-line and `run: |` blocks. */
export function ciSteps(text) {
  const lines = text.split('\n');
  const steps = [];
  for (let i = 0; i < lines.length; i += 1) {
    const named = lines[i].match(/^(\s*)- name:\s*(.+?)\s*$/);
    if (!named) continue;
    let run = null;
    for (let j = i + 1; j < lines.length && !/^\s*- /.test(lines[j]); j += 1) {
      const single = lines[j].match(/^(\s*)run:\s*(.*?)\s*$/);
      if (!single) continue;
      if (single[2] !== '|') { run = single[2]; break; }
      const block = [];
      const indent = single[1].length;
      for (let k = j + 1; k < lines.length; k += 1) {
        if (lines[k].trim() && lines[k].search(/\S/) <= indent) break;
        block.push(lines[k]);
      }
      run = block.join('\n');
      break;
    }
    if (run !== null) steps.push({ name: named[2], run });
  }
  return steps;
}

// tools/test.mjs answers what a flag set selects; this never re-derives its
// --gates filter from the file's text (register item 11: read the tool's own
// computed output before deriving the same quantity by hand).
const suiteCache = new Map();
function suite(args) {
  const flags = args.filter(arg => arg !== '--list');
  const key = flags.join(' ');
  if (!suiteCache.has(key)) {
    const out = execFileSync(process.execPath, [join(ROOT, 'tools/test.mjs'), ...flags, '--list'],
      { cwd: ROOT, encoding: 'utf8' });
    suiteCache.set(key, out.trim().split('\n').filter(Boolean).map(line => JSON.parse(line)));
  }
  return suiteCache.get(key);
}

const normal = path => posix.normalize(path.replace(/^\.\//, ''));

/** Walk one command text, calling sink.file(path, via, reached) for every file
 *  it names and sink.script(name, via) for every `npm run` it names. `reached`
 *  is false for a tools/test.mjs entry these flags do not select. */
export function walk(text, via, sink, scripts = SCRIPTS, open = new Set()) {
  for (const words of simpleCommands(text)) {
    const target = classify(words);
    if (!target) continue;
    if (target.kind === 'npm') {
      const known = Object.hasOwn(scripts, target.script);
      sink.script(target.script, via, known);
      if (!known || open.has(target.script)) continue;
      walk(scripts[target.script], `${via} > npm run ${target.script}`, sink, scripts,
        new Set([...open, target.script]));
      continue;
    }
    if (target.path.includes('$')) continue;   // a variable path is resolved at run time
    const path = normal(target.path);
    sink.file(path, via, true);
    if (path === 'tools/test.mjs') {
      // A report selected by --reports is printed and never judged: not a gate.
      for (const entry of suite(target.args))
        sink.file(entry.path, `${via} > tools/test.mjs ${target.args.join(' ')} [${entry.name}]`,
          entry.selected && entry.group !== 'reports', entry);
    }
  }
}

// --- The test files ---------------------------------------------------------

const TEST_FILE = [
  // Wherever the ADR 0002 moves put them: tools/, a package or an application.
  /^(?:tools|packages|apps)\/(?:[\w.-]+\/)*test-[\w.-]+\.(?:mjs|js|py|sh)$/,
  /^(?:tools|packages\/propose)\/(?:[\w.-]+\/)*[a-z0-9-]*test\.(?:mjs|js)$/,
  /(?:^|\/)test_[\w.-]+\.py$|_test\.py$/,
  /^(?:packages|apps)\/[\w.-]+\/test\/(?:[\w.-]+\/)*[\w.-]+\.test\.(?:mjs|js)$/,
  /^android\/[\w.-]+\/test\.sh$/,
];
const JAVA_TEST = /^android\/([\w.-]+)\/test\/(?:[\w.-]+\/)*(\w+Test)\.java$/;
export const isTestFile = path => TEST_FILE.some(re => re.test(path));

/** Tracked files only: CI and push-gate measure a commit, and a concurrent
 *  session's untracked test is not yet a claim that anything runs it. */
function trackedFiles() {
  try {
    return execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 28 })
      .split('\0').filter(Boolean).filter(path => existsSync(join(ROOT, path)));
  } catch {
    const out = [];
    const skip = new Set(['.git', 'node_modules', 'artifacts', 'captures', 'dist']);
    const visit = (dir) => {
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

/** The fully qualified classes a test.sh hands to `java`, not just to `javac`. */
export function javaExecuted(shellText) {
  const run = new Set();
  for (const line of shellText.replace(/\\\r?\n/g, ' ').split('\n')) {
    if (/^\s*#/.test(line)) continue;
    if (!/(?:^|[\s"])\$\{?JAVA\b\}?"?\s|(?:^|\s)java\s/.test(line)) continue;
    for (const m of line.matchAll(/\b((?:[a-z_]\w*\.)+[A-Z]\w*)\b/g)) run.add(m[1]);
  }
  return run;
}

/** Item 13 over one inventory. Returns what reaches each test, or why not. */
export function coverage({ files, reached, backlog, exempt, readText }) {
  const verdicts = new Map();
  const executedBy = new Map();
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
      if (!executedBy.get(runner).has(fqcn)) {
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
    else if (backlog.has(path)) verdicts.set(path, { ok: true, exempt: `tools/test.mjs BACKLOG: ${backlog.get(path)}` });
    else verdicts.set(path, { ok: false, why: 'no CI step reaches it' });
  }
  const stale = [];
  for (const [path, reason] of exempt) {
    const runs = verdicts.get(path)?.via;
    if (!tracked.has(path)) stale.push(`${path} is exempt but no such tracked file exists`);
    else if (runs) stale.push(`${path} is exempt but ${runs} runs it -- delete the stale exemption`);
    else if (!isTestFile(path) && !JAVA_TEST.test(path)) stale.push(`${path} is exempt but is not a test file by any convention here`);
    if (!String(reason).trim()) stale.push(`${path} is exempt with no reason`);
    if (backlog.has(path)) stale.push(`${path} is exempt here AND by tools/test.mjs BACKLOG -- keep one`);
  }
  return { verdicts, stale };
}

/** Every file a CI step runs, with the first route that reaches it, and the
 *  BACKLOG reason of each tools/test.mjs entry it names but does not run. */
function ciReach(ciText) {
  const reached = new Map();
  const backlog = new Map();
  const sink = {
    script: () => {},
    file: (path, via, isReached, entry) => {
      if (isReached && !reached.has(path)) reached.set(path, via);
      if (entry?.backlog) backlog.set(path, entry.backlog);
    },
  };
  for (const step of ciSteps(ciText)) walk(step.run, `ci.yml "${step.name}"`, sink);
  for (const path of reached.keys()) backlog.delete(path);
  return { reached, backlog };
}

/** Item 5: every script path package.json / CI / tools/test.mjs names exists. */
export function missingPaths({ scripts, ciText, exists }) {
  // One message per missing target, at the first line that names it: the
  // same path reached through `npm run test` and CI is one defect, not three.
  const problems = new Map();
  const sink = {
    script: (name, via, known) => {
      if (!known && !problems.has(`npm:${name}`))
        problems.set(`npm:${name}`, `${via} runs \`npm run ${name}\`, which package.json does not define`);
    },
    file: (path, via) => {
      if (!exists(path) && !problems.has(path)) problems.set(path, `${via} names ${path}, which does not exist`);
    },
  };
  if (ciText) for (const step of ciSteps(ciText)) walk(step.run, `ci.yml "${step.name}"`, sink, scripts);
  for (const [name, body] of Object.entries(scripts)) walk(body, `package.json "${name}"`, sink, scripts);
  return [...problems.values()];
}

// --- Positive controls: each check must catch a planted violation -----------
{
  // item 5, the incident itself: tools/test-bundle.mjs for packages/propose/test/test-bundle.mjs.
  const planted = missingPaths({
    scripts: { 'test:planted': 'node tools/test-bundle.mjs > /dev/null 2>&1 && echo PASS', 'test:alias': 'npm run test:nope' },
    ciText: null, exists: path => existsSync(join(ROOT, path)),
  });
  if (!planted.some(p => p.includes('tools/test-bundle.mjs')))
    fail('control: a package.json script naming tools/test-bundle.mjs (the item-5 wrong path) was not caught');
  if (!planted.some(p => p.includes('npm run test:nope')))
    fail('control: `npm run` of an undefined script was not caught');

  // item 13: an unregistered test, a compiled-but-never-run Java test, and a stale exemption.
  const shell = '"$JAVAC" -d "$T" "$HERE/test/a/b/RunTest.java" "$HERE/test/a/b/IdleTest.java"\n'
    + '"$JAVA" -cp "$T" a.b.RunTest\n# "$JAVA" -cp "$T" a.b.IdleTest\n';
  const texts = {
    'android/x/test.sh': shell,
    'android/x/test/a/b/RunTest.java': 'package a.b;\n',
    'android/x/test/a/b/IdleTest.java': 'package a.b;\n',
  };
  const files = ['tools/device/test-planted-orphan.mjs', 'tools/test-registered.mjs',
    'android/x/test.sh', 'android/x/test/a/b/RunTest.java', 'android/x/test/a/b/IdleTest.java',
    'tools/device/test-stale.mjs'];
  const reached = new Map([['tools/test-registered.mjs', 'ci'], ['android/x/test.sh', 'ci'],
    ['tools/device/test-stale.mjs', 'ci']]);
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
  if (!stale.some(s => s.startsWith('tools/device/test-stale.mjs')))
    fail('control: an exemption for a test a CI step runs was not reported stale');

  // The reader itself: a prose mention is not an invocation.
  const sink = { names: [], script() {}, file(path) { this.names.push(path); } };
  walk('echo "see tools/device/test-x.mjs" && node tools/device/test-y.mjs --flag && python3 -m pip install x', 'ctl', sink, {});
  if (sink.names.join() !== 'tools/device/test-y.mjs')
    fail(`control: the command reader named ${JSON.stringify(sink.names)} (want only tools/device/test-y.mjs)`);
}

// --- item 13 and item 5 on the tree -----------------------------------------
const ciText = readFileSync(join(ROOT, '.github/workflows/ci.yml'), 'utf8');
const { reached, backlog } = ciReach(ciText);
const files = trackedFiles();
const { verdicts, stale } = coverage({ files, reached, backlog, exempt: EXEMPT,
  readText: path => readFileSync(join(ROOT, path), 'utf8') });

for (const [path, verdict] of [...verdicts].sort(([a], [b]) => a.localeCompare(b))) {
  if (!verdict.ok) fail(`${path}: ${verdict.why}. Register it in a CI lane (npm run test:unit ` +
    'or test:contracts, or tools/test.mjs ENGINE), or exempt it in this file with a reason.');
  else if (explain) console.log(`  ${verdict.via ? 'runs  ' : 'exempt'} ${path}  <- ${verdict.via ?? verdict.exempt}`);
}
for (const message of stale) fail(message);

const missing = missingPaths({ scripts: SCRIPTS, ciText, exists: path => existsSync(join(ROOT, path)) });
// This includes every tools/test.mjs entry, selected or not (`--list` prints
// all of them): an unselected entry's path is checked by nothing else until
// the day someone runs its group.
for (const message of missing) fail(`${message} -- a wrong path fails silently behind \`> /dev/null && echo\` (item 5)`);

for (const [item, gate] of REGISTER_GATES) {
  if (!existsSync(join(ROOT, gate))) fail(`register item ${item} relies on ${gate}, which does not exist`);
  else if (!reached.has(gate)) fail(`register item ${item} relies on ${gate}, which no CI step runs (item 13)`);
}

// --- item 12 on the tree: the five-read threshold, both sides ----------------
{
  // Five cycles of one raise, four graded MISSING: a systematic miss by count.
  // What decides the verdict is how often the rule read `monitorUp: true` at all.
  const verdict = (positiveReads) => {
    const events = [];
    for (let cycle = 0; cycle < 5; cycle += 1) {
      events.push({ type: 'control.effect.result', actionId: 'raise', signal: 'monitorUp', target: true,
        status: cycle === 0 ? 'PASS' : 'MISSING',
        samples: cycle === 0 ? Array.from({ length: positiveReads }, () => ({ monitorUp: true })) : [{ monitorUp: false }] });
    }
    return report(events).effects.systematicMisses.find(row => row.signal === 'monitorUp')?.verdict ?? 'NOT-LISTED';
  };
  // 2 is the 2026-09-12 run: `true` read twice in 266 samples, a blind rule.
  for (const [reads, want] of [[2, 'UNPROVEN-OBSERVER-BLIND'], [4, 'UNPROVEN-OBSERVER-BLIND'], [5, 'ACTUATOR-GAP']]) {
    const got = verdict(reads);
    if (got !== want)
      fail(`run-report.mjs calls 4 MISSING of 5 with ${reads} positive read(s) ${got}; item 12 says ${want}`);
  }
}

const counts = [...verdicts.values()].reduce((into, v) => {
  into[v.via ? 'runs' : v.exempt?.startsWith('tools/test.mjs BACKLOG') ? 'backlog' : v.exempt ? 'exempt' : 'orphan'] += 1;
  return into;
}, { runs: 0, exempt: 0, backlog: 0, orphan: 0 });

if (failed) {
  console.error(`\nmistake register: ${failed} violation(s)`);
  process.exit(1);
}
console.log(`mistake register: item 13 -- ${verdicts.size} test files, ${counts.runs} run by a CI step, ` +
  `${counts.exempt} exempt here and ${counts.backlog} by tools/test.mjs BACKLOG, each with a reason; ` +
  `item 5 -- every script path and npm script named exists; item 12 -- the five-read threshold holds ` +
  `on both sides; items ${[...new Set(REGISTER_GATES.map(([item]) => item))].join(', ')} rely only on ` +
  'gates a CI step runs');
