// Phone-free contract tests for the Plan 21 winding-tick estimator.
import { EstimatedPhaseClock, LatencyCalibrator, PhaseClockEstimator,
         WindTickFactAdapter, PHASE_STATES } from '@sixam/play/clocks';
import { messageToFact } from '@sixam/kernel/time';

let failures = 0;
const check = (name, condition) => {
  if (!condition) { failures++; console.error(`FAIL ${name}`); }
  else console.log(`ok   ${name}`);
};

const calibration = new LatencyCalibrator({ minSamples: 3 });
calibration.addPair(1000, 1210);
calibration.addPair(1500, 1712);
calibration.addPair(2000, 2208);
const latency = calibration.status();
check('paired calibration is explicit and robust',
  latency.calibrated && latency.latencyMs === 210 && latency.uncertaintyMs >= 2);

const estimator = new PhaseClockEstimator({ latencyCalibration: calibration });
let state;
for (let i = 0; i < 8; i++)
  state = estimator.observe(1210 + i * 500 + (i % 2 ? 3 : -2));
check('six-plus consistent ticks acquire a lock',
  state.state === PHASE_STATES.LOCKED && state.locked);
check('period and drift are estimated from the tick train',
  Math.abs(state.periodMs - 500) < 2 && Math.abs(state.driftPpm) < 4000);
check('independent latency calibration unlocks game-phase claims',
  state.latencyCalibrated && state.gamePhaseKnown && state.uncertaintyMs < 10);

estimator.setParity(1, 'controlled-visual-anchor');
state = estimator.status();
check('500 ms phase does not invent one-second parity',
  state.gridParity === 1 && state.paritySource === 'controlled-visual-anchor');

const uncalibrated = new PhaseClockEstimator();
for (let i = 0; i < 6; i++) state = uncalibrated.observe(i * 500);
check('uncalibrated receipt phase remains usable but not game-known',
  state.locked && !state.gamePhaseKnown && !state.latencyCalibrated);

const uncertain = new PhaseClockEstimator({ minLockTicks: 3, maxResidualMs: 20 });
uncertain.observe(0);
uncertain.observe(500);
uncertain.observe(1000, { confidence: 0.1 });
check('low-confidence peaks do not advance the estimator',
  uncertain.status().sampleCount === 2 && uncertain.status().state === PHASE_STATES.ACQUIRING);
uncertain.observe(1500);
check('a long silence enters STALE instead of preserving a false lock',
  uncertain.status(3001).state === PHASE_STATES.STALE && !uncertain.status(3001).locked);

const clockEstimator = new PhaseClockEstimator({ latencyCalibration: calibration });
for (let i = 0; i < 8; i++) clockEstimator.observe(1210 + i * 500);
clockEstimator.setParity(0, 'controlled-visual-anchor');
const estimated = new EstimatedPhaseClock(clockEstimator, { frameOriginMs: 0, frameRate: 60 });
check('estimated provider converts only calibrated phase + parity to game frames',
  estimated.nextBoundaryFrame(1) === 60 && Math.abs(estimated.periodFrames - 60) < 0.1);
const notReady = new EstimatedPhaseClock(new PhaseClockEstimator(), { frameOriginMs: 0 });
check('estimated provider refuses uncalibrated absolute game phase',
  notReady.nextBoundaryFrame(0) === Infinity);

const factAdapter = new WindTickFactAdapter(
  new PhaseClockEstimator({ latencyCalibration: calibration }));
for (let i = 0; i < 8; i++) {
  const wire = {
    schema: 'fact-message-v1', seq: i, type: 'wind-tick', state: 'OBSERVED',
    value: true, confidence: 1, source: 'bluealsa',
    t_observed: 1210 + i * 500, t_received: 1210 + i * 500,
    latencyMin: 200, latencyMax: 220,
  };
  const fact = messageToFact(wire, 1210 + i * 500);
  factAdapter.observe(fact);
}
check('fact-link wind ticks feed only their timestamped receiver clock',
  factAdapter.status().acceptedCount === 8 && factAdapter.status().estimator.locked);
check('UNKNOWN and unrelated facts do not advance the wind clock',
  factAdapter.observe({ type: 'maskOn', state: 'OBSERVED', value: true,
    confidence: 1, receivedAtMs: 6000 }).reason === 'fact-type-not-wind-tick' &&
  factAdapter.observe({ type: 'wind-tick', state: 'UNKNOWN', reason: 'audio-dropped',
    confidence: 0, receivedAtMs: 6500 }).reason === 'fact-unknown' &&
  factAdapter.status().acceptedCount === 8);
let duplicateRejected = false;
try {
  factAdapter.observe({ type: 'wind-tick', state: 'OBSERVED', value: true,
    confidence: 1, receivedAtMs: 4000 });
} catch { duplicateRejected = true; }
check('out-of-order wind ticks are rejected before estimator mutation', duplicateRejected &&
  factAdapter.status().acceptedCount === 8);

if (failures) process.exit(1);
console.log('phase clock: calibration, lock, parity, confidence, and stale contracts pass');
