// Compatibility adapter. Strategy semantics live in the research package.
import { pathToFileURL } from 'node:url';
import { CYCLE, runCycle, cohort } from '@sixam/propose/parked/minus7';

export { CYCLE, runCycle, cohort };

const arg = (name, fallback) => {
  const raw = process.argv.find(item => item.startsWith(`--${name}=`));
  return raw === undefined ? fallback : Number(raw.slice(name.length + 3));
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const night = arg('night', 7);
  const count = arg('seeds', 3000);
  console.log(JSON.stringify(cohort({ night, count,
    slackMs: arg('slack', 0),
    bangLatencyMs: arg('bangLatency', 0),
    worst: process.argv.includes('--worst') }), null, 1));
}
