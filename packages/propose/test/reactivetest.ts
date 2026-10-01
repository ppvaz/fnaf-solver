// Plan 19 package 1 gate: the observation model and the reactive controller.
//
//   node packages/propose/test/reactivetest.ts            # all checks
//   node packages/propose/test/reactivetest.ts --assert   # exit 1 on any failure (suite mode)
import { pathToFileURL } from 'node:url';
import * as C from '@sixam/source/fnaf2';
import { Sim } from '@sixam/source/fnaf2';
import { Observer, OBSERVE_INTERVAL, val } from '@sixam/play/sim';
import { BlackoutReactive, guardIntents, GUARD_FRAMES } from '@sixam/propose/fnaf2';
import { formatRate } from '../../review/src/stat.ts';

let failures = 0;
const ok = (group, what, cond) => {
  if (!cond) { failures++; console.error(`FAIL  ${group}: ${what}`); }
  else console.log(`ok    ${group}: ${what}`);
};
const near = (a, b, tol) => Math.abs(a - b) <= tol;

// --- 1. Observer: facts are OBSERVED/UNKNOWN, mid-animation refuses -----------
{
  const s = new Sim({ seed: 1, night: 1 });
  const obs = new Observer({ interval: 1 });

  // frame 0, monitor down, nothing happening
  let f: any = obs.read(s);
  ok('observer', 'a fact is {state,...} never a bare value',
    f.blackout.state === 'OBSERVED' && typeof f.blackout.value === 'boolean');
  ok('observer', 'monitor-down: the opening is in view',
    f.leftOpening.state === 'OBSERVED');
  ok('observer', 'monitor-down: the box feed is not on screen',
    f.boxPie.state === 'UNKNOWN' && f.boxPie.reason === 'box-not-on-screen');

  // raise the monitor -- mid-animation the monitor fact must refuse
  s.press('monitor');
  s.tick();
  f = obs.read(s);
  ok('observer', 'mid monitor animation -> monitorUp UNKNOWN',
    f.monitorUp.state === 'UNKNOWN' && f.monitorUp.reason === 'monitor-animating');
  ok('observer', 'mid monitor animation -> leftOpening UNKNOWN',
    f.leftOpening.state === 'UNKNOWN');

  // let it finish
  for (let i = 0; i < C.MONITOR_ANIM_UP + 2; i++) s.tick();
  f = obs.read(s);
  ok('observer', 'monitor up, settled -> monitorUp OBSERVED true',
    f.monitorUp.state === 'OBSERVED' && f.monitorUp.value === true);

  // The source-level glitch is two simultaneous camera facts: the marker is
  // parked on CAM 09 while the viewed feed remains CAM 11. A singular camera
  // fact must refuse, while the complete highlight set remains actionable for
  // an arming verifier.
  s.cam = 9;
  s.viewing = 11;
  s.tick();
  f = obs.read(s);
  ok('observer', 'split camera arm preserves the exact highlighted pair',
    f.cameraHighlights.state === 'OBSERVED' &&
    JSON.stringify(f.cameraHighlights.value) === JSON.stringify(['cam:9', 'cam:11']) &&
    f.cameraSelected.state === 'UNKNOWN' &&
    f.cameraSelected.reason === 'multiple-camera-highlight');
}

// --- 2. Observer: cadence, latency, drops ------------------------------------
{
  const s = new Sim({ seed: 2, night: 1 });
  const obs = new Observer({ interval: OBSERVE_INTERVAL });
  const first = obs.read(s);
  const firstFrame = first.frame;
  s.tick();  // one frame later, inside the interval
  ok('observer', 'no re-read inside OBSERVE_INTERVAL', obs.read(s).frame === firstFrame);
  for (let i = 0; i < OBSERVE_INTERVAL; i++) s.tick();
  ok('observer', 're-reads after OBSERVE_INTERVAL', obs.read(s).frame > firstFrame);

  // delayed reads lag by readDelayFrames
  const s2 = new Sim({ seed: 2, night: 1 });
  const lag = new Observer({ interval: 1, readDelayFrames: 6 });
  let seen = -1;
  for (let i = 0; i < 20; i++) { seen = lag.read(s2).frame; s2.tick(); }
  ok('observer', 'a delayed read is ~readDelayFrames behind the sim',
    near(s2.frame - seen, 6 + 1, 2));

  // a drop surfaces as UNKNOWN(read-dropped), not a stale value -- on the
  // VIDEO facts. Audio (bbVent) does not share the video read's drop coin:
  // a dropped frame is not a missed hearing. Both audio facts are excluded
  // from this video-only assertion.
  const s3 = new Sim({ seed: 3, night: 1 });
  const drop = new Observer({ interval: 1, dropRate: 1, rng: { next: () => 0 } });
  const df = drop.read(s3);
  ok('observer', 'a dropped VIDEO read is UNKNOWN(read-dropped) on every video fact',
    Object.entries(df).filter(([k]) => k !== 'frame' && k !== 'bbVent' &&
      k !== 'bbVentId' && k !== 'mangleStatic' && k !== 'mangleStaticCam')
      .every(([, v]) => v.state === 'UNKNOWN' && v.reason === 'read-dropped'));
  ok('observer', 'audio does not share the video drop coin (bbVent stays OBSERVED)',
    df.bbVent.state === 'OBSERVED');

  const s4 = new Sim({ seed: 4, night: 2 });
  s4.events.push({ type: 'vent-bang', f: 0, data: { who: 'bb', arrival: true } });
  const audio = new Observer({ interval: 60, audioLatencyFrames: 0 });
  const a0 = audio.read(s4);
  ok('observer', 'audio cue is not delayed by the video cadence',
    a0.bbVent.state === 'OBSERVED' && a0.bbVent.value === 'opening' &&
    a0.bbVentId.state === 'OBSERVED');

  const fnSim = new Sim({ seed: 5, night: 2 });
  fnSim.events.push({ type: 'vent-bang', f: 0, data: { who: 'bb', arrival: true } });
  const fn = new Observer({ interval: 60, audioLatencyFrames: 0,
                            audioFalseNegativeRate: 1, rng: { next: () => 0 } });
  const fnFact = fn.read(fnSim);
  ok('observer', 'audio false negative becomes an absent cue, not privileged truth',
    fnFact.bbVent.state === 'OBSERVED' && fnFact.bbVent.value === false);

  const droppedAudio = new Observer({ interval: 60, audioDropRate: 1,
                                      rng: { next: () => 0 } });
  const droppedFact = droppedAudio.read(new Sim({ seed: 6, night: 2 }));
  ok('observer', 'audio transport loss is UNKNOWN and independently modeled',
    droppedFact.bbVent.state === 'UNKNOWN' && droppedFact.bbVent.reason === 'audio-dropped' &&
    droppedFact.bbVentId.state === 'UNKNOWN');

  const fp = new Observer({ interval: 60, audioLatencyFrames: 0,
                            audioFalsePositiveRate: 1, rng: { next: () => 0 } });
  const fpFact = fp.read(new Sim({ seed: 7, night: 2 }));
  ok('observer', 'cue-free false positive has no engine visit identity',
    fpFact.bbVent.state === 'OBSERVED' && fpFact.bbVent.value === 'opening' &&
    fpFact.bbVentId.value?.startsWith('fp:'));
}

// --- 3. controller: the night 6-38 guard ------------------------------------
{
  const scheduled = [100, 300];
  const intents = [
    { action: 'mask', at: 100 + Math.floor(GUARD_FRAMES / 2) },   // inside a window
    { action: 'mask', at: 300 - GUARD_FRAMES + 1 },               // inside a window
    { action: 'mask', at: 300 + GUARD_FRAMES + 5 },               // clear
  ];
  const kept = guardIntents(intents, scheduled);
  ok('controller', 'an intent inside a scheduled press animation window is dropped',
    kept.length === 1 && kept[0].at === 300 + GUARD_FRAMES + 5);

  const tx = new BlackoutReactive();
  const press = tx.decide({ blackout: { state: 'OBSERVED', value: true },
    leftOpening: { state: 'UNKNOWN', reason: 'hidden' },
    maskOn: { state: 'OBSERVED', value: false },
    monitorUp: { state: 'OBSERVED', value: false } }, { frame: 20, scheduled: [] });
  ok('controller', 'a rejected animated intent does not commit the FSM or cooldown',
    press.length === 1 && tx.state === 'securing' &&
    tx.settle([]) === false && tx.state === 'idle' && !tx.cooling(20));
}

// --- 4. BlackoutReactive state machine ------------------------------------
{
  const O = (v) => ({ state: 'OBSERVED', value: v });
  const U = (r) => ({ state: 'UNKNOWN', reason: r });
  // mask-camp scenario: the monitor is already down.
  const down = { blackout: O(true), leftOpening: U('opening-not-in-view'),
                 maskOn: O(false), monitorUp: O(false) };
  const ctx = { frame: 10, scheduled: [] };

  const c = new BlackoutReactive({ maxMaskFrames: 100 });
  let d = c.decide(down, ctx);
  ok('controller', 'blackout, cams down -> one mask press',
    d.length === 1 && d[0].action === 'mask');

  d = c.decide({ ...down, maskOn: O(true) }, { frame: 20, scheduled: [] });
  ok('controller', 'holds while the blackout is active', d.length === 0 && c.state === 'holding');

  d = c.decide({ blackout: O(false), leftOpening: U('x'), maskOn: O(true), monitorUp: O(false) },
               { frame: 40, scheduled: [] });
  ok('controller', 'blackout clear -> verifying, mask still up', d.length === 0 && c.state === 'verifying');

  d = c.decide({ blackout: O(false), leftOpening: O('threat'), maskOn: O(true), monitorUp: O(false) },
               { frame: 44, scheduled: [] });
  ok('controller', 'opening threat -> hold the mask', d.length === 0 && c.state === 'verifying');

  d = c.decide({ blackout: O(false), leftOpening: O('empty'), maskOn: O(true), monitorUp: O(false) },
               { frame: 48, scheduled: [] });
  ok('controller', 'opening empty -> drop mask, back to idle (no monitor owed)',
    d.length === 1 && d[0].action === 'mask' && c.state === 'idle');

  // caught while camming: lower -> mask -> hold -> verify -> drop -> raise back
  const cc = new BlackoutReactive({ maxMaskFrames: 100 });
  const step = (o, fr) => cc.decide({ blackout: O(false), leftOpening: U('x'),
    maskOn: O(false), monitorUp: O(false), ...o }, { frame: fr, scheduled: [] });
  // frames spaced past PRESS_COOLDOWN between animated presses
  d = step({ blackout: O(true), monitorUp: O(true) }, 0);
  ok('controller', 'blackout while camming -> lower the monitor first',
    d.length === 1 && d[0].action === 'monitor' && cc.state === 'securing' && cc.loweredMonitor);
  d = step({ blackout: O(true), monitorUp: U('monitor-animating') }, 10);
  ok('controller', 'monitor still animating -> no second press (would reverse it)', d.length === 0);
  d = step({ blackout: O(true) }, 60);
  ok('controller', 'monitor down, cooldown elapsed -> mask', d.length === 1 && d[0].action === 'mask');
  step({ blackout: O(true), maskOn: O(true) }, 64);          // -> holding
  step({ maskOn: O(true) }, 130);                            // blackout clear -> verifying
  d = step({ leftOpening: O('empty'), maskOn: O(true) }, 134); // -> drop mask, restoring
  ok('controller', 'opening empty -> drop mask, owe a monitor raise',
    d.some(i => i.action === 'mask') && cc.state === 'restoring');
  d = step({ leftOpening: O('empty') }, 170);                // mask off, monitor down, cooldown elapsed
  ok('controller', 'restoring -> raises the monitor back', d.some(i => i.action === 'monitor'));
  d = step({ leftOpening: O('empty'), monitorUp: O(true) }, 210);
  ok('controller', 'monitor back up -> idle', cc.state === 'idle' && !cc.loweredMonitor);

  // timeout path: stuck masked past maxMaskFrames -> drop anyway
  const c2 = new BlackoutReactive({ maxMaskFrames: 50 });
  c2.decide(down, { frame: 0, scheduled: [] });
  const dd = c2.decide({ blackout: O(false), leftOpening: O('threat'), maskOn: O(true), monitorUp: O(false) },
                       { frame: 60, scheduled: [] });
  ok('controller', 'mask timeout -> drop regardless of the opening read',
    dd.length === 1 && dd[0].action === 'mask' && c2.state === 'idle');
}

// --- 5. integration: the reactive layer helps, and degrades gracefully -------
//
// Base: the real minimal Night 1 Minus Toys schedule -- arm the CAM 09/11
// split, then flash + wind on the 5 s grid, monitor up all night. 200/200
// clean, so any death is the thing we inject: N synthetic blackouts at
// pseudo-random frames (`startBlackout('synthetic', null)`), each lethal unless
// a mask is fully on within the night's grace window. The monitor is up, so the
// reactive layer must lower it, mask, verify the opening, then raise it back --
// the full BlackoutReactive path.
import { Rng } from '@sixam/source/fnaf2';
import { build, schedule } from '../bin/plans/minus-toys-plan.mjs';

const NIGHT = 1;
const N_BLACKOUTS = 4;
const { opening: BASE_OPEN, loop: BASE_LOOP } = build({ minimal: true });

function runBase(seed, { reactive = null } = {}) {
  const s = new Sim({ seed, night: NIGHT });
  const q = schedule({ opening: BASE_OPEN, loop: BASE_LOOP,
                       periodMs: 5000, loopStartMs: 10000 });
  const scheduled = q.filter(([, k]) => k === 'press').map(([at, , action]) => ({ at, action }));
  const obs = reactive ? reactive.observer : null;

  const br = new Rng(seed ^ 0x2545f491);
  const blackoutFrames = new Set();
  for (let i = 0; i < N_BLACKOUTS; i++)   // spread across the winding half, well apart
    blackoutFrames.add(C.s(140) + i * C.s(60) + Math.floor(br.next() * C.s(30)));

  let qi = 0, seen = 0, ei = 0, handledBusy = false;
  while (s.alive && !s.won) {
    // hold the base schedule while the reactive layer is mid-response
    const busy = reactive && reactive.ctrl.state !== 'idle';
    if (!busy) while (qi < q.length && q[qi][0] <= s.frame) { const [, k, a] = q[qi++]; s[k](a); }
    else { while (qi < q.length && q[qi][0] <= s.frame) qi++; handledBusy = true; }

    if (blackoutFrames.has(s.frame) && !s.blackout.active) s.startBlackout('synthetic', null);

    if (reactive) {
      const facts = obs.read(s);
      const window = scheduled.filter(x => Math.abs(s.frame - x.at) < GUARD_FRAMES * 3);
      for (const it of guardIntents(
          reactive.ctrl.decide(facts, { frame: s.frame, scheduled: window }), window)) {
        if (it.at <= s.frame) s.press(it.action);
      }
    }

    s.tick();
    for (; ei < s.events.length; ei++) if (s.events[ei].type === 'blackout') seen++;
  }
  return { won: s.won, death: s.death?.reason ?? null, seen, handledBusy };
}

{
  const N = 200;
  const seeds = Array.from({ length: N }, (_, i) => (i * 2654435761) >>> 0);

  // The metric is blackout-specific: leaving CAM 09 to handle a blackout costs
  // the Toy stun a beat, so a few runs then die to a Toy instead -- that is a
  // real strategy cost, not a controller fault, so it is not what P1 gates.
  const rate = (fn) => {
    let dead = 0, exercised = 0;
    for (const seed of seeds) {
      const r = fn(seed);
      if (r.seen > 0) exercised++;
      if (r.death === 'blackout') dead++;
    }
    return { deadToBlackout: dead, exercised };
  };

  const base = rate(runBase);
  const react = rate(seed => runBase(seed, {
    reactive: { observer: new Observer(), ctrl: new BlackoutReactive() } }));
  const noisy = rate(seed => runBase(seed, {
    reactive: { observer: new Observer({ readDelayFrames: 8, dropRate: 0.2,
                                         rng: new Rng(seed ^ 0x9e3779b9) }),
                ctrl: new BlackoutReactive() } }));

  console.log(`  night ${NIGHT}, ${N_BLACKOUTS} synthetic blackouts/run, ${N} seeds -- ` +
    `deaths TO A BLACKOUT: base ${base.deadToBlackout}, +reactive ${react.deadToBlackout}, ` +
    `+reactive(noisy) ${noisy.deadToBlackout}`);
  console.log(`  ${formatRate(base.deadToBlackout, N, { label: 'base blackout-death rate' })}; ` +
    `${formatRate(react.deadToBlackout, N, { label: 'reactive blackout-death rate' })}; ` +
    `${formatRate(noisy.deadToBlackout, N, { label: 'noisy blackout-death rate' })}`);
  ok('integration', 'the scenario actually exercises blackouts', base.exercised === N);
  ok('integration', 'the base without reaction dies to almost every blackout',
    base.deadToBlackout >= N * 0.9);
  ok('integration', 'the reactive layer stops almost all blackout deaths',
    react.deadToBlackout <= N * 0.05);
  ok('integration', 'a delayed/dropped observer still stops most blackout deaths',
    noisy.deadToBlackout <= N * 0.2);
}

if (process.argv.includes('--assert') && failures) process.exit(1);
console.log(failures ? `\n${failures} failure(s)` : '\nall reactive checks passed');
