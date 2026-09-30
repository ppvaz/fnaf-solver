// Every committed winner must still compile into a bundle the campaign accepts.
//
// Winners are committed (CLAUDE.md) so that a night can be re-run from a clean
// checkout on any machine: on 2026-09-15 the k3 Night 7 bundle could not be
// rebuilt from the evidence records' knob deltas, and a run pack's
// winnerCommitted check means nothing unless the committed file still builds.
// So this compiles each tools/device/*-winner.json of schema winner-v1 exactly
// as `npm run device:emit` does, then runs it through the acceptance
// `cli.js campaign --bundle` applies before it opens a phone: the campaign
// spec for the bundle's nights and profile, and one compiled plan per night.
// It is the chain night-run.sh drives, minus the device.
//
// A winner whose replay no longer matches its gate fails here, and that is the
// point: the engine changed under a measured plan, and the decision to
// re-measure it or retire it belongs in the diff that changed the engine.
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileBundle } from './bundle.mjs';
import { makeCampaignSpec } from '../../packages/play/src/campaign/campaign.js';
import { validateCampaignBundle } from '../../packages/play/src/campaign/campaign-bundle.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
let failed = 0;
const rows = [];
const scratch = mkdtempSync(join(tmpdir(), 'winners-rebuild-'));
try {
  for (const name of readdirSync(HERE).filter(file => file.endsWith('-winner.json')).sort()) {
    const winner = JSON.parse(readFileSync(join(HERE, name), 'utf8'));
    if (winner.schema !== 'winner-v1') continue; // FNaF 1 routes carry their own schema: test-fnaf1-winner.mjs
    try {
      const built = compileBundle(winner, join(scratch, name));
      const profile = JSON.parse(readFileSync(join(ROOT, 'apps/device/profiles', `${built.profile.id}.json`), 'utf8'));
      const nights = built.manifest.nights;
      const timingByNight = Object.fromEntries(built.compiled.map(plan => [String(plan.night), plan.timing]));
      const spec = makeCampaignSpec({ profile: profile.id, targetBuild: profile.targetBuild, timingByNight, nights });
      validateCampaignBundle({ spec, plans: built.compiled.filter(plan => nights.includes(plan.night)) });
      rows.push(`${name.replace(/-winner\.json$/, '').padEnd(28)} ${built.manifest.strategy.padEnd(10)} ` +
        `nights ${nights.join(',').padEnd(4)} ${built.manifest.winnerHash}`);
    } catch (error) {
      failed = 1;
      console.error(`FAIL ${name}: ${error.message}`);
    }
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
if (failed) process.exit(1);
console.log(rows.join('\n'));
console.log(`winners rebuild: ${rows.length} committed winners compile into bundles the campaign accepts`);
