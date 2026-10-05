import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = dirname(fileURLToPath(import.meta.url));
const root = resolve(directory, '../../..');
const report = 'docs/research/ANDROID-EXECUTION-DECISION-LIMITS-20261005.md';
const paths = [
  report,
  'CLAUDE.md',
  'plans/ROADMAP.md',
  'docs/device/ACCESSIBILITY-VS-HID-BENCHMARK.md',
  'docs/device/REAL-TIME-CLOSED-LOOP-ARCHITECTURE.md',
  'docs/device/HID-MULTITOUCH.md',
  'docs/device/accessibility-hid-pilot-20260906.json',
  'docs/device/accessibility-game-acceptance-20260906.json',
  'docs/evidence/companion-capture-cpu-20261001.json',
  'docs/evidence/companion16-region-under-trace-20261001.json',
  'docs/evidence/clock-map-20260905-moto-g56-helper.json',
  'docs/evidence/phone-release-latency-20261001.json',
  'docs/evidence/runtime-cost-20261005/result.json',
  'android/companion/src/com/ppvaz/fnafcompanion/CaptureService.java',
  'android/companion/src/com/ppvaz/fnafcompanion/NightRunner.java',
  'android/companion/src/com/ppvaz/fnafcompanion/TermuxBridge.java',
  'packages/play/src/campaign/hid-schedule.ts',
  'packages/propose/bin/plans/recipe.ts',
  'packages/propose/bin/plans/artifact-commands.ts',
];
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const text = readFileSync(resolve(root, report), 'utf8');
const urls = [...new Set([...text.matchAll(/\]\((https:\/\/[^)]+)\)/g)].map(match => match[1]))];
const sourceHashes = Object.fromEntries(paths.map(path => [path, sha256(readFileSync(resolve(root, path)))]));
const n = Math.ceil(Math.log(0.05) / Math.log(0.999));
const record = {
  schema: 'android-execution-decision-limits-v1',
  date: '2026-10-05',
  step: ['S4'],
  claimLevel: 'MODEL_ONLY',
  provenanceKind: 'literature-and-code-synthesis-with-scoped-existing-measurements',
  question: 'What execution and decision limits apply to Host↔Android and Android-only interaction?',
  verdict: 'CONDITIONAL_LIMITS_IDENTIFIED; UNIVERSAL_NUMERIC_CEILING_UNKNOWN',
  scope: { deviceTouched: false, newDeviceMeasurement: false, productionChanged: false, stepClosureClaim: false },
  subject: { commit: git(['rev-parse', 'HEAD']), dirtyInputs: git(['status', '--short', '--', ...paths]), sourceHashes },
  report,
  externalSources: urls.map(url => ({ url, consultedOn: '2026-10-05', archivedSourceBody: false })),
  derivations: {
    idealPeriodicObservation: [60, 120].map(hz => ({ hz, periodMs: 1000 / hz, meanWaitMsIfUniformPhase: 500 / hz, guaranteedAndroidBound: false })),
    zeroFailureBinomial: { confidence: 0.95, assumptions: 'IID, stationary trials; no extrapolation across conditions', upperFailureProbabilityAt1000: 1 - Math.pow(0.05, 1 / 1000), trialsForUpperFailureProbability001: n },
  },
  findings: [
    'No universal full-loop latency or accepted-action-rate ceiling follows from Android APIs or these project measurements.',
    'The current host lane already executes precompiled HID schedules locally.',
    'The Companion+Termux candidate still uses local ADB shell authority.',
    'Frame rate, fixture event receipt, game acceptance and visual confirmation are distinct quantities.',
    'FUSION_POLL_MS=33 is not retained measurement of retail polling frequency.',
    'The local fast path with asynchronous host computation is a recommendation, not a measured architecture ranking.',
  ],
  open: ['retail polling frequency', 'per-control response deadlines', 'event-to-acceptance distribution', 'paired placement benchmark', 'Android policy runtime and sustained contention', 'self-contained actuator qualification', 'global policy ceiling'],
  reproducer: 'node docs/evidence/android-execution-decision-limits-20261005/generate.mjs',
  generatorSha256: sha256(readFileSync(fileURLToPath(import.meta.url))),
};
const evidenceId = `android-execution-decision-limits-${sha256(JSON.stringify(record)).slice(0, 16)}`;
writeFileSync(resolve(directory, 'result.json'), `${JSON.stringify({ ...record, evidenceId }, null, 2)}\n`);
console.log(evidenceId);
