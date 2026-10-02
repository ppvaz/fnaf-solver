// Every committed winner must still compile into a bundle the campaign accepts.
//
// Winners are committed (CLAUDE.md) so that a night can be re-run from a clean
// checkout on any machine: on 2026-09-15 the k3 Night 7 bundle could not be
// rebuilt from the evidence records' knob deltas, and a run pack's
// winnerCommitted check means nothing unless the committed file still builds.
// So this compiles each packages/propose/bindings/fnaf2/*-winner.json of schema winner-v1 exactly
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
import { GATES_FILE, compileBundle, readGateRegister } from '../bin/plans/bundle.ts';
import { gatedWinnerFiles } from '../bindings/gates.ts';
import { stableHash } from '@sixam/kernel/contracts';
import { FNAF2_MODEL } from '@sixam/source/fnaf2';
import { makeCampaignSpec } from '../../play/src/campaign/campaign.ts';
import { validateCampaignBundle } from '../../play/src/campaign/campaign-bundle.ts';

// compileBundle writes the compiled artifact, so the bundle it returns carries its plans.
type CompiledPlans = NonNullable<ReturnType<typeof compileBundle>['compiled']>;

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '../../..');
// The committed FNaF 2 winners (winner-v1): packages/propose/bindings/fnaf2.
const WINNERS = join(HERE, '../bindings/fnaf2');
let failed = 0;
const rows = [];
const scratch = mkdtempSync(join(tmpdir(), 'winners-rebuild-'));
try {
  for (const name of readdirSync(WINNERS).filter(file => file.endsWith('-winner.json')).sort()) {
    const winner = JSON.parse(readFileSync(join(WINNERS, name), 'utf8'));
    if (winner.schema !== 'winner-v1') continue; // FNaF 1 routes carry their own schema: test-fnaf1-winner.ts
    try {
      const built = compileBundle(winner, join(scratch, name));
      const profile = JSON.parse(readFileSync(join(ROOT, 'packages/play/profiles/fnaf2/moto-g56', `${built.profile.id}.json`), 'utf8'));
      const nights = built.manifest.nights;
      const timingByNight = Object.fromEntries((built.compiled as CompiledPlans).map(plan => [String(plan.night), plan.timing]));
      const spec = makeCampaignSpec({ profile: profile.id, targetBuild: profile.targetBuild, timingByNight, nights });
      validateCampaignBundle({ spec, plans: (built.compiled as CompiledPlans).filter(plan => nights.includes(plan.night)) });
      rows.push(`${name.replace(/-winner\.json$/, '').padEnd(28)} ${built.manifest.strategy.padEnd(10)} ` +
        `nights ${nights.join(',').padEnd(4)} ${built.manifest.winnerHash}`);
    } catch (error) {
      failed = 1;
      console.error(`FAIL ${name}: ${(error as Error).message}`);
    }
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
if (!rows.length) { failed = 1; console.error(`FAIL no winner-v1 binding found in ${WINNERS}`); }
// compileBundle checks a registered winner against its gate under the current model and falls back to
// the winner's own gate for a candidate; a committed winner, retired ones included (custody reads them),
// must be registered, or that fallback would let it skip the model it now runs under.
const register = readGateRegister();
const section = register.models.find(model => model.model === FNAF2_MODEL);
const custody = gatedWinnerFiles(ROOT);
for (const file of custody) {
  const hash = stableHash(JSON.parse(readFileSync(join(ROOT, file), 'utf8')));
  if (!section?.gates.some(gate => gate.winnerHash === hash)) {
    failed = 1;
    console.error(`FAIL ${file} has no gate under model ${FNAF2_MODEL} in ${GATES_FILE}: packages/propose/bindings/gates.ts --measure`);
  }
}
if (!custody.length) { failed = 1; console.error('FAIL no custody winner found for the gate register'); }
if (failed) process.exit(1);
console.log(rows.join('\n'));
console.log(`winners rebuild: ${rows.length} committed winners compile into bundles the campaign accepts; ${custody.length} custody winners hold a gate under ${FNAF2_MODEL}`);
