import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { LESSON_LINE, lessonForNight, lessonFromArtifactPlan, lessonLines, lessonOriginLine, lessonVerb } from '../src/coach/cycle-lesson.js';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const TOKEN = '0123456789abcdef0123456789abcdef';
const plan = JSON.parse(readFileSync(`${ROOT}tools/device/testdata/teach-night7-k3-plan.json`, 'utf8'));
const vector = readFileSync(`${ROOT}tools/device/testdata/teach-lesson-night7-k3.txt`, 'ascii').trim().split('\n');

// The shared vector: what this sends for k3 is exactly what CycleLessonTest.java
// parses to the same id, so the two canonical texts agree.
{
  const lesson = lessonFromArtifactPlan(plan);
  assert.equal(lesson.id, 'dca6427d63595573');
  assert.deepEqual(lessonLines(TOKEN, lesson), vector);
  for (const line of vector) assert.match(line, LESSON_LINE);
  assert.equal(lesson.header.viewCamera, 11, 'the arm check names the viewed camera');
  assert.equal(lesson.header.markerCamera, 9, 'and the other highlighted camera is the marker');
  assert.equal(lesson.rows.filter(row => row.cycle === 'steady').length, 7);
  const camdrop = lesson.rows.find(row => row.cycle === 'steady' && row.verb === 'camdrop');
  assert.deepEqual([camdrop.durationMs, camdrop.leadMs, camdrop.tailMs], [200, 150, 200]);
}

// The campaign port reads the plan the way the executor's request does: from
// the validated campaign bundle's own plans, by night. (The first device teach
// run looked under bundle.artifact, which carries only hashes, and refused.)
{
  const campaignBundle = { schema: 'device-campaign-bundle-v1', plans: [plan],
    artifact: { winnerHash: 'w', engineHash: 'e', profileHash: 'p' } };
  assert.equal(lessonForNight(campaignBundle, 7).id, 'dca6427d63595573');
  assert.throws(() => lessonForNight(campaignBundle, 6), /binds no plan for night 6/);
  assert.throws(() => lessonForNight(undefined, 7), /binds no plan for night 7/);
}

// Each artifact action kind the panel can narrate, and the ones it refuses.
{
  assert.equal(lessonVerb({ kind: 'ensure', control: 'monitor', targetMonitorUp: true }), 'cams-up');
  assert.equal(lessonVerb({ kind: 'ensure', control: 'monitor', targetMonitorUp: false }), 'cams-down');
  assert.equal(lessonVerb({ kind: 'press', control: 'mask', targetMaskOn: true }), 'mask-on');
  assert.equal(lessonVerb({ kind: 'press', control: 'mask', targetMaskOn: false }), 'mask-off');
  assert.equal(lessonVerb({ kind: 'tap', control: 'cam:11' }), 'cam-11');
  assert.equal(lessonVerb({ kind: 'hold', control: 'hallLight' }), 'hall-light');
  assert.equal(lessonVerb({ kind: 'hold', control: 'cameraFeedLight' }), 'feed-light');
  assert.equal(lessonVerb({ kind: 'hold', control: 'wind' }), 'wind');
  assert.equal(lessonVerb({ kind: 'compound', compound: 'camdrop', control: 'cameraFeedLight' }), 'camdrop');
  for (const action of [
    { kind: 'press', control: 'mask' },
    { kind: 'tap', control: 'cam:13' },
    { kind: 'hold', control: 'mute' },
    { kind: 'compound', compound: 'hallvent' },
    { kind: 'sweep-slot', control: 'cam:4' },
    { kind: 'observe-left', control: 'leftVentLight' },
  ]) assert.throws(() => lessonVerb(action), /teach: the panel has no words/, JSON.stringify(action));
}

// Plan shapes the helper cannot narrate are refused here, with a reason.
{
  const clone = () => JSON.parse(JSON.stringify(plan));
  const withFinish = clone();
  withFinish.cycles.finish = { blocks: [] };
  assert.throws(() => lessonFromArtifactPlan(withFinish), /cannot narrate cycle \["finish"\]/);
  const twoSteady = clone();
  twoSteady.cycles.clear = twoSteady.cycles.toys;
  assert.throws(() => lessonFromArtifactPlan(twoSteady), /exactly one steady cycle/);
  const noOpening = clone();
  delete noOpening.cycles.opening;
  assert.throws(() => lessonFromArtifactPlan(noOpening), /no opening/);
  const longHold = clone();
  longHold.cycles.toys.blocks[4].actions[0].durationMs = 10001;
  assert.throws(() => lessonFromArtifactPlan(longHold), /wind duration 10001/);
  const unarmed = clone();
  delete unarmed.armVerification;
  const plain = lessonFromArtifactPlan(unarmed);
  assert.equal(plain.header.viewCamera, null);
  assert.notEqual(plain.id, 'dca6427d63595573', 'the split is part of what the id binds');
  assert.match(lessonLines(TOKEN, plain)[0], / - -$/);
}

// The origin line: the helper's latch, in ns, and the whole release interval.
{
  assert.equal(lessonOriginLine(TOKEN, { onsetDeviceMs: 30347981.447577, afterOnsetMs: 2433.93 }),
    `LESSON ${TOKEN} origin 30347981447577 2433930`);
  assert.match(lessonOriginLine(TOKEN, { onsetDeviceMs: 1, afterOnsetMs: 0 }), LESSON_LINE);
  assert.throws(() => lessonOriginLine(TOKEN, { onsetDeviceMs: null, afterOnsetMs: 2433 }), /no latched onset/);
  assert.throws(() => lessonOriginLine(TOKEN, { onsetDeviceMs: 5, afterOnsetMs: 60000 }), /not a schedule origin/);
  assert.throws(() => lessonOriginLine('nothex', { onsetDeviceMs: 5, afterOnsetMs: 1 }), /token/);
}

// The channel grammar admits nothing else.
{
  for (const line of [
    `LESSON ${TOKEN} clear`, `LESSON ${TOKEN} status`, `LESSON ${TOKEN} commit`,
  ]) assert.match(line, LESSON_LINE);
  for (const line of [
    `LESSON ${TOKEN} row 0 opening 0 rm -rf 1`,
    `LESSON ${TOKEN} row 0 opening 0 cams-up 33; reboot`,
    `LESSON ${TOKEN} begin dca6427d63595573 7 10000 0 0 420000 425000 16 11`,
    `GET ${TOKEN}`,
    `LESSON ${TOKEN.slice(1)} clear`,
  ]) assert.doesNotMatch(line, LESSON_LINE, line);
}

console.log('cycle lesson: the k3 vector, the verb map, refused plan shapes, the origin line and the channel grammar');
