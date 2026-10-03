#!/usr/bin/env node
// Validate a v1 stock-device session manifest and its ordered event stream.
//
//     packages/review/bin/legacy/validate-session.ts MANIFEST.json [--events PATH] [--json]
//
// The schemas in packages/review/bin/legacy/schema/ are the machine-readable contract; this file interprets them
// rather than restating them, so a field added to a schema cannot silently go unchecked.
//
// What it refuses, and why (docs/device/OBSERVATION-CORPUS-INVENTORY.md):
//
//   schema-version-unsupported     a version change must fail old replay loudly
//   mixed-game-builds              one session cannot straddle two game builds
//   artifact-hash-missing          a filename is not provenance
//   model-stale / -unauthorized    a model is executable state, not its evidence
//   clock-alignment-missing        the eight clock domains are not interchangeable
//   false-win-evidence             a false win is never acceptable
//   secret-in-commit-safe-metadata tokens and private paths stay out of git
//
// Exit status: 0 valid, 1 validation failure, 2 usage or I/O error.
//
// Ported from validate-session.py: it prints and exits as that did, with Python's equality, truthiness and
// repr over the JSON it reads.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PyJsonError, type PyValue, pyArgs, pyDecodeUtf8, pyDumps, pyEquals, pyIsDict, pyIsList, pyLoads, pyPath, pyReprOf, pySplitLines, pyStr,
  pyStrRepr, pyStrip, pyTruthy,
} from '@sixam/kernel/py';

const SCHEMA_DIR = fileURLToPath(new URL('schema/', import.meta.url));

// Python's re, kept: `$` also matches before a final newline and \d is any Unicode decimal digit.
const SHA256 = /^[0-9a-f]{64}(?=\n?$)/;
const ISO8601 = /^\p{Nd}{4}-\p{Nd}{2}-\p{Nd}{2}T\p{Nd}{2}:\p{Nd}{2}:\p{Nd}{2}(?:\.\p{Nd}+)?Z(?=\n?$)/u;
// A commit-safety lint, not a secret scanner: it recognises the shapes this repository has been told to keep out
// of a committed manifest, and claims nothing about the ones it has not been told about.
export const SECRET_KEY = /(?:^|_)(token|secret|password|passwd|credential|credentials|apikey|api_key|cookie|serial)(?:$|_)/iu;
export const PRIVATE_PATH = /^(?:\/Users\/|\/home\/|\/root\/)/;

type Dict = ReadonlyMap<string, PyValue>;
interface Failure { code: string, detail: string }
class Failures {
  readonly rows: Failure[] = [];
  add(code: string, detail: string) { this.rows.push({ code, detail }); }
}

/** An OSError's str() for a file that could not be read: errno and strerror as Python printed them. */
export function pyOsError(error: NodeJS.ErrnoException, path: string) {
  const known = new Map<string, [number, string]>([
    ['ENOENT', [2, 'No such file or directory']], ['EACCES', [13, 'Permission denied']], ['EISDIR', [21, 'Is a directory']],
    ['ENOTDIR', [20, 'Not a directory']], ['ELOOP', [62, 'Too many levels of symbolic links']],
  ]);
  const python = known.get(error.code ?? '');
  return python ? `[Errno ${python[0]}] ${python[1]}: ${pyStrRepr(path)}` : error.message;
}

/** An error from the file system (an OSError), not a decode error (a ValueError). */
const isOsError = (error: unknown): error is NodeJS.ErrnoException => error instanceof Error && 'code' in error && typeof error.code === 'string';

/** Path.read_text(): the file decoded strictly as UTF-8; an OSError keeps its code for the caller. */
function readText(path: string) {
  return pyDecodeUtf8(readFileSync(path));
}

/** obj[key] or obj.get(key): Python's AttributeError or KeyError on a value that is no dict stops the run here too. */
function dict(value: PyValue | undefined): Dict {
  if (value === undefined || !pyIsDict(value)) throw new TypeError(`'${pyTypeName(value)}' object has no attribute 'get'`);
  return value;
}
const get = (value: PyValue | undefined, key: string): PyValue => dict(value).get(key) ?? null;
/** obj.get(key, fallback): the fallback only for an absent key; a key present as null gives None. */
const getOr = (value: PyValue | undefined, key: string, fallback: PyValue): PyValue => {
  const map = dict(value);
  return map.has(key) ? map.get(key) ?? null : fallback;
};
const item = (value: PyValue | undefined, key: string): PyValue => {
  const found = dict(value).get(key);
  if (found === undefined) throw new TypeError(`KeyError: ${pyStrRepr(key)}`);
  return found;
};
const list = (value: PyValue): readonly PyValue[] => {
  if (!pyIsList(value)) throw new TypeError(`'${pyTypeName(value)}' object is not iterable as a list`);
  return value;
};
function pyTypeName(value: PyValue | undefined) {
  if (value === null || value === undefined) return 'NoneType';
  if (typeof value === 'boolean') return 'bool';
  if (typeof value === 'bigint') return 'int';
  if (typeof value === 'string') return 'str';
  if (pyIsList(value)) return 'list';
  return pyIsDict(value) ? 'dict' : 'float';
}
/** x in values: Python's == membership. */
const within = (value: PyValue, values: readonly PyValue[]) => values.some(other => pyEquals(value, other));
/** A set or dict key must hash: a list or dict stops the run, as its TypeError did. */
function hashable(value: PyValue) {
  if (pyIsList(value) || pyIsDict(value)) throw new TypeError(`unhashable type: '${pyTypeName(value)}'`);
  return value;
}
/** isinstance(value, (int, float)), bool included, as a number to compare. */
function number(value: PyValue): number | bigint | null {
  if (typeof value === 'boolean') return value ? 1n : 0n;
  if (typeof value === 'bigint') return value;
  return value !== null && typeof value === 'object' && !pyIsList(value) && !pyIsDict(value) ? value.value : null;
}
/** An int against a float, exactly as Python compares them: -1, 0 or 1, or null against NaN. */
function compareIntFloat(int: bigint, float: number): -1 | 0 | 1 | null {
  if (Number.isNaN(float)) return null;
  if (float === Infinity || float === -Infinity) return float > 0 ? -1 : 1;
  const floor = BigInt(Math.floor(float));
  if (int !== floor) return int < floor ? -1 : 1;
  return float > Math.floor(float) ? -1 : 0;
}
/** a < b for two numbers, exactly across int and float. */
function less(a: number | bigint, b: number | bigint): boolean {
  if (typeof a === 'bigint' && typeof b === 'bigint') return a < b;
  if (typeof a === 'number' && typeof b === 'number') return a < b;
  return typeof a === 'bigint' ? compareIntFloat(a, Number(b)) === -1 : compareIntFloat(BigInt(b), a) === 1;
}

function loadSchema(name: string): Dict {
  return dict(pyLoads(readText(`${SCHEMA_DIR}${name}`)));
}

// ---------------------------------------------------------------- type checks

/** A human reason the value does not match the spec, or null. */
function typeError(value: PyValue, spec: PyValue): string | null {
  if (typeof spec === 'string') {
    if (spec === 'any') return null;
    if (spec === 'string') return typeof value === 'string' ? null : 'expected string';
    if (spec === 'int') return typeof value === 'bigint' ? null : 'expected int';
    if (spec === 'number') return typeof value !== 'boolean' && number(value) !== null ? null : 'expected number';
    if (spec === 'bool') return typeof value === 'boolean' ? null : 'expected bool';
    if (spec === 'sha256') {
      if (typeof value !== 'string') return 'expected sha256 string';
      return SHA256.test(value) ? null : 'expected 64 lowercase hex characters';
    }
    if (spec === 'iso8601') {
      if (typeof value !== 'string') return 'expected ISO-8601 UTC string';
      return ISO8601.test(value) ? null : 'expected YYYY-MM-DDThh:mm:ssZ';
    }
    return `unknown type '${spec}' in schema`;
  }
  const rule = dict(spec);
  if (rule.has('const')) return pyEquals(value, get(rule, 'const')) ? null : `expected ${pyReprOf(get(rule, 'const'))}`;
  if (rule.has('enum')) return within(value, list(get(rule, 'enum'))) ? null : `expected one of ${pyStr(get(rule, 'enum'))}`;
  if (rule.has('nullable')) return value === null ? null : typeError(value, get(rule, 'nullable'));
  if (rule.has('object')) return pyIsDict(value) ? null : 'expected object';
  if (rule.has('array')) {
    if (!pyIsList(value)) return 'expected array';
    const count = number(getOr(rule, 'min_items', 0n));
    if (count !== null && less(BigInt(value.length), count)) return `expected at least ${pyStr(get(rule, 'min_items'))} item(s)`;
    return null;
  }
  if (rule.has('map')) {
    if (!pyIsDict(value)) return 'expected object map';
    for (const [key, entry] of value) {
      const reason = typeError(entry, get(rule, 'map'));
      if (reason) return `key '${key}': ${reason}`;
    }
    return null;
  }
  return `unreadable schema spec ${pyReprOf(spec)}`;
}

/** Recursively check one object against a named schema object. */
function checkObject(value: Dict, name: string, objects: Dict, where: string, failures: Failures, prefix: string) {
  const definition = item(objects, name);
  const required = dict(getOr(definition, 'required', new Map()));
  const optional = dict(getOr(definition, 'optional', new Map()));
  for (const [field, spec] of required) {
    const found = value.get(field);
    if (found === undefined) {
      failures.add(`${prefix}-field-missing`, `${where}: required field '${field}' is absent`);
      continue;
    }
    descend(found, spec, objects, `${where}.${field}`, failures, prefix);
  }
  for (const [field, spec] of optional) {
    const found = value.get(field);
    if (found !== undefined) descend(found, spec, objects, `${where}.${field}`, failures, prefix);
  }
  for (const field of value.keys())
    if (!required.has(field) && !optional.has(field))
      failures.add(`${prefix}-field-unknown`, `${where}: field '${field}' is not in schema object '${name}'`);
}

function descend(value: PyValue, spec: PyValue, objects: Dict, where: string, failures: Failures, prefix: string) {
  const reason = typeError(value, spec);
  if (reason) {
    failures.add(`${prefix}-field-type`, `${where}: ${reason}`);
    return;
  }
  if (!pyIsDict(spec)) return;
  if (spec.has('nullable') && value !== null) descend(value, get(spec, 'nullable'), objects, where, failures, prefix);
  else if (spec.has('object')) checkObject(dict(value), pyStr(get(spec, 'object')), objects, where, failures, prefix);
  else if (spec.has('array')) list(value).forEach((entry, index) => descend(entry, get(spec, 'array'), objects, `${where}[${index}]`, failures, prefix));
}

// ------------------------------------------------------------ path resolution

/** First sub-path of a dotted field-group path that does not resolve. */
function pathMissing(document: PyValue, path: string): string | null {
  const parts = path.split('.');
  let node = document;
  const walked: string[] = [];
  for (const [index, part] of parts.entries()) {
    const array = part.endsWith('[]');
    const name = array ? part.slice(0, -2) : part;
    walked.push(name);
    const next = pyIsDict(node) ? node.get(name) : undefined;
    if (next === undefined) return walked.join('.');
    node = next;
    if (array) {
      if (!pyIsList(node)) return walked.join('.');
      const rest = parts.slice(index + 1).join('.');
      for (const element of node) {
        const missing = rest ? pathMissing(element, rest) : null;
        if (missing) return `${walked.join('.')}[].${missing}`;
      }
      return null;
    }
  }
  return null;
}

// ------------------------------------------------------------- secret linting

function scanSecrets(node: PyValue, where: string, failures: Failures, source: string) {
  if (pyIsDict(node)) {
    for (const [key, value] of node) {
      const here = `${where}.${key}`;
      if (typeof value === 'string' && value && SECRET_KEY.test(key))
        failures.add('secret-in-commit-safe-metadata', `${source}: '${here}' names a credential and carries a value; `
          + 'commit-safe metadata must not hold tokens or serials');
      if (typeof value === 'string' && PRIVATE_PATH.test(value))
        failures.add('secret-in-commit-safe-metadata', `${source}: '${here}' contains an absolute private path (${pyStrRepr(value)})`);
      scanSecrets(value, here, failures, source);
    }
  } else if (pyIsList(node)) node.forEach((entry, index) => scanSecrets(entry, `${where}[${index}]`, failures, source));
}

// ------------------------------------------------------------------ validation

function validateManifest(manifest: Dict, schema: Dict, failures: Failures) {
  if (!pyEquals(get(manifest, 'schema'), get(schema, 'schema'))) {
    failures.add('schema-mismatch', `manifest declares schema ${pyReprOf(get(manifest, 'schema'))}, expected ${pyReprOf(get(schema, 'schema'))}`);
    return false;
  }
  const version = get(manifest, 'schema_version');
  if (!within(version, list(item(schema, 'supported_versions')))) {
    failures.add('schema-version-unsupported', `manifest schema_version ${pyReprOf(version)} is not one of `
      + `${pyStr(item(schema, 'supported_versions'))}; refusing to reinterpret it as v1`);
    return false;
  }
  checkObject(manifest, pyStr(item(schema, 'root')), dict(item(schema, 'objects')), 'manifest', failures, 'manifest');
  return failures.rows.length === 0;
}

function checkArtifacts(manifest: Dict, failures: Failures) {
  const seen: PyValue[] = [];
  list(item(manifest, 'artifacts')).forEach((artifact, index) => {
    const where = `artifacts[${index}] (${pyStr(get(artifact, 'artifact_id'))})`;
    if (get(artifact, 'sha256') === null) failures.add('artifact-hash-missing', `${where}: no sha256; a path and a basename are not provenance`);
    const identifier = hashable(get(artifact, 'artifact_id'));
    if (within(identifier, seen)) failures.add('duplicate-artifact-id', `${where}: artifact_id repeats`);
    seen.push(identifier);
    const redaction = getOr(artifact, 'redaction', new Map());
    if (pyTruthy(get(redaction, 'contains_game_media')) && pyTruthy(get(redaction, 'commit_safe')))
      failures.add('raw-media-commit-declared', `${where}: declares game media and commit_safe; raw commercial media stays out of git`);
    if (pyTruthy(get(redaction, 'contains_game_media')) && pyEquals(get(artifact, 'retention'), 'commit-safe'))
      failures.add('raw-media-commit-declared', `${where}: game media cannot have retention 'commit-safe'`);
  });
}

function checkBuilds(manifest: Dict, events: readonly Dict[], failures: Failures) {
  const build = item(item(manifest, 'target'), 'game_build');
  list(item(manifest, 'artifacts')).forEach((artifact, index) => {
    const other = get(artifact, 'game_build');
    if (other !== null && !pyEquals(other, build))
      failures.add('mixed-game-builds', `artifacts[${index}] (${pyStr(get(artifact, 'artifact_id'))}) was captured on `
        + `game build ${pyReprOf(other)}, session target is ${pyReprOf(build)}`);
  });
  for (const event of events) {
    const other = get(event, 'game_build');
    if (other !== null && !pyEquals(other, build))
      failures.add('mixed-game-builds', `event seq ${pyStr(get(event, 'seq'))} records game build ${pyReprOf(other)}, `
        + `session target is ${pyReprOf(build)}`);
  }
}

/** a > 0 for holdout errors: a number compares, anything else stops the run as its TypeError did. */
function positive(value: PyValue) {
  const amount = number(value);
  if (amount === null) throw new TypeError(`'>' not supported between instances of '${pyTypeName(value)}' and 'int'`);
  return less(0n, amount);
}

function checkModels(manifest: Dict, failures: Failures) {
  const build = item(item(manifest, 'target'), 'game_build');
  list(item(manifest, 'models')).forEach((model, index) => {
    const where = `models[${index}] (${pyStr(get(model, 'model_id'))})`;
    if (!pyEquals(get(model, 'authorized_for_game_build'), build))
      failures.add('model-stale', `${where}: authorized for game build ${pyReprOf(get(model, 'authorized_for_game_build'))}, `
        + `session runs ${pyReprOf(build)}`);
    if (pyEquals(get(model, 'authorized_for'), 'live-decision')) {
      const holdout = get(model, 'holdout_report');
      if (holdout === null) failures.add('model-unauthorized', `${where}: authorized for live decisions with no holdout report`);
      else if (positive(getOr(holdout, 'errors', 0n)))
        failures.add('model-unauthorized', `${where}: holdout report records ${pyStr(item(holdout, 'errors'))} error(s); `
          + 'a model that misclassifies its holdout is not action-authorized');
    }
  });
}

function checkClocks(manifest: Dict, failures: Failures) {
  const domains: PyValue[] = [];
  list(item(manifest, 'clocks')).forEach((clock, index) => {
    const domain = get(clock, 'domain');
    if (within(domain, domains)) failures.add('duplicate-clock-domain', `clocks[${index}]: domain ${pyReprOf(domain)} repeats`);
    domains.push(domain);
  });
  list(item(manifest, 'alignment_edges')).forEach((edge, index) => {
    for (const side of ['from_domain', 'to_domain']) {
      if (!within(get(edge, side), domains))
        failures.add('unknown-clock-domain', `alignment_edges[${index}].${side}: ${pyReprOf(get(edge, side))} is not a declared clock domain`);
    }
  });
  return domains;
}

function readEvents(path: string, schema: Dict, failures: Failures): Map<string, PyValue>[] {
  const events: Map<string, PyValue>[] = [];
  let lines: string[];
  try {
    lines = pySplitLines(readText(path));
  } catch (error) {
    if (!isOsError(error)) throw error;
    failures.add('events-unreadable', `${path}: ${pyOsError(error, path)}`);
    return events;
  }
  const kindRequired = dict(item(schema, 'kind_required'));
  lines.forEach((line, k) => {
    const number = k + 1;
    if (!pyStrip(line)) return;
    let parsed: PyValue;
    try {
      parsed = pyLoads(line);
    } catch (error) {
      if (!(error instanceof PyJsonError)) throw error;
      failures.add('events-unreadable', `${path}:${number}: ${error.message}`);
      return;
    }
    if (!pyIsDict(parsed)) {
      failures.add('events-unreadable', `${path}:${number}: line is not a JSON object`);
      return;
    }
    const where = `event line ${number}`;
    checkObject(parsed, pyStr(item(schema, 'root')), dict(item(schema, 'objects')), where, failures, 'event');
    const kind = hashable(get(parsed, 'kind'));
    for (const field of typeof kind === 'string' ? list(kindRequired.get(kind) ?? []) : []) {
      if (get(parsed, pyStr(field)) === null)
        failures.add('event-kind-field-missing', `${where}: kind ${pyReprOf(kind)} requires '${pyStr(field)}'`);
    }
    if (pyEquals(kind, 'observation')) {
      const hasValue = get(parsed, 'value') !== null, hasUnknown = get(parsed, 'unknown_reason') !== null;
      if (hasValue === hasUnknown)
        failures.add('event-kind-field-missing', `${where}: an observation carries exactly one of 'value' or 'unknown_reason'; an UNKNOWN must say why`);
    }
    events.push(new Map(parsed).set('_line', BigInt(number)));
  });
  return events;
}

/** A dict over hashable keys, looked up by Python's == (the caller hashes, as Python would). */
class PyDict<T> {
  private readonly entries: [PyValue, T][] = [];
  get(key: PyValue) { return this.entries.find(([other]) => pyEquals(key, other))?.[1]; }
  set(key: PyValue, value: T) {
    const found = this.entries.find(([other]) => pyEquals(key, other));
    if (found) found[1] = value;
    else this.entries.push([key, value]);
  }
}

function checkEventStream(manifest: Dict, events: readonly Dict[], domains: readonly PyValue[], failures: Failures) {
  const aligned = new PyDict<true>();
  for (const edge of list(item(manifest, 'alignment_edges'))) {
    const from = hashable(get(edge, 'from_domain')), to = hashable(get(edge, 'to_domain'));
    aligned.set([from, to], true);
    aligned.set([to, from], true);
  }
  const models = new PyDict<Dict>();
  for (const model of list(item(manifest, 'models'))) if (dict(model).has('model_id')) models.set(hashable(item(model, 'model_id')), dict(model));
  const artifacts = new PyDict<true>();
  for (const artifact of list(item(manifest, 'artifacts'))) if (dict(artifact).has('artifact_id')) artifacts.set(hashable(item(artifact, 'artifact_id')), true);

  let previousSeq: PyValue = null;
  const latest = new PyDict<PyValue>();
  for (const event of events) {
    const where = `event line ${pyStr(item(event, '_line'))} (seq ${pyStr(get(event, 'seq'))})`;
    const seq = get(event, 'seq');
    if (typeof seq === 'bigint' || typeof seq === 'boolean') {   // isinstance(seq, int): a bool is one
      const previous = number(previousSeq);
      const current = number(seq);
      if (previous !== null && current !== null && !less(previous, current))
        failures.add('event-out-of-order', `${where}: seq must strictly increase; previous was ${pyStr(previousSeq)}`);
      previousSeq = seq;
    }

    const clock = get(event, 'clock');
    if (!within(clock, domains)) failures.add('unknown-clock-domain', `${where}: clock ${pyReprOf(clock)} is not declared in the manifest`);
    else {
      const when = get(event, 't');
      const at = number(when);
      const before = latest.get(hashable(clock));
      const was = before === undefined ? null : number(before);
      if (at !== null && was !== null && before !== undefined && less(at, was))
        failures.add('event-out-of-order', `${where}: t ${pyStr(when)} precedes ${pyStr(before)} in the same clock `
          + `domain ${pyReprOf(clock)}`);
      if (at !== null) latest.set(clock, when);
    }

    const decision = get(event, 'decision');
    for (const [field, other] of [['source_clock', get(event, 'source_clock')],
      ['deadline_clock', get(pyTruthy(decision) ? decision : new Map(), 'deadline_clock')]] as const) {
      if (other === null || pyEquals(other, clock)) continue;
      if (!within(other, domains)) failures.add('unknown-clock-domain', `${where}: ${field} ${pyReprOf(other)} is not declared in the manifest`);
      else if (aligned.get([hashable(clock), other]) === undefined)
        failures.add('clock-alignment-missing', `${where}: crosses clock domains ${pyReprOf(clock)} -> ${pyReprOf(other)} with no `
          + 'alignment edge in the manifest; the two are not interchangeable');
    }

    const modelId = get(event, 'model_id');
    if (modelId !== null) {
      const model = models.get(hashable(modelId));
      if (model === undefined) failures.add('unknown-model-reference', `${where}: model_id ${pyReprOf(modelId)} is not declared in the manifest`);
      else {
        if (!within(get(event, 'model_sha256'), [null, get(model, 'sha256')]))
          failures.add('unknown-model-reference', `${where}: model_sha256 disagrees with the manifest entry for ${pyReprOf(modelId)}`);
        const provenance = get(event, 'label_provenance');
        const split = get(pyTruthy(provenance) ? provenance : new Map(), 'split_role');
        if (pyEquals(split, 'live-decision') && !pyEquals(get(model, 'authorized_for'), 'live-decision'))
          failures.add('model-unauthorized', `${where}: drives a live decision with model ${pyReprOf(modelId)}, `
            + `authorized only for ${pyReprOf(get(model, 'authorized_for'))}`);
      }
    }

    const source = get(event, 'source_artifact');
    if (source !== null && artifacts.get(hashable(source)) === undefined)
      failures.add('unknown-artifact-reference', `${where}: source_artifact ${pyReprOf(source)} is not a manifest artifact`);

    if (pyTruthy(get(getOr(event, 'redaction', new Map()), 'commit_safe')))
      scanSecrets(new Map([...event].filter(([key]) => key !== '_line')), 'event', failures, where);
  }
}

function checkTerminalOutcome(manifest: Dict, events: readonly Dict[], schema: Dict, failures: Failures) {
  const outcome = item(manifest, 'outcome');
  const terminal = events.filter(event => pyEquals(get(event, 'kind'), 'lifecycle') && pyTruthy(get(event, 'terminal')));
  if (pyTruthy(item(outcome, 'terminal'))) {
    if (!terminal.length) failures.add('terminal-event-missing', 'manifest declares a terminal outcome but no lifecycle event is marked terminal');
    else if (terminal.length > 1) failures.add('terminal-outcome-mismatch', `${terminal.length} lifecycle events claim to be terminal`);
    else if (!pyEquals(get(terminal[0], 'outcome'), item(outcome, 'lifecycle')))
      failures.add('terminal-outcome-mismatch', `manifest outcome ${pyReprOf(item(outcome, 'lifecycle'))} disagrees with terminal `
        + `event outcome ${pyReprOf(get(terminal[0], 'outcome'))}`);
  }
  if (!pyEquals(item(outcome, 'lifecycle'), 'win')) return;
  const kinds = item(schema, 'win_evidence_kinds');
  const authority = new PyDict<PyValue>();
  for (const artifact of list(item(manifest, 'artifacts'))) authority.set(hashable(get(artifact, 'artifact_id')), get(artifact, 'authority'));
  const supporting = list(item(outcome, 'evidence')).filter(evidence => pyEquals(get(evidence, 'supports'), 'win')
    && get(evidence, 'positive') === true && within(get(evidence, 'kind'), list(kinds))
    && pyEquals(authority.get(hashable(get(evidence, 'artifact_id'))) ?? null, 'primary-observation'));
  if (!supporting.length)
    failures.add('false-win-evidence', "terminal outcome 'win' has no positive 6 AM evidence from a primary "
      + `observation (accepted evidence kinds: ${pyStr(kinds)}); a false win is never acceptable, so an unevidenced win stays UNKNOWN`);
}

function checkFieldGroups(manifest: Dict, events: readonly Dict[], schema: Dict, failures: Failures) {
  for (const group of list(item(schema, 'field_groups'))) {
    const label = `field group ${pyStr(item(group, 'group'))} (${pyStr(item(group, 'name'))})`;
    for (const path of list(getOr(group, 'manifest_paths', []))) {
      const missing = pathMissing(manifest, pyStr(path));
      if (missing) failures.add('field-group-missing', `${label}: manifest lacks '${missing}'`);
    }
    for (const path of list(getOr(group, 'event_paths', []))) {
      for (const event of events) {
        if (pyStr(path).startsWith('label_provenance') && !pyEquals(get(event, 'kind'), 'observation')) continue;
        const missing = pathMissing(event, pyStr(path));
        if (missing) failures.add('field-group-missing', `${label}: event line ${pyStr(item(event, '_line'))} lacks '${missing}'`);
      }
    }
  }
}

/** Path.parent, as PurePosixPath gives it. */
function parentOf(path: string) {
  const at = path.lastIndexOf('/');
  if (at < 0) return '.';
  const head = path.slice(0, at);
  return /^\/*$/.test(head) ? path.slice(0, at + 1) : head;
}
/** parent / child, as PurePosixPath joins them. */
const joinPath = (parent: string, child: string) => pyPath(child.startsWith('/') ? child : parent.endsWith('/') ? parent + child : `${parent}/${child}`);
const nameOf = (path: string) => path.slice(path.lastIndexOf('/') + 1);

export function validate(manifestPath: string, eventsPath: string | null): [Failures, Dict | null] {
  const failures = new Failures();
  const manifestSchema = loadSchema('session-manifest-v1.json');
  const eventSchema = loadSchema('session-events-v1.json');
  let parsed: PyValue;
  try {
    parsed = pyLoads(readText(manifestPath));
  } catch (error) {
    if (error instanceof PyJsonError) failures.add('manifest-unreadable', `${manifestPath}: ${error.message}`);
    else if (isOsError(error)) failures.add('manifest-unreadable', `${manifestPath}: ${pyOsError(error, manifestPath)}`);
    else throw error;
    return [failures, null];
  }
  if (!pyIsDict(parsed)) {
    failures.add('manifest-unreadable', `${manifestPath}: not a JSON object`);
    return [failures, null];
  }
  const manifest = parsed;
  if (!validateManifest(manifest, manifestSchema, failures)) return [failures, manifest];
  const events = eventsPath ?? joinPath(parentOf(manifestPath), pyStr(item(manifest, 'event_stream')));
  checkArtifacts(manifest, failures);
  checkModels(manifest, failures);
  const domains = checkClocks(manifest, failures);
  if (pyTruthy(item(item(manifest, 'redaction'), 'commit_safe'))) {
    scanSecrets(manifest, 'manifest', failures, nameOf(manifestPath));
    if (pyTruthy(item(item(manifest, 'helper'), 'token_present')))
      failures.add('secret-in-commit-safe-metadata', 'helper.token_present is true in a manifest declared commit-safe');
  }
  const rows = readEvents(events, eventSchema, failures);
  checkBuilds(manifest, rows, failures);
  checkEventStream(manifest, rows, domains, failures);
  checkTerminalOutcome(manifest, rows, manifestSchema, failures);
  checkFieldGroups(manifest, rows, manifestSchema, failures);
  return [failures, manifest];
}

function main(argv: readonly string[]): number {
  const args = pyArgs(argv, 'validate-session.ts', [{ name: '--events' }, { name: '--json', takes: 'flag' }], [{ name: 'manifest' }]);
  if ('exit' in args) {
    (args.exit ? console.error : console.log)(args.text);
    return args.exit;
  }
  const manifestPath = pyPath(args.positionals[0]);
  const eventsOption = args.options['--events'];
  if (!existsSync(manifestPath)) {
    console.error(`no such manifest: ${manifestPath}`);
    return 2;
  }
  const [failures, manifest] = validate(manifestPath, typeof eventsOption === 'string' ? pyPath(eventsOption) : null);
  if (args.options['--json'] === true) {
    console.log(pyDumps(new Map<string, PyValue>([['manifest', manifestPath], ['ok', failures.rows.length === 0],
      ['failures', failures.rows.map(row => new Map([['code', row.code], ['detail', row.detail]]))]]), 2));
  } else if (failures.rows.length) {
    console.error(`${nameOf(manifestPath)}: ${failures.rows.length} failure(s)`);
    for (const row of failures.rows) console.error(`FAIL ${row.code}: ${row.detail}`);
  } else {
    const session = item(item(manifest, 'session'), 'session_id');
    console.log(`${nameOf(manifestPath)}: session ${pyStr(session)} validates against fnaf2.session-manifest v${pyStr(item(manifest, 'schema_version'))}`);
  }
  return failures.rows.length ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
