// Report and check for the plans/11 policy comparison.
//
//   node tools/policytest.mjs                 # the whole comparison (slow)
//   node tools/policytest.mjs --nights        # survival by night
//   node tools/policytest.mjs --slack         # the degradation curves
//   node tools/policytest.mjs --actuator      # through the measured phone
//   node tools/policytest.mjs --assert        # the regression (fast)
//   node tools/policytest.mjs --assert --record FILE.json  # retain the mask-timing diagnostic
//
// EVERY NUMBER THIS PRINTS IS A SIMULATOR NUMBER. `pilottest`/`hidpilottest`
// count frames and so does this: a press and a sensor read both look free
// (CLAUDE.md, "The simulator prices nothing"). `--actuator` narrows that gap
// without closing it, and none of these figures is a device clear.
import { pathToFileURL } from 'node:url';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import * as C from '@sixam/source/fnaf2';
import { sweep, runPolicy } from './policy.mjs';
import { POLICIES } from './policybaselines.mjs';
import { run as bbRun, DEFAULT_CYCLE, LEGACY_ANIMATION_INVALID_CYCLE } from './model/reactive-pilot.mjs';
import { genCycle, KNOBS0, MIN } from './cyclesearch.mjs';
import { formatRate } from './stat.mjs';

const RUNS = +(process.env.POLICY_RUNS || 100);
const SLACKS = [0, 20, 40, 60, 100];
const MODELS = ['iid', 'correlated', 'common'];

// The families reported side by side. `privilege` is not decoration: a truth
// policy is an upper bound and must never be compared to a belief policy as
// though they had solved the same problem.
const FAMILIES = [
  ['minus7', 'local Minus 7 (bbtest Bot)', 'truth'],
  ['jason-10s', 'Jason-style, 10 s phase', 'belief'],
  ['jason-5s', 'Jason-style, 5 s phase', 'belief'],
  ['shooter25', 'Shooter25-style priority machine (literal)', 'truth'],
  ['shooter25-belief', 'Shooter25-style, stock-belief', 'belief'],
  ['couraeel', 'Couraeel-style emergency priority', 'truth'],
  ['couraeel-2x', 'Couraeel-style, doubled hall rate', 'truth'],
  ['couraeel-belief', 'Couraeel-style, stock-belief', 'belief'],
];
const CONTROLS = [
  ['null', 'C1 no inputs at all'],
  ['wind-only', 'C2 a perfect box and nothing else'],
  ['couraeel-inverted', 'C3 the same ladder, upside down'],
  ['minus7-no-stun', 'C4 Minus 7 with the camera flashes deleted'],
  ['shooter25-hoisted', 'C5 Shooter25 with the danger test hoisted out of Checking'],
];

const pct = (r) => `${String(r.survived).padStart(3)}/${r.runs} ` +
  `(${formatRate(r.survived, r.runs, { label: 'survival' })})`;

function nightsTable() {
  console.log('\n== survival by night, exact replay, no execution error ==');
  console.log(`   (${RUNS} seeds each; simulator only)\n`);
  const nights = [1, 2, 3, 4, 5, 6, 7];
  console.log('policy'.padEnd(20) + 'priv  ' + nights.map(n => `  n${n}`).join('  '));
  for (const [key, , priv] of [...FAMILIES, ...CONTROLS.map(c => [c[0], c[1], '-'])]) {
    const cells = nights.map(n => String(sweep(POLICIES[key], { runs: RUNS, night: n }).survived)
      .padStart(4));
    console.log(key.padEnd(20) + String(priv).padEnd(6) + cells.join('  '));
  }
}

function slackTable(nights = [4, 5, 6, 7]) {
  for (const night of nights) {
    console.log(`\n== night ${night}: survival out of ${RUNS} as execution error grows ==`);
    for (const model of MODELS) {
      console.log(`\n  error shape: ${model}`);
      console.log('  ' + 'policy'.padEnd(20) +
        SLACKS.map(s => `+/-${s}ms`.padStart(9)).join(''));
      for (const [key] of FAMILIES) {
        const cells = SLACKS.map(slackMs =>
          pct(sweep(POLICIES[key], { runs: RUNS, night, slackMs, slackModel: model }))
            .padStart(9));
        console.log('  ' + key.padEnd(20) + cells.join(''));
      }
    }
  }
}

function actuatorTable(nights = [4, 5, 6, 7]) {
  console.log('\n== through tools/device/actuator.mjs (measured phone) ==');
  console.log('   launch lateness 110-300 ms, one draw per delivery frame, ' +
    'mask-seam monitor drops\n');
  console.log('policy'.padEnd(20) + nights.map(n => `night ${n}`.padStart(12)).join('') +
    '   seam drops');
  for (const [key] of FAMILIES) {
    let drops = 0;
    const cells = nights.map(n => {
      const r = sweep(POLICIES[key], { runs: RUNS, night: n, deviceActuator: true });
      drops += r.seamDrops;
      return pct(r).padStart(12);
    });
    console.log(key.padEnd(20) + cells.join('') + `   ${drops}`);
  }
}

function deathTable(night = 7) {
  console.log(`\n== night ${night}: what killed each policy (exact replay) ==\n`);
  for (const [key] of FAMILIES) {
    const r = sweep(POLICIES[key], { runs: RUNS, night });
    console.log(key.padEnd(20) + pct(r) + '  ' +
      r.deaths.map(([k, v]) => `${v}x ${k}`).join(', '));
  }
}

// ------------------------------------------------------------------- checks
function assertSuite(recordPath = null) {
  const problems = [];
  const check = (name, cond, detail = '') => {
    if (!cond) problems.push(`${name}${detail ? ` -- ${detail}` : ''}`);
  };

  // Source-driven input floor, not a seed fit: mask-off must wait for the
  // put-on animation. The old nine-frame hold remains an explicit negative.
  const maskRows = DEFAULT_CYCLE.filter(([, , action]) => action === 'mask');
  const hallRow = DEFAULT_CYCLE.find(([, kind, action]) => kind === 'down' && action === 'light');
  check('mask-off precedes the sourced put-on completion', maskRows[1][0] - maskRows[0][0] === C.MASK_ANIM_ON);
  check('hall flash lost its sourced take-off floor and one-frame margin', hallRow[0] - maskRows[1][0] === C.MASK_ANIM_OFF + 1);
  check('cycle search can propose animation-invalid mask holds', MIN.maskHold === C.MASK_ANIM_ON && KNOBS0.maskHold === C.MASK_ANIM_ON);
  check('cycle search default differs from the baseline', JSON.stringify(genCycle(KNOBS0)) === JSON.stringify(DEFAULT_CYCLE));
  const inputControl = cycle => {
    const s = new C.Sim({ night: 1, seed: 1, gfEnabled: false, bbEnabled: false,
      foxyEnabled: false, stalledEnabled: false, boxEnabled: false, powerEnabled: false });
    s.monitor = 'up'; s.viewing = 11;
    const maskStates = []; let hallLit = false, at = 0;
    const end = cycle.find(([ , kind, action]) => kind === 'up' && action === 'light')[0];
    while (s.frame <= end) {
      while (at < cycle.length && cycle[at][0] <= s.frame) {
        const [, kind, action] = cycle[at++];
        if (kind === 'up') s.release(action); else s.press(action);
        if (action === 'mask') maskStates.push(s.maskOn);
        if (kind === 'down' && action === 'light') hallLit = s.hallLightOn;
      }
      s.tick();
    }
    return { maskStates, hallLit };
  };
  const beforeInput = inputControl(LEGACY_ANIMATION_INVALID_CYCLE);
  const afterInput = inputControl(DEFAULT_CYCLE);
  check('the old nine-frame mask control stopped exposing the ignored tap',
    JSON.stringify(beforeInput) === JSON.stringify({ maskStates: [true, true], hallLit: false }));
  check('the corrected cycle does not clear the mask and light the hall',
    JSON.stringify(afterInput) === JSON.stringify({ maskStates: [true, false], hallLit: true }));
  const timingRows = Array.from({ length: 25 }, (_, i) => {
    const seed = (i * 2246822519) >>> 0;
    const result = cycle => {
      const { sim } = bbRun({ seed, night: 1, cycle });
      return { won: sim.won, frame: sim.frame, death: sim.death?.reason ?? null };
    };
    return { seed, rngSeed16: seed & 0xffff,
      before: result(LEGACY_ANIMATION_INVALID_CYCLE), after: result(DEFAULT_CYCLE) };
  });
  const beforeWins = timingRows.filter(r => r.before.won).length;
  const afterWins = timingRows.filter(r => r.after.won).length;
  check('source timing correction did not improve the retained negative', afterWins > beforeWins,
    `${beforeWins}/25 before, ${afterWins}/25 after`);

  // 1. Equivalence. The Minus 7 control IS model/reactive-pilot.mjs's Bot, so at zero slack
  //    and with no actuator the adapter must not change a single night.
  //    This is plans/11 work package 2's gate.
  for (let i = 0; i < 25; i++) {
    const seed = (i * 2246822519) >>> 0;
    const legacy = bbRun({ seed });
    const viaAdapter = runPolicy({ policy: POLICIES.minus7(seed, 0), night: 7, seed });
    const a = [legacy.sim.won, legacy.sim.frame, legacy.sim.death?.reason ?? null,
               legacy.sim.death?.detail ?? null];
    const b = [viaAdapter.won, viaAdapter.frame, viaAdapter.reason, viaAdapter.detail];
    check('the adapter changed a bbtest night', JSON.stringify(a) === JSON.stringify(b),
      `seed ${seed}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`);
    if (problems.length) break;
  }

  // 2. Zero slack is an identity in every error shape, and a zero-lateness
  //    actuator is an identity for a schedule that keeps every mask -> monitor
  //    pair at or past SEAM_SAFE_MS (test-actuator.mjs makes the same claim
  //    for pilottest).
  {
    const key = (r) => JSON.stringify([r.won, r.frame, r.reason]);
    for (const name of ['minus7', 'shooter25', 'couraeel']) {
      const plain = key(runPolicy({ policy: POLICIES[name](7, 0), night: 7, seed: 7 }));
      for (const slackModel of MODELS)
        check('zero slack changed a night', plain === key(runPolicy(
          { policy: POLICIES[name](7, 0, slackModel), night: 7, seed: 7,
            slackMs: 0, slackModel })), `${name}/${slackModel}`);
    }
    const plain = key(runPolicy({ policy: POLICIES.minus7(9, 0), night: 7, seed: 9 }));
    const wrapped = runPolicy({ policy: POLICIES.minus7(9, 0), night: 7, seed: 9,
      deviceActuator: { lateMinMs: 0, lateMaxMs: 0 } });
    check('a zero-lateness actuator changed the night', plain === key(wrapped),
      `${plain} vs ${key(wrapped)}`);
    check('the Minus 7 schedule seam-dropped at zero lateness', wrapped.seamDrops === 0);
  }

  // 3. Determinism.
  {
    const one = () => JSON.stringify(runPolicy(
      { policy: POLICIES.couraeel(3, 60), night: 7, seed: 3, slackMs: 60 }));
    check('the same seed produced two different nights', one() === one());
  }

  // 4. Observation privilege. A belief policy must not be handed anything a
  //    stock Android screen cannot show: Foxy's D and Balloon Boy's route
  //    stage are the two that would silently make it an oracle.
  {
    let leaked = false;
    const spy = { name: 'spy', version: 0, observation: 'belief',
      step(obs) { if (obs.foxyD !== -1 || obs.bbStage !== -1) leaked = true; } };
    runPolicy({ policy: spy, night: 7, seed: 1 });
    check('belief mode leaked a truth-only field', !leaked);
  }

  // 5. The controls. Each of these SHOULD NOT clear night 7, and a suite that
  //    never checks that cannot tell a working policy from a working engine.
  for (const [key, why] of CONTROLS) {
    const r = sweep(POLICIES[key], { runs: 25, night: 7 });
    check(`control scored on night 7: ${why}`, r.survived === 0, pct(r));
  }

  // 6. Night 1 sanity, the other direction: night 1's AI table cannot arm
  //    Balloon Boy at all and holds Foxy's D at zero, so a baseline that
  //    cannot clear it is failing of its own defects, not of the strategy.
  for (const key of ['minus7', 'shooter25', 'couraeel']) {
    const r = sweep(POLICIES[key], { runs: 25, night: 1 });
    check(`${key} cannot clear night 1`, r.survived >= 22, pct(r));
  }

  if (recordPath) {
    const sourceFiles = ['tools/model/reactive-pilot.mjs', 'tools/cyclesearch.mjs', 'tools/policytest.mjs',
      'tools/policy.mjs', 'tools/policybaselines.mjs', 'packages/source/src/games/fnaf2/plant-model.js',
      'packages/source/src/games/fnaf2/config.js', 'packages/source/src/games/fnaf2/rng.js'];
    const record = {
      schema: 'evidence-record-v1', id: 'policy-baseline-mask-animation-20260927', date: '2026-09-27',
      claimLevel: 'MODEL_ONLY', status: problems.length ? 'FAIL' : 'PASS',
      question: 'Does waiting for the sourced put-on animation repair the inherited Minus 7 policy baseline without weakening its Night 1 sanity assertion?',
      method: { tool: 'tools/policytest.mjs', command: `node tools/policytest.mjs --assert --record ${recordPath}`,
        seedBlock: { definition: '(i * 2246822519) >>> 0, i = 0..24; RNG consumes seed & 0xffff',
          n: 25, design: 25, heldOut: 0 },
        sourceHashes: sourceFiles.map(file => ({ file,
          sha256: createHash('sha256').update(readFileSync(new URL(`../${file}`, import.meta.url))).digest('hex') })),
        replay: 'Same current engine, Night 1, zero jitter and identical 25 design seeds. Only the cycle table differs; mask-off and every following row move three frames later.',
      },
      sourceRule: { maskAnimationInputCommit: '3d5c5f7', maskPutOnFrames: C.MASK_ANIM_ON,
        maskTakeOffFrames: C.MASK_ANIM_OFF, source: 'config.js sprite lengths/speeds and the mask-animation input gate; g267/g270, g10/g11 and g75',
        maskOff: '15 + MASK_ANIM_ON', hallOn: 'maskOff + MASK_ANIM_OFF + 1' },
      before: { cycle: LEGACY_ANIMATION_INVALID_CYCLE, inputControl: beforeInput, wins: beforeWins, n: 25 },
      after: { cycle: DEFAULT_CYCLE, inputControl: afterInput, wins: afterWins, n: 25 },
      rows: timingRows, problems,
      limits: ['This is a 25-design-seed regression diagnostic, not a population or held-out reliability estimate.',
        'Historical jitter curves describe their old baseline/engine and no longer describe DEFAULT_CYCLE. No jitter curve was re-measured here.',
        'The source-driven input controls and the existing Night 1 >=22/25 assertion are both enforced; the assertion was not relaxed.',
        'No device winner, phone run, human-route timing recommendation or promotion changes.'],
    };
    writeFileSync(recordPath, `${JSON.stringify(record, null, 2)}\n`);
    console.log(`${record.id} ${record.status} MODEL_ONLY: ${beforeWins}/25 -> ${afterWins}/25; 25 design / 0 held-out`);
  }
  if (problems.length) {
    console.error('policy adapter and baselines:');
    for (const p of problems) console.error('  FAIL  ' + p);
    process.exitCode = 1;
    return;
  }
  console.log('policy adapter: bbtest-equivalent, zero-error identities hold, ' +
    'belief privilege enforced, all five controls score zero on night 7');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const recordAt = args.indexOf('--record');
  const recordPath = recordAt < 0 ? null : args[recordAt + 1];
  if (recordAt >= 0) {
    if (!recordPath || recordPath.startsWith('--') || !args.includes('--assert'))
      throw new Error('--record FILE requires --assert and an output path');
    args.splice(recordAt, 2);
  }
  const known = ['--assert', '--nights', '--slack', '--actuator', '--deaths'];
  const bad = args.filter(a => !known.includes(a));
  if (bad.length) throw new Error(`unknown argument: ${bad.join(', ')}`);
  if (args.includes('--assert')) { assertSuite(recordPath); }
  else {
    const all = !args.length;
    console.log(`policy comparison -- IN THE SIMULATOR. ${RUNS} seeds a cell, ` +
      `engine ${C.NIGHT_FRAMES} frames.`);
    if (all || args.includes('--nights')) nightsTable();
    if (all || args.includes('--deaths')) deathTable();
    if (all || args.includes('--slack')) slackTable();
    if (all || args.includes('--actuator')) actuatorTable();
  }
}
