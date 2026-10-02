// The coach grades what the game did with a press, not that it was sent
// (CLAUDE.md: a send is not game acceptance). Until 2026-09-30 it graded every
// press on time alone, so a perfect player on the taught office half scored
// "good" on a mask-off the Sim refused -- the mask was still animating on --
// and on everything the mask then blocked.
import assert from 'node:assert/strict';
import * as C from '@sixam/source/fnaf2';
import { Sim } from '@sixam/source/fnaf2';
import { Coach, playPress, pressLanded, pressState } from '../src/coach.ts';
import type { Step } from '../src/curriculum.ts';

const QUIET = { bbEnabled: false, foxyEnabled: false, gfEnabled: false, boxEnabled: false,
  stalledEnabled: false, powerEnabled: false, lethal: false, record: false, seed: 1 };

// pressLanded, press by press, on states the Sim refuses and accepts.
{
  const sim = new Sim(QUIET);
  const press = (act: string) => { const before = pressState(sim); sim.press(act); return pressLanded(before, pressState(sim), act); };
  assert.equal(sim.monitor, 'down');
  assert.equal(press('cam:10'), false, 'a camera with the monitor down is refused');
  assert.equal(press('mask'), true, 'the mask goes on from rest');
  assert.equal(press('mask'), false, 'the mask is refused while it is still animating on');
  assert.equal(press('light'), false, 'no light while the mask is on');
  for (let i = 0; i < C.MASK_ANIM_ON; i++) sim.tick();
  assert.equal(press('mask'), true, 'the mask comes off once it is fully on');
  assert.equal(press('monitor'), false, 'nothing but the mask answers while it is coming off');
  for (let i = 0; i < C.MASK_ANIM_OFF; i++) sim.tick();
  assert.equal(press('light'), true, 'the light answers once the mask is fully off');
  sim.release('light');
  assert.equal(press('monitor'), true, 'the monitor raises');
  assert.equal(press('cam:10'), false, 'a camera is refused while the monitor is still raising');
  // Widened: the ticks move the monitor, which the assert above narrowed to 'down'.
  for (let i = 0; (sim.monitor as string) !== 'up' && i < 60; i++) sim.tick();
  assert.equal(press('cam:10'), true, 'a camera answers once the monitor is up');
  assert.equal(press('cam:10'), true, 'selecting the camera already selected still lands');
  assert.equal(press('wind'), true);
}

// The coach, fed through playPress as the app feeds it: a press on time that
// the Sim refuses is graded `refused`, and it breaks the pass.
{
  const sim = new Sim(QUIET);
  const script = [
    { id: 'mask-on', at: 0.00, label: 'Mask on', action: 'mask' },
    { id: 'mask-off', at: 0.10, label: 'Mask off', action: 'mask' },   // inside MASK_ANIM_ON
    { id: 'flash-hall', at: 0.60, label: 'Flash the hall', action: 'light' },
  ];
  const passes: boolean[] = [];
  const coach = new Coach(sim, { script, tolGood: 0.2, tolOk: 0.4, onCycle: ok => passes.push(ok) });
  coach.start(0);
  // Called after coach.start, with ids of the script above.
  const due = (id: string) => (coach.cycleStart as number) + (script.find(st => st.id === id) as Step).at;
  while (sim.t < due('mask-on')) sim.tick();
  assert.equal(playPress(sim, coach, 'mask'), true);
  while (sim.t < due('mask-off')) sim.tick();
  assert.equal(playPress(sim, coach, 'mask'), false, 'the Sim refuses the mask mid-animation');
  const [on, off] = coach.trace;
  assert.equal(on.grade, 'good');
  assert.equal(off.grade, 'refused', 'a refused press is not graded on its timing');
  assert.ok(Math.abs(Number(off.delta)) < 1 / C.FPS, 'the refused row keeps the press time for the lateness census');
  assert.equal(coach.combo, 0, 'a refused press breaks the combo');
  assert.equal(coach.summary.bad, 1);
  // The mask is still on, so the flash is refused too, and the pass is not clean.
  while (sim.t < due('flash-hall')) sim.tick();
  assert.equal(playPress(sim, coach, 'light'), false);
  assert.equal(coach.trace[2].grade, 'refused');
  assert.deepEqual(passes, [false], 'a pass with a refused press is not a clean pass');
}

// A pass that ends on the held WIND is settled when the hold ends, at the next
// anchor. Until 2026-09-30 it was settled at the WIND press, so it graded the
// PREVIOUS pass's hold: every lesson's first pass read `no-wind` however long
// the player held, and each trace `holds` row carried the wrong cycle.
{
  const sim = { t: 0, isWinding: false };
  const script = [
    { id: 'tap', at: 0, label: 'Tap', action: 'light' },
    { id: 'wind', at: 1, label: 'Hold WIND', action: 'wind', hold: 3.5 },
  ];
  const passes: boolean[] = [];
  // A partial fake: the coach reads only t and isWinding.
  const coach = new Coach(sim as unknown as C.Sim, { script, tolGood: 0.2, tolOk: 0.4, onCycle: ok => passes.push(ok) });
  // Anchors at 2 and 7. Pass 0 winds its full 3.5 s; pass 1 only taps WIND.
  const presses = new Map([[2 * C.FPS, 'light'], [3 * C.FPS, 'wind'], [7 * C.FPS, 'light'], [8 * C.FPS, 'wind']]);
  for (let f = 0; f <= 12.5 * C.FPS; f++) {
    sim.t = f / C.FPS;
    sim.isWinding = f >= 3 * C.FPS && f < 6.5 * C.FPS;
    coach.update();
    const act = presses.get(f);
    if (act) coach.onInput(act);
  }
  assert.deepEqual(passes, [true, false], 'the held pass is clean and the tapped one is not');
  assert.equal(coach.holds[0].cycle, 0);
  assert.ok(Math.abs(coach.holds[0].heldSec - 3.5) < 1 / C.FPS, `pass 0 held ${coach.holds[0].heldSec} s`);
  assert.equal(coach.holds[1].cycle, 1);
  assert.equal(coach.holds[1].heldSec, 0);
  const flagged = coach.trace.filter(row => row.grade === 'no-wind');
  assert.deepEqual(flagged.map(row => row.cycle), [1], 'no-wind lands on the pass that did not wind');
}

// The coach must not call an input safe when the model says it ends the night
// (moved from packages/source/test/simtest.ts, 2026-09-30: it tests the trainer's Coach, not the Sim).
// Grading is per step and lopsided: `mask-off` has 450 ms of room early and
// about 50 ms late, because the mask blocks the hall flash that resets Foxy.
{
  // A partial fake: the coach reads only these.
  const stub = { t: 0, isWinding: false, camsUp: false } as unknown as C.Sim;
  const coach = new Coach(stub, { script: C.CYCLE_SCRIPT });
  const maskOff = C.CYCLE_SCRIPT.find(st => st.id === 'mask-off');
  const beat = { id: 'beat', at: 0, label: 'Tap', action: 'light' };

  if (!maskOff?.win) throw new Error('mask-off lost its measured window');
  if (coach.grade(maskOff, -0.10) !== 'good')
    throw new Error('a 100ms-early mask-off should still be good');
  if (coach.grade(maskOff, 0.10) === 'good')
    throw new Error('a 100ms-late mask-off was graded good, but dies in the model');
  if (coach.grade(maskOff, 0.06) !== 'late')
    throw new Error('a 60ms-late mask-off must not pass: the window closes at 50ms');

  // The same delta, either side of zero, must not grade the same.
  if (coach.grade(maskOff, -0.03) === coach.grade(maskOff, 0.03))
    throw new Error('mask-off graded symmetrically despite a lopsided window');

  // A step with no measured window keeps the lesson's symmetric tolerance.
  if (coach.grade(beat, 0.14) !== 'good' || coach.grade(beat, -0.14) !== 'good')
    throw new Error('an unwindowed step should fall back to the lesson tolerance');

  // A window may only tighten a lesson, never loosen it: an easy lesson still
  // cannot pass a late mask-off, and a strict lesson still binds elsewhere.
  const easy = new Coach(stub, { script: C.CYCLE_SCRIPT, tolGood: 0.30, tolOk: 0.55 });
  if (easy.grade(maskOff, 0.10) === 'ok' || easy.grade(maskOff, 0.10) === 'good')
    throw new Error('an easy lesson loosened a step past its measured window');
  const strict = new Coach(stub, { script: C.CYCLE_SCRIPT, tolGood: 0.01, tolOk: 0.02 });
  if (strict.grade(maskOff, -0.10) !== 'late')
    throw new Error('a strict lesson tolerance should still bind where it is tighter');
}

console.log('coach: a press the Sim refuses is graded refused, on its own and through the app\'s press path; ' +
  'a pass that ends on WIND is settled when its hold ends');
