// Contract tests for the winner -> device bundle handoff.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { compileBundle, parsePlan, validateBundle } from '../bin/plans/bundle.ts';
import { stableHash } from '@sixam/kernel/contracts';
import { compileArtifactPlans } from '../bin/plans/artifact-commands.ts';
import { makeExecutorRequest } from '../../play/src/campaign/artifact-executor.ts';

const check = (condition, message) => { if (!condition) throw new Error(message); };
const expectFailure = (fn, message) => {
  let failed = false;
  try { fn(); } catch { failed = true; }
  check(failed, message);
};

const root = mkdtempSync(join(tmpdir(), 'fnaf2-device-bundle-'));
try {
  const winner = {
    schema: 'winner-v1', strategy: 'minus-toys', knobs: 'KNOBS0', nights: [2, 7],
    engineHash: 'minus-toys-engine-fixture-v1', seeds: [1, 2],
    profile: 'fixture-hid-screencap',
    gate: { status: 'PASS', claimLevel: 'MODEL_ONLY' },
  };
  const bundlePath = join(root, 'minus-toys');

  // A death-targeting bundle: the gate is honestly not PASS and carries the
  // prediction the run will be read against. Without the prediction it is
  // refused; with it the manifest carries it verbatim.
  const targeted = { ...winner, nights: [6],
    gate: { status: 'DEATH_TARGETED', claimLevel: 'MODEL_ONLY' } };
  expectFailure(() => compileBundle(targeted, join(root, 'targeted-no-prediction')),
    'a DEATH_TARGETED gate without its prediction must be refused');
  const prediction = { schema: 'death-prediction-v1', night: 6, replays: 3000, phasesMs: [0, 500], wins: 0,
    killers: [{ killer: 'foxy', count: 2250, share: 0.75, tSeconds: { min: 50, p10: 80, p50: 150, p90: 170, max: 230 } },
      { killer: 'puppet', count: 750, share: 0.25, tSeconds: { min: 24.7, p10: 26.7, p50: 32.7, p90: 49.7, max: 82.7 } }],
    generatedBy: 'test' };
  expectFailure(() => compileBundle({ ...targeted, gate: { ...targeted.gate, prediction: { ...prediction, replays: 600, killers: [{ ...prediction.killers[0], count: 600 }] } } },
    join(root, 'targeted-short')), 'a death prediction below 3000 replays must be refused');
  expectFailure(() => compileBundle({ ...targeted, gate: { ...targeted.gate, prediction: { ...prediction, wins: 5 } } },
    join(root, 'targeted-sum')), 'a death prediction whose counts do not add up must be refused');
  const targetedPath = join(root, 'targeted');
  check(compileBundle({ ...targeted, gate: { ...targeted.gate, prediction } }, targetedPath).status === 'READY',
    'a DEATH_TARGETED gate with a valid prediction must compile');
  const targetedManifest = JSON.parse(readFileSync(join(targetedPath, 'manifest.json'), 'utf8'));
  check(targetedManifest.gate.status === 'DEATH_TARGETED' && targetedManifest.gate.prediction.killers[0].killer === 'foxy',
    'the manifest must carry the death-targeted gate and its prediction');
  check(validateBundle(targetedPath).plans.length === 1, 'a death-targeted bundle must validate like any other');
  expectFailure(() => compileBundle({ ...winner, gate: { status: 'FAIL' } }, join(root, 'fail-gate')),
    'a plain FAIL gate is still refused');

  // A gate may name the plan it was measured against, because gate.replayHash
  // cannot: that hash is over the MODEL's event traces, so two plans the model
  // scores identically share it. On 2026-09-20 binding h and a copy with the
  // mask coming off 300 ms later -- the exact change the device's five-tick
  // defect turns on -- both hashed fnv1a-c651e2ff.
  const planned = compileBundle(winner, join(root, 'plan-sha-probe'));
  const night2Sha = planned.manifest.plans.find(plan => plan.night === 2).sha256;
  expectFailure(() => compileBundle({ ...winner, gate: { ...winner.gate, planSha256: { 2: night2Sha } } },
    join(root, 'plan-sha-missing-night')),
    'a gate.planSha256 that omits an emitted night must be refused');
  expectFailure(() => compileBundle({ ...winner,
    gate: { ...winner.gate, planSha256: { 2: night2Sha.replace(/^./, c => c === 'a' ? 'b' : 'a'),
      7: planned.manifest.plans.find(plan => plan.night === 7).sha256 } } },
  join(root, 'plan-sha-wrong')),
  'a gate.planSha256 that does not match the emitted plan must be refused');
  const boundPath = join(root, 'plan-sha-bound');
  check(compileBundle({ ...winner, gate: { ...winner.gate,
    planSha256: Object.fromEntries(planned.manifest.plans.map(plan => [plan.night, plan.sha256])) } },
  boundPath).status === 'READY', 'a gate.planSha256 that matches every emitted plan must compile');
  check(validateBundle(boundPath).plans.length === 2,
    'a plan-bound bundle must validate from disk, where the check runs against the re-emission');
  const compiled = compileBundle(winner, bundlePath);
  check(compiled.status === 'READY', 'compiler did not return READY');
  check(readFileSync(join(bundlePath, 'manifest.json'), 'utf8').includes('device-bundle-v1'),
    'manifest was not written');
  check(readFileSync(join(bundlePath, 'night-2.plan'), 'utf8').includes('#loop-start 0'),
    'compiled plan did not receive common timing headers');
  check(readFileSync(join(bundlePath, 'profile.json'), 'utf8').includes('fixture-hid-screencap'),
    'profile was not copied into the bundle');
  const compiledArtifactText = readFileSync(join(bundlePath, 'artifact.json'), 'utf8');
  check(compiledArtifactText.includes('device-artifact-v1') && !compiledArtifactText.includes('"strategy"') &&
    !compiledArtifactText.includes('"policy"'), 'compiled artifact leaked host strategy metadata');
  const ready = validateBundle(bundlePath);
  check(ready.plans.length === 2 && ready.replay.results.length === 4,
    'bundle validator did not replay each selected night and seed');
  check(ready.compiled?.length === 2, 'bundle validator did not return persisted semantic artifact plans');
  check(ready.compiled.every(plan => plan.timing?.periodMs > 0 &&
    plan.timing.stopAtMs >= plan.timing.loopStartMs &&
    plan.timing.observeUntilMs >= plan.timing.stopAtMs),
  'persisted artifact plans did not retain their bounded full-night timing envelope');
  const selected = validateBundle(bundlePath, { night: 7 });
  check(selected.plans.length === 1 && selected.plans[0].night === 7,
    'night selector did not bind to the requested plan');
  const conditioned = compileArtifactPlans(selected.plans, parsePlan, selected.profile);
  const actions = Object.values(conditioned[0].cycles).flatMap((cycle: any) =>
    cycle.blocks.flatMap(block => block.actions));
  check(actions.filter(action => action.control?.startsWith('cam:'))
    .every(action => action.requiresMonitorUp === true),
  'artifact compiler emitted a camera action without an UP precondition');
  check(actions.filter(action => action.control === 'monitor')
    .every(action => typeof action.targetMonitorUp === 'boolean'),
  'artifact compiler retained a parity-only monitor toggle');

  // The campaign target is an all-night target, not a Night 6 + Custom Night
  // special case. Keep one fixture bundle covering the complete 1..7 chain so
  // the emitter/parser/semantic compiler cannot regress to a two-night default.
  const allNightBundle = compileBundle({ ...winner, nights: [1, 2, 3, 4, 5, 6, 7], seeds: [1] },
    join(root, 'all-nights'));
  check(allNightBundle.manifest.nights.join(',') === '1,2,3,4,5,6,7' &&
    allNightBundle.compiled.length === 7,
  'bundle compiler did not bind one semantic plan for every night');

  const cliWinner = join(root, 'winner-input.json');
  const cliBundle = join(root, 'cli-bundle');
  writeFileSync(cliWinner, JSON.stringify(winner) + '\n');
  const cliOutput = execFileSync('node', [join(process.cwd(), 'packages/propose/bin/plans/emit.ts'),
    '--winner', cliWinner, '--out', cliBundle], { encoding: 'utf8' });
  check(cliOutput.includes('device bundle READY') && validateBundle(cliBundle).status === 'READY',
    'device:emit CLI did not create a valid bundle');

  const planPath = join(bundlePath, 'night-2.plan');
  const originalPlan = readFileSync(planPath, 'utf8');
  writeFileSync(planPath, `${originalPlan}#manual-edit\n`);
  expectFailure(() => validateBundle(bundlePath),
    'validator accepted a manually edited plan');
  writeFileSync(planPath, originalPlan);
  check(validateBundle(bundlePath).status === 'READY', 'bundle did not recover after restoring the plan');
  writeFileSync(join(bundlePath, 'artifact.json'), `${compiledArtifactText}\n`);
  expectFailure(() => validateBundle(bundlePath),
    'validator accepted a manually edited compiled artifact');
  writeFileSync(join(bundlePath, 'artifact.json'), compiledArtifactText);
  check(validateBundle(bundlePath).compiled?.length === 2,
    'bundle did not recover after restoring the compiled artifact');

  // The Companion presses the controls file, not a map of its own, so the
  // bundle carries it bound to the profile and the validator re-derives it.
  const controlsPath = join(bundlePath, 'hid-controls.txt');
  const controlsText = readFileSync(controlsPath, 'utf8');
  check(/^#schema hid-controls-v1\n#profile fixture-hid-screencap\n#profile-sha256 [0-9a-f]{64}\n/.test(controlsText) &&
    /^mask \d+ \d+$/m.test(controlsText), 'bundle did not carry the HID controls derived from its profile');
  const planted = JSON.parse(readFileSync(join(bundlePath, 'manifest.json'), 'utf8'));
  writeFileSync(controlsPath, controlsText.replace(/^mask (\d+) /m, (m, x) => `mask ${Number(x) + 1} `));
  expectFailure(() => validateBundle(bundlePath), 'validator accepted a moved control in hid-controls.txt');
  writeFileSync(controlsPath, controlsText);
  check(planted.controls?.sha256 && validateBundle(bundlePath).status === 'READY',
    'bundle did not recover after restoring hid-controls.txt');

  // The manifest's winner hash pins winner.json exactly as the emitter stored
  // it, not the winner after validateWinner fills knob defaults: a default
  // added after a bundle was built must fail the engine-source gate (if it
  // changes the digest) or the plan gate (if it changes the emission), never
  // masquerade as a tampered winner. A real edit to the stored file still does.
  const winnerPath = join(bundlePath, 'winner.json');
  const storedWinnerText = readFileSync(winnerPath, 'utf8');
  const storedManifest = JSON.parse(readFileSync(join(bundlePath, 'manifest.json'), 'utf8'));
  check(stableHash(JSON.parse(storedWinnerText)) === storedManifest.winnerHash,
    'manifest winnerHash must be the hash of the stored winner.json');
  writeFileSync(winnerPath, storedWinnerText.replace('"seeds":[1,2]', '"seeds":[1,3]'));
  let tamperMessage = '';
  try { validateBundle(bundlePath); } catch (error) { tamperMessage = error.message; }
  check(tamperMessage.includes('winner hash does not match manifest'),
    `an edited stored winner must be refused as a winner hash mismatch, got: ${tamperMessage}`);
  writeFileSync(winnerPath, storedWinnerText);
  check(validateBundle(bundlePath).status === 'READY', 'bundle did not recover after restoring the winner');

  const malformed = originalPlan.replace('tap cam11 33', 'tap unsupported 33');
  expectFailure(() => parsePlan(malformed, { strategy: 'minus-toys', night: 2 }),
    'plan parser accepted an unsupported interpreter control');

  // minus7 authors two steady cycles (`clear` and `attack`) and lets the
  // left-opening read choose between them.  The device executor cannot
  // branch -- expandNightBlocks() sends every cycle that is not
  // opening/toys/finish at every period -- so a night whose model can reach
  // `attack` has no faithful single-cycle device form and must be refused
  // rather than compiled into a plan that actuates both on one beat.
  const branchyMinus7 = {
    schema: 'winner-v1', strategy: 'minus7',
    knobs: { night: 6, sweepSlotMs: 120, maskMarginMs: 900, readLatencyMs: 550, hallPulseMs: 130, pilotOffset: 10 },
    planOptions: { deviceSpacingMs: 100, sweepContactMs: 33 }, nights: [6],
    engineHash: 'minus7-engine-fixture-v1', seeds: [1], profile: 'fixture-hid-screencap',
    gate: { status: 'PASS', claimLevel: 'MODEL_ONLY' },
  };
  expectFailure(() => compileBundle(branchyMinus7, join(root, 'minus7-branchy')),
    'minus7 compiled a night whose attack branch the device executor cannot honor');

  // Night 1 is the attack-free night: recipe.ts's idleUntilMs() records that
  // Foxy, BB, Mangle, the Withereds and Golden Freddy never act on it, and the
  // emitted plan's own replay reports detections=0 over seeds 1..3000
  // (2026-09-19), so `clear` is the whole steady schedule.
  const minus7 = compileBundle({
    schema: 'winner-v1', strategy: 'minus7', knobs: {},
    planOptions: { deviceSpacingMs: 100, sweepContactMs: 33 }, nights: [1],
    engineHash: 'minus7-engine-fixture-v1', seeds: [1], profile: 'fixture-hid-screencap',
    attackFreeEvidence: 'night 1 replays detections=0 over seeds 1..3000 (2026-09-19)',
    gate: { status: 'PASS', claimLevel: 'MODEL_ONLY' },
  }, join(root, 'minus7'));
  check(minus7.manifest.plans[0].policy === 'minus7', 'minus7 emitter was not registered');
  const minus7Plan = readFileSync(join(root, 'minus7', 'night-1.plan'), 'utf8');
  check(!minus7Plan.includes('#cycle attack'),
    'the emitted minus7 device plan must carry a single steady cycle');
  // The idle is a shift of the authored opening, and the steady loop starts
  // after it: #loop-start 0 made the phone run the 5 s loop over the 7 s
  // opening, and #idle-until 140000 above #loop-start 0 is the exact shape the
  // campaign refuses as "timing bounds are invalid".
  check(minus7Plan.includes('#idle-until 140000') && minus7Plan.includes('#loop-start 147000'),
    'minus7 night 1 must idle to 2 AM and start its loop after the opening');
  check(minus7Plan.includes('\n140183 tap monitor 33'),
    'minus7 opening rows must be authored on the night timeline, shifted by the idle');

  const minus3 = compileBundle({
    schema: 'winner-v1', strategy: 'minus3', knobs: 'KNOBS0', nights: [3],
    engineHash: 'minus3-engine-fixture-v1', seeds: [1], profile: 'hid-mediaprojection',
    gate: { status: 'PASS', claimLevel: 'MODEL_ONLY' },
  }, join(root, 'minus3'));
  check(minus3.manifest.plans[0].policy === 'minus3', 'minus3 emitter was not registered');
  const minus3Actions = Object.values(minus3.compiled[0].cycles).flatMap((cycle: any) =>
    cycle.blocks.flatMap(block => block.actions));
  check(minus3Actions.some(action => action.compound === 'hallvent' &&
    action.control === 'hallLight' && action.ventControl === 'rightVentLight'),
  'minus3 did not compile the hall/right-vent compound');

  // What crosses into the device executor is the compiled semantic blocks and
  // bound hashes, never the strategy or its plan interpreter. (This was checked
  // through artifact-runner.mjs until that second lane onto the phone was
  // retired on 2026-09-25; the executor request is the boundary itself.)
  const request = makeExecutorRequest({ manifest: ready.manifest, profile: ready.profile,
    compiledPlans: ready.compiled.filter(plan => plan.night === 2), mode: 'dry-run' });
  check(request.schema === 'device-executor-v1', 'executor request lost its schema');
  check(request.blocks.length > 0 && request.blocks.every(block => block.night === 2),
    'executor request did not carry the selected night\'s compiled blocks');
  check(!JSON.stringify(request).includes('"strategy"') && !JSON.stringify(request).includes('"policy"'),
    'the strategy leaked into the executor request');
  expectFailure(() => makeExecutorRequest({ manifest: ready.manifest, profile: ready.profile,
    compiledPlans: ready.compiled, mode: 'machine' }), 'executor request accepted an unknown mode');

  // A phase offset rotates the whole emitted stream against the game's own
  // frame grid, so the replay that gates the winner has to score it. The
  // 2026-09-11 Night 5 bundle shipped `#phase-offset 333` while its replay ran
  // epoch 0: the plan text changed, the replay hash did not, and the winner's
  // `MODEL_ONLY 3000/3000` evidence was re-certified for a stream no census had
  // seen. These two checks are what makes that impossible.
  const phased = { ...winner, nights: [7], phaseOffsetMs: 333 };
  const unphased = { ...winner, nights: [7] };
  const phasedPath = join(root, 'phased');
  const unphasedPath = join(root, 'unphased');
  const phasedBundle = compileBundle(phased, phasedPath);
  const unphasedBundle = compileBundle(unphased, unphasedPath);
  check(readFileSync(join(phasedPath, 'night-7.plan'), 'utf8').includes('#phase-offset 333'),
    'phase offset did not reach the emitted plan');
  check(phasedBundle.replay.hash !== unphasedBundle.replay.hash,
    'replay hash ignored the phase offset: the gate cannot see the rotation it ships');

  // An anchored winner replays at the epoch the anchor delivers, and the
  // manifest carries that epoch so the run script can refuse to run it
  // unanchored. 10 s covers the longest game timer the routes are banded on.
  const anchored = { ...winner, nights: [7], anchorEpochMs: 3850 };
  const anchoredPath = join(root, 'anchored');
  const anchoredBundle = compileBundle(anchored, anchoredPath);
  check(anchoredBundle.replay.hash !== unphasedBundle.replay.hash,
    'replay hash ignored the anchor epoch: the gate cannot see the phase the anchor delivers');
  check(JSON.parse(readFileSync(join(anchoredPath, 'manifest.json'), 'utf8')).anchorEpochMs === 3850,
    'anchor epoch did not reach the manifest');
  let anchorRefusal = '';
  try { compileBundle({ ...winner, nights: [7], anchorEpochMs: 10001 }, join(root, 'anchored-late')); }
  catch (error) { anchorRefusal = error.message; }
  check(anchorRefusal.includes('anchorEpochMs must be an integer in 0..10000'),
    `an anchor epoch past the longest game timer was accepted (${anchorRefusal})`);

  // minus3 and minus7 replay at epoch 0 only. Emitting an offset they cannot
  // score would reopen the same hole through a different strategy.
  // Assert the reason, not just the refusal: this winner also trips the
  // profile's control map, and a test that accepts any error would pass with
  // the phase check deleted.
  let phaseRefusal = '';
  try {
    compileBundle({ ...winner, strategy: 'minus3', nights: [5], knobs: 'KNOBS0',
      engineHash: 'minus3-engine-fixture-v1', phaseOffsetMs: 333 }, join(root, 'minus3-phased'));
  } catch (error) { phaseRefusal = error.message; }
  check(phaseRefusal.includes('minus3 cannot replay a phase offset'),
    `a strategy whose replay cannot evaluate a phase offset still accepted one (${phaseRefusal})`);

  console.log('device bundle: winner-v1 -> manifest/plans/profile, hash+syntax+control+replay validation, and the executor boundary pass');
} finally {
  rmSync(root, { recursive: true, force: true });
}
