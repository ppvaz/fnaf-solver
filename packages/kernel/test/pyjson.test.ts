// pyLoads, pyLoadsBytes and pyReprOf against Python 3.12's json.loads and repr(): each expected string below is
// what CPython printed for the same input (repr of the value, or str() of the error).
import assert from 'node:assert/strict';
import {
  PyUnicodeDecodeError, pyCompareNumbers, pyDecodeUtf8, pyEquals, pyIsList, pyLen, pyLoads, pyLoadsBytes, pyReprOf, pyStr, pySum, pyTruthy,
} from '../src/pyjson.ts';
import { test } from 'node:test';
test("CPython JSON values and UTF-8 errors", async () => {


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
assert.equal(pyReprOf(bytes('22f09f988022')), "'\u{1F600}'");
assert.equal(pyReprOf(bytes('efbbbf7b2261223a20317d')), "{'a': 1}");

// bytes.decode('utf-8'): strict refuses the encoded surrogate that surrogatepass lets through, as a ValueError, and
// keeps a BOM.
const hex = (text: string) => Buffer.from(text, 'hex');
assert.throws(() => pyDecodeUtf8(hex('61eda080')), (error: Error) => error instanceof PyUnicodeDecodeError
  && error.message === "'utf-8' codec can't decode byte 0xed in position 1: invalid continuation byte");
assert.equal(pyDecodeUtf8(hex('eda080'), 'surrogatepass'), String.fromCharCode(0xd800));
assert.equal(pyDecodeUtf8(hex('efbbbf61')), `${String.fromCharCode(0xfeff)}a`);

// ==, bool() and str() as Python gives them over what json.loads returns.
const equal = (a: string, b: string) => pyEquals(pyLoads(a), pyLoads(b));
assert.deepEqual([equal('true', '1'), equal('1', '1.0'), equal('9007199254740993', '9007199254740992.0'),
  equal('{"a": 1, "b": [1, 2]}', '{"b": [1, 2.0], "a": true}'), equal('[1, 2]', '[2, 1]'), equal('"1"', '1'), equal('null', 'false'),
  equal('NaN', 'NaN'), equal('0.0', '-0.0')], [true, true, false, true, false, false, false, false, true]);
assert.deepEqual(['0.0', '""', '{}', '[]', '0', 'null', '" "', '[0]'].map(text => pyTruthy(pyLoads(text))),
  [false, false, false, false, false, false, true, true]);
assert.deepEqual(['true', 'null', '[1, "a"]', '"a"'].map(text => pyStr(pyLoads(text))), ['True', 'None', "[1, 'a']", 'a']);

// sum(), len() and the order Python gives two numbers, exactly across int and float.
const sumOf = (text: string) => {
  const values = pyLoads(text);
  assert.ok(pyIsList(values));
  return pyReprOf(pySum(values));
};
assert.deepEqual(['[1, 2]', '[1, 2.5]', '[true, 2]'].map(sumOf), ['3', '3.5', '3']);
assert.deepEqual(['"\u00e9\ud83d\ude00"', '[1, 2]', '{"a": 1}'].map(text => pyLen(pyLoads(text))), [2n, 2n, 1n]);
assert.deepEqual([['1', '1.5'], ['9007199254740993', '9007199254740992.0'], ['NaN', '1']].map(([a, b]) => pyCompareNumbers(pyLoads(a), pyLoads(b))), [-1, 1, null]);

console.log(`pyjson: 3 values read and printed, ${refusals.length} refusals, 4 byte bodies and 3 decodes as CPython's json.loads, repr and bytes.decode give them`);

});
