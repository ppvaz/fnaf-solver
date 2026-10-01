// Every lesson is playable in today's Sim: a player who presses each step of a
// lesson on its cue has every press taken, and passes the lesson.
//
// Until 2026-09-30 the trainer taught Source's CYCLE_SCRIPT, whose mask-off the
// Sim has refused since 3d5c5f7 (2026-09-27); every lesson with the office half
// was unpassable played perfectly, and lesson.test.ts's "cycle passed" was the
// only thing that said so, in a browser lane CI does not run. This replays the
// same lessons headless through playPress, the app's press path, in
// test:contracts.
import assert from 'node:assert/strict';
import * as C from '@sixam/source/fnaf2';
import { Coach, playPress } from '../src/coach.ts';
import { LESSONS, MINUS7_CYCLE, lessonSim } from '../src/curriculum.ts';

const TAP_FRAMES = 6;   // a light held 100 ms, as lesson.test.ts's player holds it

/** A metronomic player: every cue pressed on the first frame it is due. */
function play(lesson, { seed, script = lesson.script, seconds }) {
  const sim = lessonSim(lesson, { seed, record: false });
  const passes = [];
  const coach = new Coach(sim, { script, tolGood: lesson.tol?.tolGood, tolOk: lesson.tol?.tolOk,
    onCycle: ok => passes.push(ok) });
  let releases = [];
  while (sim.alive && !sim.won && sim.t < seconds) {
    sim.tick();
    coach.update();
    releases = releases.filter(([frame, act]) => frame > sim.frame || (sim.release(act), false));
    const e = coach.expected;
    if (coach.pendingFlash) {
      playPress(sim, coach, 'light');
      releases.push([sim.frame + TAP_FRAMES, 'light']);
    } else if (e && coach.cycleStart != null && sim.t >= coach.cycleStart + e.at) {
      const act = e.action === 'cam' || e.action === 'camflash' ? `cam:${e.cam}` : e.action;
      playPress(sim, coach, act);
      if (e.hold) releases.push([sim.frame + Math.round(e.hold * C.FPS) - 1, act]);
      else if (act === 'light') releases.push([sim.frame + TAP_FRAMES, 'light']);
    }
  }
  return { sim, coach, passes };
}
const refused = coach => coach.trace.filter(row => row.grade === 'refused').map(row => `${row.cycle}:${row.stepId}`);
const lessonById = id => LESSONS.find(lesson => lesson.id === id);

// The control: the pattern taught until 2026-09-30 must be caught, or this
// check measures nothing.
{
  const { coach, passes } = play(lessonById('cycle'), { seed: 1, script: C.CYCLE_SCRIPT, seconds: 20 });
  assert.ok(refused(coach).length > 0, 'CYCLE_SCRIPT should be refused by the Sim; the control lost its bite');
  assert.ok(!passes.some(Boolean), 'CYCLE_SCRIPT should never give a clean pass');
}

// The taught cycle's gated gaps are the sourced animations plus two frames.
{
  const at = id => MINUS7_CYCLE.find(step => step.id === id).at;
  const gap = (a, b) => Math.round((at(b) - at(a)) * C.FPS);
  assert.equal(gap('mask-on', 'mask-off'), C.MASK_ANIM_ON + 2);
  assert.ok(gap('mask-off', 'flash-hall') >= C.MASK_ANIM_OFF + 2);
  assert.ok(gap('monitor-up', 'cam-10') >= C.MONITOR_ANIM_UP + 2);
  assert.ok(MINUS7_CYCLE.every(step => !step.win), 'STEP_WINDOWS belong to CYCLE_SCRIPT\'s geometry, not this one');
  const wind = MINUS7_CYCLE.at(-1);
  assert.ok(wind.at + wind.hold <= 5, 'the wind hold ends by the next anchor');
}

// Every scripted lesson: every press taken; a drill passes; a lesson that can
// kill does not, over several seeds. The full nights need Balloon Boy's
// reactive drills, which no script plays, so only their first passes are
// played, for refusals.
let lessons = 0;
for (const lesson of LESSONS.filter(l => l.script)) {
  const lethal = lesson.sim.lethal !== false;
  const seeds = lethal ? 10 : 1;
  for (let seed = 1; seed <= seeds; seed++) {
    const seconds = lesson.fullNight ? 20 : (lesson.target + 2) * 5 + 3;
    const { sim, coach, passes } = play(lesson, { seed, seconds });
    assert.deepEqual(refused(coach), [], `${lesson.id} seed ${seed}: the Sim refused a press on its cue`);
    assert.ok(coach.trace.length > 0, `${lesson.id} seed ${seed}: no step was graded`);
    const off = coach.trace.filter(row => row.grade !== 'good').map(row => `${row.cycle}:${row.stepId}:${row.grade}`);
    assert.deepEqual(off, [], `${lesson.id} seed ${seed}: a perfect player graded below good`);
    if (!lesson.fullNight) {
      assert.ok(sim.alive, `${lesson.id} seed ${seed}: died (${sim.death?.reason}) before its pass target`);
      assert.equal(passes[0], true, `${lesson.id} seed ${seed}: the first pass was not clean`);
      assert.ok(coach.bestStreak >= lesson.target,
        `${lesson.id} seed ${seed}: best streak ${coach.bestStreak} of ${lesson.target} with every cue hit`);
    }
  }
  lessons++;
}
console.log(`lessons: ${lessons} scripted lessons played on their cues in the Sim, no press refused, ` +
  'every row graded good from the first pass, every drill passed; CYCLE_SCRIPT refused as the control');
