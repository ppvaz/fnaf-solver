// Compatibility adapter. The canonical Right Vent Camp route lives in the
// research package; this command remains the model-only diagnostic entrypoint.
import { pathToFileURL } from 'node:url';
import { run, cohort, emitPlan } from '@sixam/research/strategies/right-vent-camp';

export { run, cohort, emitPlan };

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const raw = process.argv[2];
  const count = raw && /^\d+$/.test(raw) ? Number(raw) : 200;
  const result = cohort({ count, ventStall: !process.argv.includes('--no-vent-stall'),
    worst: process.argv.includes('--worst') });
  console.log('Right Vent Camp model diagnostic');
  console.log('Android plant-model hypothesis; PC 104-1 history is not an Android claim');
  console.log(`${result.won}/${result.runs} survived`);
  for (const [reason, n] of Object.entries(result.deaths)) console.log(`  ${n}x ${reason}`);
  console.log(`min box ${(result.minBox * 100).toFixed(0)}% | min power ${result.minPower}`);
  console.log(`first power-out ${result.firstPowerOut === null
    ? 'never' : (result.firstPowerOut / 60).toFixed(1) + 's'}`);
  console.log(`cohort=${result.seedCohort.sha256.slice(0, 12)}`);
}
