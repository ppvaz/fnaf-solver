#!/usr/bin/env node
// Content-free measurement reader. Raw debugger/disassembly/source stays external.
// node packages/review/bin/recompile/diagnose-child-events.ts --external DIR
//   --after-default FILE --after-sourced FILE --out FILE
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const hash = (data) => createHash('sha256').update(data).digest('hex');
const fileHash = (path) => hash(readFileSync(path));

function completed(text) {
  if (!/\[Inferior \d+ .*exited normally\]/.test(text)) throw new Error('debugger probe did not exit normally');
}
export function parseRngProbe(text) {
  completed(text);
  const draws = [...text.matchAll(/^DRAW event=(\d+) range=(\d+) loop=(\d+) draws=(\d+) state=(\d+)$/gm)]
    .map((m) => Object.fromEntries(['generatedEvent', 'range', 'loop', 'draws', 'state'].map((key, i) => [key, Number(m[i + 1])])));
  const imageChecks = [...text.matchAll(/^IMAGE loop=(\d+) viewing=(-?[\d.]+) guard=(\d+)$/gm)]
    .map((m) => ({ loop: Number(m[1]), viewing: Number(m[2]), guard: Number(m[3]) }));
  if (!draws.length || !imageChecks.length) throw new Error('missing positive RNG/condition measurements');
  return { draws, imageChecks };
}
export function parseViewingProbe(text) {
  completed(text);
  const initial = /^INITIAL viewing=(-?[\d.]+)$/m.exec(text);
  if (!initial) throw new Error('missing initial viewing measurement');
  const writes = [...text.matchAll(/^VIEWING_WRITE loop=(\d+) value=(-?[\d.]+)$/gm)]
    .map((m) => ({ loop: Number(m[1]), value: Number(m[2]) }));
  const final = /^FINAL viewing=(-?[\d.]+) loop=(\d+)$/m.exec(text);
  const images = [...text.matchAll(/^IMAGE loop=(\d+) viewing=(-?[\d.]+) guard=(\d+)$/gm)]
    .map((m) => ({ loop: Number(m[1]), viewing: Number(m[2]), guard: Number(m[3]) }));
  return { initial: Number(initial[1]), writes,
    ...(final ? { final: { value: Number(final[1]), loop: Number(final[2]) }, imageChecks: images } : {}) };
}
export function parseChildCensus(text) {
  const frames = [...text.matchAll(/^COUNTS (\d+) (-?\d+) (\{[^\n]+\})$/gm)].map((m) => {
    const count = (key) => Number(new RegExp(`'${key}': (\\d+)`).exec(m[3])?.[1] ?? 0);
    return { frame: Number(m[1]), unclosedDepth: Number(m[2]), parentLists: count('parent'), childRows: count('child'), listEnds: count('end') };
  });
  if (!frames.length || frames.length !== (text.match(/^COUNTS /gm) ?? []).length ||
      new Set(frames.map((f) => f.frame)).size !== frames.length ||
      frames.some((f) => f.unclosedDepth || f.parentLists !== f.listEnds)) throw new Error('unbalanced child census');
  return { frames, unsupportedTriggeredChildren: (text.match(/^TRIGGER_CHILD /gm) ?? []).length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args: any = {};
  for (let i = 2; i < process.argv.length; i += 2) {
    if (!['--external', '--after-default', '--after-sourced', '--out'].includes(process.argv[i]) || !process.argv[i + 1]) throw new Error('see usage');
    args[process.argv[i].slice(2)] = process.argv[i + 1];
  }
  if (Object.keys(args).length !== 4) throw new Error('all four arguments are required');
  const external = (name) => resolve(args.external, name);
  const text = (name) => readFileSync(external(name), 'utf8');
  const resultRef = (path) => {
    const data = JSON.parse(readFileSync(path));
    if (data.claimLevel !== 'MODEL_ONLY' || data.schema !== 'recompile-draw-comparison-v1') throw new Error('invalid comparison');
    return { evidenceId: data.evidenceId, status: data.status, sha256: fileHash(path),
      targetUpdates: data.runtime.targetUpdates, alignments: data.alignments };
  };
  const files = ['input/application.ccn', 'dex/classes.dex', 'runs/first-rng-v3-gdb.log',
    'runs/viewing-write-v2-gdb.log', 'runs/child-shapes.log', 'runs/child-runtime-dex.log',
    'runs/title-timer-boundary.log', 'runs/timer-runtime-dex.log', 'runs/runloop-timer-dex.log',
    'convert-child-resume.log', 'build-child-resume.log', 'convert-child-timer-v2.log',
    'build-child-timer-v2.log', 'runs/child-office-64.trace', 'runs/child-office-64.log',
    'runs/child-timer-office-64.trace', 'runs/child-timer-office-64.log',
    'runs/child-timer-viewing-gdb.log', 'runs/child-timer-viewing.trace', 'runs/child-contract-test.log'];
  const afterViewingPath = external('runs/child-timer-viewing-gdb.log');
  const result: any = {
    schema: 'recompile-child-diagnosis-v1', claimLevel: 'MODEL_ONLY', fidelity: 'rebuilt-runtime',
    status: 'SOURCE_SUPPORTED_CORRECTION',
    question: 'What source event path causes the first measured RNG disagreement?',
    originalComparisonCommit: '9db9aed', childOnlyCheckpoint: '2bf1c66',
    before: { rng: parseRngProbe(text('runs/first-rng-v3-gdb.log')),
      viewing: parseViewingProbe(text('runs/viewing-write-v2-gdb.log')) },
    diagnosis: {
      defaultTick6: 'Generated events53_3 and157_3 each fire Every100ms and draw ranges50 and31. Default model disables these cosmetic draws; do not tune defaults.',
      sourcedInitialization: 'Generated event724_3 Random1000 is gated by viewing==0. Independently scheduled child functions event_func_244 and event_func_275 change viewing0→9→1 without their parent gates, suppressing that draw. Start-of-frame event735_3 Random100 still executes.',
      probePositions: 'event735 logged before its draw; event53/event157 logged immediately after their draw (optimized line breakpoints). IMAGE logs at event724 entry. Values are not all pre-draw counts.',
      childEncoding: { parentFlag: '0x40', childFlag: '0x8000', parentSystemAction: 43,
        endSystemCondition: -42, restoreSystemCondition: -43, objectScopeParameter: 69 },
      sourceMethods: ['ACT_EXECUTECHILDEVENTS.execute', 'CEventProgram.executeChildEvents',
        'CND_STARTCHILDEVENT.eva2', 'CEventProgram.evt_SaveSelectedObjects', 'CEventProgram.evt_RestoreSelectedObjects'],
      selectionRule: 'After successful parent actions, copy the enclosing snapshot and replace explicitly selected types. Each child restores only its parameter69 types. Do not re-evaluate parent predicates or share child filtering with siblings.',
      exposedNavigationBoundary: { frame: 1, scheduleSourceGroup: 78, delayMs: 200,
        onTimerSourceGroup: 79, childSourceGroups: [80, 81, 82, 83, 84, 85],
        explanation: 'The old flattened title transition bypassed an unsupported timer parent. Correct child gating exposed it; the child-only4000-update control remained in title.' },
      timerSourceMethods: ['ACT_EVENTAFTER.execute', 'CND_ONEVENT.eva1', 'CEventProgram.handle_TimerEvents', 'CRun.f_GameLoop'],
      timerRule: 'Append integer-millisecond deadline rhTimer+delay; dispatch due one-shots in insertion order before ordinary rows, including callbacks appended during dispatch; ASCII names compare case-insensitively.',
      nextTest: 'The sourced variant now first differs at office tick5/modelFrame6, when the model spends the Every100ms draws one update before the rebuilt runtime. Check the sourced model first-evaluation clock against CND_EVERY2; do not change production defaults to fit this trace.',
    },
    childCensus: parseChildCensus(text('runs/child-shapes.log')),
    childOnlyNegative: resultRef(new URL('../../../../tools/recompile/results/night1-child-timer-blocked-20260927.json', import.meta.url)),
    after: { default: resultRef(args['after-default']), sourced: resultRef(args['after-sourced']),
      viewing: existsSync(afterViewingPath) ? parseViewingProbe(readFileSync(afterViewingPath, 'utf8')) : 'UNKNOWN' },
    provenance: { externalFiles: Object.fromEntries(files.map((name) => [name, existsSync(external(name)) ? fileHash(external(name)) : 'UNKNOWN'])),
      patchSha256: fileHash(new URL('../../../source/recompile/mmfparser-chowdren-mobile.patch', import.meta.url)),
      fixtureSha256: fileHash(new URL('../../../source/recompile/fixtures/child-events.cpp', import.meta.url)),
      navigationFixtureSha256: fileHash(new URL('../../../source/recompile/fixtures/night1-newgame.input', import.meta.url)),
      saveFixtureSha256: fileHash(new URL('../../../source/recompile/fixtures/night1-before.ini', import.meta.url)),
      probes: Object.fromEntries(['child-before-rng.gdb', 'child-before-viewing.gdb', 'child-timer-viewing.gdb']
        .map((name) => [name, fileHash(new URL(`./probes/${name}`, import.meta.url))])),
      testSha256: fileHash(new URL('../../../source/recompile/test-child-events.py', import.meta.url)), toolSha256: fileHash(new URL(import.meta.url)) },
    limitations: ['Host reconstruction and synthetic fixtures, not device evidence or full equivalence.',
      'Old18k divergent records are preserved; their apparent navigation success bypassed unsupported parents.',
      'Child-triggered rows, static child scopes, repeat timers and dynamic/non-ASCII timer names are not established by this correction.',
      'Deleted-object selection override, qualifier/foreach semantics, immediate touch dispatch, unsupported extensions and whole-state equivalence remain open.',
      'The timer uses the rebuilt frame clock; this does not establish Android wall-clock timing equivalence.'],
  };
  result.evidenceId = `recompile-child-${hash(JSON.stringify(result)).slice(0, 16)}`;
  writeFileSync(args.out, `${JSON.stringify(result, null, 2)}\n`);
  console.log(`${result.evidenceId}: ${result.status} (MODEL_ONLY)`);
}
