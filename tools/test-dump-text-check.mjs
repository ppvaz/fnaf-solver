// tools/dump-text-check.mjs and its place in .githooks/commit-msg.
//
// Every fixture below is written for this test from the dumpers' grammar
// (packages/source/decompile/EventTextDumper.cs, packages/source/decompile/aimap.py, packages/source/decompile/readdump.py)
// with invented objects and numbers. None is copied from a dump: that is the
// rule under test (ADR 0002, decision 12).
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SIGNATURES, findDumpText, commitMessageBody, refusal } from './dump-text-check.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const T = '\t';

// [signature id, line]
const POSITIVE = [
  ['tabular-event-row', [' C', 'OT', '7', 'NUM', '-81', 'OI', '301', 'NAME', 'lamp gauge', 'OIL', '0', 'CFLAGS', '0', 'COTHER', '0', 'PARAMS', ''].join(T)],
  ['tabular-event-row', ' A OT 2 NUM 14 OI 77 NAME tin widget.Active OIL 0 PARAMS'],
  ['tabular-event-row', '> ` C OT -1 NUM -10 OI 0 NAME tin widget`'],
  ['tabular-record', ['GROUP', '41', 'FLAGS', '0', 'RESTRICT', '0', 'CONDS', '2', 'ACTS', '1'].join(T)],
  ['tabular-record', ['OBJECT', '9', 'TYPE', '7', 'NAME', 'lamp gauge', 'VALUES', '', 'STRINGS', ''].join(T)],
  ['tabular-record', [' I', 'INST', '5', 'OI', '33', 'NAME', 'tin widget.Active', 'X', '10', 'Y', '20'].join(T)],
  ['tabular-parameter', '23:ExpressionParameter:cmp=== ...'],
  ['tabular-parameter', '11:Short:Short value: 4'],
  ['tabular-parameter', 'the folder opens with 38:Group:Group: Group 9'],
  ['expression-item', 'value [3]ot=-1,num=0,oi=0,oil=0,loader=LongExp,value=12'],
  ['rendered-event', '  IF   lamp gauge -> CompareCounter (COMPARISON{= Long[3]})'],
  ['rendered-event', '  DO   tin widget.Active -> SetAlterableValue (AlterableValue{isExpression=False value=2}, EXPRESSION{= Long[1]})'],
  ['rendered-event', 'DO tin widget.Active -> Hide'],
  ['rendered-event', '  IF   StartOfFrame'],
  ['rendered-event', '  IF   NOT SampleNotPlaying (CNDSAMPLE{handle=4 isExpression=False name=\'x\'})'],
  ['rendered-event', '  IF   tin widget.Active -> FlagOn (param68?)'],
  ['rendered-event', '  DO   lamp store -> ExtAction#86 (EXPSTRING{= String[\'k\']})'],
  ['rendered-event', 'g41 reads `IF lamp gauge -> CompareCounter (COMPARISON{> Long[0]})` first'],
  ['rendered-parameter', 'it compares COMPARISON{>= Long[12]} against the gauge'],
  ['rendered-parameter', 'ActivateGroup with GROUPOINTER{id=3 isExpression=False pointer=0}'],
  ['group-header', '--- group 41 ---  [NoGood]'],
  ['group-header', 'FRAME 2 GROUP 41  flags=0 conds=2 acts=1'],
  ['group-header', 'FRAME 02: 03-Test Room  (12 event groups)'],
  ['readdump-row', '   C ot=7 num=-81 oi=301 [lamp gauge] '],
  ['readdump-row', '  !C ot=2 num=-27 oi=77 [tin widget] '],
];

// Ordinary commit prose, citations and code: none of it may be refused.
const NEGATIVE = [
  'g262 and g274 perform `drop everything` and g612 clears it.',
  'Only after that do g618 and g619 set it from a touch (group 33, events 542_3/543_3).',
  'See packages/source/decompile/readdump.py:132 and 03-04-Office.txt:1234 for the rendering.',
  'Run `readdump.py group 3 413-418` with the dump to read them.',
  'FRAME 3 GROUP 413 is the drop; g618 (monitor v0 == 2, v1 == 0, mask == 0).',
  'The first difference moves from 6953 -> 10200, the split.',
  '`flip lock` v0 2 -> 3, `monitor down` shown, v1 = 1.',
  'C ot=-1 num=-7 is Fusion\'s "only one action when event loops".',
  'A RESTRICT 32 event is a folder header; FLAGS 8192 events are its children; NUM -11 closes it.',
  'The tabular form is GROUP, N, FLAGS, F; OT and NUM name the condition.',
  'IF the mask is on -> refuse the press',
  'DO NOT push without the gate.',
  '- DO NOT use --no-verify',
  'if (this.monitor === MON_UP && this.maskFullyOff) this.dropEverything = true; // g618',
  'const ITEM = /^\\[(\\d+)\\]ot=(-?\\d+),num=(-?\\d+)/;',
  '| g618 | touch | mask == 0 |',
  'MODEL_ONLY, rebuilt-runtime fidelity. No default changed, no phone claim.',
  // The hook's evidence reference, assembled so validate-references.js does
  // not read this fixture as a stable-ID citation.
  `${'EVIDENCE'}:docs/evidence/plan12-promotions-20260927.json`,
  'Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>',
  '- GroupPointer build->=284 layout per NebulaFD: 32-bit ID, pointer base',
  'Group 738 destroys the labels at 3 AM once a run is in progress.',
  'The Toy view draws at A = 1, and Random(N) spends one draw.',
];

let checks = 0;

// 1. Each positive is caught, by the signature it was written for.
for (const [id, line] of POSITIVE) {
  const hits = findDumpText(line);
  assert.equal(hits.length, 1, `not caught (${id}): ${JSON.stringify(line)}`);
  assert.equal(hits[0].id, id, `${JSON.stringify(line)} caught as ${hits[0].id}, written for ${id}`);
  checks += 1;
}

// 2. Every signature has a positive fixture: a new signature needs one here.
for (const { id } of SIGNATURES) {
  assert.ok(POSITIVE.some(([fixture]) => fixture === id), `signature ${id} has no positive fixture`);
  checks += 1;
}

// 3. No negative is caught.
for (const line of NEGATIVE) {
  const hits = findDumpText(line);
  assert.equal(hits.length, 0, `prose refused as ${hits[0]?.id}: ${JSON.stringify(line)}`);
  checks += 1;
}

// 4. A message is judged per line, with line numbers, and comments and the
//    `git commit -v` diff below the scissors are not part of it.
const dumpLine = POSITIVE[10][1];
const message = ['Replay the drop order', '', 'g41 is the gate.', dumpLine, ''].join('\n');
const hits = findDumpText(message);
assert.deepEqual(hits.map((h) => [h.line, h.id]), [[4, 'rendered-event']]);
assert.equal(findDumpText(commitMessageBody(`Subject\n\n# ${dumpLine}\n`)).length, 0, 'a comment line is not message');
assert.equal(findDumpText(commitMessageBody(`Subject\n\n; x\n${dumpLine}\n`, ';')).length, 1, 'core.commentChar is honoured');
const verbose = ['Subject', '', 'Body.', '# ------------------------ >8 ------------------------',
  '# Do not modify or remove the line above.', 'diff --git a/x b/x', `+${POSITIVE[0][1]}`, dumpLine].join('\n');
assert.equal(findDumpText(commitMessageBody(verbose)).length, 0, 'the diff below the scissors is not message');
checks += 4;

// 5. The refusal says what matched and how to cite instead.
const text = refusal(hits);
for (const needle of ['decision 12', 'line 4 [rendered-event]', 'COMPARISON{= Long[3]}', 'Cite instead',
  'g673', '03-04-Office.txt:1234', 'PEDRO-OK does not waive'])
  assert.ok(text.includes(needle), `refusal lacks ${JSON.stringify(needle)}:\n${text}`);
checks += 1;

// 6. The hook runs the check first, even with PEDRO-OK and nothing staged.
const repo = mkdtempSync(join(tmpdir(), 'dump-text-hook-'));
try {
  execFileSync('git', ['init', '-q', repo]);
  // The hook also refuses an identity outside GitHub's noreply form (tools/commit-identity.mjs).
  execFileSync('git', ['-C', repo, 'config', 'user.name', 'Hook Test']);
  execFileSync('git', ['-C', repo, 'config', 'user.email', 'hook-test@users.noreply.github.com']);
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_')));
  const hook = join(ROOT, '.githooks', 'commit-msg');
  const run = (body) => {
    const file = join(repo, 'MSG');
    writeFileSync(file, body);
    return spawnSync('sh', [hook, file], { cwd: repo, encoding: 'utf8', env });
  };
  const refused = run(`Subject\n\n${dumpLine}\n\nPEDRO-OK\n`);
  assert.equal(refused.status, 1, `hook let a dump line through: ${refused.stderr}`);
  assert.match(refused.stderr, /dump-text check: refused/);
  assert.match(refused.stderr, /line 3 \[rendered-event\]/);
  const clean = run(`Subject\n\n${NEGATIVE.join('\n')}\n`);
  assert.equal(clean.status, 0, `hook refused prose: ${clean.stderr}`);
  const cli = spawnSync(process.execPath, [join(ROOT, 'tools', 'dump-text-check.mjs'), join(repo, 'MSG')], { encoding: 'utf8' });
  assert.equal(cli.status, 0, `CLI refused prose: ${cli.stderr}`);
  checks += 3;
} finally {
  rmSync(repo, { recursive: true, force: true });
}

console.log(`dump-text check: ${checks} checks pass (${POSITIVE.length} dump-shaped fixtures caught by ` +
  `${SIGNATURES.length} signatures, ${NEGATIVE.length} prose lines passed, hook wired first)`);
