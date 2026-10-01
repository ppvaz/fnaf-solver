#!/usr/bin/env node
import assert from 'node:assert/strict';
import { parseRngProbe, parseViewingProbe, parseChildCensus } from './diagnose-child-events.ts';
const end = '\n[Inferior 1 (process 100) exited normally]\n';
assert.deepEqual(parseViewingProbe(`INITIAL viewing=0\nVIEWING_WRITE loop=0 value=9${end}`), { initial: 0, writes: [{ loop: 0, value: 9 }] });
assert.deepEqual(parseViewingProbe(`INITIAL viewing=0${end}`), { initial: 0, writes: [] });
assert.deepEqual(parseViewingProbe(`INITIAL viewing=0\nIMAGE loop=0 viewing=0 guard=0\nFINAL viewing=0 loop=63${end}`), {
  initial: 0, writes: [], final: { value: 0, loop: 63 }, imageChecks: [{ loop: 0, viewing: 0, guard: 0 }],
});
assert.throws(() => parseViewingProbe(`VIEWING_WRITE loop=0 value=1${end}`), /initial/);
assert.throws(() => parseViewingProbe('INITIAL viewing=0\n'), /normally/);
const rng = parseRngProbe(`DRAW event=53 range=50 loop=6 draws=2 state=30314\nIMAGE loop=0 viewing=1 guard=0${end}`);
assert.equal(rng.draws[0].state, 30314);
assert.equal(rng.imageChecks[0].viewing, 1);
assert.throws(() => parseRngProbe(`DRAW event=53 range=50 loop=6 draws=2 state=30314${end}`), /positive/);
assert.deepEqual(parseChildCensus("COUNTS 3 0 {'end': 2, 'parent': 2, 'child': 3}\n"), {
  frames: [{ frame: 3, unclosedDepth: 0, parentLists: 2, childRows: 3, listEnds: 2 }], unsupportedTriggeredChildren: 0,
});
assert.throws(() => parseChildCensus("COUNTS 3 1 {'end': 1, 'parent': 2, 'child': 3}\n"), /unbalanced/);
assert.throws(() => parseChildCensus("COUNTS 3 -1 {'end': 2, 'parent': 1, 'child': 3}\n"), /unbalanced/);
console.log('PASS child diagnosis reader: measured-positive requirements, incomplete probes, nested census (FIXTURE)');
