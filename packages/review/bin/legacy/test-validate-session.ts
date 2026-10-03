#!/usr/bin/env node
// Synthetic contract for the v1 session manifest/event validator.
//
// The point of this gate is not that a good session passes. It is that each way of being wrong fails for its
// *own* stated reason: a validator that rejects everything with one generic error is indistinguishable from one
// that rejects everything, and would let the next malformed session be explained away.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { extname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const TOOL = fileURLToPath(new URL('validate-session.ts', import.meta.url));
const DATA = fileURLToPath(new URL('../../test/legacy-session', import.meta.url));
const SCHEMA = fileURLToPath(new URL('schema', import.meta.url));

const run = (manifest: string, events: string | null = null, asJson = false) => spawnSync(process.execPath,
  [TOOL, join(DATA, manifest), ...(events ? ['--events', join(DATA, events)] : []), ...(asJson ? ['--json'] : [])], { encoding: 'utf8' });

function report(text: string): { ok: unknown, failures: unknown } {
  const value: unknown = JSON.parse(text);
  assert.ok(value !== null && typeof value === 'object' && 'ok' in value && 'failures' in value, text);
  return { ok: value.ok, failures: value.failures };
}

function firstCode(manifest: string, events: string | null = null) {
  const result = run(manifest, events, true);
  assert.equal(result.status, 1, `${manifest}: ${result.stdout}${result.stderr}`);
  const payload = report(result.stdout);
  assert.equal(payload.ok, false, result.stdout);
  const failures = payload.failures;
  assert.ok(Array.isArray(failures) && failures.length, result.stdout);
  const first: unknown = failures[0];
  assert.ok(first !== null && typeof first === 'object' && 'code' in first, result.stdout);
  return first.code;
}

const snapshot = () => new Map(readdirSync(DATA).map(name => [name, readFileSync(join(DATA, name))]));

test('each malformed session fails for its own reason, and the validator is read-only', () => {
  // The fixtures are the committed evidence, so they may never quietly become game media or a real device's identity.
  for (const name of readdirSync(DATA)) assert.ok(['.json', '.jsonl'].includes(extname(name)), `non-synthetic fixture type in testdata: ${name}`);
  const before = snapshot();

  // The schemas must still carry all twelve minimum field groups from docs/device/OBSERVATION-CORPUS-INVENTORY.md.
  // Dropping one is how a contract silently stops representing provenance.
  const manifestSchema: unknown = JSON.parse(readFileSync(join(SCHEMA, 'session-manifest-v1.json'), 'utf8'));
  const eventSchema: unknown = JSON.parse(readFileSync(join(SCHEMA, 'session-events-v1.json'), 'utf8'));
  assert.ok(manifestSchema !== null && typeof manifestSchema === 'object' && 'field_groups' in manifestSchema && 'supported_versions' in manifestSchema);
  assert.ok(eventSchema !== null && typeof eventSchema === 'object' && 'supported_versions' in eventSchema);
  const groups = manifestSchema.field_groups;
  assert.ok(Array.isArray(groups));
  assert.deepEqual(groups.map((group: unknown) => (group !== null && typeof group === 'object' && 'group' in group ? group.group : null)),
    Array.from({ length: 12 }, (_, k) => k + 1));
  for (const group of groups) {
    assert.ok(group !== null && typeof group === 'object', JSON.stringify(group));
    const paths = [('manifest_paths' in group ? group.manifest_paths : null), ('event_paths' in group ? group.event_paths : null)];
    assert.ok(paths.some(entry => Array.isArray(entry) && entry.length), JSON.stringify(group));
  }
  assert.deepEqual(manifestSchema.supported_versions, [1]);
  assert.deepEqual(eventSchema.supported_versions, [1]);

  // Positive fixtures. Two of them, because a win rule that is never exercised and a win rule that is vacuous look
  // identical from one passing session.
  for (const manifest of ['valid-night6-win.manifest.json', 'valid-aborted-unknown.manifest.json']) {
    const result = run(manifest);
    assert.equal(result.status, 0, `${manifest}: ${result.stderr}`);
    assert.ok(result.stdout.includes('validates against fnaf2.session-manifest v1'), result.stdout);
  }

  // Each way of being wrong, and the reason it must fail with.
  const expected = new Map([
    ['bad-schema-version.manifest.json', 'schema-version-unsupported'], ['bad-mixed-builds.manifest.json', 'mixed-game-builds'],
    ['bad-missing-hash.manifest.json', 'artifact-hash-missing'], ['bad-stale-model.manifest.json', 'model-stale'],
    ['bad-cross-clock.manifest.json', 'clock-alignment-missing'], ['bad-false-win.manifest.json', 'false-win-evidence'],
    ['bad-secret.manifest.json', 'secret-in-commit-safe-metadata'],
  ]);
  const seen = new Map<unknown, string>();
  for (const [manifest, code] of expected) {
    assert.equal(firstCode(manifest), code, manifest);
    seen.set(code, manifest);
  }
  assert.equal(seen.size, expected.size);

  // Event-stream defects fail on their own terms too, against a manifest that is otherwise valid -- so the reason
  // cannot be blamed on the manifest.
  assert.equal(firstCode('valid-night6-win.manifest.json', 'bad-event-order.events.jsonl'), 'event-out-of-order');
  assert.equal(firstCode('valid-night6-win.manifest.json', 'bad-shadow-model-live.events.jsonl'), 'model-unauthorized');

  // A stale model and a shadow model driving a live decision are different faults; neither may be reported as the
  // other.
  assert.notEqual(seen.get('model-stale'), 'model-unauthorized');

  // The secret lint is a positive control, not a claim about the fixture's innocence: the same manifest without
  // the token passes.
  assert.equal(report(run('valid-night6-win.manifest.json', null, true).stdout).ok, true);

  // Usage failure is distinct from validation failure, so a typo in a path can never be read as a passing or
  // failing session.
  assert.equal(run('no-such.json').status, 2);

  assert.deepEqual(snapshot(), before, 'validator modified a fixture');
});
