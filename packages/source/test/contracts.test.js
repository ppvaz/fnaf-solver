/** Fast contract lane: semantic data is runtime-validated and unknown-safe. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PlantModel } from '../src/games/fnaf2/plant.js';
import {
  canonicalJson, stableHash,
  validateClockRef, validateQualification, validateManifest,
} from '@sixam/kernel/contracts';
import { validateControlCommand } from '../src/clockwork/control-contracts.js';
import { decodeFactMessage } from '@sixam/kernel/time';

const register = JSON.parse(readFileSync(fileURLToPath(new URL('../../kernel/contracts/register.json', import.meta.url)), 'utf8'));
const catalog = JSON.parse(readFileSync(fileURLToPath(new URL('../../../docs/architecture/generated/contract-specifications.json', import.meta.url)), 'utf8'));
assert.equal(catalog.specifications.length, register.contracts.length);
for (const entry of register.contracts) assert.ok(catalog.specifications.some(spec => spec.contractId === entry.id && spec.runtimeValidation === entry.validator));

const command = { schema: 'control-command-v1', id: 'cmd-1', action: { kind: 'press', control: 'mask' }, requestedAt: { clock: 'game-frame', value: 0 }, source: { controller: 'test' } };
assert.equal(validateControlCommand(command), command);
assert.throws(() => validateControlCommand({ ...command, coordinates: { x: 1, y: 2 } }), /physical encoding/);
assert.throws(() => validateClockRef({ clock: 'wall-clock', value: 1 }), /declared clock/);
assert.equal(canonicalJson({ b: 1, a: 2 }), '{"a":2,"b":1}\n');
assert.equal(stableHash({ a: 1 }), stableHash({ a: 1 }));
const vectors = readFileSync(fileURLToPath(new URL('./fixtures/fact-message-v1.jsonl', import.meta.url)), 'utf8').trim().split('\n');
assert.equal(decodeFactMessage(vectors[0] + '\n').value, true);
assert.equal(decodeFactMessage(vectors[1] + '\n').state, 'UNKNOWN');
const commandVectors = readFileSync(fileURLToPath(new URL('./fixtures/semantic-control-v1.jsonl', import.meta.url)), 'utf8').trim().split('\n').map(line => JSON.parse(line));
assert.doesNotThrow(() => validateControlCommand(commandVectors[0]));
assert.throws(() => validateControlCommand(commandVectors[1]), /physical encoding/);

const model = new PlantModel({ seed: 1, night: 7, durationFrames: 8, lethal: false });
model.apply(command); model.advance(8);
assert.equal(model.frame, 8);
assert.equal(model.terminalState().alive, true);
// Retained-run contracts: a qualification the campaign preflight binds, and a
// session manifest the evidence index reads (research sessions write them).
const qualification = { schema: 'qualification-v1', policyHash: 'p', modelHash: 'm', sampleCount: 16,
  verdict: 'PASS', evidenceId: 'q-1' };
assert.equal(validateQualification(qualification), qualification);
for (const broken of [{ ...qualification, sampleCount: 0 }, { ...qualification, verdict: 'QUALIFIED' },
  { ...qualification, evidenceId: '' }, { ...qualification, schema: 'qualification-v0' }])
  assert.throws(() => validateQualification(broken), /qualification is incomplete/);
const manifest = { schema: 'session-manifest-v1', id: 's-1', profileHash: 'h', targetBuild: 'b', artifacts: {},
  events: [{ schema: 'telemetry-event-v1', sessionId: 's-1', type: 'experiment.result', component: 'research',
    at: { clock: 'simulator-frame', value: 0 } }] };
assert.equal(validateManifest(manifest), manifest);
assert.throws(() => validateManifest({ ...manifest, events: [{ ...manifest.events[0], component: undefined }] }),
  /telemetry event is incomplete/);
assert.throws(() => validateManifest({ ...manifest, artifacts: null }), /session manifest is incomplete/);
console.log('core contracts: semantic command, clock, PlantModel, qualification and session manifest pass');
