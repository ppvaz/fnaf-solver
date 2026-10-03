/**
 * @sixam/kernel/py: Python's printing, reading and command lines, for the scripts ported from Python (Pedro,
 * 2026-10-02), so a ported tool keeps the bytes and exit codes its Python had. Kept out of the kernel's index,
 * which the trainer bundles for the browser: none of this runs there.
 */
export { pyArgs, pyArgsError, type PyArgs, type PyOption, type PyPositional } from './pyargs.ts';
export {
  PyJsonError, PyUnicodeDecodeError, pyDecodeUtf8, pyEquals, pyIsDict, pyIsList, pyLoads, pyLoadsBytes, pyReadText, pyReprOf, pyStr, pyStrRepr, pyTruthy,
  type PyValue,
} from './pyjson.ts';
export {
  PY_NOT_SPACE, PY_SPACE, PY_WORD, PyFloat, pyAlign, pyCompare, pyDumps, pyFixed, pyFloat, pyInt, pyPath, pyRegExp, pyRepr, pyRound, pySplit, pySplitLines, pyStrip, type PyJson,
} from './pyfmt.ts';
export { PyCsvError, pyCsvDicts, pyCsvRows, pyMedian, pyPstdev } from './pystats.ts';
