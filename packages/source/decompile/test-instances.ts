#!/usr/bin/env node
// Check the frame-instance reader against a synthetic dump.
//
// No game content: the fixture below is hand-written, so this runs anywhere.
//
// What it defends is the one rule that is easy to get wrong three different ways. A placed instance's OI is in its
// own space: the runtime's layout loader (Frame/CLO.load) reads it as `readAShort() ^ 48` and only then resolves it
// in the item table that COI.loadHeader XORed with 28. So the event handle of an ` I` line is OI ^ 48, its
// item-table row is OI ^ 48 ^ 28, and its image is the one the dumper printed on the instance line whose OI equals
// that row. The 2026-08-26 reader used the raw row and the 2026-09-15 reader used OI as an event handle; each left
// the Office without five of its twelve camera markers. docs/android/SOURCE-DUMP-GUIDE.md section 4.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { Dump } from './readdump.ts';

// Rows 66, 94, 110 and 114 are one XOR orbit: 66 ^ 28 == 94, 66 ^ 48 == 114, 66 ^ 48 ^ 28 == 110. So the instance
// line with OI 66 is `your view` read raw, `hall movement` read as an event handle, and `cam 11` read as the runtime
// does. Each instance line carries the image of its raw row, as the dumper does.
const FIXTURE = `GAME\tfixture\tBUILD\t296\tFRAMES\t1
OBJECTS
OBJECT\t66\tTYPE\t2\tNAME\tyour view\tVALUES\t\tSTRINGS\t
OBJECT\t83\tTYPE\t7\tNAME\tviewing hall light\tVALUES\t\tSTRINGS\t
OBJECT\t94\tTYPE\t2\tNAME\thall movement\tVALUES\t\tSTRINGS\t
OBJECT\t110\tTYPE\t2\tNAME\tcam 11\tVALUES\t\tSTRINGS\t
OBJECT\t114\tTYPE\t2\tNAME\tleft light\tVALUES\t\tSTRINGS\t
FRAME\t0\t04-Office\tGROUPS\t1
 F\tWIDTH\t1600\tHEIGHT\t768\tLAYERS\t2\tINSTANCES\t5
 L\tIDX\t0\tNAME\tLayer 1\tXC\t1\tYC\t1
 L\tIDX\t1\tNAME\tLayer 2\tXC\t1\tYC\t1
 I\tINST\t0\tOI\t66\tNAME\tyour view\tX\t950\tY\t465\tLAYER\t3\tPTYPE\t0\tPARENT\t0\tINSTNUM\t0\tW\t32\tH\t32\tHOTX\t16\tHOTY\t16
 I\tINST\t1\tOI\t94\tNAME\thall movement\tX\t-274\tY\t482\tLAYER\t3\tPTYPE\t0\tPARENT\t0\tINSTNUM\t1\tW\t16\tH\t125\tHOTX\t8\tHOTY\t62
 I\tINST\t2\tOI\t110\tNAME\tcam 11\tX\t1\tY\t914\tLAYER\t4\tPTYPE\t0\tPARENT\t0\tINSTNUM\t2\tW\t59\tH\t40\tHOTX\t29\tHOTY\t20
 I\tINST\t3\tOI\t114\tNAME\tleft light\tX\t340\tY\t846\tLAYER\t3\tPTYPE\t0\tPARENT\t0\tINSTNUM\t3\tW\t58\tH\t88\tHOTX\t28\tHOTY\t42
 I\tINST\t4\tOI\t127\tNAME\t?\tX\t-867\tY\t102\tLAYER\t5\tPTYPE\t0\tPARENT\t0\tINSTNUM\t4\tW\t\tH\t\tHOTX\t\tHOTY\t
GROUP\t0\tFLAGS\t0\tRESTRICT\tFalse\tCONDS\t1\tACTS\t0
 C\tOT\t2\tNUM\t-27\tOI\t114\tNAME\tleft light\tOIL\t0\tCFLAGS\t0\tCOTHER\t0\tPARAMS\t50:AlterableValue:AlterableValue0
`;

test('frame instances resolve through OI ^ 48, then the item table', () => {
  const directory = mkdtempSync(join(tmpdir(), 'test-instances-'));
  const path = join(directory, 'dump.txt');
  writeFileSync(path, FIXTURE);
  try {
    const dump = new Dump(path, 28n, 48n);
    const frame = dump.frames[0];
    const [cam11, light, , , counter] = frame.instances;

    assert.deepEqual([frame.size.get('WIDTH'), frame.size.get('HEIGHT')], ['1600', '768'], 'frame size');
    assert.equal(frame.layers.length, 2, 'layer count');
    assert.equal(frame.instances.length, 5, 'instance count');
    assert.equal(frame.groups.length, 1, 'groups still parse');

    // Events: handle 114 is row 110, cam 11.
    assert.equal(dump.name(114n), 'cam 11', 'event handle 114 -> cam 11');
    // Instances: OI 66 is event handle 66 ^ 48 == 114, the same cam 11.
    assert.equal(dump.handle(cam11), 114n, 'instance OI 66 -> event handle 114');
    assert.equal(dump.placed(cam11), 'cam 11', 'instance OI 66 -> cam 11');
    assert.equal(dump.placed(light), 'left light', 'instance OI 94 -> left light');
    // The three readings disagree on this line, and only one is the runtime's.
    assert.equal(dump.objects.get(66n), 'your view', 'raw row 66 would say your view');
    assert.equal(dump.name(66n), 'hall movement', 'event-space reading would say hall movement');

    // The image follows the true object: OI 66 draws row 110's image (59x40), which the dumper printed on the
    // instance line whose OI is 110.
    assert.deepEqual(dump.extent(cam11), [921n, 445n, 980n, 485n], 'extent uses row OI ^ 48 ^ 28 and subtracts the hotspot');
    assert.deepEqual(dump.extent(light), [-302n, 440n, -244n, 528n], "instance OI 94 draws row 114's image (58x88)");
    assert.equal(dump.extent(counter), null, 'a non-Active true object has no extent');
    assert.equal(dump.imageKnown(counter), true, "and its image is not 'missing'");

    // The new line types must not leak into the event lines.
    assert.equal(dump.render(frame.groups[0].lines[0]).trim(), 'C ot=2 num=-27 oi=114 [cam 11] 50:AlterableValue:AlterableValue0',
      'condition line intact');

    // PC builds: no scramble anywhere.
    const flat = new Dump(path, 0n, 0n);
    assert.deepEqual([flat.placed(flat.frames[0].instances[0]), flat.name(66n)], ['your view', 'your view'], '--xor 0 --lo-xor 0 reads rows as printed');

    // The `instances` command runs end to end.
    const out = spawnSync(process.execPath, [fileURLToPath(new URL('readdump.ts', import.meta.url)), '--dump', path, 'instances', '0', 'cam'],
      { encoding: 'utf8' });
    assert.equal(out.status, 0, 'instances command exits 0');
    assert.ok(out.stdout.includes('cam 11') && out.stdout.includes('h=114') && out.stdout.includes('oi=66')
      && out.stdout.includes('box x[921..980] y[445..485]'), 'instances command prints the true name, event handle, raw oi and box');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
