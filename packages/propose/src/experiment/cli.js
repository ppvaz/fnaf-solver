#!/usr/bin/env node
/** Experiment composition root; evaluators remain pure core consumers. */
import { isUnknown } from '@sixam/kernel';
import { stableHash, validateArtifactRef } from '@sixam/kernel/contracts';
import { makeResultPayload, runModelExperiment } from './experiment.js';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(join(fileURLToPath(new URL('.', import.meta.url)), '../../../..'));

const CASES = Object.freeze([
  'model-smoke', 'controller-synthesis', 'cycle-optimization',
  'robustness-sweep', 'model-probe', 'device-characterization',
  'minus-toys', 'minus-two',
]);

const help = () => console.log(`fnaf2-research — explicit experiment operations\n\nUsage:\n  npm run research -- --help\n  npm run research -- <case>\n\nCases:\n  ${CASES.join(', ')}\n\nEvery case retains its spec, structured result, and session manifest. Results\nare claim-capped until the Plan 12 promotion ladder supplies external evidence.`);

async function runCase(id) {
  if (!CASES.includes(id)) throw new Error(`unknown experiment case: ${id}`);
  const spec = JSON.parse(await readFile(join(ROOT, 'packages/propose/experiments', `${id}.json`), 'utf8'));
  const evaluation = runModelExperiment(spec);
  const evidenceId = `research-${id}-${stableHash({ specHash: evaluation.specHash, evaluations: evaluation.evaluations }).slice(-10)}`;
  const resultPayload = makeResultPayload(evaluation, evidenceId);
  const result = { ...resultPayload, resultHash: stableHash(resultPayload) };
  const specText = JSON.stringify(spec, null, 2) + '\n';
  const resultText = JSON.stringify(result, null, 2) + '\n';
  const artifact = (locator, text, mediaType, producer) => {
    const ref = { schema: 'artifact-ref-v1', hash: stableHash(text), mediaType,
      producer, size: Buffer.byteLength(text), locator };
    return validateArtifactRef(ref);
  };
  const artifacts = {
    result: artifact('result.json', resultText, 'application/json', 'research-cli'),
    spec: artifact('experiment-spec.json', specText, 'application/json', 'research-cli'),
  };
  // The result event is stamped when the LAST evaluation ended (LEG-009), on
  // the aggregate over every evaluation; an experiment none of whose
  // evaluations reports a terminal frame has no time to stamp, and is refused.
  const ended = result.terminalAggregate;
  if (isUnknown(ended)) throw new Error(`${id}: the result event has no time: ${ended.reason}`);
  const manifestPayload = {
    schema: 'session-manifest-v1', version: 1, id: result.evidenceId,
    targetBuild: 'com.scottgames.fnaf2:2.0.7+26', profile: result.profile,
    profileHash: 'profile-simulator-fixture-v1', modelHash: result.modelHash,
    policyHash: stableHash({ operation: spec.operation, policyFamily: spec.policyFamily }),
    specHash: result.specHash, resultHash: result.resultHash,
    reproducer: result.reproducer,
    events: [{ schema: 'telemetry-event-v1', sessionId: result.evidenceId, type: 'experiment.result', component: 'research', at: { clock: ended.clock, value: ended.frames.hi }, data: { evidenceId: result.evidenceId, resultHash: result.resultHash, verdict: result.verdict, claimLevel: result.claimLevel, terminalFrames: ended.frames, evaluations: ended.evaluations } }],
    artifacts, outcome: 'COMPLETED', redaction: { media: 'none', secrets: 'excluded' },
  };
  const manifest = {
    ...manifestPayload,
    manifestHash: stableHash(manifestPayload),
  };
  const output = join(ROOT, 'artifacts', result.evidenceId);
  await mkdir(output, { recursive: true });
  await writeFile(join(output, 'result.json'), resultText);
  await writeFile(join(output, 'experiment-spec.json'), specText);
  await writeFile(join(output, 'session-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
  console.log(`result=${result.verdict} claim=${result.claimLevel} evidence=${result.evidenceId}`);
}

const operation = process.argv[2];
if (!operation || operation === '--help' || operation === '-h') help();
else await runCase(operation).catch(error => { console.error(`research: ${error.message}`); process.exitCode = 2; });
