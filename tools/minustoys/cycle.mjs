// Compatibility adapter. Strategy semantics live in the research package.
import { pathToFileURL } from 'node:url';
import { CYCLE, runMinusToys7, cohort } from '@sixam/research/strategies/minus-toys';

export { CYCLE, runMinusToys7, cohort };

const arg = (name, fallback) => {
  const raw = process.argv.find(item => item.startsWith(`--${name}=`));
  return raw === undefined ? fallback : Number(raw.slice(name.length + 3));
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const night = arg('night', 7);
  const count = arg('seeds', 3000);
  const fromArg = process.argv.find(item => item.startsWith('--from='));
  const toArg = process.argv.find(item => item.startsWith('--to='));
  const range = fromArg || toArg
    ? { from: fromArg ? Number(fromArg.slice(7)) : 1,
        to: toArg ? Number(toArg.slice(5)) :
          (fromArg ? Number(fromArg.slice(7)) + count - 1 : count) }
    : { count };
  console.log(JSON.stringify(cohort({ ...range, night,
    slackMs: arg('slack', 0),
    openLoop: process.argv.includes('--open-loop'),
    worst: process.argv.includes('--worst') }), null, 1));
}
