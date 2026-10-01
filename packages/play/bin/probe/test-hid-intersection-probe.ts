// No-device conformance for the split legal intersection schedule.
import assert from 'node:assert/strict';
import { HALL_LIGHT, HID_ID, phases, record, timingPlan } from './hid-intersection-probe.ts';
import { COORDS } from '../phone/hid-sweep-probe.ts';

const plan = timingPlan({ contactMs: 33, camdropLeadMs: 150,
  camdropMonitorMs: 33, camdropTailMs: 67, hallMs: 33,
  preRaiseMs: 100, postHallMs: 1500 });
assert.deepEqual(plan, {
  contactMs: 33, camdropLeadMs: 150, camdropMonitorMs: 33,
  camdropTailMs: 67, hallMs: 33, preRaiseMs: 100, postHallMs: 1500,
  camdropTotalMs: 250,
});

const built = phases(plan);
assert.equal(built.register.length, 1);
assert.equal(built.manifest.schema, 'intersection-probe-schedule-v1');
assert.deepEqual(built.manifest.illegalPathsRefused,
  ['mask-up->hallLight', 'mask-up->monitor']);
assert.equal(built.manifest.maskReports, 0);
assert.equal(built.manifest.dependentControlsStateGated, true);

// A report event carries its report.
const reports = (phase: readonly { command: string, report?: number[] }[]) =>
  phase.filter(event => event.command === 'report').map(event => event.report as number[]);
const allReports = [...reports(built.raise), ...reports(built.camdrop), ...reports(built.hall)];
const containsPoint = (report: number[], point: readonly [number, number]) => {
  const raw = record(0, point).slice(1);
  return [2, 7].some(offset => report.length >= offset + 5 &&
    report.slice(offset + 1, offset + 5).every((value, index) => value === raw[index]));
};
assert.ok(allReports.every(report => !containsPoint(report, [600, 1015])),
  'no report may contain the mask coordinate');
assert.equal(reports(built.raise).length, 2);
assert.equal(reports(built.camdrop).length, 4);
assert.equal(reports(built.hall).length, 2);

const camdropReports = reports(built.camdrop);
assert.deepEqual(camdropReports[0].slice(0, 2), [1, 1]);
assert.deepEqual(camdropReports[0].slice(2, 7), record(0x03, COORDS.cameraFeedLight));
assert.deepEqual(camdropReports[1].slice(0, 2), [1, 2]);
assert.deepEqual(camdropReports[1].slice(2, 7), record(0x03, COORDS.cameraFeedLight));
assert.deepEqual(camdropReports[1].slice(7, 12), record(0x07, COORDS.monitor));
assert.deepEqual(camdropReports[2].slice(2, 7), record(0x03, COORDS.cameraFeedLight));
assert.deepEqual(camdropReports[2].slice(7, 12), record(0x04, COORDS.monitor));
assert.deepEqual(camdropReports[3].slice(2, 7), record(0x00, COORDS.cameraFeedLight));

const hallReports = reports(built.hall);
assert.deepEqual(hallReports[0].slice(2, 7), record(0x03, HALL_LIGHT));
assert.deepEqual(hallReports[1].slice(2, 7), record(0x00, HALL_LIGHT));
assert.ok(hallReports.every(report => !containsPoint(report, COORDS.monitor)),
  'hall phase must not include monitor coordinates');

for (const phase of [built.register, built.raise, built.camdrop, built.hall]) {
  for (const event of phase) assert.equal(event.id, HID_ID);
}

console.log('hid-intersection-probe: legal camdrop overlap, gated hall phase, and no mask input OK');
