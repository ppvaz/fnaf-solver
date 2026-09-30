/** Pure experiment primitives shared by named research cases. */
import { PlantModel } from '@sixam/source/fnaf2';
import { stableHash, validateExperiment, validateExperimentResult } from '@sixam/kernel/contracts';
import { validateControlCommand } from '@sixam/source';
import { summarizeMinusToys } from './families/minus-toys.js';
import { summarizeMinusTwo } from './families/minus-two.js';

export { runMinusToys, summarizeMinusToys } from './families/minus-toys.js';
export { runMinusTwo, summarizeMinusTwo } from './families/minus-two.js';

const FAMILY_EVALUATORS = Object.freeze({
  'minus-toys-v1': summarizeMinusToys,
  'minus-two-v1': summarizeMinusTwo,
});

function expandCandidateParameters(spec) {
  if (spec.candidateSpace?.kind !== 'cartesian')
    return Array.isArray(spec.candidateParameters) && spec.candidateParameters.length
      ? spec.candidateParameters : [{}];
  const dimensions = Object.entries(spec.candidateSpace.dimensions ?? {})
    .filter(([, values]) => Array.isArray(values) && values.length);
  if (!dimensions.length) throw new TypeError(`${spec.id}: cartesian candidate space has no dimensions`);
  return dimensions.reduce((combinations, [key, values]) =>
    combinations.flatMap(partial => values.map(value => ({ ...partial, [key]: value }))), [{}]);
}

export function generateCandidates(spec) {
  validateExperiment(spec);
  const parameters = expandCandidateParameters(spec);
  if (spec.evaluator && !FAMILY_EVALUATORS[spec.evaluator])
    throw new TypeError(`unknown research evaluator: ${spec.evaluator}`);
  if (spec.evaluator || spec.candidateSpace) {
    return Object.freeze(spec.seeds.flatMap(seed => parameters.map((parameter, index) =>
      Object.freeze({
        id: `${spec.id}-${parameter.label ?? index + 1}-seed-${seed}`,
        seed,
        parameters: Object.freeze({ ...parameter }),
      }))));
  }
  return Object.freeze(spec.seeds.map((seed, index) => Object.freeze({
    id: `${spec.id}-${index + 1}`, seed,
    parameters: Object.freeze(parameters[index] ? { ...parameters[index] } : {}),
  })));
}

export function evaluateModelCandidate(spec, candidate) {
  if (spec.evaluator) {
    const summary = FAMILY_EVALUATORS[spec.evaluator]({
      seed: candidate.seed, ...candidate.parameters,
    });
    return { candidateId: candidate.id, seed: candidate.seed,
      parameters: candidate.parameters, ...summary };
  }
  const model = new PlantModel({ seed: candidate.seed, night: spec.night ?? 7,
    durationFrames: spec.durationFrames ?? 60, lethal: spec.lethal ?? false });
  const defaults = [
    { at: 0, action: { kind: 'press', control: 'monitor' } },
    { at: 12, action: { kind: 'select', control: 'cam:10' } },
  ];
  const generatedRows = Array.isArray(candidate.parameters.cameraOrder)
    ? [
      { at: 0, action: { kind: 'press', control: 'monitor' } },
      ...candidate.parameters.cameraOrder.map((camera, index) => ({
        at: candidate.parameters.cameraFrames?.[index] ?? 12 + index * 20,
        action: { kind: 'select', control: `cam:${camera}` },
      })),
      { at: candidate.parameters.cameraFrames?.length
          ? candidate.parameters.cameraFrames.at(-1) + 12 : 72,
        action: { kind: 'release', control: 'monitor' } },
    ] : null;
  const rows = generatedRows ?? spec.commands ?? defaults;
  const explicit = candidate.parameters.commandAtFrames;
  const offset = Number.isInteger(candidate.parameters.offsetFrames) ? candidate.parameters.offsetFrames : 0;
  let at = model.frame;
  for (const [index, row] of rows.entries()) {
    const requestedAt = Number.isInteger(explicit?.[index]) ? explicit[index] : row.at;
    const frame = Math.max(at, requestedAt + offset);
    if (frame > model.frame) model.advance(frame);
    if (!model.alive) break;
    const command = validateControlCommand({
      schema: 'control-command-v1', id: `${candidate.id}-command-${index + 1}`,
      action: { ...row.action }, requestedAt: { clock: 'game-frame', value: frame },
      source: { controller: spec.id, policyHash: stableHash(candidate.parameters) },
    });
    model.apply(command);
    at = frame;
  }
  model.advance(spec.durationFrames ?? 60);
  return {
    candidateId: candidate.id,
    seed: candidate.seed,
    parameters: candidate.parameters,
    traceHash: stableHash(model.events),
    terminal: model.terminalState(),
    eventCount: model.events.length,
  };
}

const survived = evaluation => evaluation.won === true || evaluation.terminal?.won === true;
const frameOf = evaluation => evaluation.terminal?.frame ?? null;

function wilson(successes, count, z = 1.96) {
  if (!count) return { low: 0, high: 0 };
  const p = successes / count;
  const denominator = 1 + z * z / count;
  const centre = p + z * z / (2 * count);
  const spread = z * Math.sqrt((p * (1 - p) + z * z / (4 * count)) / count);
  return { low: Math.max(0, (centre - spread) / denominator), high: Math.min(1, (centre + spread) / denominator) };
}

function campaignSummary(spec, evaluations) {
  const groups = new Map();
  for (const evaluation of evaluations) {
    const label = evaluation.parameters?.label ??
      (Array.isArray(evaluation.parameters?.cameraOrder)
        ? `order:${evaluation.parameters.cameraOrder.join('-')}/offset:${evaluation.parameters.offsetFrames ?? 0}`
        : evaluation.candidateId);
    const group = groups.get(label) ?? { candidate: label, successes: 0, frames: [], evaluations: 0 };
    group.evaluations++;
    if (survived(evaluation)) group.successes++;
    const frame = frameOf(evaluation);
    if (frame !== null) group.frames.push(frame);
    groups.set(label, group);
  }
  const statistics = [...groups.values()].map(group => ({
    candidate: group.candidate, sampleCount: group.evaluations,
    successes: group.successes, survivalRate: group.successes / group.evaluations,
    confidence: { level: 0.95, interval: wilson(group.successes, group.evaluations) },
    meanTerminalFrame: group.frames.length
      ? group.frames.reduce((sum, frame) => sum + frame, 0) / group.frames.length : null,
  }));
  const ranking = statistics.slice().sort((a, b) =>
    b.survivalRate - a.survivalRate || (b.meanTerminalFrame ?? -1) - (a.meanTerminalFrame ?? -1) ||
    a.candidate.localeCompare(b.candidate));
  return {
    method: spec.search?.method ?? 'fixed-candidate-set',
    candidateSpace: spec.search?.candidateSpace ?? 'declared-candidateParameters',
    candidateCount: statistics.length, statistics, ranking,
    rejectionReasons: [],
  };
}

export function aggregateExperiment(spec, evaluations) {
  const result = {
    schema: 'experiment-result-v1', operation: spec.operation, verdict: 'MODEL_ONLY',
    outcome: 'COMPLETED', modelHash: spec.modelHash, specHash: stableHash(spec),
    sample: { firstSeed: spec.seeds[0], count: evaluations.length, seeds: [...new Set(evaluations.map(item => item.seed))] },
    evaluations, claimLevel: spec.claimLevel,
    profile: spec.profile ?? 'simulator-fixture',
    family: spec.family ?? 'canonical-plant',
    campaign: campaignSummary(spec, evaluations),
    reproducer: { case: spec.id, command: `npm run research -- ${spec.id}`, seeds: [...spec.seeds] },
  };
  return validateExperimentResult(result);
}

export function runModelExperiment(spec) {
  const candidates = generateCandidates(spec);
  return aggregateExperiment(spec, candidates.map(candidate => evaluateModelCandidate(spec, candidate)));
}

export function makeResultPayload(evaluation, evidenceId) {
  return {
    ...evaluation,
    evidenceId,
    terminal: evaluation.evaluations[0]?.terminal,
    eventCount: evaluation.evaluations.reduce((sum, item) => sum + item.eventCount, 0),
  };
}

/** Rebuild the exact result payload used by the CLI without mutating artifacts. */
export function replayModelResult(spec, result) {
  if (!result || typeof result.evidenceId !== 'string') throw new TypeError('replay needs an evidence id');
  const evaluation = runModelExperiment(spec);
  const payload = makeResultPayload(evaluation, result.evidenceId);
  return { evaluation, payload, resultHash: stableHash(payload) };
}
