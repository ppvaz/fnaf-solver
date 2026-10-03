#!/usr/bin/env node
// Emit a v1 session manifest and event stream for one device run.
//
//     session-manifest.ts start    RUN [key=value ...]
//     session-manifest.ts record   RUN OP [key=value ...]
//     session-manifest.ts event    RUN [key=value ...]
//     session-manifest.ts finalize RUN [key=value ...]
//
// This is the *producer* half of the Plan 09 package 2 contract; validate-session.ts is the consumer half.
//
// Three properties it exists to guarantee:
//
//   One session id, threaded.  `start` latches an id and a monotonic origin once and writes them to a spool;
//   every later call reads them back. Nothing re-derives an id from a filename or a clock, so artifacts from one
//   run join.
//
//   Hashes, not filenames.     `record artifact file=...` and `record model file=...` hash the bytes on disk. A
//   path that does not exist is an error, not an artifact entry -- a manifest that names a file nobody wrote is
//   exactly the failure grade-run.sh was written for.
//
//   Raw clocks preserved.      Every event names its clock domain. A reading that came from another domain keeps
//   its own `source_clock`/`source_t`; the manifest carries the measured alignment edge instead of rewriting the
//   value.
//
// Fields are typed by packages/review/bin/legacy/schema/*.json, not by a table restated here, so a key this tool
// cannot place in the schema is refused at `record` time rather than surfacing as a validation failure minutes
// later.
//
// Exit status: 0 success, 1 refused/invalid, 2 usage or I/O error.
//
// Ported from session-manifest.py: it writes the same spool, events and manifest, and prints and exits as that
// did.
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  appendFileSync, closeSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, readlinkSync, realpathSync,
  renameSync, statSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PyFloat, type PyJson, type PyValue, pyDecodeUtf8, pyDumps, pyFixed, pyFloat, pyInt, pyIsDict, pyIsList, pyLoads, pyPath, pyReprOf, pySplitLines,
  pyStrRepr, pyStrip, pyTruthy, PyJsonError,
} from '@sixam/kernel/py';
import { PRIVATE_PATH, SECRET_KEY } from './validate-session.ts';

const HERE = dirname(realpathSync(fileURLToPath(import.meta.url)));
const REPO = resolve(HERE, '../../../..');
const SCHEMA_DIR = `${HERE}/schema`;
const VALIDATOR = fileURLToPath(new URL('validate-session.ts', import.meta.url));
// FNAF2_CAPTURES exists so the mock-ADB regression can build real sessions without colliding with a live run's
// files. It must stay inside the checkout: artifact paths are recorded repository-relative, and a path outside it
// cannot be recorded at all.
const CAPTURES = process.env.FNAF2_CAPTURES ? pyPath(process.env.FNAF2_CAPTURES) : `${REPO}/captures`;
const ORIGIN_CLOCK = 'host_monotonic_ms';

/** One OS monotonic clock shared by separate producer processes, in seconds: the clock libuv's hrtime reads
 *  (CLOCK_MONOTONIC on Linux, mach time on macOS), the same in every process of a session. */
const hostMonotonic = () => Number(process.hrtime.bigint()) / 1e9;

// op -> [schema file, root object, manifest destination]
const OPS = new Map<string, [string, string, readonly string[]]>([
  ['producer', ['manifest', 'producer', ['producer']]], ['target', ['manifest', 'target', ['target']]],
  ['controller', ['manifest', 'controller', ['controller']]], ['helper', ['manifest', 'helper', ['helper']]],
  ['redaction', ['manifest', 'redaction', ['redaction']]], ['clock', ['manifest', 'clock', ['clocks']]],
  ['align', ['manifest', 'alignment_edge', ['alignment_edges']]], ['artifact', ['manifest', 'artifact', ['artifacts']]],
  ['model', ['manifest', 'model', ['models']]], ['evidence', ['manifest', 'evidence', ['outcome', 'evidence']]],
]);
const LIST_OPS = new Set(['clock', 'align', 'artifact', 'model', 'evidence']);

/** SystemExit with a message, as die() raised it. */
class Die extends Error {
  readonly status: number;
  constructor(message: string, status: number) { super(message); this.status = status; }
}
const die = (message: string, status = 2): never => { throw new Die(message, status); };

/** A dict this tool builds and writes: insertion-ordered, values as Python held them. */
type Dict = Map<string, Value>;
type Value = null | boolean | bigint | number | PyFloat | string | Value[] | Dict;

/** What json.loads read, as a value this tool may change. */
function own(value: PyValue): Value {
  if (pyIsList(value)) return value.map(own);
  if (pyIsDict(value)) return new Map([...value].map(([key, entry]) => [key, own(entry)]));
  return value;
}
const isDict = (value: Value | undefined): value is Dict => value instanceof Map;
function dictOf(value: Value | undefined): Dict {
  if (!isDict(value)) throw new TypeError("'NoneType' object has no attribute 'get'");
  return value;
}
const at = (value: Value | undefined, key: string): Value => {
  const found = dictOf(value).get(key);
  if (found === undefined) throw new TypeError(`KeyError: ${pyStrRepr(key)}`);
  return found;
};
const toJson = (value: Value): PyJson => value;

function readText(path: string) {
  return pyDecodeUtf8(readFileSync(path));
}
const nameOf = (path: string) => path.slice(path.lastIndexOf('/') + 1);

function loadSchema(name: string): Dict {
  return dictOf(own(pyLoads(readText(`${SCHEMA_DIR}/session-${name}-v1.json`))));
}

// ------------------------------------------------------------------ spool i/o

function paths(run: string) {
  return { spool: `${CAPTURES}/${run}-session.spool.jsonl`, events: `${CAPTURES}/${run}-session.events.jsonl`, manifest: `${CAPTURES}/${run}-session.json` };
}

/** The spool's rows: the first a start record (only it is checked, as Python checked it). */
function readSpool(run: string): [Dict, ...Value[]] {
  const path = paths(run).spool;
  if (!existsSync(path)) die(`no session started for ${pyStrRepr(run)}: ${nameOf(path)} is absent`, 2);
  const rows: Value[] = [];
  pySplitLines(readText(path)).forEach((line, k) => {
    if (!pyStrip(line)) return;
    try {
      rows.push(own(pyLoads(line)));
    } catch (error) {
      if (!(error instanceof PyJsonError)) throw error;
      die(`${nameOf(path)}:${k + 1}: ${error.message}`, 2);
    }
  });
  const [first, ...rest] = rows;
  if (first === undefined || dictOf(first).get('op') !== 'start') return die(`${nameOf(path)} does not begin with a start record`, 2);
  return [dictOf(first), ...rest];
}

function append(path: string, record: Dict) {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${pyDumps(toJson(record), undefined, { sortKeys: true })}\n`);
}

// ------------------------------------------------------------ value handling

/** Refuse the shapes that must never reach a manifest, wherever declared. */
function guard(key: string, value: Value) {
  const leaf = key.split('.').pop() ?? key;
  if (typeof value === 'string' && value && SECRET_KEY.test(leaf))
    die(`refusing to record ${pyStrRepr(key)}: it names a credential and carries a value; a manifest never holds tokens, serials or cookies`, 1);
  if (typeof value === 'string' && PRIVATE_PATH.test(value))
    die(`refusing to record ${pyStrRepr(key)}: ${pyStrRepr(value)} is an absolute private path; record a repository-relative path instead`, 1);
}

/** os.path.realpath(path) without strict: each existing symlink followed, the rest kept as written. */
function realpath(path: string): string {
  const seen = new Map<string, string | null>();
  const split = (p: string): [string, string] => {
    const cut = p.lastIndexOf('/') + 1;
    const head = p.slice(0, cut);
    return [head && !/^\/+$/.test(head) ? head.replace(/\/+$/, '') : head, p.slice(cut)];
  };
  const join = (a: string, b: string) => (!a ? b : a.endsWith('/') ? a + b : `${a}/${b}`);
  const walk = (start: string, rest: string): [string, boolean] => {
    let current = start;
    if (rest.startsWith('/')) [rest, current] = [rest.slice(1), '/'];
    while (rest) {
      const cut = rest.indexOf('/');
      const name = cut < 0 ? rest : rest.slice(0, cut);
      rest = cut < 0 ? '' : rest.slice(cut + 1);
      if (!name || name === '.') continue;
      if (name === '..') {
        if (current) {
          const [head, tail] = split(current);
          current = tail === '..' ? join(join(head, '..'), '..') : head;
        } else current = '..';
        continue;
      }
      const next = join(current, name);
      let link = false;
      try { link = lstatSync(next).isSymbolicLink(); } catch { link = false; }
      if (!link) { current = next; continue; }
      if (seen.has(next)) {
        const known = seen.get(next);
        if (known !== null && known !== undefined) { current = known; continue; }
        return [join(next, rest), false];
      }
      seen.set(next, null);
      const [followed, ok] = walk(current, readlinkSync(next));
      if (!ok) return [join(followed, rest), false];
      seen.set(next, followed);
      current = followed;
    }
    return [current, true];
  };
  const [found] = walk('', path);
  return resolve(process.cwd(), found || '.');
}

/** PurePath.relative_to: the path below root by whole components, or null. */
function relativeTo(path: string, root: string): string | null {
  if (path === root) return '.';
  const prefix = root.endsWith('/') ? root : `${root}/`;
  return path.startsWith(prefix) ? path.slice(prefix.length) : null;
}

function relativeSource(text: string, what: string): [string, string] {
  const path = pyPath(text);
  const resolved = realpath(path.startsWith('/') ? path : `${process.cwd()}/${path}`);
  const rel = relativeTo(resolved, REPO);
  if (rel === null)
    die(`${what} ${pyStrRepr(text)} lives outside the repository; its path cannot be recorded without leaking a private location`, 1);
  return [resolved, rel ?? ''];
}

/** Path.expanduser(): a leading ~ or ~/ is the home directory. */
const expandUser = (path: string) => (path === '~' || path.startsWith('~/') ? (process.env.HOME ?? homedir()) + path.slice(1) : path);
const isFile = (path: string) => { try { return statSync(path).isFile(); } catch { return false; } };
const isDir = (path: string) => { try { return statSync(path).isDirectory(); } catch { return false; } };

function sha256File(path: string) {
  const digest = createHash('sha256');
  const fd = openSync(path, 'r');
  try {
    const block = Buffer.alloc(1 << 20);
    for (let read = readSync(fd, block); read > 0; read = readSync(fd, block)) digest.update(block.subarray(0, read));
  } finally {
    closeSync(fd);
  }
  return digest.digest('hex');
}

/** Code-point order, as Python compares str. */
const byCodePoint = (a: string, b: string) => {
  const [x, y] = [[...a], [...b]];
  for (let k = 0; k < Math.min(x.length, y.length); k += 1) {
    const diff = (x[k].codePointAt(0) ?? 0) - (y[k].codePointAt(0) ?? 0);
    if (diff) return diff;
  }
  return x.length - y.length;
};
/** Paths sorted as PosixPath sorts them: by their components. */
const byComponents = (a: string, b: string) => {
  const [x, y] = [a.split('/'), b.split('/')];
  for (let k = 0; k < Math.min(x.length, y.length); k += 1) {
    const diff = byCodePoint(x[k], y[k]);
    if (diff) return diff;
  }
  return x.length - y.length;
};

/** A directory's digest: the sorted (name, sha256) listing, itself hashed. Frame sets are pulled as directories
 *  and there is no single file to hash. Hashing the listing is reproducible from the directory alone and changes
 *  if any member does, which is the property a manifest needs. */
function sha256Tree(root: string): [string | null, number, number] {
  // root.rglob('*'): every entry below, without descending into a symlinked directory.
  const entries: string[] = [];
  const walk = (relative: string) => {
    for (const entry of readdirSync(relative ? `${root}/${relative}` : root, { withFileTypes: true })) {
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      entries.push(name);
      if (entry.isDirectory()) walk(name);
    }
  };
  walk('');
  const listing: string[] = [];
  let total = 0;
  for (const name of entries.filter(entry => isFile(`${root}/${entry}`)).sort(byComponents)) {
    total += statSync(`${root}/${name}`).size;
    listing.push(`${name} ${sha256File(`${root}/${name}`)}`);
  }
  if (!listing.length) return [null, 0, 0];
  return [createHash('sha256').update(`${listing.join('\n')}\n`).digest('hex'), total, listing.length];
}

// --------------------------------------------------------- schema-typed keys

function leafSpec(objects: Dict, objName: string, parts: readonly string[]): Value | null {
  const definition = objects.get(objName);
  if (definition === undefined || definition === null) return null;
  const required = dictOf(definition).get('required') ?? new Map();
  let spec = dictOf(required).get(parts[0]) ?? null;
  if (spec === null) spec = dictOf(dictOf(definition).get('optional') ?? new Map()).get(parts[0]) ?? null;
  if (spec === null) return null;
  if (parts.length === 1) return spec;
  const inner = isDict(spec) ? spec.get('nullable') ?? spec : spec;
  if (isDict(inner) && inner.has('object')) return leafSpec(objects, String(inner.get('object')), parts.slice(1));
  return null;
}

function coerce(spec: Value, key: string, text: string): Value {
  if (isDict(spec)) {
    if (spec.has('nullable')) {
      if (['', 'null', 'none'].includes(text)) return null;
      return coerce(spec.get('nullable') ?? null, key, text);
    }
    if (spec.has('enum') || spec.has('const')) return text;
    if (spec.has('array')) return text.split(',').filter(entry => entry);
    die(`${pyStrRepr(key)} is a structured field; set its leaves individually`, 2);
  }
  if (spec === 'int') return pyInt(text) ?? die(`${pyStrRepr(key)} expects an integer, got ${pyStrRepr(text)}`, 2);
  if (spec === 'number') {
    const value = pyFloat(text);
    return value === null ? die(`${pyStrRepr(key)} expects a number, got ${pyStrRepr(text)}`, 2) : new PyFloat(value);
  }
  if (spec === 'bool') {
    if (['1', 'true', 'True', 'yes'].includes(text)) return true;
    if (['0', 'false', 'False', 'no'].includes(text)) return false;
    die(`${pyStrRepr(key)} expects a boolean, got ${pyStrRepr(text)}`, 2);
  }
  return text;
}

function parsePairs(argv: readonly string[]): [string, string][] {
  return argv.map(item => {
    const cut = item.indexOf('=');
    return cut < 0 ? die(`expected key=value, got ${pyStrRepr(item)}`, 2) : [item.slice(0, cut), item.slice(cut + 1)];
  });
}

function typedFields(schemaName: string, objName: string, pairs: readonly [string, string][], skip: readonly string[] = []): Dict {
  const objects = dictOf(loadSchema(schemaName).get('objects'));
  const out: Dict = new Map();
  for (const [key, text] of pairs) {
    if (skip.includes(key)) continue;
    const parts = key.split('.');
    const spec = leafSpec(objects, objName, parts);
    if (spec === null)
      die(`${pyStrRepr(key)} is not a field of schema object ${pyStrRepr(objName)}; the schema in packages/review/bin/legacy/schema/ is the contract`, 2);
    const value = coerce(spec, key, text);
    guard(key, value);
    let node = out;
    for (const part of parts.slice(0, -1)) {
      if (!node.has(part)) node.set(part, new Map());
      const next = node.get(part);
      if (!isDict(next)) throw new TypeError(`'${typeof next}' object does not support item assignment`);
      node = next;
    }
    node.set(parts[parts.length - 1], value);
  }
  return out;
}

function deepMerge(into: Dict, extra: Dict) {
  for (const [key, value] of extra) {
    const current = into.get(key);
    if (isDict(value) && isDict(current)) deepMerge(current, value);
    else into.set(key, value);
  }
}

// ------------------------------------------------------------------ git facts

function git(...args: string[]) {
  const result = spawnSync('git', ['-C', REPO, ...args], { encoding: 'utf8', timeout: 15_000 });
  if (result.error || result.status !== 0) return null;
  return pyStrip(result.stdout);
}

const utc = (format: 'compact' | 'iso') => {
  const text = new Date().toISOString().slice(0, 19);
  return format === 'iso' ? `${text}Z` : `${text.replaceAll('-', '').replaceAll(':', '')}Z`;
};

// -------------------------------------------------------------- subcommands

function cmdStart(run: string, argv: readonly string[]) {
  const spool = paths(run).spool;
  if (existsSync(spool)) die(`${nameOf(spool)} already exists; a session id is latched once per run name, never re-derived. Use a fresh run name.`, 2);
  const fields = new Map(parsePairs(argv));
  const unknown = [...fields.keys()].filter(key => !['command', 'session_id', 'cohort_id', 'tool_version'].includes(key)).sort(byCodePoint);
  if (unknown.length) die(`start does not take ${pyReprOf(unknown)}; use \`record\``, 2);
  const command = fields.get('command');
  if (!command) return die('start needs command=<the producer\'s argv[0], repo-relative>', 2);
  guard('command', command);
  const commit = git('rev-parse', '--short', 'HEAD') || 'unknown';
  const dirty = git('status', '--porcelain');
  const sessionId = fields.get('session_id') || `${run}-${utc('compact')}-${randomUUID().replaceAll('-', '').slice(0, 8)}`;
  const originWallMs = Date.now();
  const record: Dict = new Map<string, Value>([
    ['op', 'start'], ['session_id', sessionId], ['cohort_id', fields.get('cohort_id') || null], ['command', command],
    ['tool_version', fields.get('tool_version') || `${nameOf(pyPath(command))}@${commit}`], ['repo_commit', commit],
    ['dirty_tree', dirty !== null ? dirty !== '' : true], ['started_at_utc', utc('iso')], ['origin_monotonic', new PyFloat(hostMonotonic())],
    ['origin_wall_ms', originWallMs],
  ]);
  append(spool, record);
  const events = paths(run).events;
  if (!existsSync(events)) writeFileSync(events, '');
  // Shell-evalable, so the caller threads exactly what was latched here instead of computing a second answer.
  console.log(`FNAF2_SESSION_ID=${sessionId}`);
  console.log(`FNAF2_SESSION_RUN=${run}`);
  console.log(`FNAF2_SESSION_ORIGIN_WALL_MS=${originWallMs}`);
  return 0;
}

function cmdRecord(run: string, argv: readonly string[]) {
  const named = (keys: readonly string[]) => keys.join(' ');
  if (!argv.length) die(`record needs an op: ${named([...[...OPS.keys()].sort(byCodePoint), 'env', 'note'])}`, 2);
  const [op, ...rest] = argv;
  readSpool(run);                       // refuses if no session was started
  const pairs = parsePairs(rest);
  if (op === 'env') {
    const fields: Dict = new Map();
    for (const [key, value] of pairs) {
      guard(key, value);
      fields.set(key, value);
    }
    append(paths(run).spool, new Map<string, Value>([['op', 'env'], ['fields', fields]]));
    return 0;
  }
  if (op === 'note') {
    const text = new Map(pairs).get('text') ?? '';
    guard('note', text);
    append(paths(run).spool, new Map<string, Value>([['op', 'note'], ['text', text]]));
    return 0;
  }
  const entry = OPS.get(op);
  if (entry === undefined) return die(`unknown op ${pyStrRepr(op)}; expected one of ${[...OPS.keys(), 'env', 'note'].sort(byCodePoint).join(', ')}`, 2);
  const [schemaName, objName] = entry;
  const given = new Map(pairs);
  let derived: Dict = new Map();

  if (op === 'model') {
    // A model records its hash and nothing about where it sat. Model files are gitignored and often live outside
    // the checkout entirely; the hash is the provenance, which is the point of recording one at all.
    const source = given.get('file');
    if (!source) return die('record model needs file=<path>', 2);
    const resolved = realpath(expandUser(pyPath(source)));
    if (!isFile(resolved)) die(`record model file=${pyStrRepr(source)}: not a file. A manifest does not name a model nobody can hash.`, 1);
    derived = new Map([['sha256', sha256File(resolved)]]);
  }

  if (op === 'artifact') {
    const source = given.get('file') || given.get('dir');
    if (!source) return die('record artifact needs file=<path> (or dir=<path> for a frame set)', 2);
    const [resolved, rel] = relativeSource(source, 'artifact source');
    if (given.has('dir')) {
      if (!isDir(resolved)) die(`record artifact dir=${pyStrRepr(source)}: not a directory. A manifest does not name artifacts that were never written.`, 1);
      const [digest, total, count] = sha256Tree(resolved);
      if (count === 0) die(`record artifact dir=${pyStrRepr(source)}: the directory is empty. An empty frame set is a fault to report, not an artifact.`, 1);
      derived = new Map<string, Value>([['path', rel], ['sha256', digest], ['bytes', total]]);
      console.log(`session-manifest: ${op} ${given.get('artifact_id') ?? rel}: ${count} file(s), ${total} bytes`);
    } else {
      if (!isFile(resolved)) die(`record ${op} file=${pyStrRepr(source)}: not a file. A manifest does not name artifacts that were never written.`, 1);
      derived = new Map<string, Value>([['path', rel], ['sha256', sha256File(resolved)], ['bytes', statSync(resolved).size]]);
    }
  }

  const planFile = given.get('plan_file');
  if (op === 'controller' && planFile !== undefined) {
    // Same reasoning as a model: the plan is identified by its bytes. The emitted plan lives in a per-run temporary
    // directory that is gone by the time anyone reads the manifest, so its path would be a dead name.
    const resolved = realpath(expandUser(pyPath(planFile)));
    if (!isFile(resolved)) die(`record controller plan_file=${pyStrRepr(planFile)}: not a file`, 1);
    derived.set('plan_sha256', sha256File(resolved));
  }

  const fields = typedFields(schemaName, objName, pairs, ['file', 'dir', 'plan_file']);
  deepMerge(fields, derived);
  append(paths(run).spool, new Map<string, Value>([['op', op], ['fields', fields]]));
  return 0;
}

/** round(x, digits) as Python rounds a float. */
const round = (x: number, digits: number) => Number(pyFixed(x, digits));
const elapsedMs = (start: Dict) => round((hostMonotonic() - Number(numberOf(at(start, 'origin_monotonic')))) * 1000, 1);
function numberOf(value: Value): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'bigint') return Number(value);
  if (value instanceof PyFloat) return value.value;
  throw new TypeError(`unsupported operand type(s) for -: 'float' and '${typeof value}'`);
}

function cmdEvent(run: string, argv: readonly string[], spoolRows: [Dict, ...Value[]] | null = null) {
  const rows = spoolRows ?? readSpool(run);
  const start = rows[0];
  const events = paths(run).events;
  const seq = existsSync(events) ? pySplitLines(readText(events)).filter(line => pyStrip(line)).length + 1 : 1;
  const fields = typedFields('events', 'event', parsePairs(argv));
  fields.delete('seq');
  const take = (key: string, fallback: Value) => {
    const value = fields.has(key) ? fields.get(key) ?? null : fallback;
    fields.delete(key);
    return value;
  };
  const record: Dict = new Map<string, Value>([['seq', seq]]);
  record.set('clock', take('clock', ORIGIN_CLOCK));
  // pop's default is evaluated whether or not t was given, so a start record without its origin fails either way.
  record.set('t', take('t', new PyFloat(elapsedMs(start))));
  record.set('kind', take('kind', 'lifecycle'));
  const redaction = dictOf(take('redaction', new Map()));
  if (!redaction.has('commit_safe')) redaction.set('commit_safe', true);
  record.set('redaction', redaction);
  for (const [key, value] of fields) record.set(key, value);
  append(events, record);
  return 0;
}

// ------------------------------------------------------------------ finalize

function assemble(run: string, rows: readonly [Dict, ...Value[]], closing: { lifecycle: string, terminal: boolean }): Dict {
  const start = rows[0];
  const environment: Dict = new Map();
  const manifest: Dict = new Map<string, Value>([
    ['schema', 'fnaf2.session-manifest'], ['schema_version', 1], ['event_stream', nameOf(paths(run).events)],
    ['session', new Map<string, Value>([['session_id', at(start, 'session_id')], ['cohort_id', at(start, 'cohort_id')],
      ['started_at_utc', at(start, 'started_at_utc')], ['ended_at_utc', utc('iso')], ['origin_clock', ORIGIN_CLOCK]])],
    ['producer', new Map<string, Value>([['command', at(start, 'command')], ['tool_version', at(start, 'tool_version')],
      ['repo_commit', at(start, 'repo_commit')], ['dirty_tree', at(start, 'dirty_tree')], ['environment', environment]])],
    ['target', new Map()],
    ['clocks', [new Map<string, Value>([['domain', ORIGIN_CLOCK], ['kind', 'monotonic'], ['units', 'ms'],
      ['origin_note', 'host monotonic clock latched by session-manifest.ts start; host-side only'], ['valid_from', 0],
      ['valid_until', new PyFloat(elapsedMs(start))]])]],
    ['alignment_edges', []], ['artifacts', []], ['models', []], ['controller', new Map()],
    ['outcome', new Map<string, Value>([['lifecycle', closing.lifecycle], ['terminal', closing.terminal], ['evidence', []]])],
    ['helper', new Map<string, Value>([['process_identity', null], ['restarts', 0], ['revocations', 0], ['focus_faults', 0], ['token_present', false]])],
    ['redaction', new Map<string, Value>([['commit_safe', true], ['raw_media_committed', false],
      ['notes', 'captures/ is gitignored; this manifest carries paths, sizes and hashes, never media']])],
  ]);
  const notes: string[] = [];
  for (const row of rows.slice(1)) {
    const op = at(row, 'op');
    if (op === 'env') for (const [key, value] of dictOf(at(row, 'fields'))) environment.set(key, value);
    else if (op === 'note') notes.push(String(at(row, 'text')));
    else {
      const entry = typeof op === 'string' ? OPS.get(op) : undefined;
      if (entry === undefined) throw new TypeError(`KeyError: ${typeof op === 'string' ? pyStrRepr(op) : 'op'}`);
      const destination = entry[2];
      if (LIST_OPS.has(String(op))) {
        let node: Value = manifest;
        for (const part of destination.slice(0, -1)) node = at(node, part);
        const target = at(node, destination[destination.length - 1]);
        if (!Array.isArray(target)) throw new TypeError("'dict' object has no attribute 'append'");
        target.push(at(row, 'fields'));
      } else deepMerge(dictOf(at(manifest, destination[0])), dictOf(at(row, 'fields')));
    }
  }
  if (notes.length) manifest.set('notes', notes.join(' | '));
  return manifest;
}

function cmdFinalize(run: string, argv: readonly string[]) {
  const where = paths(run);
  const rows = readSpool(run);
  const fields = new Map(parsePairs(argv));
  const lifecycle = fields.get('lifecycle') ?? 'unknown';
  if (!['win', 'death', 'aborted', 'focus-loss', 'unknown'].includes(lifecycle)) die(`lifecycle ${pyStrRepr(lifecycle)} is not a v1 outcome`, 2);
  const terminal = ['1', 'true', 'True', 'yes'].includes(fields.get('terminal') ?? (lifecycle !== 'unknown' ? 'true' : 'false'));
  const reason = fields.get('reason') ?? '';
  guard('reason', reason);

  if (terminal) {
    // The manifest and the stream must not be able to disagree about how the session ended, so the terminal
    // record is written here, from the same decision, rather than left to each caller's exit path.
    cmdEvent(run, ['kind=lifecycle', `outcome=${lifecycle}`, 'terminal=true', 'sensor=runner', `note=${reason || lifecycle}`], rows);
  }
  const manifest = assemble(run, rows, { lifecycle, terminal });

  // The event stream is itself an artifact of the session, and hashing it last guarantees at least one artifact
  // exists even for a run that captured nothing -- an empty artifact list would otherwise read as "no manifest".
  const eventsPath = relativeTo(where.events, REPO);
  if (eventsPath === null) throw new RangeError(`${pyStrRepr(where.events)} is not in the subpath of ${pyStrRepr(REPO)}`);
  const artifacts = at(manifest, 'artifacts');
  const outcome = dictOf(at(manifest, 'outcome'));
  const evidence = at(outcome, 'evidence');
  if (!Array.isArray(artifacts) || !Array.isArray(evidence)) throw new TypeError("'dict' object has no attribute 'append'");
  const present = existsSync(where.events);
  artifacts.push(new Map<string, Value>([
    ['artifact_id', 'session-events'], ['role', 'session-event-stream'], ['authority', 'operational-metadata'], ['path', eventsPath],
    ['format', 'application/x-ndjson'], ['bytes', present ? statSync(where.events).size : 0], ['sha256', present ? sha256File(where.events) : null],
    ['complete', true], ['truncated', false], ['retention', 'local-only'], ['clock_domain', ORIGIN_CLOCK], ['game_build', null],
    ['redaction', new Map<string, Value>([['contains_game_media', false], ['contains_audio', false], ['commit_safe', true]])],
  ]));
  if (!evidence.length) {
    evidence.push(new Map<string, Value>([['kind', 'runner-exit-record'], ['supports', lifecycle], ['positive', true], ['artifact_id', 'session-events'],
      ['note', reason || 'the runner\'s own exit path; no independent grader has spoken for this interval']]));
  }
  const helper = dictOf(at(manifest, 'helper'));
  if (truthy(at(helper, 'token_present'))) {
    // A live helper token existed in this session. The manifest never holds it, but v1 treats "commit-safe" and
    // "a token was in play" as contradictory, and the honest side of that is not to claim commit safety for a
    // session that had one.
    const redaction = dictOf(at(manifest, 'redaction'));
    redaction.set('commit_safe', false);
    redaction.set('notes', `${String(at(redaction, 'notes'))}; a Companion session token was in play, so this manifest is not `
      + 'declared commit-safe (the token itself is never recorded)');
  }

  const target = dictOf(at(manifest, 'target'));
  const missing = ['game_package', 'game_version', 'game_build', 'night', 'configuration', 'device_model', 'sensor_path'].filter(key => !target.has(key));
  if (missing.length || !target.has('display')) {
    die(`target facts were never recorded: ${[...missing, ...(target.has('display') ? [] : ['display'])].join(', ')}. Refusing to write a `
      + `manifest that cannot name its build or device; the spool is kept at ${nameOf(where.spool)}`, 1);
  }
  if (!dictOf(at(manifest, 'controller')).size)
    die('no controller was recorded; refusing to write a manifest that cannot name the policy that produced the run', 1);

  const temporary = `${where.manifest}.tmp`;
  writeFileSync(temporary, `${pyDumps(toJson(manifest), 2)}\n`);
  renameSync(temporary, where.manifest);

  const validator = spawnSync(process.execPath, [VALIDATOR, where.manifest], { encoding: 'utf8' });
  process.stdout.write(validator.stdout);
  process.stderr.write(validator.stderr);
  if (validator.status !== 0) {
    console.error(`session-manifest: ${nameOf(where.manifest)} was written but does NOT validate; the spool is kept beside it so the defect `
      + 'can be corrected and re-finalized');
    return 1;
  }
  unlinkSync(where.spool);
  const models = at(manifest, 'models');
  console.log(`session-manifest: ${nameOf(where.manifest)} (${artifacts.length} artifact(s), ${Array.isArray(models) ? models.length : 0} model(s), outcome ${lifecycle})`);
  return 0;
}

/** bool() of a value this tool holds. */
function truthy(value: Value): boolean {
  if (typeof value === 'number') return value !== 0;
  if (Array.isArray(value)) return value.length > 0;
  if (isDict(value)) return value.size > 0;
  return pyTruthy(value);
}

const USAGE = `Emit a v1 session manifest and event stream for one device run.

    session-manifest.ts start    RUN [key=value ...]
    session-manifest.ts record   RUN OP [key=value ...]
    session-manifest.ts event    RUN [key=value ...]
    session-manifest.ts finalize RUN [key=value ...]

Exit status: 0 success, 1 refused/invalid, 2 usage or I/O error.
`;

function main(argv: readonly string[]): number {
  if (argv.length < 2) {
    console.error(USAGE);
    return 2;
  }
  const [command, run, ...rest] = argv;
  try {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(run)) die(`run name ${pyStrRepr(run)} must be a plain basename`, 2);
    if (command === 'start') return cmdStart(run, rest);
    if (command === 'record') return cmdRecord(run, rest);
    if (command === 'event') return cmdEvent(run, rest);
    if (command === 'finalize') return cmdFinalize(run, rest);
    return die(`unknown subcommand ${pyStrRepr(command)}`, 2);
  } catch (error) {
    if (!(error instanceof Die)) throw error;
    console.error(`session-manifest: ${error.message}`);
    return error.status;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
