/**
 * @sixam/kernel/py: Python's printing, reading and command lines, for the scripts ported from Python (Pedro,
 * 2026-10-02), so a ported tool keeps the bytes and exit codes its Python had. Kept out of the kernel's index,
 * which the trainer bundles for the browser: none of this runs there.
 */
export { pyArgs, type PyArgs, type PyOption, type PyPositional } from './pyargs.ts';
export { PyJsonError, pyLoads, pyLoadsBytes, pyReprOf, pyStrRepr, type PyValue } from './pyjson.ts';
export { PyFloat, pyDumps, pyFixed, pyFloat, pyInt, pyPath, pyRepr, pyRound, pySplit, pySplitLines, type PyJson } from './pyfmt.ts';
