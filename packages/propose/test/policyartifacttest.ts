// Plan 21 package 6: the IR-to-device execution contract.
//
// No phone is needed. This proves that the runner's plan is a projection of a
// canonical policy artifact, that both hashes are byte hashes, and that a
// changed artifact or plan cannot pass verification. The static runner checks
// keep the host-side analysis opt-in and the compiled artifact on the path
// before the first device action.
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compilePolicyArtifact, verifyPolicyArtifact } from '../bin/policy/policy-artifact.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const check = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };
const hash = (text: string) => createHash('sha256').update(text).digest('hex');

const artifact = compilePolicyArtifact();
check(artifact.schema === 'policy-artifact-v1', 'artifact schema is not versioned');
check(artifact.policySchema === 'policy-v1' &&
      artifact.execution.mode === 'compiled-ir', 'artifact is not a compiled IR execution record');
check(artifact.execution.capture === 'low-cost' &&
      artifact.execution.automaticHostAnalysis === false,
  'capture/analysis separation is not explicit');
check(artifact.policySha256 === hash(artifact.canonicalPolicy),
  'policy hash is not the canonical policy bytes');
check(artifact.planSha256 === hash(artifact.compiledPlan),
  'plan hash is not the compiled plan bytes');
check(artifact.compiledPlan.includes('#policy-schema policy-v1') &&
      artifact.compiledPlan.includes('#policy-sha256 ' + artifact.policySha256),
  'the device plan does not carry its IR identity');
verifyPolicyArtifact(artifact);

const changedPlan = structuredClone(artifact);
changedPlan.compiledPlan = changedPlan.compiledPlan.replace('#period 5000', '#period 10000');
let refused = false;
try { verifyPolicyArtifact(changedPlan); } catch { refused = true; }
check(refused, 'a changed compiled plan was accepted');

const changedPolicy = structuredClone(artifact);
(changedPolicy.policy.metadata as { id: string }).id += '-tampered'; // the clone's to tamper with
refused = false;
try { verifyPolicyArtifact(changedPolicy); } catch { refused = true; }
check(refused, 'a changed policy identity was accepted');

const work = mkdtempSync(join(tmpdir(), 'fnaf2-policy-artifact-'));
try {
  const planPath = join(work, 'plan.txt');
  const artifactPath = join(work, 'artifact.json');
  const metadataPath = join(work, 'metadata.env');
  const emitted = spawnSync('node', [
    join(HERE, '../bin/policy/policy-artifact.ts'), '--minimal',
    '--plan', planPath, '--artifact', artifactPath, '--metadata', metadataPath,
  ], { encoding: 'utf8' });
  check(emitted.status === 0, 'CLI artifact emission failed: ' + emitted.stderr);
  const emittedArtifact = JSON.parse(readFileSync(artifactPath, 'utf8'));
  verifyPolicyArtifact(emittedArtifact, readFileSync(planPath, 'utf8'));
  check(readFileSync(metadataPath, 'utf8').includes(
    'policy_sha256=' + emittedArtifact.policySha256),
  'CLI metadata omitted the policy hash');
  writeFileSync(planPath, readFileSync(planPath, 'utf8').replace('#policy-id ', '#policy-id altered-'));
  const verified = spawnSync('node', [
    join(HERE, '../bin/policy/policy-artifact.ts'), '--verify',
    '--artifact', artifactPath, '--plan', planPath,
  ], { encoding: 'utf8' });
  check(verified.status !== 0, 'CLI accepted altered plan bytes');
} finally {
  rmSync(work, { recursive: true, force: true });
}

console.log('policy artifact: canonical IR, compiled plan, and analysis boundary are gated');
