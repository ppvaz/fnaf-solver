// Recheck retained DEVICE_MEASURED arithmetic without a phone, APK or media.
// Corrupted copies below are FIXTURE controls, never new device measurements.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { isRecord, isList } from '@sixam/kernel';

function object(value: unknown) {
  if (!isRecord(value)) assert.fail('expected a record');
  return value;
}
function list(value: unknown) {
  if (!isList(value)) assert.fail('expected a list');
  return value;
}
function numeric(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value)) assert.fail('expected a finite number');
  return value;
}
function text(value: unknown) {
  if (typeof value !== 'string') assert.fail('expected text');
  return value;
}
function read(name: string) {
  const value: unknown = JSON.parse(readFileSync(new URL(`../../../../docs/evidence/${name}.json`, import.meta.url), 'utf8'));
  return object(value);
}

function recheckTrial(value: unknown) {
  const t = object(value), d = object(t.predeclaration), result = object(t.result);
  const samples = list(t.fitSamples).map(object), fit = object(d.clockFit), baseline = object(d.baseline);
  const points = samples.map(r => ({ u: numeric(r.u), at: numeric(r.hostReceiptMs) }));
  assert(points.length >= 30);
  const mu = points.reduce((s, r) => s + r.u, 0) / points.length;
  const mt = points.reduce((s, r) => s + r.at, 0) / points.length;
  const period = points.reduce((s, r) => s + (r.u - mu) * (r.at - mt), 0) /
    points.reduce((s, r) => s + (r.u - mu) ** 2, 0);
  assert.equal(period, fit.periodMs);
  assert.equal(numeric(d.atHostMonoMs), mt - period * mu + period * (numeric(d.targetGlobalUpdate) - numeric(d.correctionUpdates)));
  assert.equal(numeric(d.targetOfficeUpdate), numeric(d.targetGlobalUpdate) - (numeric(baseline.u) - numeric(baseline.fu)));
  if (isRecord(t.slot)) {
    assert.equal(numeric(d.targetGlobalUpdate), numeric(object(samples.at(-1)).u) + numeric(t.slot.leadUpdates) + numeric(d.phaseAdvance));
    assert.equal(numeric(d.targetOfficeUpdate) % 4, t.slot.officeModulo4);
    assert(numeric(baseline.fu) >= numeric(t.slot.minimumOfficeUpdate));
  }
  const poll = list(t.pollWitness).map(object);
  assert.equal(poll.length, 2);
  assert.equal(poll[0].m, 0); assert.equal(poll[1].m, 1);
  assert.equal(numeric(poll[1].u), numeric(poll[0].u) + 1);
  assert.equal(poll[1].u, result.acceptedGlobalUpdate);
  assert.equal(poll[1].fu, result.acceptedOfficeUpdate);
  const edge = object(list(object(result.ledger).edges)[0]);
  assert(numeric(edge.sdlReceiptMonoNs) > numeric(poll[0].tp));
  assert(numeric(edge.sdlReceiptMonoNs) <= numeric(poll[1].tp));
  const error = numeric(poll[1].u) - numeric(d.targetGlobalUpdate);
  assert.equal(result.errorUpdates, error);
  assert.equal(result.withinTolerance, Math.abs(error) <= numeric(result.toleranceUpdates));
  const send = object(t.sendWitness);
  assert.equal(object(send.timing).plannedHostMonoMs, d.atHostMonoMs);
  assert(numeric(send.sendHostMonoMs) >= numeric(d.atHostMonoMs));
  assert(numeric(send.sendHostMonoMs) - numeric(d.atHostMonoMs) <= 5);
  assert(Date.parse(text(d.date)) <= numeric(object(send.deadline).atWallMs));
  assert(numeric(object(send.deadline).atWallMs) < numeric(send.atWallMs));
  if (isRecord(t.observation) && isRecord(t.observation.handoff)) {
    assert.equal(t.observation.handoff.reason, 'tap-complete-before-snapshot');
    const witness = list(t.observation.witness).map(object);
    assert(numeric(witness[0].u) <= numeric(result.acceptedGlobalUpdate));
    assert(numeric(witness[1].u) >= numeric(result.acceptedGlobalUpdate));
    assert(numeric(t.observation.handoff.completedHostMonoMs) >= numeric(send.sendHostMonoMs));
  }
  assert.equal(object(t.cleanup).researchStopped, true);
  return error;
}

test('predictive landing records rederive clock fits, targets and polled acceptance from retained witnesses', () => {
  for (const name of ['research-targeted-landing-20261015', 'research-landing-cohort-20261015', 'research-landing-concurrent-handoff-20261015']) {
    const r = read(name), { id, ...body } = r;
    const prefix = name.replace(/20261015$/, '');
    assert.equal(id, prefix + createHash('sha256').update(JSON.stringify(body)).digest('hex').slice(0, 16));
    assert.equal(r.claimLevel, 'DEVICE_MEASURED');
    const trials = list(r.trials).map(object), measured = trials.filter(t => t.status === undefined || t.status === 'MEASURED');
    const errors = measured.map(recheckTrial), summary = object(r.summary);
    if (isList(object(r.protocol).slots)) {
      assert.equal(trials.length, list(object(r.protocol).slots).length);
      assert.deepEqual(summary.errors, errors);
      assert.equal(summary.notMeasured, trials.length - measured.length);
      assert.equal(summary.withinTolerance, errors.filter(e => Math.abs(e) <= numeric(summary.toleranceUpdates)).length);
      for (const t of measured) assert.equal(object(t.predeclaration).correctionUpdates, object(object(r.protocol).priorCalibration).correctionUpdates);
    } else assert.deepEqual(summary.validationErrors, errors.slice(1));
  }
});

test('a retargeted claim or invented poll transition cannot survive the retained witnesses', () => {
  const t = object(list(read('research-targeted-landing-20261015').trials)[0]);
  const d = object(t.predeclaration);
  assert.throws(() => recheckTrial({ ...t, predeclaration: { ...d, targetGlobalUpdate: numeric(d.targetGlobalUpdate) + 1 } }));
  const poll = list(t.pollWitness).map(object);
  assert.throws(() => recheckTrial({ ...t, pollWitness: [poll[0], { ...poll[1], m: 0 }] }));
});
