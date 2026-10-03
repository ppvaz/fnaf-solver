// The two helpers Propose's tools share: a lookup that must find (lookup.ts)
// and a command line that reads only the flags it names (flags.ts).
import { found } from './lookup.ts';
import { refuseUnknownFlags } from './flags.ts';

const check = (ok: unknown, message: string) => { if (!ok) throw new Error(message); };
const refusal = (fn: () => unknown) => {
  try { fn(); } catch (error) { return error instanceof Error ? error.message : String(error); }
  return '';
};

check(found([1, 2, 3].find(n => n === 2), 'two') === 2, 'found() did not return what the lookup found');
check(found(0, 'zero') === 0 && found('', 'empty') === '', 'found() refused a falsy value it was given');
check(/the third row was not found/.test(refusal(() => found([1, 2].find(n => n === 3), 'the third row'))),
  'found() let a missed lookup through');
check(/was not found/.test(refusal(() => found(null))), 'found() let null through');

const known = ['count', 'jobs', 'no-floor'];
check(refusal(() => refuseUnknownFlags(['--count', '3000', '--jobs=2', '--no-floor', 'positional'], known)) === '',
  'refuseUnknownFlags refused flags the command reads');
check(/unknown flag --seeds; this command reads --count, --jobs, --no-floor/
  .test(refusal(() => refuseUnknownFlags(['--seeds', '3000'], known))), 'a flag the command does not read passed');
check(/unknown flags --seed, --floor/.test(refusal(() => refuseUnknownFlags(['--seed=3', '--count', '1', '--floor'], known))),
  'every unknown flag is not named');

console.log('bin helpers: found() returns what a lookup found and refuses a miss; ' +
  'refuseUnknownFlags passes the flags a command reads and names every other');
