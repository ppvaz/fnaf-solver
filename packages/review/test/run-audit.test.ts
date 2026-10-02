// The run audit attributes a loss to the first execution fault before the death's onset, judges
// the strategy only on a verified execution with a conclusive delivered phase, and otherwise
// answers UNKNOWN naming what it could not decide.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Annotation } from '@sixam/kernel';
import { ATTRIBUTIONS, auditRun, auditRuns, runAuditRecord } from '../src/run-audit.ts';

/** auditRun's annotation: a class, and its value by the fields this test reads. */
type Audit = Extract<Annotation, { class: string }> & { readonly value: {
  readonly undecided: readonly string[], readonly onset: { readonly from: string } | null,
  readonly firstDivergence: { readonly beforeOnsetMs: number } | null, readonly execution: { readonly faultsAfterOnset: readonly unknown[] } } };
type Row = Readonly<Record<string, unknown>>;

const root = mkdtempSync(join(tmpdir(), 'run-audit-'));
const ONSET = Date.parse('2026-09-30T01:00:00.000Z');
const at = (offsetMs: number) => new Date(ONSET + offsetMs).toISOString();
const verified = { arm: { status: 'VERIFIED' }, effects: { tally: { PASS: 12 }, systematicMisses: [] } };
const band = (verdict: string) => ({ epochMs: 2430, uncertaintyMs: 8, verdict, band: [2366, 2500], conclusive: true });

/** Writes one pack and returns its directory. */
function pack(id: string, { outcome = 'DEATH', events = [], report = verified, phase = { terminal: { lastNightAt: ONSET } } }:
  { outcome?: string, events?: readonly Row[], report?: Row, phase?: Row | null } = {}) {
  const dir = join(root, 'docs/evidence/runs', id);
  mkdirSync(join(dir, 'run'), { recursive: true });
  writeFileSync(join(dir, 'pack.json'), JSON.stringify({ id, outcome }));
  writeFileSync(join(dir, 'events.jsonl'), events.map(event => JSON.stringify(event)).join('\n'));
  if (report) writeFileSync(join(dir, 'run/run-report.json'), JSON.stringify(report));
  if (phase) writeFileSync(join(dir, 'run/phase.json'), JSON.stringify(phase));
  return dir;
}

try {
  const noOnset = auditRun(pack('no-onset', { phase: null })) as Audit; // auditRun writes a class and this value
  assert.equal(noOnset.class, 'UNKNOWN');
  assert.deepEqual(noOnset.value.undecided, ['death-onset-unknown'], 'with no onset nothing can be ordered');

  const nightObserved = auditRun(pack('night-observed', { phase: null,
    events: [{ type: 'observation', label: 'state=night', at: at(-500) }, { type: 'control.gate.abort', at: at(-2500), reason: 'mask unreadable' }] })) as Audit; // as above
  assert.equal(nightObserved.value.onset?.from, 'last observation labelled state=night');
  assert.equal(nightObserved.class, 'OBSERVATION', 'a gate abort before the last night observation is the first divergence');
  assert.equal(nightObserved.value.firstDivergence?.beforeOnsetMs, 2000);

  const abortAfter = auditRun(pack('abort-after', { phase: { terminal: { lastNightAt: ONSET }, deliveredBand: band('IN A LOSS BAND') },
    events: [{ type: 'control.gate.abort', at: at(1800), reason: 'mask unreadable' }] })) as Audit; // as above
  assert.equal(abortAfter.class, 'STRATEGY', 'an abort after the onset is a symptom, and a verified run in a loss band blames the strategy');
  assert.deepEqual(abortAfter.value.execution.faultsAfterOnset, [{ kind: 'gate-abort', detail: 'mask unreadable', afterOnsetMs: 1800 }]);

  const miss = { type: 'control.effect.result', status: 'MISSING', actionId: 'a7', signal: 'monitorUp', target: 'true', contactAt: ONSET - 900 };
  const systematic = auditRun(pack('systematic', { events: [miss], report: { ...verified,
    effects: { tally: { PASS: 11, MISSING: 1 }, systematicMisses: [{ key: 'a7 monitorUp->true', verdict: 'ACTUATOR-GAP' }] } } })) as Audit; // as above
  assert.equal(systematic.class, 'ACTUATION', 'a miss run-report.mjs graded systematic is an actuation fault');

  const blind = auditRun(pack('blind', { events: [miss], report: { ...verified, effects: { tally: { PASS: 11, MISSING: 1 }, systematicMisses: [] } },
    phase: { terminal: { lastNightAt: ONSET }, deliveredBand: band('IN A LOSS BAND') } })) as Audit; // as above
  assert.equal(blind.class, 'UNKNOWN', 'a miss below the systematic threshold decides nothing (mistake register #12)');
  assert.ok(blind.value.undecided.includes('misses-below-the-systematic-threshold'));

  const model = auditRun(pack('model', { phase: { terminal: { lastNightAt: ONSET }, deliveredBand: band('OUTSIDE EVERY LOSS BAND') } })) as Audit; // as above
  assert.equal(model.class, 'MODEL', 'a verified run outside every loss band is a model disagreement');

  const unmeasured = auditRun(pack('unmeasured', { report: { arm: { status: 'UNRESOLVED NON-FATAL' }, effects: { tally: { PASS: 9, UNREAD: 3 } } } })) as Audit; // as above
  assert.equal(unmeasured.class, 'UNKNOWN');
  assert.deepEqual(unmeasured.value.undecided,
    ['arm-unresolved-non-fatal', 'effects-not-all-pass (3 UNREAD)', 'delivered-phase-unmeasured']);

  const edge = auditRun(pack('edge', { phase: { terminal: { lastNightAt: ONSET }, deliveredBand: { ...band('IN A LOSS BAND'), conclusive: false } } })) as Audit; // as above
  assert.deepEqual(edge.value.undecided, ['delivered-phase-within-its-uncertainty-of-a-band-edge']);

  pack('won', { outcome: 'WIN' });
  const all = auditRuns(root);
  assert.equal(all.packs, 9);
  assert.equal(all.audited, 8, 'a win needs no attribution');
  assert.deepEqual(Object.keys(all.byAttribution), ATTRIBUTIONS);
  assert.equal(all.byAttribution.UNKNOWN, 4);
  const record = runAuditRecord(all, { date: '2026-09-30', command: 'npm run review -- query audit', commit: 'a'.repeat(40), dirtyInputs: [] });
  assert.equal(record.kind, 'run-audit-v1');
  assert.match(record.evidenceId, /^run-audit-sha256-[0-9a-f]{16}$/);
  assert.match(record.answer, /^4 of 8 audited runs attributed/);
  console.log('run-audit: onset ordering, the five attributions, UNKNOWN with its reasons, and the record');
} finally {
  rmSync(root, { recursive: true, force: true });
}
