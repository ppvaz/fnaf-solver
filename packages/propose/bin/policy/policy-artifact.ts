// Build and verify the compiled policy artifact consumed by the device runner.
//
// The runner may send plan text to the phone, but that text is not the source
// of policy. This artifact keeps the canonical policy, its hash, and the
// device projection together, then checks the projection against the same
// compiler/equivalence gate used by the offline campaign.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { canonicalPolicy, validatePolicy } from '@sixam/propose/policy';
import type { PolicyProgram } from '@sixam/propose/policy';
import { smokeSeed } from '@sixam/propose/seeds';
import { isRecord } from '@sixam/kernel';
import { minimalPolicy } from './policy-ir.ts';
import { compileDevicePlan, comparePolicyToDevice } from './policy-equivalence.ts';
import { phaseOf, replayPolicy } from './policy-interpreter.ts';

export const ARTIFACT_SCHEMA = 'policy-artifact-v1';

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

export function compilePolicyArtifact(program: PolicyProgram = minimalPolicy()) {
  validatePolicy(program);
  const canonical = canonicalPolicy(program);
  const plan = compileDevicePlan(program);
  const equivalence = comparePolicyToDevice(program, plan);
  if (!equivalence.equal)
    throw new Error('compiled policy is not equivalent: ' +
      JSON.stringify(equivalence.mismatches.slice(0, 3)));
  return {
    schema: ARTIFACT_SCHEMA,
    policySchema: program.schema,
    policyId: program.metadata.id,
    policySha256: sha256(canonical),
    planSha256: sha256(plan),
    // Read as written: nothing checks that it is a list.
    sourceDependencies: [...(program.metadata.sourceDependencies ?? []) as unknown[]],
    calibrationProfile: program.metadata.calibrationProfile ?? null,
    execution: {
      mode: 'compiled-ir',
      capture: 'low-cost',
      postRunAnalysis: 'explicit-resource-capped',
      automaticHostAnalysis: false,
    },
    // The canonical bytes of the program validated above.
    policy: JSON.parse(canonical) as PolicyProgram,
    canonicalPolicy: canonical,
    compiledPlan: plan,
  };
}

/**
 * A verified artifact: its policy, canonical bytes and plan, and the two
 * digests checked against them. Its other fields are carried as written.
 */
type VerifiedArtifact = Readonly<Record<string, unknown>> & {
  readonly schema: typeof ARTIFACT_SCHEMA, readonly policy: PolicyProgram, readonly canonicalPolicy: string,
  readonly compiledPlan: string, readonly policySha256: string, readonly planSha256: string,
};

export function verifyPolicyArtifact(artifact: unknown, plan: unknown = isRecord(artifact) ? artifact.compiledPlan : undefined) {
  if (!isRecord(artifact) || artifact.schema !== ARTIFACT_SCHEMA)
    throw new TypeError('policy artifact schema mismatch');
  if (typeof artifact.canonicalPolicy !== 'string' ||
      typeof artifact.compiledPlan !== 'string')
    throw new TypeError('policy artifact is missing its canonical policy or compiled plan');
  const policy = validatePolicy(artifact.policy);
  const canonical = canonicalPolicy(artifact.policy);
  if (canonical !== artifact.canonicalPolicy)
    throw new Error('policy artifact canonical bytes do not match policy');
  if (sha256(canonical) !== artifact.policySha256)
    throw new Error('policy artifact policySha256 does not match canonical bytes');
  const expectedPlan = compileDevicePlan(policy);
  if (expectedPlan !== artifact.compiledPlan)
    throw new Error('policy artifact compiledPlan differs from the canonical compiler output');
  if (sha256(artifact.compiledPlan) !== artifact.planSha256)
    throw new Error('policy artifact planSha256 does not match compiledPlan bytes');
  if (plan !== artifact.compiledPlan)
    throw new Error('runner plan bytes differ from the policy artifact compiledPlan');
  const equivalence = comparePolicyToDevice(policy, plan);
  if (!equivalence.equal)
    throw new Error('policy artifact equivalence failed: ' +
      JSON.stringify(equivalence.mismatches.slice(0, 3)));
  return clone(artifact) as VerifiedArtifact;
}

export function gatePolicyArtifact(program: PolicyProgram = minimalPolicy(), runs = 200) {
  const untilMs = program.phases.find(phase => phase.kind === 'observe')?.endMs;
  for (const worst of [false, true]) {
    const count = worst ? Math.min(100, runs) : runs;
    let survived = 0;
    const losses: number[] = [];
    for (let i = 0; i < count; i++) {
      const result = replayPolicy(program, {
        night: program.metadata.nights[0],
        seed: smokeSeed(i),
        worst,
        untilMs,
      });
      if (result.sim.won) survived++;
      else losses.push(result.sim.death?.frame ?? Infinity);
    }
    const artifactOnly = worst && survived === 0 &&
      losses.length === count &&
      losses.every(frame => frame < (phaseOf(program, 'repeat').startMs * 60 / 1000));
    if (survived !== count && !artifactOnly)
      throw new Error('policy artifact exact ' + (worst ? 'worst' : 'normal') +
        ' gate failed: ' + survived + '/' + count);
    console.log('policy artifact exact ' + (worst ? 'worst' : 'normal') +
      ' gate: ' + survived + '/' + count);
  }
  return true;
}

function argument(name: string) {
  const index = process.argv.indexOf(name);
  return index < 0 ? null : process.argv[index + 1];
}

function writeMetadata(path: string | null, artifact: Readonly<Record<string, unknown>>) {
  if (!path) return;
  writeFileSync(path, [
    'policy_schema=' + artifact.policySchema,
    'policy_id=' + artifact.policyId,
    'policy_sha256=' + artifact.policySha256,
    'plan_sha256=' + artifact.planSha256,
    'artifact_schema=' + artifact.schema,
  ].join('\n') + '\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes('--verify')) {
    const artifactPath = argument('--artifact');
    if (!artifactPath) throw new Error('--verify requires --artifact PATH');
    const artifact = JSON.parse(readFileSync(artifactPath, 'utf8'));
    const planPath = argument('--plan');
    const plan = planPath ? readFileSync(planPath, 'utf8') : undefined;
    const verified = verifyPolicyArtifact(artifact, plan);
    writeMetadata(argument('--metadata'), verified);
    console.log('policy artifact: verified ' + verified.policyId +
      ' (policy ' + verified.policySha256 + ', plan ' + verified.planSha256 + ')');
  } else {
    if (!process.argv.includes('--minimal'))
      throw new Error('the only live policy artifact target is --minimal Night 1');
    const artifact = compilePolicyArtifact();
    if (process.argv.includes('--gate')) gatePolicyArtifact(artifact.policy);
    const planPath = argument('--plan');
    const artifactPath = argument('--artifact');
    if (planPath) writeFileSync(planPath, artifact.compiledPlan);
    if (artifactPath)
      writeFileSync(artifactPath, JSON.stringify(artifact, null, 2) + '\n');
    writeMetadata(argument('--metadata'), artifact);
    if (!planPath) process.stdout.write(artifact.compiledPlan);
  }
}
