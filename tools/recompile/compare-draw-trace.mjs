#!/usr/bin/env node
// Content-free summary of an external harness trace versus the no-input model.
// node tools/recompile/compare-draw-trace.mjs --trace FILE --night 1 --seed 24850
//   --frame 3 --frames 18000 --out FILE [--binary FILE] [--input FILE] [--save FILE] [--model-options FILE] [--repeat-trace FILE]
// Raw game values, names, source and assets never enter the output.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { drawTrace } from './model-draw-trace.mjs';

const hash = (value) => createHash('sha256').update(value).digest('hex');
const fileHash = (path) => hash(readFileSync(path));

export function compareTrace(text, { night, seed, frame, frames, modelOptions = {} }) {
  if (!text.endsWith('\n')) throw new Error('trace is truncated: missing final newline');
  const visits = [];
  const rows = [];
  const projection = [];
  let visit = null;
  let stop = null;
  let touches = 0;
  for (const line of text.split('\n')) {
    const match = /^# frame (\d+) seeded (\d+)$/.exec(line);
    if (match) {
      visit = { frame: Number(match[1]), seed: Number(match[2]), updates: 0 };
      visits.push(visit);
    } else if (line.startsWith('# stop ')) stop = line.slice(7);
    else if (line.startsWith('# touch ')) touches += 1;
    else if (line && !line.startsWith('#')) {
      const fields = line.split(/\s+/).slice(0, 4).map(Number);
      if (fields.length !== 4 || fields.some((n) => !Number.isInteger(n) || n < 0)) throw new Error('invalid harness row');
      const [index, tick, draws, state] = fields;
      if (!visit || index !== visit.frame || tick !== visit.updates) throw new Error('trace is truncated or visits are interleaved');
      visit.updates += 1;
      projection.push(fields.join(' '));
      if (index === frame) rows.push({ tick, draws, state });
    }
  }
  const model = drawTrace({ night, seed, frames, modelOptions });
  const targetVisits = visits.filter((v) => v.frame === frame);
  const alignments = [0, 1].map((offset) => {
    let compared = 0;
    let firstMismatch = null;
    for (const row of rows) {
      const expected = model.out[row.tick + offset];
      if (!expected) break;
      compared += 1;
      if (!firstMismatch && (row.draws !== expected.draws || row.state !== expected.state)) {
        firstMismatch = { tick: row.tick, modelFrame: expected.frame,
          rebuilt: { draws: row.draws, state: row.state }, model: { draws: expected.draws, state: expected.state } };
      }
    }
    return { modelFrameOffset: offset, compared, firstMismatch };
  });
  const alignment = alignments[1];
  const status = !rows.length ? 'TARGET_NOT_REACHED'
    : targetVisits.length !== 1 || targetVisits[0].seed !== (seed & 65535) ? 'INVALID_COMPARISON'
      : alignment.firstMismatch ? 'DIVERGENT'
        : alignment.compared < Math.min(frames, model.out.length - 1) ? 'INCOMPLETE' : 'MATCHED_PREFIX';
  const result = {
    schema: 'recompile-draw-comparison-v1', claimLevel: 'MODEL_ONLY', fidelity: 'rebuilt-runtime', status,
    question: 'Does the rebuilt no-input night consume the same Random stream per event update as the simulator?',
    scope: { night, seed, targetFrame: frame, requestedModelFrames: frames, modelOptions, input: 'navigation only; no gameplay actions' },
    runtime: { visits, targetUpdates: rows.length, namedTouches: touches, stop, traceSha256: hash(text), drawTraceSha256: hash(`${projection.join('\n')}\n`) },
    model: { traceSha256: hash(JSON.stringify(model)), terminal: model.out.at(-1), death: model.death, won: model.won },
    alignment: 'Harness tick 0 is after its first event update, compared to model frame 1. Offset 0 is also retained to expose an initialization boundary discrepancy.',
    alignments,
    limitations: ['Host reimplementation; no device claim or promotion.',
      'Matching draws is necessary but insufficient for event/state equivalence.',
      'Touch triggers are polled once per update; Android immediate event ordering remains unverified.',
      'Both traces must describe the same night, seed and input; the operator must retain input/save provenance.'],
  };
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = {};
  for (let i = 2; i < process.argv.length; i += 2) {
    if (!['--trace', '--night', '--seed', '--frame', '--frames', '--out', '--binary', '--input', '--save', '--model-options', '--repeat-trace'].includes(process.argv[i]) || !process.argv[i + 1]) throw new Error('see usage at top of file');
    args[process.argv[i].slice(2)] = process.argv[i + 1];
  }
  if (!args.trace || !args.out) throw new Error('--trace and --out are required');
  const settings = { night: Number(args.night ?? 1), seed: Number(args.seed ?? 24850), frame: Number(args.frame ?? 3), frames: Number(args.frames ?? 18000) };
  if (Object.values(settings).some((v) => !Number.isInteger(v) || v < 0) || settings.frames === 0) throw new Error('invalid numeric argument');
  settings.modelOptions = args['model-options'] ? JSON.parse(readFileSync(args['model-options'], 'utf8')) : {};
  if (args.input && readFileSync(args.input, 'utf8').split('\n').some((line) => line.trim() && !line.trim().startsWith('#') && Number(line.trim().split(/\s+/)[0]) === settings.frame)) {
    throw new Error('this comparison accepts navigation-only input; gameplay input needs a corresponding model replay');
  }
  const result = compareTrace(readFileSync(args.trace, 'utf8'), settings);
  if (args['repeat-trace']) {
    const repeat = compareTrace(readFileSync(args['repeat-trace'], 'utf8'), settings);
    result.repeatability = {
      traceSha256: repeat.runtime.traceSha256,
      drawTraceSha256: repeat.runtime.drawTraceSha256,
      drawTraceMatches: repeat.runtime.drawTraceSha256 === result.runtime.drawTraceSha256,
      wholeTraceMatches: repeat.runtime.traceSha256 === result.runtime.traceSha256,
      scope: 'Ordered frame/tick/draw-count/RNG-state projection. Other global values are not covered by draw repeatability.',
    };
  }
  result.provenance = {
    toolSha256: fileHash(new URL(import.meta.url)),
    modelTraceToolSha256: fileHash(new URL('./model-draw-trace.mjs', import.meta.url)),
    patchSha256: fileHash(new URL('./mmfparser-chowdren-mobile.patch', import.meta.url)),
    configSha256: fileHash(new URL('./fnaf2-config.py', import.meta.url)),
    ...Object.fromEntries(['binary', 'input', 'save'].filter((key) => args[key]).map((key) => [`${key}Sha256`, fileHash(args[key])])),
  };
  result.evidenceId = `recompile-draw-${hash(JSON.stringify(result)).slice(0, 16)}`;
  writeFileSync(args.out, `${JSON.stringify(result, null, 2)}\n`);
  console.log(`${result.evidenceId}: ${result.status} (${result.claimLevel}, ${result.fidelity}); target updates ${result.runtime.targetUpdates}`);
}
