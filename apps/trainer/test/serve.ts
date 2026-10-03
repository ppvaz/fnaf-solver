#!/usr/bin/env node
// Dev server for the trainer.
//
// Serves the project on this machine only (127.0.0.1) and accepts POST /save-layout, so a layout calibrated by
// dragging can be written back into the core config as the new DEFAULT_MAP; it rebuilds dist/ afterwards so a
// reload picks it up. POST /save-trace records a coached run under captures/traces/.
//
// Both POSTs write to this machine, and /save-layout rewrites a source file of @sixam/core. So until
// 2026-09-29, when this bound 0.0.0.0, anyone on the network could rewrite
// packages/source/src/games/fnaf2/config.ts. Now the socket is loopback only, and a write is refused unless its
// client is loopback, its Host names this machine, and any Origin is the page's own (writeRefusal): a web page
// in the host's browser can reach 127.0.0.1 too, and must not write here.
//
// To calibrate on a phone, forward the port over USB rather than opening it to the network:
// `adb reverse tcp:8731 tcp:8731`, then open http://localhost:8731/index.html on the phone. Its requests arrive
// from loopback, and localhost is a secure context, so wake lock and vibration work.
//
//   npm run serve:trainer          # port 8731
//   node apps/trainer/test/serve.ts [port]
//
// Ported from serve.py: it answers each request with the status, content type and body that served, as
// Python's SimpleHTTPRequestHandler did for every other file, and writes the same config and trace bytes.
// It speaks HTTP/1.1 where that spoke 1.0, and sends no Server header.
import { spawnSync } from 'node:child_process';
import { closeSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync, writeSync } from 'node:fs';
import { type IncomingMessage, type Server, type ServerResponse, createServer } from 'node:http';
import { stripTypeScriptTypes } from 'node:module';
import { isIPv4, isIPv6 } from 'node:net';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PyFloat, type PyJson, type PyValue, pyDumps, pyFixed, pyFloat, pyInt, pyLoadsBytes, pyReprOf, pyStrRepr } from '@sixam/kernel/py';

// Node 22.13 added it; the @types/node this repository pins (22.10) does not declare it yet.
declare module 'node:module' {
  export function stripTypeScriptTypes(code: string, options?: { mode?: 'strip' | 'transform', sourceMap?: boolean, sourceUrl?: string }): string;
}

// Loopback only. There is deliberately no LAN switch: the writes are this machine's, and a phone reaches the
// server through `adb reverse` (above).
export const HOST = '127.0.0.1';
const LOOPBACK_NAMES = new Set(['localhost', '127.0.0.1', '::1']);

const HERE = dirname(realpathSync(fileURLToPath(import.meta.url)));
const REPO = resolve(HERE, '../../..');
const configOf = (root: string) => join(root, 'packages', 'source', 'src', 'games', 'fnaf2', 'config.ts');
// Where POST /save-trace lands. captures/ is ignored, like every other run artifact; the env override exists so
// tests can exercise the real write without littering the repository.
const tracesOf = (root: string) => process.env.FNAF_TRACE_DIR ?? join(root, 'captures', 'traces');
const MAP_BLOCK = /export const DEFAULT_MAP = \{.*?\n\};\n/gs;
const WID_BLOCK = /export const DEFAULT_WIDGETS = \{.*?\n\};\n/gs;
// The page learns what this server can write from a tag it adds to every trainer page it serves. GitHub Pages,
// or any static host, serves index.html as committed, with no such tag, and the trainer there neither posts
// traces nor offers to save a layout: until 2026-09-30 every coached run on Pages posted to a /save-trace that
// answers 405, and queued the trace to post again on every later visit.
export const DEV_META = '<meta name="trainer-dev-server" content="save-layout save-trace">';
const PAGES: Readonly<Record<string, string>> = { '/': 'index.html', '/index.html': 'index.html', '/dist/': 'dist/index.html', '/dist/index.html': 'dist/index.html' };
const WIDGETS = ['light', 'camlight', 'mask', 'monitor', 'ventL', 'ventR', 'wind'];
const SPACES: Readonly<Record<string, string>> = { light: 'stage', camlight: 'stage', mask: 'stage', monitor: 'stage', ventL: 'stage', ventR: 'stage', wind: 'feed' };

// --- Python's objects, for the validation messages serve.py answered with ------------------------------------

const typeName = (v: PyValue) => (v === null ? 'NoneType' : typeof v === 'boolean' ? 'bool' : typeof v === 'bigint' ? 'int'
  : v instanceof PyFloat ? 'float' : typeof v === 'string' ? 'str' : v instanceof Map ? 'dict' : 'list');
const isDict = (v: PyValue): v is ReadonlyMap<string, PyValue> => v instanceof Map;
const isList = (v: PyValue): v is readonly PyValue[] => Array.isArray(v);
const truthy = (v: PyValue) => (v === null ? false : typeof v === 'boolean' ? v : typeof v === 'bigint' ? v !== 0n
  : v instanceof PyFloat ? v.value !== 0 : typeof v === 'string' ? v.length > 0 : isDict(v) ? v.size > 0 : isList(v) ? v.length > 0 : true);
/** str(v) */
const str = (v: PyValue) => (typeof v === 'string' ? v : pyReprOf(v));
/** d.get(key), refused as AttributeError where d is not a dict. */
function get(d: PyValue, key: string): PyValue {
  if (!isDict(d)) throw new Error(`'${typeName(d)}' object has no attribute 'get'`);
  return d.get(key) ?? null;
}
/** iter(v) */
function items(v: PyValue): PyValue[] {
  if (isDict(v)) return [...v.keys()];
  if (isList(v)) return [...v];
  if (typeof v === 'string') return [...v];
  throw new Error(`'${typeName(v)}' object is not iterable`);
}
/** int(v) */
function toInt(v: PyValue): bigint {
  if (typeof v === 'bigint') return v;
  if (typeof v === 'boolean') return v ? 1n : 0n;
  if (v instanceof PyFloat) {
    if (Number.isNaN(v.value)) throw new Error('cannot convert float NaN to integer');
    if (!Number.isFinite(v.value)) throw new Error('cannot convert float infinity to integer');
    return BigInt(Math.trunc(v.value));
  }
  if (typeof v === 'string') {
    const value = pyInt(v);
    if (value === null) throw new Error(`invalid literal for int() with base 10: ${pyStrRepr(v)}`);
    return value;
  }
  throw new Error(`int() argument must be a string, a bytes-like object or a real number, not '${typeName(v)}'`);
}
/** float(v) */
function toFloat(v: PyValue): number {
  if (v instanceof PyFloat) return v.value;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'bigint') {
    const value = Number(v);
    if (!Number.isFinite(value)) throw new Error('int too large to convert to float');
    return value;
  }
  if (typeof v === 'string') {
    const value = pyFloat(v);
    if (value === null) throw new Error(`could not convert string to float: ${pyStrRepr(v)}`);
    return value;
  }
  throw new Error(`float() argument must be a string or a real number, not '${typeName(v)}'`);
}
/** v[key] for a str key */
function at(v: PyValue, key: string): PyValue {
  if (isDict(v)) {
    const value = v.get(key);
    if (value === undefined) throw new Error(pyStrRepr(key));
    return value;
  }
  if (isList(v)) throw new Error('list indices must be integers or slices, not str');
  if (typeof v === 'string') throw new Error("string indices must be integers, not 'str'");
  throw new Error(`'${typeName(v)}' object is not subscriptable`);
}
/** sorted(values): numbers by value, str by code point; a mix Python could not order is refused. */
function sorted(values: readonly PyValue[]): PyValue[] {
  const rank = (v: PyValue) => (typeof v === 'string' ? 'str' : typeof v === 'bigint' || typeof v === 'boolean' || v instanceof PyFloat ? 'number' : typeName(v));
  const kinds = new Set(values.map(rank));
  if (kinds.size > 1 || (kinds.size === 1 && !kinds.has('str') && !kinds.has('number')))
    throw new Error(`'<' not supported between instances of '${typeName(values[1] ?? null)}' and '${typeName(values[0] ?? null)}'`);
  const number = (v: PyValue) => (typeof v === 'bigint' || typeof v === 'boolean' ? Number(v) : v instanceof PyFloat ? v.value : 0);
  return [...values].sort((a, b) => (typeof a === 'string' && typeof b === 'string' ? compareCodePoints(a, b) : number(a) - number(b)));
}
function compareCodePoints(a: string, b: string) {
  const x = [...a], y = [...b];
  for (let k = 0; k < Math.min(x.length, y.length); k += 1)
    if (x[k] !== y[k]) return (x[k].codePointAt(0) ?? 0) - (y[k].codePointAt(0) ?? 0);
  return x.length - y.length;
}
const reprList = (values: readonly PyValue[]) => pyReprOf(values);

// --- Validation and the two writes -----------------------------------------------------------------------

type Box = { x: number, y: number, w: number, h: number };
const boxRepr = (r: Readonly<Record<string, number>>) => pyReprOf(new Map(Object.entries(r).map(([k, v]) => [k, new PyFloat(v)])));

function readBox(v: PyValue): Box {
  const r = { x: toFloat(at(v, 'x')), y: toFloat(at(v, 'y')), w: toFloat(at(v, 'w')), h: toFloat(at(v, 'h')) };
  return r;
}
const inUnit = (r: Box) => [r.x, r.y, r.w, r.h].every(value => value >= 0 && value <= 1);

export function validate(m: PyValue): Map<bigint, Box> {
  const VALID = new Set(Array.from({ length: 12 }, (_, k) => BigInt(k + 1)));
  const fail = () => { throw new Error(`expected exactly cams 1-12, got ${reprList(sorted(items(m).map(toInt)))}`); };
  if (!isDict(m)) fail();
  const keys = new Set(items(m).map(toInt));
  if (keys.size !== VALID.size || [...keys].some(key => !VALID.has(key))) fail();
  const out = new Map<bigint, Box>();
  for (const [k, v] of m as ReadonlyMap<string, PyValue>) {
    const r = readBox(v);
    if (!inUnit(r)) throw new Error(`cam ${k}: values must be 0..1, got ${boxRepr(r)}`);
    if (r.w <= 0 || r.h <= 0) throw new Error(`cam ${k}: width and height must be positive`);
    out.set(toInt(k), r);
  }
  return out;
}

export function validateWidgets(w: PyValue): Map<string, Box & { space: string }> {
  const fail = () => {
    throw new Error(`expected widgets ${reprList(sorted(WIDGETS))}, got ${reprList(sorted(truthy(w) ? items(w) : []))}`);
  };
  if (!isDict(w)) fail();
  const keys = [...(w as ReadonlyMap<string, PyValue>).keys()];
  if (keys.length !== WIDGETS.length || keys.some(key => !WIDGETS.includes(key))) fail();
  const out = new Map<string, Box & { space: string }>();
  for (const [k, v] of w as ReadonlyMap<string, PyValue>) {
    const r = readBox(v);
    if (!inUnit(r)) throw new Error(`widget ${k}: values must be 0..1, got ${boxRepr(r)}`);
    if (r.w <= 0 || r.h <= 0) throw new Error(`widget ${k}: width and height must be positive`);
    // `space` is structural; it is never taken from the client.
    out.set(k, { ...r, space: SPACES[k] });
  }
  return out;
}

function writeConfig(root: string, m: ReadonlyMap<bigint, Box>, w: ReadonlyMap<string, Box & { space: string }>) {
  const config = configOf(root);
  let src = readFileSync(config, 'utf8');
  for (const [name, block] of [['DEFAULT_MAP', MAP_BLOCK], ['DEFAULT_WIDGETS', WID_BLOCK]] as const)
    if (!src.match(block)) throw new Error(`${name} block not found in canonical core config`);
  const rows = [...m.keys()].sort((a, b) => (a < b ? -1 : 1)).map(k => {
    const r = m.get(k) as Box;   // a key of m
    return `  ${k}:${' '.repeat(Math.max(0, 2 - String(k).length))} { x: ${pyFixed(r.x, 3)}, y: ${pyFixed(r.y, 3)}, w: ${pyFixed(r.w, 3)}, h: ${pyFixed(r.h, 3)} },`;
  }).join('\n');
  src = src.replace(MAP_BLOCK, () => `export const DEFAULT_MAP = {\n${rows}\n};\n`);
  const pad = Math.max(...[...w.keys()].map(k => [...k].length));
  const wrows = [...w.keys()].sort(compareCodePoints).map(k => {
    const r = w.get(k) as Box & { space: string };   // a key of w
    const label = `${k}:`;
    return `  ${label}${' '.repeat(Math.max(0, pad + 1 - [...label].length))} { space: '${r.space}',${r.space === 'feed' ? ' ' : ''} `
      + `x: ${pyFixed(r.x, 3)}, y: ${pyFixed(r.y, 3)}, w: ${pyFixed(r.w, 3)}, h: ${pyFixed(r.h, 3)} },`;
  }).join('\n');
  src = src.replace(WID_BLOCK, () => `export const DEFAULT_WIDGETS = {\n${wrows}\n};\n`);
  writeFileSync(config, src);
}

export function validateTrace(data: PyValue): string {
  const version = get(data, 'v');
  const isOne = typeof version === 'bigint' ? version === 1n : typeof version === 'boolean' ? version
    : version instanceof PyFloat ? version.value === 1 : false;
  if (!isOne) throw new Error(`unknown trace version ${pyReprOf(version)}`);
  const lessonValue = get(data, 'lesson');
  const lesson = str(truthy(lessonValue) ? lessonValue : '');
  if (!/^[a-zA-Z0-9_-]{1,40}$/.test(lesson)) throw new Error(`bad lesson id ${pyStrRepr(lesson)}`);
  const steps = get(data, 'steps');
  if (!isList(steps) || !steps.length) throw new Error('steps must be a non-empty list');
  for (const s of steps)
    if (!isDict(s) || !s.has('stepId') || !s.has('grade')) throw new Error('every step row needs stepId and grade');
  return lesson;
}

function repoCommit(root: string) {
  const git = (...args: string[]) => {
    const run = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
    if (run.status !== 0) throw new Error(run.stderr);
    return run.stdout.trim();
  };
  try {
    const head = git('rev-parse', '--short', 'HEAD');
    return head + (git('status', '--porcelain') ? '+' : '');
  } catch {
    return 'unknown';
  }
}

// datetime.now(timezone.utc).isoformat(): microseconds, and none when they are zero.
function isoNow(now: Date) {
  const base = now.toISOString().slice(0, 19);
  const micro = now.getUTCMilliseconds() * 1000;
  return `${base}${micro ? `.${String(micro).padStart(6, '0')}` : ''}+00:00`;
}

function writeTrace(root: string, data: Map<string, PyValue>, lesson: string): string {
  // Provenance is stamped at save time, not left to the client: the lateness band that needed a retroactive
  // parasite-era caveat was measured under conditions nobody recorded. Never again.
  data.set('savedAt', isoNow(new Date()));
  data.set('commit', repoCommit(root));
  const traces = tracesOf(root);
  mkdirSync(traces, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  for (let n = 0; n < 100; n += 1) {
    const path = join(traces, `${stamp}-${lesson}${n ? `-${n}` : ''}.json`);
    let fd: number;
    try {
      fd = openSync(path, 'wx');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') continue;
      throw error;
    }
    try {
      writeSync(fd, pyDumps(data));
    } finally {
      closeSync(fd);
    }
    return path;
  }
  throw new Error('could not find a free trace filename');
}

// --- Who may write ---------------------------------------------------------------------------------------

/** ipaddress.ip_address(address).is_loopback, an IPv4-mapped IPv6 address included. */
function isLoopback(address: string) {
  const ip = address.split('%')[0];
  if (/^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/.test(ip)) return ip.startsWith('127.');
  if (!isIPv6(ip)) return false;
  const mapped = /^::ffff:(.+)$/i.exec(ip)?.[1];
  if (mapped && isIPv4(mapped)) return mapped.startsWith('127.');
  const [head, tail] = ip.includes('::') ? ip.split('::') : [ip, null];
  const left = head.split(':').filter(Boolean);
  const right = tail === null ? [] : tail.split(':').filter(Boolean);
  const words = tail === null ? left : [...left, ...Array<string>(8 - left.length - right.length).fill('0'), ...right];
  return words.length === 8 && words.slice(0, 7).every(word => parseInt(word, 16) === 0) && parseInt(words[7], 16) === 1;
}

/** The hostname of a Host header value: `localhost:8731`, `[::1]:8731`. */
function hostName(host: string) {
  if (host.startsWith('[')) return host.includes(']') ? host.slice(1, host.indexOf(']')) : host;
  return host.split(':').length === 2 ? host.slice(0, host.lastIndexOf(':')) : host;
}

const pyStrip = (text: string) => text.replace(/^[\t\n\v\f\r\x1c-\x1f \x85\xa0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+|[\t\n\v\f\r\x1c-\x1f \x85\xa0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+$/g, '');

/**
 * Why a POST may not write here, or null when it may. client: the peer address; host, origin: the request's
 * Host and Origin headers (null when absent). A write needs a loopback client (the socket is loopback already;
 * this holds if that ever changes), a Host naming this machine (a DNS-rebound name is not), and, when the
 * client is a browser that sent an Origin, that Origin to be the page's own: http:// plus Host.
 */
export function writeRefusal(client: string, host: string | null, origin: string | null): string | null {
  if (!isLoopback(client)) return `writes are accepted from this machine only, not from ${client}`;
  if (!host || !LOOPBACK_NAMES.has(hostName(pyStrip(host).toLowerCase()))) return `Host ${host === null ? 'None' : pyStrRepr(host)} does not name this machine`;
  if (origin !== null && pyStrip(origin).toLowerCase() !== `http://${pyStrip(host).toLowerCase()}`)
    return `a page from ${pyStrRepr(origin)} may not write to http://${host}`;
  return null;
}

// --- Serving files, as SimpleHTTPRequestHandler did ---------------------------------------------------

type MimeTable = { handler: Record<string, string>, types: Record<string, string>, suffixes: Record<string, string>, encodings: Record<string, string> };
const MIME: MimeTable = JSON.parse(readFileSync(join(HERE, 'mime-types.json'), 'utf8'));

/** posixpath.splitext: the last dot after the last slash, unless only dots come before it in the name. */
function splitext(path: string): [string, string] {
  const slash = path.lastIndexOf('/');
  const dot = path.lastIndexOf('.');
  if (dot > slash) for (let k = slash + 1; k < dot; k += 1) if (path[k] !== '.') return [path.slice(0, dot), path.slice(dot)];
  return [path, ''];
}

/** SimpleHTTPRequestHandler.guess_type */
function guessType(path: string) {
  let [base, ext] = splitext(path);
  if (MIME.handler[ext]) return MIME.handler[ext];
  if (MIME.handler[ext.toLowerCase()]) return MIME.handler[ext.toLowerCase()];
  while (MIME.suffixes[ext.toLowerCase()]) [base, ext] = splitext(base + MIME.suffixes[ext.toLowerCase()]);
  if (MIME.encodings[ext]) [base, ext] = splitext(base);
  return MIME.types[ext.toLowerCase()] ?? 'application/octet-stream';
}

/** urllib.parse.unquote: %XX runs decoded as UTF-8, a bad sequence replaced, a stray % kept. */
function unquote(text: string) {
  if (!text.includes('%')) return text;
  return text.replace(/[\x00-\x7f]+/g, run => {
    const bits = run.split('%');
    const bytes: number[] = [...Buffer.from(bits[0])];
    for (const bit of bits.slice(1)) {
      if (/^[0-9a-fA-F]{2}/.test(bit)) bytes.push(parseInt(bit.slice(0, 2), 16), ...Buffer.from(bit.slice(2)));
      else bytes.push(0x25, ...Buffer.from(bit));
    }
    return Buffer.from(bytes).toString('utf8');
  });
}

/** posixpath.normpath */
function normpath(path: string) {
  if (!path) return '.';
  const initial = path.startsWith('/') ? (path.startsWith('//') && !path.startsWith('///') ? 2 : 1) : 0;
  const out: string[] = [];
  for (const part of path.split('/')) {
    if (!part || part === '.') continue;
    if (part !== '..' || (!initial && !out.length) || (out.length && out[out.length - 1] === '..')) out.push(part);
    else if (out.length) out.pop();
  }
  return '/'.repeat(initial) + out.join('/') || '.';
}

/** SimpleHTTPRequestHandler.translate_path */
function translatePath(root: string, requestPath: string) {
  let path = requestPath.split('?')[0].split('#')[0];
  const trailing = path.trimEnd().endsWith('/');
  path = normpath(unquote(path));
  let out = root;
  for (const word of path.split('/').filter(Boolean)) {
    if (word.includes('/') || word === '.' || word === '..') continue;
    out = join(out, word);
  }
  return trailing ? `${out}/` : out;
}

const ERROR_PAGE = (code: number, message: string, explain: string) => '<!DOCTYPE HTML>\n<html lang="en">\n    <head>\n        <meta charset="utf-8">\n'
  + '        <title>Error response</title>\n    </head>\n    <body>\n        <h1>Error response</h1>\n'
  + `        <p>Error code: ${code}</p>\n        <p>Message: ${message}.</p>\n        <p>Error code explanation: ${code} - ${explain}.</p>\n    </body>\n</html>\n`;
const PHRASES: Readonly<Record<number, [string, string]>> = {
  200: ['OK', 'Request fulfilled, document follows'], 301: ['Moved Permanently', 'Object moved permanently -- see URI list'],
  304: ['Not Modified', 'Document has not changed since given time'], 400: ['Bad Request', 'Bad request syntax or unsupported method'],
  403: ['Forbidden', 'Request forbidden -- authorization will not help'], 404: ['Not Found', 'Nothing matches the given URI'],
  500: ['Internal Server Error', 'Server got itself in trouble'], 501: ['Not Implemented', 'Server does not support this operation'],
};
/** urllib.parse.quote(text): UTF-8, every byte but letters, digits, '_.-~' and '/' as %XX. */
const quote = (text: string) => [...Buffer.from(text)].map(byte => (/[A-Za-z0-9_.~/-]/.test(String.fromCharCode(byte))
  ? String.fromCharCode(byte) : `%${byte.toString(16).toUpperCase().padStart(2, '0')}`)).join('');
const escapeHtml = (text: string) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

/** One response: the status and its phrase, the headers in order, Cache-Control: no-store on every one. */
function send(res: ServerResponse, code: number, headers: [string, string][], body: Buffer | null, phrase = PHRASES[code]?.[0] ?? '') {
  res.writeHead(code, phrase, [...headers, ['Cache-Control', 'no-store']].flat());
  res.end(body ?? undefined);
}

function sendError(req: IncomingMessage, res: ServerResponse, code: number, message?: string) {
  const [short, explain] = PHRASES[code] ?? ['???', '???'];
  const text = message ?? short;
  const body = Buffer.from(ERROR_PAGE(code, escapeHtml(text), escapeHtml(explain)));
  const withBody = req.method !== 'HEAD' && code >= 200 && ![204, 205, 304].includes(code);
  send(res, code, [['Connection', 'close'], ['Content-Type', 'text/html;charset=utf-8'], ['Content-Length', String(body.length)]], withBody ? body : null, text);
}

const httpDate = (ms: number) => new Date(Math.floor(ms / 1000) * 1000).toUTCString();

/** email.utils.parsedate_to_datetime, for the forms browsers send: UTC, or null when the date is not UTC or not read. */
function imsUtc(text: string) {
  const m = /^\s*(?:[A-Za-z]{3},?\s+)?(\d{1,2})\s+([A-Za-z]{3})\s+(\d{2,4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(GMT|UT|UTC|Z|[+-]0000)?\s*$/.exec(text);
  if (!m) return null;
  const month = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(m[2].toLowerCase());
  if (month < 0) return null;
  let year = Number(m[3]);
  if (m[3].length === 2) year += year > 68 ? 1900 : 2000;
  return Date.UTC(year, month, Number(m[1]), Number(m[4]), Number(m[5]), Number(m[6] ?? 0));
}

function listDirectory(req: IncomingMessage, res: ServerResponse, path: string) {
  let names: string[];
  try {
    names = readdirSync(path);
  } catch {
    return sendError(req, res, 404, 'No permission to list directory');
  }
  names.sort((a, b) => compareCodePoints(a.toLowerCase(), b.toLowerCase()));
  const display = escapeHtml(unquote(req.url ?? '/'));
  const title = `Directory listing for ${display}`;
  const lines = ['<!DOCTYPE HTML>', '<html lang="en">', '<head>', '<meta charset="utf-8">', `<title>${title}</title>\n</head>`,
    `<body>\n<h1>${title}</h1>`, '<hr>\n<ul>'];
  for (const name of names) {
    const full = join(path, name);
    let displayName = name, link = name;
    if (existsSync(full) && statSync(full).isDirectory()) { displayName = `${name}/`; link = `${name}/`; }
    if (lstatSync(full).isSymbolicLink()) displayName = `${name}@`;
    lines.push(`<li><a href="${quote(link)}">${escapeHtml(displayName)}</a></li>`);
  }
  lines.push('</ul>\n<hr>\n</body>\n</html>\n');
  const body = Buffer.from(lines.join('\n'));
  send(res, 200, [['Content-type', 'text/html; charset=utf-8'], ['Content-Length', String(body.length)]], req.method === 'HEAD' ? null : body);
}

function serveFile(root: string, req: IncomingMessage, res: ServerResponse) {
  const url = req.url ?? '/';
  let path = translatePath(root, url);
  if (existsSync(path) && statSync(path).isDirectory()) {
    const pathPart = url.split('?')[0].split('#')[0];
    if (!pathPart.endsWith('/')) {
      const rest = url.slice(pathPart.length);
      return send(res, 301, [['Location', `${pathPart}/${rest}`], ['Content-Length', '0']], null);
    }
    const index = ['index.html', 'index.htm'].map(name => join(path, name)).find(file => existsSync(file) && statSync(file).isFile());
    if (index === undefined) return listDirectory(req, res, path);
    path = index;
  }
  const ctype = guessType(path);
  if (path.endsWith('/')) return sendError(req, res, 404, 'File not found');
  // open() refused a NUL with ValueError, not OSError: the request failed and its connection closed unanswered.
  if (path.includes('\0')) throw new Error('embedded null byte');
  let body: Buffer;
  try {
    body = readFileSync(path);
  } catch {
    return sendError(req, res, 404, 'File not found');
  }
  const mtime = statSync(path).mtimeMs;
  const since = req.headers['if-modified-since'];
  if (since !== undefined && req.headers['if-none-match'] === undefined) {
    const ims = imsUtc(since);
    if (ims !== null && Math.floor(mtime / 1000) * 1000 <= ims) return send(res, 304, [], null);
  }
  send(res, 200, [['Content-type', ctype], ['Content-Length', String(body.length)], ['Last-Modified', httpDate(mtime)]],
    req.method === 'HEAD' ? null : body);
}

const stripped = new Map<string, [number, Buffer]>();
// serve.py ran the stripper with --no-warnings: its ExperimentalWarning is not the server's to print.
process.removeAllListeners('warning');
// The sources run under Node's type stripping (Pedro, 2026-09-30: "runtime .ts"). A browser cannot strip types,
// so every .ts module the import map reaches is served as JavaScript with its types erased by the same stripper
// the Pages build uses, cached until the file changes.
function strippedModule(path: string): Buffer {
  const stamp = statSync(path).mtimeMs;
  const hit = stripped.get(path);
  if (hit && hit[0] === stamp) return hit[1];
  let code: string;
  try {
    code = stripTypeScriptTypes(readFileSync(path, 'utf8'), { mode: 'strip' });
  } catch (error) {
    throw new Error(`strip-types: ${path}: ${(error as Error).message}`);
  }
  const body = Buffer.from(code);
  stripped.set(path, [stamp, body]);
  return body;
}

function sendModule(root: string, req: IncomingMessage, res: ServerResponse, route: string) {
  const candidate = resolve(root, unquote(route).replace(/^\/+/, ''));
  let path: string;
  try {
    path = realpathSync(candidate);
  } catch {
    path = candidate;
  }
  const inside = path === root || path.startsWith(root + sep);
  if (!inside || !existsSync(path) || !statSync(path).isFile() || basename(path).endsWith('.d.ts')) return sendError(req, res, 404);
  let body: Buffer;
  try {
    body = strippedModule(path);
  } catch (error) {
    console.log(`${route}: ${(error as Error).message}`);
    return sendError(req, res, 500, 'types could not be stripped');
  }
  send(res, 200, [['Content-Type', 'text/javascript; charset=utf-8'], ['Content-Length', String(body.length)]], body);
}

function json(res: ServerResponse, code: number, payload: PyJson) {
  // No Access-Control-Allow-Origin: the writes are same-origin only, and nothing on another origin has any
  // business reading their answers.
  const body = Buffer.from(pyDumps(payload));
  send(res, code, [['Content-Type', 'application/json'], ['Content-Length', String(body.length)]], body);
}

/** The body, read as rfile.read(int(Content-Length)) did. */
function body(req: IncomingMessage, chunks: readonly Buffer[]) {
  const length = toInt(req.headers['content-length'] ?? 0n);
  const all = Buffer.concat(chunks);
  return length < 0n ? all : all.subarray(0, Number(length));
}

function saveLayout(root: string, req: IncomingMessage, res: ServerResponse, chunks: readonly Buffer[]) {
  try {
    const raw = body(req, chunks);
    const data = pyLoadsBytes(raw.length ? raw : Buffer.from('{}'));
    const m = validate(get(data, 'map'));
    const w = validateWidgets(get(data, 'widgets'));
    if (truthy(get(data, 'dry'))) {
      // Validate and report without touching the file, so automated tests can exercise this path without
      // editing the repo.
      console.log('save-layout: dry run ok');
      return json(res, 200, { ok: true, dry: true, build: '(dry run, not written)' });
    }
    writeConfig(root, m, w);
    const build = spawnSync(process.execPath, [join(HERE, 'build.ts')], { encoding: 'utf8' });
    const out = (build.stdout ?? '').trim();
    console.log(`saved layout -> packages/source/src/games/fnaf2/config.ts  (${out})`);
    json(res, 200, { ok: true, build: out });
  } catch (error) {
    console.log(`save-layout failed: ${(error as Error).message}`);
    json(res, 400, { error: (error as Error).message });
  }
}

function saveTrace(root: string, req: IncomingMessage, res: ServerResponse, chunks: readonly Buffer[]) {
  try {
    const n = toInt(req.headers['content-length'] ?? 0n);
    if (n > 4_000_000n) throw new Error(`trace too large (${n} bytes)`);
    const raw = body(req, chunks);
    const data = pyLoadsBytes(raw.length ? raw : Buffer.from('{}'));
    const lesson = validateTrace(data);
    if (truthy(get(data, 'dry'))) {
      // Validation without a write: automated browser runs post dry so a bot's perfectly timed presses never
      // enter the census.
      console.log(`save-trace: dry run ok (${lesson})`);
      return json(res, 200, { ok: true, dry: true });
    }
    const path = writeTrace(root, data as Map<string, PyValue>, lesson);
    const rel = relative(root, path);
    console.log(`saved trace -> ${rel.startsWith('..') ? path : rel}`);
    json(res, 200, { ok: true, file: basename(path) });
  } catch (error) {
    console.log(`save-trace failed: ${(error as Error).message}`);
    json(res, 400, { error: (error as Error).message });
  }
}

function logRequest(req: IncomingMessage, code: number) {
  const line = `${req.method} ${req.url} HTTP/${req.httpVersion}`;
  if (!line.includes('save-layout') && !line.includes('save-trace')) return;
  const now = new Date();
  const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][now.getMonth()];
  const two = (n: number) => String(n).padStart(2, '0');
  const when = `${two(now.getDate())}/${month}/${now.getFullYear()} ${two(now.getHours())}:${two(now.getMinutes())}:${two(now.getSeconds())}`;
  process.stderr.write(`${req.socket.remoteAddress} - - [${when}] "${line}" ${code} -\n`);
}

/** The server, on root (the repository unless a test names another). */
export function makeServer(port: number, host = HOST, root = REPO): Server {
  return createServer((req, res) => {
    try {
      handle(root, req, res);
    } catch (error) {
      // socketserver's handle_error: the traceback on stderr, and the connection closed with no answer.
      console.error(`Exception occurred during processing of request from ${req.socket.remoteAddress}\n${(error as Error).stack}`);
      res.destroy();
    }
  }).listen(port, host);
}

function handle(root: string, req: IncomingMessage, res: ServerResponse) {
    res.on('finish', () => logRequest(req, res.statusCode));
    const method = req.method ?? '';
    if (method === 'GET') {
      const route = (req.url ?? '/').split('?')[0].split('#')[0];
      if (route.endsWith('.ts')) return sendModule(root, req, res, route);
      const page = PAGES[route];
      if (page === undefined || !existsSync(join(root, page)) || !statSync(join(root, page)).isFile()) return serveFile(root, req, res);
      const bytes = readFileSync(join(root, page));
      const at = bytes.indexOf('<head>');
      const out = at < 0 ? bytes : Buffer.concat([bytes.subarray(0, at), Buffer.from(`<head>\n${DEV_META}`), bytes.subarray(at + 6)]);
      return send(res, 200, [['Content-Type', 'text/html; charset=utf-8'], ['Content-Length', String(out.length)]], out);
    }
    if (method === 'HEAD') return serveFile(root, req, res);
    if (method !== 'POST') return sendError(req, res, 501, `Unsupported method (${pyStrRepr(method)})`);
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const header = (name: string) => { const value = req.headers[name]; return typeof value === 'string' ? value : null; };
      const refusal = writeRefusal(req.socket.remoteAddress ?? '', header('host'), header('origin'));
      if (refusal) {
        console.log(`${req.url} refused: ${refusal}`);
        return json(res, 403, { error: refusal });
      }
      if (req.url === '/save-trace') return saveTrace(root, req, res, chunks);
      if (req.url !== '/save-layout') return json(res, 404, { error: 'not found' });
      return saveLayout(root, req, res, chunks);
    });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = process.argv[2] === undefined ? 8731 : Number(toInt(process.argv[2]));
  const server = makeServer(port);
  server.on('listening', () => {
    const address = server.address();
    console.log(`serving ${REPO} on http://${HOST}:${typeof address === 'object' && address ? address.port : port}/ (this machine only)`);
  });
}
