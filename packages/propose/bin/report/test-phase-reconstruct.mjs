// Contract tests for the delivered-phase reconstruction.
//
// The numbers are chosen so the answer is known by construction: a prefix of
// 2000 ms, a host that released the parked stream 1000 ms late, and gates that
// each fall a further 50 ms behind. The reconstruction has to recover all
// three from timestamps alone, and has to keep saying UNKNOWN about the one
// interval no recorded quantity measures.
import { reconstruct, lossBands, phoneWallFrom, SCHEMA } from './phase-reconstruct.mjs';

const check = (condition, message) => { if (!condition) throw new Error(message); };
const expectFailure = (fn, message) => {
  let failed = false;
  try { fn(); } catch { failed = true; }
  check(failed, message);
};

const NIGHT_GO = 1_000_000;
const RELEASED = NIGHT_GO + 50;
const ARM_READY_AT_MS = 2000;
const ARM_LAG_MS = 1000;
const ARM_GO_AT = RELEASED + ARM_READY_AT_MS + ARM_LAG_MS;
const GATE_LAGS = [0, 50, 100];

const events = [
  { type: 'hid.schedule-start', startedAt: NIGHT_GO - 9000, actionCount: 297, phaseOffsetMs: 333 },
  { type: 'hid.night-go', at: NIGHT_GO },
  { type: 'hid.night-go-released', at: RELEASED },
  { type: 'arm.verified', attempt: 1, armGoAt: ARM_GO_AT },
  ...GATE_LAGS.map((lag, index) => {
    const gateAtMs = 5533 + index * 10000;
    return { type: 'control.gate', gateAtMs, nextActionId: 'toys-1', status: 'AGREED',
      believedMaskOn: true, observedMaskOn: true, maskEvidence: 'mask-rule',
      reads: [{ startedAt: 0, finishedAt: 1 }],
      reachedAt: ARM_GO_AT + (gateAtMs - ARM_READY_AT_MS) + lag };
  }),
];
const observations = [
  { at: NIGHT_GO - 2400, script: 'lifecycle-observe.py', label: 'state=intro' },
  { at: NIGHT_GO - 400, script: 'lifecycle-observe.py', label: 'state=night' },
  { at: NIGHT_GO + 20000, script: 'lifecycle-observe.py', label: 'state=night' },
  { at: NIGHT_GO + 21800, script: 'lifecycle-observe.py', label: 'state=static' },
];

const report = reconstruct(events, observations);
check(report.schema === SCHEMA, 'reconstruction did not declare its schema');

// The prefix length is recorded nowhere; it is recovered from the first gate,
// whose accumulated lag is zero by construction.
check(report.arm.armReadyAtMs === ARM_READY_AT_MS,
  `prefix length not recovered (${report.arm.armReadyAtMs})`);
check(report.arm.lagMs === ARM_LAG_MS,
  `arm release lag not recovered (${report.arm.lagMs})`);

// The delivered offset is the plan's own rotation plus everything delivery
// added to it. This is the quantity the bundle never states.
check(report.cycles.map(cycle => cycle.deliveredOffsetMs).join(',') === '1333,1383,1433',
  `delivered offsets wrong (${report.cycles.map(cycle => cycle.deliveredOffsetMs).join(',')})`);
check(report.cycles.map(cycle => cycle.gateLagMs).join(',') === GATE_LAGS.join(','),
  'per-gate lag was not separated from the arm release lag');
check(report.deliveredOffsetMs.first === 1333 && report.deliveredOffsetMs.last === 1433,
  'delivered offset summary did not span the run');

// The interval between the game's first night frame and the classifier calling
// it is not measured by anything in the bundle. It must stay UNKNOWN and carry
// its bracket, never a plausible number.
check(report.origin.errorVersusFirstNightFrameMs === 'UNKNOWN',
  'reconstruction invented an origin error the bundle cannot measure');
check(report.origin.bracketedByMs === 2000,
  `origin bracket wrong (${report.origin.bracketedByMs})`);
check(report.origin.priorSampleLabel === 'state=intro',
  'origin bracket did not name the sample that precedes it');

// The end of the night is bracketed by the classifier's own cadence, and the
// dump attributes nothing.
check(report.terminal.bracketMs === 1800 && report.terminal.terminalLabel === 'state=static',
  'terminal bracket wrong');
check(report.terminal.attribution === 'UNKNOWN',
  'reconstruction claimed a death attribution the frames cannot support');

// A run that never reached a night has no origin to reconstruct, and saying so
// is the answer -- not a reconstruction anchored to the shell spawn.
expectFailure(() => reconstruct([{ type: 'hid.schedule-start', actionCount: 1 }], []),
  'reconstruction accepted a run that never reached a night');

// Loss bands are contiguous runs of zero-win phases, reported with the mask
// tick count that explains them.
const bands = lossBands([
  { epochMs: 0, wins: 10, maskTicks: 5 },
  { epochMs: 100, wins: 0, maskTicks: 4 },
  { epochMs: 200, wins: 0, maskTicks: 4 },
  { epochMs: 300, wins: 10, maskTicks: 5 },
  { epochMs: 400, wins: 0, maskTicks: 4 },
]);
check(bands.length === 2 && bands[0].fromMs === 100 && bands[0].toMs === 300 &&
  bands[0].maskTicks === 4 && bands[1].fromMs === 400 && bands[1].toMs === 1000,
'loss bands did not close on the phase grid');

// --- the two wall clocks ----------------------------------------------------
//
// Real numbers from night6-c2-01-20260917T021417Z. The host wall clock sat
// 1374.8 ms ahead of the phone's, so `releasedAt` (host wall) and the office
// seed read out of logcat (phone wall) are not comparable until converted. A
// press reconstruction that skipped the conversion placed the schedule 1.37 s
// late, and the model scored the winning route as killing every seed.
const ANCHOR = { type: 'origin.anchor', status: 'scheduled', aimMs: 4870, maxK: 0,
  offsetMs: -941663594.474785, wallMinusHostMs: 1789611259780.0422,
  phoneWallMinusMonoMs: 1788669594810.7449,
  onsetPhoneWallMs: 1789611303278.1782, onsetPhoneWallLow16: 24942 };
const SEED_PHONE_WALL_MS = 1789611303187;    // office-seed-bracket, low16 24851

const skewed = phoneWallFrom(ANCHOR, { released: 1789611309534, nightGoAt: 1789611309524 });
check(Math.abs(skewed.hostWallMinusPhoneWallMs - 1374.823) < 0.01,
  `host-minus-phone skew wrong: ${skewed.hostWallMinusPhoneWallMs}`);
check(Math.abs((skewed.releasedAtPhoneWallMs - SEED_PHONE_WALL_MS) - 4972.178) < 0.01,
  `converted origin wrong: ${skewed.releasedAtPhoneWallMs - SEED_PHONE_WALL_MS}`);
check(skewed.onsetPhoneWallLow16 === 24942 && skewed.basis === 'origin.anchor',
  'the anchor onset it carries forward is wrong');
// The unconverted stamp is the trap the block exists to close.
check(1789611309534 - SEED_PHONE_WALL_MS === 6347,
  'the unconverted origin is no longer 6347 ms; the fixture drifted');

check(phoneWallFrom(undefined, { released: 1, nightGoAt: 1 }) === null,
  'a run without an anchor must report no phone-wall block, not a guess');
check(phoneWallFrom({ ...ANCHOR, wallMinusHostMs: 'UNKNOWN' }, { released: 1, nightGoAt: 1 }) === null,
  'a non-finite anchor field must refuse, not coerce');

const withAnchor = reconstruct([...events, ANCHOR], observations);
check(withAnchor.origin.clock === 'host-wall', 'the origin block must name its clock');
check(withAnchor.origin.phoneWall?.hostWallMinusPhoneWallMs === skewed.hostWallMinusPhoneWallMs,
  'reconstruct did not carry the phone-wall conversion into the origin block');
check(reconstruct(events, observations).origin.phoneWall === null,
  'without an anchor the origin block must carry phoneWall: null');

console.log('device phase reconstruction: prefix, arm release lag, per-cycle lag, ' +
  'bracketed origin, host/phone wall skew, and refusals pass');
