// pyCsvRows, pyCsvDicts, pyMedian and pyPstdev against Python 3.12's csv module and statistics: each expected
// value below is what CPython gave for the same input.
import assert from 'node:assert/strict';
import { PyCsvError, pyCsvDicts, pyCsvRows, pyMedian, pyPstdev } from '../src/pystats.ts';
import { test } from 'node:test';
test("CPython CSV and exact statistics", async () => {


// A quoted delimiter and quote, an empty record, CRLF, and a quoted field that runs over a line end.
assert.deepEqual(pyCsvRows('a,"b,c","d""e"\n\nx\r\n"multi\nline",z\n'), [['a', 'b,c', 'd"e'], [], ['x'], ['multi\nline', 'z']]);
// DictReader: a short record's missing fields are None, a long one's extras listed under the key None.
const dicts = pyCsvDicts('k,v\n1\n2,3,4\n');
assert.deepEqual(dicts.fieldnames, ['k', 'v']);
assert.deepEqual(dicts.rows.map(row => [...row]), [[['k', '1'], ['v', null]], [['k', '2'], ['v', '3'], [null, ['4']]]]);
assert.throws(() => pyCsvRows('a\rb\n'), (error: Error) => error instanceof PyCsvError
  && error.message === "new-line character seen in unquoted field - do you need to open the file with newline=''?");

// median keeps an int an int when it can; pstdev is exact over rationals, then correctly rounded.
assert.deepEqual([pyMedian([3n, 1n, 2n]), pyMedian([1n, 2n, 3n, 4n]), pyMedian([0.1, 0.2])], [2n, 2.5, 0.15000000000000002]);
assert.equal(pyPstdev([1n, 2n, 3n, 4n]), 0x11e3779b97f4a8 / 2 ** 52);
assert.equal(pyPstdev([0.1, 0.2, 0.3]), 0x14e6fdf33cf031 / 2 ** 56);
assert.equal(pyPstdev([10n ** 20n, 10n ** 20n + 1n]), 0.5, 'exact where float arithmetic would lose the 1');

console.log('pystats: csv records and DictReader rows, median and pstdev as CPython 3.12 gives them');

});
