/**
 * Truth's reading of a game's own event sheet (Plan 28 step 5): the tabular dump parsed into
 * fields, the per-build handle scramble K estimated from it, and the queries over both. Pure: it
 * takes the dump as text and reads no file. The caller's own dump is found and read, and a CCN is
 * decoded, by packages/source/decompile/truth.mjs, which is what `@sixam/source/truth` exports.
 */
export { DUMPER, DUMP_FORMAT, dumpShape, isTabularDump, parseDump, parseParameter, parseParameters, parseRow } from './dump.js';
export { COMMON_TYPE, OBJECT_TYPES, QUALIFIER_BIT, aceName, typeName } from './engine.js';
export { HANDLE_SCRAMBLE_LIMIT, HANDLE_SCRAMBLE_METHOD, estimateHandleScramble } from './handles.js';
export { ACCESS, DEFAULT_LIMIT, QUERY_FIELDS, TRUTH_URI, describeObject, findEvents, handlesNamed, namesContaining, objectAt,
  presentRow, qualifierRows, truthUri, unparsedLoaders } from './query.js';
