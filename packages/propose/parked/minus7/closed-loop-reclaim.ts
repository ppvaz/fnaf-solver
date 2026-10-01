// What the live runner's closed loop reclaims from the measured actuator.
//
// plans/12 left one number unmeasured and said so: the shipped route is
// 23/200 on Night 1 and 0/200 on Nights 2-7 through `packages/play/bin/phone/actuator.mjs`,
// and "the live runner's checkpoint read and verified recovery are the untested
// variable... how much of the gap is recoverable is currently unmeasured".
// `MonitorSupervisor` now models that loop -- the flip gate, the classifier's
// `cams=UP-DESYNCED` question, the verified recovery, and the `desyncs -le 12`
// abort -- so this file measures the delta, at the same seeds, night by night.
//
// Every number printed here is a simulator number. The actuator prices launch
// lateness and the mask seam; the supervisor prices what the shell then does
// about them. Neither is the phone.
//
//   node packages/propose/parked/minus7/closed-loop-reclaim.ts                 # the reclaim table
//   node packages/propose/parked/minus7/closed-loop-reclaim.ts --controls      # the controls, night 6
//   node packages/propose/parked/minus7/closed-loop-reclaim.ts --runs=500
import { pathToFileURL } from 'node:url';
import { run as hidRun } from './hid-device-pilot.mjs';
import { run as pilotRun } from './stock-device-pilot.ts';

// `hidpilot n6 target` in tools/test.ts, which is the route plans/12 priced.
export const N6_TARGET = {
  bbMode: 'left', deviceSweep: true, pulseLight: true, sweepSlotMs: 120,
  maskMarginMs: 900, readLatencyMs: 480, hallPulseMs: 83,
  pilotOffset: Math.round(167 * 60 / 1000), prophylacticMask: true,
};

export const NIGHTS = [1, 2, 3, 4, 5, 6, 7];
const seedOf = (i) => (i * 2246822519) >>> 0;

// A night the runner aborts (`exit 48`) is not a night that survived, however
// the simulator's clock ends. This is the one place the loop can make things
// worse without the engine noticing.
export function trial(night, seed, closedLoop, deviceActuator = true) {
  const r = hidRun({ ...N6_TARGET,
    deviceActuator: deviceActuator ? (closedLoop ? { closedLoop } : true) : false,
    sim: { seed, night } });
  const loop = r.actuator && r.actuator.loop;
  return {
    won: r.sim.won && !(loop && loop.aborted),
    aborted: Boolean(loop && loop.aborted),
    reason: r.sim.won ? (loop && loop.aborted ? 'runner-abort' : null) : r.sim.death.reason,
    gateReads: loop ? loop.gateReads : 0,
    gateCorrections: loop ? loop.gateCorrections : 0,
    gateFalse: loop ? loop.gateFalse : 0,
    checkpointFalse: loop ? loop.checkpointFalse : 0,
    desyncs: loop ? loop.checkpointDesyncs : 0,
    presses: loop ? loop.recoveryPresses : 0,
    frames: r.sim.frame,
  };
}

export function cohort(night, runs, closedLoop, deviceActuator = true) {
  const acc = { won: 0, aborted: 0, gateReads: 0, gateCorrections: 0,
                gateFalse: 0, checkpointFalse: 0,
                desyncs: 0, presses: 0, frames: 0, reasons: new Map() };
  for (let i = 0; i < runs; i++) {
    const t = trial(night, seedOf(i), closedLoop, deviceActuator);
    if (t.won) acc.won++;
    if (t.aborted) acc.aborted++;
    acc.gateReads += t.gateReads; acc.gateCorrections += t.gateCorrections;
    acc.gateFalse += t.gateFalse; acc.checkpointFalse += t.checkpointFalse;
    acc.desyncs += t.desyncs; acc.presses += t.presses; acc.frames += t.frames;
    if (t.reason) acc.reasons.set(t.reason, (acc.reasons.get(t.reason) || 0) + 1);
  }
  return acc;
}

// The `--vent --sync` pilot, which plans/12 named as the reference. It is not
// the runner: its `up`/`down` intents read the monitor state at any moment, in
// both directions, and repair it with no observation cost -- three things
// `trial.sh` cannot do.
//
// It is printed beside `--vent`, the SAME route with the resync removed,
// because plans/12's "it is the open loop, not the phone" compared
// `--vent --sync` against the HID route and so changed the route as well as the
// loop. Run both and the resync turns out to be worth almost nothing; the
// tolerance belongs to the schedule.
export function syncCohort(night, runs, deviceActuator, sync = true) {
  let won = 0;
  for (let i = 0; i < runs; i++) {
    const r = pilotRun({ vent: true, sync, deviceActuator,
      sim: { seed: seedOf(i), night } });
    if (r.sim.won) won++;
  }
  return won;
}

const top = (reasons) => [...reasons.entries()].sort((a, b) => b[1] - a[1])
  .slice(0, 2).map(([k, v]) => `${k} ${v}`).join(', ') || '-';

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const arg = (name, def) => {
    const v = (process.argv.find(a => a.startsWith(`--${name}=`)) || '').split('=')[1];
    return v === undefined ? def : +v;
  };
  const runs = arg('runs', 200);

  if (process.argv.includes('--controls')) {
    const night = arg('night', 6);
    // Each control is a way the loop could be flattering itself. The first two
    // must NOT help; the third must be able to hurt.
    const cases = [
      ['open loop (no supervisor)', null],
      ['shipped loop', {}],
      ['CONTROL classifier always wrong', { errorRate: 1 }],
      ['CONTROL reads kept, correction removed', { correct: false }],
      // Two ways of putting the sample inside the flip it is checking, which is
      // the sourced night 6-38 hazard. `gateWaitMs` alone cannot do it: the
      // shell reaches `light_down_at` 360 ms into the cycle and a `wait_until`
      // already in the past returns at once, so the read never moves earlier
      // than the plan's own read position.
      ['CONTROL gate wait cut to 100 ms (cannot move the read earlier)', { gateWaitMs: 100 }],
      ['CONTROL cams read as up for 600 ms after the press', { cueAnimUpMs: 600 }],
      ['CONTROL no confirming second read', { confirmRead: false }],
      ['CONTROL flip gate only (no classifier checkpoint)', { checkpoint: false }],
      ['CONTROL checkpoint only (no flip gate)', { gate: false }],
      ['CONTROL anim window anchored to the landing', { animAnchor: 'land' }],
      ['BOUND free instant bidirectional resync (not the runner)', { idealResync: true }],
    ];
    console.log(`night ${night}, ${runs} seeds, measured actuator -- in the simulator`);
    for (const [label, loop] of cases) {
      const a = cohort(night, runs, loop);
      console.log(`  ${String(a.won).padStart(3)}/${runs}  ${(label as any).padEnd(52)}` +
        ` reads ${String(a.gateReads).padStart(6)}` +
        ` corrections ${String(a.gateCorrections).padStart(5)}` +
        ` corr-on-a-down-monitor ${String(a.gateFalse + a.checkpointFalse).padStart(5)}` +
        ` desyncs ${String(a.desyncs).padStart(4)}` +
        ` aborts ${String(a.aborted).padStart(3)}` +
        `  alive ${(a.frames / runs / 60).toFixed(1)}s  ${top(a.reasons)}`);
    }
    process.exit(0);
  }

  console.log(`the closed-loop reclaim, ${runs} seeds a night -- every figure in the simulator`);
  console.log('night | exact | actuator open | actuator + loop | reclaim | ' +
    'other route: --vent / --vent --sync | gate corrections | checkpoint desyncs | ' +
    'aborts | mean alive (open -> loop)');
  for (const night of NIGHTS) {
    const exact = cohort(night, runs, null, false);
    const open = cohort(night, runs, null);
    const closed = cohort(night, runs, {});
    const refPlain = syncCohort(night, runs, true, false);
    const ref = syncCohort(night, runs, true, true);
    console.log(
      `${String(night).padStart(5)} | ${String(exact.won).padStart(5)} | ` +
      `${String(open.won).padStart(13)} | ${String(closed.won).padStart(15)} | ` +
      `${String(closed.won - open.won).padStart(7)} | ` +
      `${String(refPlain).padStart(16)} / ${String(ref).padStart(4)} | ` +
      `${String(closed.gateCorrections).padStart(16)} | ${String(closed.desyncs).padStart(18)} | ` +
      `${String(closed.aborted).padStart(6)} | ` +
      `${(open.frames / runs / 60).toFixed(1)}s -> ${(closed.frames / runs / 60).toFixed(1)}s`);
  }
}
