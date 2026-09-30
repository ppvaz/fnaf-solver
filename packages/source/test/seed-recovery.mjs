#!/usr/bin/env node
// Stock-APK RNG hypothesis tooling.
//
// Examples:
//   node packages/source/test/seed-recovery.mjs window --center-ms 1760000000123 --half-width-ms 8
//   node packages/source/test/seed-recovery.mjs clock-window clock-sample.json
//   node packages/source/test/seed-recovery.mjs filter trace.json
//
// `filter` accepts the JSON contract documented in
// docs/device/RNG-SEED-RECOVERY.md. Roll filtering can scan all 65,536 seeds;
// event replay intentionally has a smaller default bound because it invokes
// the full simulator once per candidate.
import { readFileSync } from 'node:fs';
import { SEED_SPACE, filterSeedCandidatesByEvents, filterSeedCandidatesByRolls, normalizeSeedCandidates, seedCandidatesFromHostMarker, seedCandidatesFromTimeWindow } from '@sixam/source/fnaf2';

const args = process.argv.slice(2);
const command = args[0];

function value(name, fallback = undefined) {
  const prefix = `--${name}=`;
  const inline = args.find(arg => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : fallback;
}

function hasFlag(name) { return args.includes(`--${name}`) || args.some(arg => arg.startsWith(`--${name}=`)); }

function numberOption(name, fallback = undefined) {
  const raw = value(name, fallback);
  if (raw === undefined) return undefined;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed)) throw new TypeError(`--${name} must be an integer`);
  return parsed;
}

function inputPath() {
  const explicit = value('input');
  if (explicit) return explicit;
  const positional = args.slice(1).find(arg => !arg.startsWith('--'));
  return positional;
}

function readJson(file) {
  if (!file) throw new Error('an input JSON path is required');
  const text = file === '-' ? readFileSync(0, 'utf8') : readFileSync(file, 'utf8');
  return JSON.parse(text);
}

function sampleFromInput(input) {
  if (Array.isArray(input.samples)) {
    const index = numberOption('sample-index', 0);
    if (index < 0 || index >= input.samples.length)
      throw new RangeError(`--sample-index must be in 0..${input.samples.length - 1}`);
    return input.samples[index];
  }
  return input;
}

function print(valueToPrint) {
  process.stdout.write(`${JSON.stringify(valueToPrint, null, 2)}\n`);
}

function usage() {
  process.stderr.write([
    'usage:',
    '  seed-recovery.mjs window --center-ms MS --half-width-ms MS',
    '  seed-recovery.mjs window --start-ms MS --end-ms MS',
    '  seed-recovery.mjs clock-window SAMPLE.json',
    '  seed-recovery.mjs marker-window SAMPLE.json --host-marker-ms MS',
    '  seed-recovery.mjs filter TRACE.json [--mode=rolls|events]',
  ].join('\n') + '\n');
  process.exitCode = 2;
}

try {
  if (command === 'window') {
    const centerMs = numberOption('center-ms');
    const halfWidthMs = numberOption('half-width-ms');
    const startMs = numberOption('start-ms');
    const endMs = numberOption('end-ms');
    print(seedCandidatesFromTimeWindow({ centerMs, halfWidthMs, startMs, endMs }));
  } else if (command === 'clock-window') {
    const sample = sampleFromInput(readJson(inputPath()));
    if (sample.status && sample.status !== 'READY')
      throw new Error(`clock sample is not READY: ${sample.reason ?? sample.status}`);
    const window = sample.deviceWindow ?? {
      startMs: sample.deviceMs - sample.uncertaintyMs,
      endMs: sample.deviceMs + sample.uncertaintyMs,
    };
    print({ sample, ...seedCandidatesFromTimeWindow(window) });
  } else if (command === 'marker-window') {
    const input = readJson(inputPath());
    const sample = sampleFromInput(input);
    const hostMarkerMs = numberOption('host-marker-ms');
    const markerUncertaintyMs = numberOption('marker-uncertainty-ms', 0);
    if (hostMarkerMs === undefined) throw new Error('--host-marker-ms is required');
    print(seedCandidatesFromHostMarker({ hostMarkerMs, clockSample: sample, markerUncertaintyMs }));
  } else if (command === 'filter') {
    const input = readJson(inputPath());
    const mode = value('mode', input.mode ?? (input.rolls ? 'rolls' : 'events'));
    let candidates = input.candidates ?? input.seedCandidates;
    if (candidates === undefined) {
      if (mode !== 'rolls' && !hasFlag('all-seeds'))
        throw new Error('event filtering needs candidates; use --all-seeds only deliberately');
      candidates = Array.from({ length: SEED_SPACE }, (_, seed) => seed);
    }
    if (mode === 'rolls') {
      print(filterSeedCandidatesByRolls({
        candidates,
        observations: input.observations ?? input.rolls,
      }));
    } else if (mode === 'events') {
      const maxCandidates = numberOption('max-candidates', input.maxCandidates ?? 4096);
      print(filterSeedCandidatesByEvents({
        candidates: normalizeSeedCandidates(candidates),
        simOptions: input.simOptions ?? input.options ?? {},
        actions: input.actions ?? [],
        observations: input.observations ?? [],
        untilFrame: input.untilFrame,
        maxCandidates,
      }));
    } else {
      throw new Error(`unsupported filter mode: ${mode}`);
    }
  } else {
    usage();
  }
} catch (error) {
  process.stderr.write(`seed-recovery: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
