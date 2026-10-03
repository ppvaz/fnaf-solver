/**
 * The reader half of the REGION read reply: the line the Companion's
 * NativeRegions writes for companion-region-read-v1.txt (NativeRegionsTest.java
 * holds that side) decodes here to its regions, each sample naming its own
 * native coordinates. A writer change the reader does not follow, or the
 * reverse, fails the side that drifted. CONTRACT:cue-helper-control-v1.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseRegionRead } from '../src/venues/phone/companion.ts';

const vector = readFileSync(new URL('testdata/companion-region-read-v1.txt', import.meta.url), 'utf8').split('\n');
const geometry = vector.filter(row => row.startsWith('region: ')).map(row => {
  const [name, ...numbers] = row.slice(8).split(' ');
  const [x, y, width, height, step] = numbers.map(Number);
  return { name, x, y, width, height, step };
});
const capture = vector.find(row => row.startsWith('capture: '))?.slice(9).split(' ').map(Number);
const line = vector.find(row => row.startsWith('line: '))?.slice(6);
assert.ok(geometry.length > 0 && capture && line, 'the vector names its regions, its capture and its line');

const read = parseRegionRead(`OK ${line} snapshotNs=99`);
assert.equal(read.seq, capture[0]);
assert.equal(read.imageNs, BigInt(capture[1]));
assert.equal(read.copiedNs, BigInt(capture[2]));
assert.equal(read.snapshotNs, 99n);
assert.deepEqual(Object.keys(read.regions), geometry.map(region => region.name), 'every region, in order');
for (const { name, x, y, width, height, step } of geometry) {
  const region = read.regions[name];
  assert.deepEqual([region.x, region.y, region.width, region.height, region.step], [x, y, width, height, step]);
  assert.equal(region.pixels.length, Math.ceil(width / step) * Math.ceil(height / step), `${name}'s sample count`);
  region.pixels.forEach((pixel, i) => {
    const px = x + (i % region.cols) * step;
    const py = y + Math.floor(i / region.cols) * step;
    assert.equal(pixel, ((px & 0xfff) << 12) | (py & 0xfff), `${name} sample ${i} is (${px}, ${py})`);
  });
}

console.log('companion region read: the Companion\'s REGION line decodes to its regions, each sample at its own coordinates');
