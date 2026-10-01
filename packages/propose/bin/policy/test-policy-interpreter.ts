// Plan 21 package 2 foundation: IR expansion is finite and carries the
// current Minimal Minus Toys setup/repeat/terminal semantics.
import { minimalPolicy } from './policy-ir.ts';
import { compilePolicy, replayPolicy } from './policy-interpreter.ts';
import { build, schedule } from '../plans/minus-toys-plan.ts';
import * as C from '@sixam/source/fnaf2';

const check: (condition: unknown, message: string) => asserts condition = (condition, message) => { if (!condition) throw new Error(message); };
const events = compilePolicy(minimalPolicy(), { untilMs: 420000 });
const presses = events.filter(event => event.kind === 'press');
check(presses.some(event => event.atMs === 115000 && event.action === 'monitor'),
      'setup monitor action was not compiled');
check(presses.some(event => event.atMs === 140150 && event.action === 'light'),
      'first repeat light action was not compiled');
check(presses.some(event => event.atMs === 359700 && event.action === 'cam:9'),
      'terminal proof camera action was not compiled');
check(presses.some(event => event.atMs === 360000 && event.action === 'monitor'),
      'terminal monitor action was not compiled');
check(events.every(event => event.atMs >= 0 && event.atMs <= 420000),
      'compiled event escaped the declared program window');

// Package 2's promotion gate: the IR and the existing device schedule must
// produce the same frame-stamped semantic trace, including seam ordering.
const built = build({ minimal: true });
const expected = schedule({ opening: built.opening, loop: built.loop, finish: built.finish,
  periodMs: 5000, loopStartMs: 140000, untilMs: 360000 });
const actual = compilePolicy(minimalPolicy(), { untilMs: 360000 }).map(event => [
  Math.round(event.atMs * C.FPS / 1000), event.kind, event.action]);
const expectedSemantic = expected.map(([frame, kind, action]) => [frame, kind, action]);
check(JSON.stringify(actual) === JSON.stringify(expectedSemantic),
      'IR semantic trace diverges from the existing scheduled trace');

const replay = replayPolicy(minimalPolicy(), { night: 1, seed: 1, untilMs: 420000 });
check(replay.sim.won && replay.events.length === events.length,
      'exact-engine IR replay did not complete the minimal Night 1 proof run');
console.log(`policy interpreter: ${presses.length} presses and ${events.length} events compiled`);
