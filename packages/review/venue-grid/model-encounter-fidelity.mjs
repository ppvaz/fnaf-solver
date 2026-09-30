#!/usr/bin/env node
// Assemble the 2026-09-27 encounter study from its retained derived outputs.
// No phone, media decode or simulation is performed by this report command.
// node packages/review/venue-grid/model-encounter-fidelity.mjs INPUT_DIR OUT.json
// INPUT_DIR is artifacts/forensics/encounter-fidelity-20260927 (private inputs).
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { score } from './encounter-replay.mjs';

// Paths are written relative to this checkout's root, whatever the directory is called.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const repoRel = p => (p && isAbsolute(p) && !relative(ROOT, p).startsWith('..')) ? relative(ROOT, p) : p;

const [input, output] = process.argv.slice(2);
if (!input || !output) throw new Error('usage: model-encounter-fidelity.mjs INPUT_DIR OUT.json');
const sources = [];
const hashFile = p => createHash('sha256').update(readFileSync(p)).digest('hex');
const read = (name) => {
  const bytes = readFileSync(join(input, name));
  sources.push({ file: name, sha256: createHash('sha256').update(bytes).digest('hex') });
  return JSON.parse(bytes);
};
const base = read('out-baseline-reviewed.json');
const gated = read('out-gated-reviewed.json');
const cam8 = read('out-cam8-reviewed.json');
const rollResolution = read('out-rollres-reviewed.json');
const old = read('enc-old.json');
const current = read('enc-new.json');
const night7 = read('out-night7-reviewed.json');
const census = read('wc-gated-3000.json');
const phoneCounts = { nights: base.out.length, read: 0, occupied: 0, byCharacter: { B: 0, C: 0, F: 0 } };
const compactRow = (row, phone) => ({
  seed: row.seed, won: row.won, death: row.death, endMs: row.endMs,
  windows: row.w, windowStartMs: row.windowStartMs, score: score(phone, row.w),
  movementHops: row.hopCount, firstDepartureFromCam8Ms: row.leaveCam8,
  bbInsideMs: row.bbIn, officeEntries: row.insides,
});
const nights = base.out.map((night) => {
  const cfg = base.cfg.nights.find(n => n.name === night.name);
  for (const c of night.phone) {
    if (c === '?') continue;
    phoneCounts.read++;
    if (c !== '.') { phoneCounts.occupied++; phoneCounts.byCharacter[c]++; }
  }
  const path = p => repoRel(p)?.replace(/^.*\/scratchpad\//, 'artifacts/forensics/encounter-fidelity-20260927/');
  const baseline = night.rows.map(r => compactRow(r, night.phone));
  return {
    name: night.name, phoneWindows: night.phone,
    clock: cfg.trace ? 'retained native-frame trace with the original catch-up rule' : 'MODEL_ONLY constant 60 Hz; not a seed-equivalent phone replay',
    inputs: { presses: path(cfg.presses), pressesSha256: hashFile(cfg.presses),
      trace: path(cfg.trace) ?? null, traceSha256: cfg.trace ? hashFile(cfg.trace) : null,
      firstNightFrameIndex: cfg.first ?? null },
    seeds: cfg.seeds, baseline,
    gated: gated.out.find(n => n.name === night.name).rows.map(r => compactRow(r, night.phone)),
    cam8: cam8.out.find(n => n.name === night.name)?.rows.map(r => compactRow(r, night.phone)) ?? 'NOT_RUN',
    rollResolution: rollResolution.out.find(n => n.name === night.name)?.rows.map(r => compactRow(r, night.phone)) ?? 'NOT_RUN',
  };
});
const populations = {};
for (const name of ['base-tw04', 'base-c201', 'base-slh', 'xcam8-tw04', 'gated-tw04',
  'sub-xMask', 'sub-xFoxy', 'sub-xStreak', 'sub-xOther', 'd-stale', 'd-rollres', 'd-roll2n',
  'd-delay20000', 'd-delay30000', 'd-delay40000']) {
  const row = read(`pop-${name}.json`);
  populations[name] = { options: row.opts, night: row.night, ...row.stats };
}
const ownSeedNulls = {};
for (const name of ['base', 'rollres', 'gated']) ownSeedNulls[name] = read(`ownseed-${name}.json`);
const lanes = {};
for (const name of ['n3v-4551-off', 'n3v-4551-on', 'n34-5051-n3-on',
  'n5-phase-off', 'n5-phase-on', 'm5p-phase-off', 'm5p-phase-on']) {
  const lane = read(`lane-${name}.json`);
  lanes[name] = { night: lane.night, options: lane.extra, rows: lane.rows };
}
const tw04 = nights.find(n => n.name === 'tw-04');
const reproduced = old.rows.every((r, i) => r.w === current.rows[i].w && r.hall === current.rows[i].hall);
if (!reproduced) throw new Error('the historical and current encounter replay no longer agree');
const record = {
  schema: 'evidence-record-v1', id: 'model-encounter-fidelity-20260927', date: '2026-09-27',
  claimLevel: 'MODEL_ONLY; phone reads are reused DEVICE_MEASURED historical observations, not new measurements',
  question: 'Do sourced countdown and movement-order corrections close the occupied-mask-window gap, and do gated countdowns expose the short BB/Mangle mask-window hazard?',
  verdict: 'S2 remains OPEN. The tw-04 reproduction remains 2/11 and 1/11 at its bracket seeds after the mask-animation input change. Gated Every timers expose short-mask BB/Mangle failures, but do not improve those encounter hits; their lower total occupancy is largely early death. Keep the option default off.',
  method: {
    tool: 'packages/review/venue-grid/model-encounter-fidelity.mjs',
    command: 'node packages/review/venue-grid/model-encounter-fidelity.mjs artifacts/forensics/encounter-fidelity-20260927 docs/evidence/model-encounter-fidelity-20260927.json',
    replayTool: 'packages/review/venue-grid/encounter-replay.mjs',
    replayCommand: 'node packages/review/venue-grid/encounter-replay.mjs CONFIG.json OUT.json',
    historicalTool: 'artifacts/forensics/twin-nights-night6-cohort2/win-score.mjs',
    historicalRecord: 'docs/evidence/model-encounter-fidelity-20260918.json',
    baseCommit: census.method.git.commit,
    modelSha256: hashFile(new URL('../../source/src/games/fnaf2/plant-model.js', import.meta.url)),
    runtimeSource: {
      localPath: '~/fnaf-apks/fnaf2/base.apk!classes.dex',
      sha256: 'ca5c98a4d6ceefc3e0efe542695762263b87e73ca7e3956e3c688177d4c0d8a3',
      reader: '~/fnaf-apks/fnaf2-recompile-20260927/dex/dexread4.py',
      countdown: 'CND_EVERY2.eva2 offsets 7..46 load value and mark value2, then return false; 47..56 subtract rhTimerDelta on later reaches; 77..90 add the period back and return true when nonpositive.',
      conditionOrder: 'CEventProgram.computeEventList offsets 59..84 stop the ordinary condition loop on a false eva2 result. Thus an Every after mask==2 is not reached while the mask condition is false.',
      verification: 'Read directly on 2026-09-27; the extracted dex hash matches classes.dex streamed from the source APK. Existing passEvery and frame-time-hook contracts exercise the countdown convention.',
    },
    dump: { localPath: '~/fnaf-apks/fnaf2/events/03-04-Office.txt',
      sha256: '026ee3861642abb24a0961d590d8e3d708c9417ec143b92aacb73d6c0415b23b',
      groups: [293, 294, 333, 343, 380, 385, 401, 440, 570, 722, 785, 786, 824, 825, 904, 907], publishing: 'Derived rules only; no dump, frames or recording is published.' },
    options: base.opts,
    replay: 'Original press schedule and constructor seed adjustment; each trace interval is split into at most three catch-up loops, with 1 ms continuation loops. The same seed set and clock are used within each ablation.',
    scoring: 'One character per accepted mask-on window, the first active blackout character in its first 1500 ms. B/C/F are Withered Bonnie/Chica/Freddy; dot requires a fully observed empty window, question mark is unread or UNKNOWN. Missing model windows after death and terminally truncated empty windows are UNKNOWN: excluded from comparedRead and agreeRead, retained as misses in occupied-window hits. Bracket candidates are separate replays, not independent phone nights.',
    alignmentLimit: 'The score pairs accepted model mask windows with phone-read windows by ordinal position. Model windowStartMs are retained, but phone strings are not a complete timestamped accepted-input ledger. A differently accepted/rejected mask press can shift later ordinal pairs; these scores alone do not establish time-aligned encounter equivalence.',
    nullSeeds: { n: 1202, definition: 'Python random.seed(7); random.sample(range(65536), 1202)', purpose: 'Exploratory null and density comparisons; not a quoted reliability rate or an S3 population census.' },
    densityCaution: 'Per-window expectations from tw-04 are also pooled over nine nights\' read positions as a sensitivity estimate. That pooling is not nine independent traced-clock population replays.',
    ownSeedNullCaution: 'Combined own-seed/null comparisons include c2-01\'s untraced 60 Hz replay; they do not establish phone-seed agreement. The null counts occupied hits only, so post-death empty-padding did not affect those hit counts.',
    diagnosticSources: ['pop.py', 'ownseed.py', 'lane.mjs', 'make_sub.py', 'patch_m.py', 'diagnostic-replay.mjs',
      'diagnostic-sub-plant-model.js', 'diagnostic-cam8-plant-model.js'].map(file => ({
        file: `artifacts/forensics/encounter-fidelity-20260927/${file}`, sha256: hashFile(join(input, file)),
      })),
    diagnosticReproduction: 'Exploratory drivers and both diagnostic model snapshots are retained privately by hash. The historical drivers use local scratch paths that must be rebound before re-running; they are not installed production options. The committed replay command covers the baseline and gated option.',
    artifacts: 'artifacts/forensics/encounter-fidelity-20260927/',
    sources,
  },
  reproduction: { historicalRevision: '4c31a2e', currentRevision: census.method.git.commit,
    maskAnimationCommit: '3d5c5f7', identicalWindowsAndHallReads: reproduced,
    phoneWindows: tw04.phoneWindows, rows: tw04.baseline,
    offsetFit: { range: [-300, 300], atZero: [2, 1], best: [{ seed: 24883, hits: 8, offsets: [-193, -3] }, { seed: 24884, hits: 8, offsets: [57] }],
      null: populations['base-tw04'].nullHits, conclusion: 'The offset fit remains at chance; no seed offset closes the gap.' },
  },
  night7Reproduction: {
    claimLevel: 'MODEL_ONLY replay of retained DEVICE_MEASURED traces; no new phone run',
    options: night7.opts,
    rows: night7.out.map(n => {
      const cfg = night7.cfg.nights.find(c => c.name === n.name);
      return { name: n.name, firstNightFrameIndex: cfg.first,
        presses: repoRel(cfg.presses), pressesSha256: hashFile(cfg.presses),
        trace: repoRel(cfg.trace), traceSha256: hashFile(cfg.trace),
        ...compactRow(n.rows[0], null) };
    }),
    verdict: 'The prior discrepancy reproduces: full-04-k3 seed 34043 dies inside-office at 174499 ms; full-06-k3 seed 47593 dies inside-office at 294544 ms although that phone night won. No new equivalence claim or seed-offset fit is made.',
  },
  phoneCounts, nights, populations, ownSeedNulls,
  ablations: [
    { name: 'mask-animation input rejection', sourced: true, implementation: '3d5c5f7', verdict: 'No change: historical window and hall strings reproduce byte for byte.' },
    { name: 'Night 6 AI table and five-second opportunity cadence', sourced: true,
      checkedGroups: [333, 334, 335, 683, 684],
      witheredAi: { midnight: 5, twoAm: 10, characters: ['withfreddy', 'withbonnie', 'withchica'] },
      roll: 'Each Withered group has Every 5000 first, followed by Random(20)+1 <= AI: success probabilities 5/20 then 10/20. The timers are reached regardless of the later random outcome.',
      verdict: 'These rows match config.js. No changed AI table retained: the source does not justify tuning away the excess. No new parameter fit is promoted.' },
    { name: 'CAM 08 ordering and cross-character roll reset (g380/g385)', sourced: true, scratchOnly: true,
      population: 'xcam8-tw04', verdict: 'Mean occupied windows 16.85 → 16.54; first-window median stays 7. Some own-seed matches move, but the excess survives. Not retained as a production option.' },
    { name: 'consume stale pending movement on a resolved roll', sourced: true, scratchOnly: true,
      populations: ['d-stale', 'd-rollres'], verdict: 'Clearing the stale pending flag barely changes population density; combining CAM 08 ordering still leaves the excess. Not retained as a production option.' },
    { name: 'load consumes the first five-second roll', sourced: false, scratchOnly: true,
      population: 'd-roll2n', verdict: 'Diagnostic only, inconsistent with the already sourced first-evaluation countdown semantics. It does not close the occupancy gap.' },
    { name: 'delay Withered movement by 20/30/40 seconds', sourced: false, scratchOnly: true,
      populations: ['d-delay20000', 'd-delay30000', 'd-delay40000'], verdict: 'Delays can move the first encounter later but retain excess late occupancy. No source supports these fitted delays; not implemented in the model.' },
    { name: 'gated Every countdowns', sourced: true, option: 'sourcedGatedEvery', default: false,
      population: 'gated-tw04', verdict: 'tw-04 occupied hits stay 2/11 and 1/11. Only 480 of 1202 exploratory null replays reach 6 AM; mean occupied windows falls to 11.70 because many nights terminate. This is not improved encounter fidelity.' },
    { name: 'split gated countdowns', sourced: true, scratchOnly: true,
      populations: ['sub-xMask', 'sub-xFoxy', 'sub-xStreak', 'sub-xOther'],
      verdict: 'The mask-counter component reproduces nearly all new deaths (484/1202 reach 6 AM); Foxy-only, streak-only and other timers each retain 1202/1202. This localizes the short-mask hazard, not the Withered excess.' },
  ],
  maskWindowFinding: {
    rule: 'g907 follows mask == 2. Its countdown is reached only while the mask is fully on, loads on first reach, and keeps its remainder between holds. Value 12 is reset each new hold (g293). A 4551 ms hold can therefore contain four or five fires regardless of wall-clock phase; a long-enough hold guarantees five.',
    correction: 'The baseline already produces BB vent arrivals (3240 in the Night 3 diagnostic). At its nominal phase the global-grid approximation clears every one. Gating the timer exposes 804 BB-inside events and 803 Foxy deaths on the same 3000 seeds.',
    night3: { shortHoldMs: 4551, shortOffWins: 3000, shortOnWins: 2197, n: 3000, longHoldMs: 5051, longOnWins: 3000,
      shortBinding: 'diagnostic copy of campaign-toys-nights3-4-winner.json with maskOffMs=9200; not a committed winner' },
    night5: { binding: 'tools/device/campaign-night5-toys-n5-winner.json', shortHoldMs: 4551,
      shortOnWinsAtDeclaredPhase: 317, n: 3000,
      phaseScan: '300 seeds per phase, epoch 0..900 ms in 100 ms increments: exploratory cells, not separate 3000-seed rates.',
      longBinding: 'tools/device/campaign-night5-mask5plus-winner.json', longHoldMs: 5111,
      longOnWinsAtDeclaredPhase: 3000,
      phoneContext: 'Parent session supplied two 2026-09-27 toys-n5 losses, visually attributed to BB and Mangle. Those attributions and the mechanism are not newly device-validated by this host study.' },
    lanes,
  },
  census: { ...census, limitation: 'Seeds 0..2999 are all in the design block. This 3000-seed option comparison has ZERO held-out seeds and is not an exhaustive population census. Default census records are unchanged.' },
  limits: [
    'S2 is not closed; default-off gated timers do not explain the Withered Chica/Freddy encounter excess.',
    'The gated option changes timing semantics inside the hand model, not every source condition or complete event-sheet ordering.',
    'The model still increments mask counters only while an occupant is at marker 122. The dump increments all three counters from hold start; Toy Chica can arrive mid-hold.',
    'The existing g825 opening guard includes all modeled opening occupants; the source names only BB and three vent toys. That guard is not corrected by this option.',
    'Only four of the nine phone-read Night 6 inputs have retained frame traces; the others use 60 Hz and cannot prove own-seed encounter equivalence.',
    'Private frames and old recordings are not republished. Historical phone reads are reused; no new phone run, measurement or promotion occurred.',
    'The prior Night 7 traced-night discrepancy remains open; this record makes no new Night 7 traced-clock equivalence claim.',
    'A full or held-out census under the gated option and a same-phase traced phone validation remain open.',
  ],
  gates: ['packages/source/test/gated-every.test.js', 'tools/test-encounter-fidelity.mjs'],
};
writeFileSync(output, `${JSON.stringify(record, null, 2)}\n`);
console.log(`${record.id}: tw-04 2/11 and 1/11 unchanged; short-mask BB/Mangle hazard reproduced MODEL_ONLY; S2 OPEN; census ${census.bindings.length} night-bindings, 3000 design / 0 held-out seeds`);
