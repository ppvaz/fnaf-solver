// pyLoads, pyLoadsBytes and pyReprOf against Python 3.12's json.loads and repr(): each expected string below is
// what CPython printed for the same input (repr of the value, or str() of the error).
import assert from 'node:assert/strict';
import { pyLoads, pyLoadsBytes, pyReprOf } from '../src/pyjson.ts';

const repr = (text: string) => pyReprOf(pyLoads(text));
// Keys keep their order (an integer-like key does not move first), an int stays an int at any size and a float
// a float, and NaN and the infinities are read.
assert.equal(repr('{"12": 1, "1": 2.0, "a": [NaN, -Infinity, 1E400, 123456789012345678901]}'),
  "{'12': 1, '1': 2.0, 'a': [nan, -inf, inf, 123456789012345678901]}");
// A str's repr: printable non-ASCII kept, controls and separators escaped, a pair joined, a lone surrogate kept.
assert.equal(repr('"\\u00e9\\t\'\\u0000\\u2028\\ud83d\\ude00\\ud83d"'), '"\u00e9\\t\'\\x00\\u2028\u{1F600}\\ud83d"');
assert.equal(repr('"it\'s"'), '"it\'s"');

const refusals: [string, string][] = [
  ['{"a":1,}', 'Expecting property name enclosed in double quotes: line 1 column 8 (char 7)'],
  ['[1 2]', "Expecting ',' delimiter: line 1 column 4 (char 3)"],
  ['"\\x"', 'Invalid \\escape: line 1 column 2 (char 1)'],
  ['{"a"', "Expecting ':' delimiter: line 1 column 5 (char 4)"],
  ['1.', 'Extra data: line 1 column 2 (char 1)'],
  ['\ufeff1', 'Unexpected UTF-8 BOM (decode using utf-8-sig): line 1 column 1 (char 0)'],
];
for (const [text, message] of refusals) assert.throws(() => pyLoads(text), { message }, JSON.stringify(text));

// json.loads(bytes): UTF-8 by default, with the codec's own message for a bad sequence, and a UTF-8 BOM skipped.
const bytes = (hex: string) => pyLoadsBytes(Buffer.from(hex, 'hex'));
assert.throws(() => bytes('22ff22'), { message: "'utf-8' codec can't decode byte 0xff in position 1: invalid start byte" });
assert.throws(() => bytes('22e28222'), { message: "'utf-8' codec can't decode bytes in position 1-2: invalid continuation byte" });
// A surrogate is let through only whole; a broken one is refused as the strict decoder refuses its lead.
assert.throws(() => bytes('22eda04322'), { message: "'utf-8' codec can't decode byte 0xed in position 1: invalid continuation byte" });
assert.throws(() => bytes('22eda0'), { message: "'utf-8' codec can't decode byte 0xed in position 1: invalid continuation byte" });
assert.equal(pyReprOf(bytes('22f09f988022')), "'\u{1F600}'");
assert.equal(pyReprOf(bytes('efbbbf7b2261223a20317d')), "{'a': 1}");

console.log(`pyjson: 3 values read and printed, ${refusals.length} refusals and 6 byte bodies as CPython's json.loads and repr give them`);
