/**
 * @sixam/kernel/py: Python's printing, reading and command lines, for the scripts ported from Python (Pedro,
 * 2026-10-02), so a ported tool keeps the bytes and exit codes its Python had. Kept out of the kernel's index,
 * which the trainer bundles for the browser: none of this runs there.
 */
export {
  pyArgs, pyArgsError, pyOptionList, pyOptionText, pySubcommands, type PyArgs, type PyOption, type PyPositional, type PySubcommand,
} from './pyargs.ts';
export {
  PyJsonError, PyKeyError, PyUnicodeDecodeError, pyCompareNumbers, pyDecodeUtf8, pyEquals, pyGet, pyIsDict, pyIsList, pyItem, pyLen, pyLoads,
  pyLoadsBytes, pyReadText, pyReprOf, pyStr, pyStrRepr, pySum, pyTruthy,
  type PyValue,
} from './pyjson.ts';
export {
  PY_NOT_SPACE, PY_SPACE, PY_WORD, PyAssertionError, PyFloat, pyAlign, pyAt, pyCompare, pyDumps, pyFixed, pyFloat, pyFloatValue, pyInt, pyIntValue,
  pyKeyValues, pyPath, pyRegExp, pyRepr, pyRound, pySplit, pySplitLimit, pySplitLines, pyStrip, pyUnpack, type PyJson,
} from './pyfmt.ts';
export { PyCsvError, pyCsvDicts, pyCsvRows, pyMedian, pyPstdev } from './pystats.ts';
export { PyEOFError, PyWaveError, pyWave, type PyWave } from './pywave.ts';
