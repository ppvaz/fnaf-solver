/**
 * The reader half of the companion-status-v1 contract: every vector line the
 * Companion's writer emits (CompanionStatusTest.java holds that side) decodes
 * to exactly its `expect:`; the endpoint handshake decodes from the file and
 * from its logcat line; and the parser refuses what it must.
 * CONTRACT:companion-status-v1.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  COMPANION_STATUS_FIELDS, companionStatusFields, parseCompanionEndpoint, parseCompanionStatus,
} from '../src/venues/phone/companion-status.js';

const vector = readFileSync(new URL('../../../packages/play/test/testdata/companion-status-v1.txt', import.meta.url), 'utf8');
const cases = [];
let endpoint = null;
let endpointExpect = null;
for (const line of vector.split('\n')) {
  if (line.startsWith('case: ')) cases.push({ name: line.slice(6).trim() });
  else if (line.startsWith('line: ')) cases.at(-1).line = line.slice(6);
  else if (line.startsWith('expect: ')) cases.at(-1).expect = JSON.parse(line.slice(8));
  else if (line.startsWith('endpoint: ')) endpoint = line.slice(10).replaceAll('\\n', '\n');
  else if (line.startsWith('endpoint-expect: ')) endpointExpect = JSON.parse(line.slice(17));
}
assert.equal(cases.length, 4, 'the vector file carries four status cases');

for (const { name, line, expect } of cases) {
  const parsed = parseCompanionStatus(`OK ${line}`);
  const decoded = Object.fromEntries(Object.keys(expect).map(key => [key,
    key === 'snapshotNs' ? String(parsed[key]) : parsed[key]]));
  assert.deepEqual(decoded, expect, `case ${name} decodes to its expect`);
  assert.deepEqual(Object.keys(companionStatusFields(line)), [...COMPANION_STATUS_FIELDS],
    `case ${name} carries every v1 field in wire order`);
}

// A newer minor writer may append a field; the reader keeps it and decodes the rest.
const extended = parseCompanionStatus(`${cases[1].line} recorder=OFF`);
assert.equal(extended.fields.recorder, 'OFF');
assert.equal(extended.game, 'fnaf4');

for (const [bad, pattern] of [
  ['ERROR unauthorized', /unauthorized/],
  ['OK schema=cue-helper-control-v1 capture=ON session=1 snapshotNs=1', /schema is cue-helper-control-v1/],
  [cases[0].line.replace('capture=OFF', 'capture=MAYBE'), /capture is MAYBE/],
  [cases[0].line.replace('session=0 ', ''), /session is required/],
  [cases[1].line.replace('panel=440,8,1960,188', 'panel=440,8,40,188'), /panel is empty/],
  [cases[1].line.replace('clearance=OK:37px', 'clearance=probably'), /clearance is malformed/],
  [cases[1].line.replace('battery=64', 'battery=140'), /battery is 140/],
  [`${cases[0].line} capture=ON`, /capture is repeated/],
  [cases[0].line.replace('frames=0', 'frames=zero'), /frames is not an integer/],
]) assert.throws(() => parseCompanionStatus(bad), pattern);

assert.ok(endpoint && endpointExpect, 'the vector file carries the endpoint handshake');
assert.deepEqual({ ...parseCompanionEndpoint(endpoint) }, endpointExpect, 'the endpoint file decodes');
const logLine = '09-27 20:00:00.000 I/FnafCueHelper(7007): COMPANION schema=companion-endpoint-v1 app=0.2.0 code=16 '
  + 'session=3 pid=7007 port=49707 socket=com.fnaf2.cuehelper.control.3 token=0123456789abcdef0123456789abcdef';
assert.deepEqual({ ...parseCompanionEndpoint(logLine) }, endpointExpect, 'the endpoint log line decodes identically');
for (const [bad, pattern] of [
  [endpoint.replace('token=0123456789abcdef0123456789abcdef', 'token=nothex'), /token/],
  [endpoint.replace('port=49707', 'port=70000'), /port/],
  [endpoint.replace('socket=com.fnaf2.cuehelper.control.3', 'socket=evil'), /socket/],
  [endpoint.replace('schema=companion-endpoint-v1', 'schema=other'), /schema/],
]) assert.throws(() => parseCompanionEndpoint(bad), pattern);

console.log('companion status: every v1 vector decodes, extra fields survive, malformed lines and endpoints are refused');
