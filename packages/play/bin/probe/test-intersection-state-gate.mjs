// No-device conformance for the read-only intersection state gate.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { classifyFrame, bottomButtons, BUTTON_THRESHOLDS } from './intersection-state-gate.mjs';
import { parseMaskRule, parseMonitorRule } from '@sixam/play';

const monitorRule = parseMonitorRule(JSON.parse(await readFile(
  new URL('../../profiles/fnaf2/moto-g56/monitor-rule-moto-g56-v207.json', import.meta.url), 'utf8')));
const maskRule = parseMaskRule(JSON.parse(await readFile(
  new URL('../../profiles/fnaf2/moto-g56/mask-rule-moto-g56-v207.json', import.meta.url), 'utf8')));
const rgb = (luma, blue = luma) => (luma << 16) | (luma << 8) | blue;

function frame({ monitorUp, maskOn = false, sequence = 1, visual = 'OBSERVED',
  visualReason, screen = 'FNAF2_NIGHT' } = {}) {
  const cells = new Array(180).fill(rgb(40));
  // Start with the measured office baseline: map-present anchors are dark and
  // monitor-covered/mask-off anchors are bright.
  for (const anchor of monitorRule.adapter.anchors) {
    cells[anchor.cell] = rgb(anchor.kind === 'present' ? (monitorUp ? 220 : 0) : (monitorUp ? 0 : 220));
  }
  for (const anchor of maskRule.adapter.anchors) {
    cells[anchor.cell] = rgb(maskOn ? 0 : 220);
  }
  // The native gate uses fixed downward-chevron coverage, not the translucent
  // button-band means. Model the observed exclusive controls directly.
  const maskButtonStroke = monitorUp ? 0 : 140;
  const monitorButtonStroke = maskOn ? 0 : 140;
  // Several fitted mask anchors sit in the monitor-button band. Reapply them
  // after the visual button fill so the fixture remains on the calibrated
  // side of every threshold rather than manufacturing an in-band frame.
  for (const anchor of maskRule.adapter.anchors)
    cells[anchor.cell] = rgb(maskOn ? 0 : 250);
  return { visual, ...(visualReason ? { visualReason } : {}), screen,
    ageUs: '1000', seq: String(sequence), cells,
    monitorUp: monitorUp === null ? 'UNKNOWN' : String(monitorUp),
    mask_button_downstroke: String(maskButtonStroke),
    monitor_button_downstroke: String(monitorButtonStroke),
    // Deliberately hostile diagnostics: they must not affect the gate.
    mask_button_mean_luma: '0', monitor_button_mean_luma: '255' };
}

const office = classifyFrame(frame({ monitorUp: false }), { monitorRule, maskRule, target: 'office' });
assert.equal(office.pass, true);
assert.equal(office.monitorSource, 'helper-explicit');
assert.equal(office.mask, false);
assert.ok(office.maskButtonDownstroke >= BUTTON_THRESHOLDS.visibleMin);
assert.ok(office.monitorButtonDownstroke >= BUTTON_THRESHOLDS.visibleMin);

const up = classifyFrame(frame({ monitorUp: true }), { monitorRule, maskRule, target: 'monitor-up' });
assert.equal(up.pass, true);
assert.equal(up.monitor, true);
assert.ok(up.maskButtonDownstroke <= BUTTON_THRESHOLDS.absentMax);
assert.ok(up.monitorButtonDownstroke >= BUTTON_THRESHOLDS.visibleMin);

const maskUp = classifyFrame(frame({ monitorUp: false, maskOn: true }), { monitorRule, maskRule, target: 'office' });
assert.equal(maskUp.pass, false);
assert.match(maskUp.reason, /mask-not-down|office-stroke-signature-missing/);

const transition = classifyFrame(frame({ monitorUp: false, maskOn: false, sequence: 3 }), {
  monitorRule, maskRule, target: 'monitor-up',
});
assert.equal(transition.pass, false);

const metadataUnknownFields = frame({ monitorUp: null, visual: 'UNKNOWN',
  visualReason: 'content-hidden' });
metadataUnknownFields.cells = undefined;
const metadataUnknownOffice = classifyFrame(metadataUnknownFields, {
  monitorRule, maskRule, target: 'office',
});
assert.equal(metadataUnknownOffice.pass, true,
  'fresh native strokes may establish office while capture metadata is invalid');
assert.equal(metadataUnknownOffice.observerState, 'UNKNOWN');
assert.equal(metadataUnknownOffice.observerReason, 'content-hidden');
assert.equal(metadataUnknownOffice.stateSource, 'native-stroke');
const noStateEvidence = classifyFrame({ visual: 'UNKNOWN', visualReason: 'content-hidden',
  screen: 'UNKNOWN', ageUs: '1000', seq: '12',
  mask_button_downstroke: '60', monitor_button_downstroke: '80' }, {
  monitorRule, maskRule, target: 'office',
});
assert.match(noStateEvidence.reason, /^state-unknown:/);
const unknownScreenOfficeFields = frame({ monitorUp: null, visual: 'OBSERVED', screen: 'UNKNOWN' });
unknownScreenOfficeFields.cells = undefined;
const unknownScreenOffice = classifyFrame(unknownScreenOfficeFields, {
  monitorRule, maskRule, target: 'office',
});
assert.equal(unknownScreenOffice.pass, true,
  'native strokes may establish office when only screen identity is unavailable');
assert.equal(unknownScreenOffice.stateSource, 'native-stroke');
assert.equal(classifyFrame(frame({ monitorUp: false, screen: 'FNAF2_MENU' }), {
  monitorRule, maskRule, target: 'office',
}).reason, 'screen-not-night');

const malformed = bottomButtons(new Array(179).fill(0));
assert.deepEqual(malformed, {
  maskStroke: null, monitorStroke: null, maskMean: null, monitorMean: null,
  source: 'unavailable',
});

const lightweight = classifyFrame({
  visual: 'OBSERVED', screen: 'FNAF2_NIGHT', ageUs: '1000', seq: '11', monitorUp: 'true',
  mask_button_downstroke: '0', monitor_button_downstroke: '140',
  mask_button_mean_luma: '255', monitor_button_mean_luma: '0',
}, { monitorRule, maskRule, target: 'monitor-up' });
assert.equal(lightweight.pass, true,
  'lightweight gate must use the native strokes even when luma diagnostics disagree');

console.log('intersection state gate: atomic freshness, button tells, and illegal-state refusal pass');
