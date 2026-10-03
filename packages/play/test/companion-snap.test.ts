/**
 * The reader half of the SNAP reply: the line the Companion's SnapReply writes
 * for companion-snap-v1.txt (SnapReplyTest.java holds that side) reads back
 * here to the label's path and the two helper clocks, and is refused for any
 * other label. A writer change the reader does not follow, or the reverse,
 * fails the side that drifted. CONTRACT:cue-helper-control-v1.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseSnapReply } from '../src/venues/phone/companion.ts';

const vector = readFileSync(new URL('testdata/companion-snap-v1.txt', import.meta.url), 'utf8').split('\n');
const field = (name: string) => {
  const row = vector.find(line => line.startsWith(`${name}: `));
  if (row === undefined) throw new Error(`companion-snap-v1.txt names no ${name}`);
  return row.slice(name.length + 2);
};

test('the Companion\'s SNAP line reads back to its label\'s path and clocks', () => {
  const reply = parseSnapReply(field('line'), field('label'));
  assert.deepEqual(reply, {
    path: `files/frames/${field('label')}.png`,
    imageNs: BigInt(field('imageNs')),
    snapshotNs: BigInt(field('snapshotNs')),
  });
});

test('a SNAP line for another label, without a clock, or an ERROR is refused', () => {
  assert.throws(() => parseSnapReply(field('line'), 'another-label'), /not files\/frames\/another-label\.png/);
  assert.throws(() => parseSnapReply(field('line').replace(/ snapshotNs=\d+/, ''), field('label')), /no snapshotNs/);
  assert.throws(() => parseSnapReply('ERROR snap-no-frame', field('label')), /^Error: ERROR snap-no-frame$/);
});
