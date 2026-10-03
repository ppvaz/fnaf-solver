#!/usr/bin/env node
// Read-only inventory of ignored observation artifacts.
//
// The command classifies paths and their evidence role. It deliberately does not infer labels from
// filenames, migrate layouts, or rewrite old captures.
//
//   node packages/review/bin/legacy/index-observations.ts [captures] [--json] [--hash] [--strict]
//
// `--strict` fails when a file is empty or unclassified. It does not make an old artifact replayable; that
// requires the session manifest introduced by Plan 09. Ported from index-observations.py; it prints what
// that printed.
import { createHash } from 'node:crypto';
import { closeSync, existsSync, lstatSync, openSync, readSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { pyArgs, pyDumps, pyPath } from '@sixam/kernel/py';

type Record_ = { kind: string, authority: string, join: string | null, note: string };
const record = (kind: string, authority: string, join: string | null = null, note = ''): Record_ => ({ kind, authority, join, note });

function rootJoin(name: string) {
  for (const suffix of ['-aborted.mp4', '-epoch.txt', '-hid.jsonl', '-cue.txt', '-keyframes.png', '.mp4'])
    if (name.endsWith(suffix)) return name.slice(0, -suffix.length);
  return null;
}

// PurePath.suffix: the last '.' part of the final component, unless the dot leads or ends it.
function suffixOf(name: string) {
  const at = name.lastIndexOf('.');
  return at > 0 && at < name.length - 1 ? name.slice(at) : '';
}

function classify(parts: readonly string[]): Record_ {
  const name = parts[parts.length - 1];
  const suffix = suffixOf(name).toLowerCase();

  if (parts[0] === 'traces' && suffix === '.json')
    return record('trainer-trace', 'primary-observation', name.slice(0, -5), 'trainer/simulator timing, not stock-game truth');

  if (parts[0] === 'screencheck-keep' && (suffix === '.raw' || suffix === '.png')) {
    const join = parts.length > 2 ? parts[1] : null;
    return record('selected-raw-frame', 'primary-observation', join, 'selection/class filename is not an independent label');
  }

  if (parts[0] === 'screencheck') {
    if (suffix === '.scm') return record('scm1-model', 'model-artifact', null, 'requires separate calibration and holdout evidence');
    if (suffix === '.raw' || suffix === '.png') {
      const join = parts.length >= 5 ? parts[parts.length - 2] : null;
      return record('labeled-screen-frame', 'primary-observation', join, 'directory label is collection intent');
    }
  }

  if (parts[0] === 'cue-helper') {
    if (suffix === '.wav') {
      const join = name.includes('-cue-') ? name.split('-cue-')[0] : null;
      return record('cue-audio', 'primary-observation', join, 'continuous logs need a retained monotonic startNs');
    }
    if (suffix === '.tsv' && name.startsWith('soak-')) return record('helper-soak', 'operational-metadata');
    if (suffix === '.tsv' && name.endsWith('-visual.tsv')) return record('visual-watch', 'primary-observation', name.slice(0, -'-visual.tsv'.length));
    if (suffix === '.tsv' && name.endsWith('-sessions.tsv'))
      return record('collection-boundaries', 'operational-metadata', name.slice(0, -'-sessions.tsv'.length));
  }

  if (parts.length === 1) {
    const join = rootJoin(name);
    if (name.endsWith('-aborted.mp4')) return record('aborted-run-video', 'primary-observation', join);
    if (suffix === '.mp4') return record('run-video', 'primary-observation', join);
    if (name.endsWith('-epoch.txt')) return record('epoch-report', 'operational-metadata', join);
    if (name.endsWith('-hid.jsonl')) return record('hid-trace', 'emitted-action-record', join, 'does not prove the game accepted an action');
    if (name.endsWith('-cue.txt')) return record('cue-scalar-trace', 'primary-observation', join);
    if (name.endsWith('-keyframes.png')) return record('video-keyframes', 'derived-evidence', join);
    if (suffix === '.hid') return record('hid-probe-input', 'emitted-action-record', name.slice(0, -4));
  }

  if (suffix === '.mp4' || suffix === '.wav' || suffix === '.raw')
    return record('unscoped-media', 'primary-observation', null, 'media type known; producer/session unknown');
  if (suffix === '.png') return record('derived-or-raw-image', 'unknown', null, 'needs manual authority classification');
  if (suffix === '.json' && name.toLowerCase().includes('signature')) return record('grid-signature', 'model-artifact');
  return record('unclassified', 'unknown', null, 'no current capture-family rule matches');
}

// Python compares strings by code point; JavaScript's < compares UTF-16 units, which differ past U+FFFF.
function byCodePoint(a: string, b: string) {
  const x = [...a], y = [...b];
  for (let k = 0; k < Math.min(x.length, y.length); k += 1)
    if (x[k] !== y[k]) return (x[k].codePointAt(0) ?? 0) - (y[k].codePointAt(0) ?? 0);
  return x.length - y.length;
}

// Path.rglob('*') then is_file(): every file below root, directories reached through a symlink not
// entered, a symlink to a file kept; sorted as Python sorts paths, part by part.
function files(root: string): string[][] {
  const found: string[][] = [];
  const walk = (dir: string, parts: string[]) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      const link = lstatSync(path);
      if (link.isDirectory()) walk(path, [...parts, name]);
      else if (existsSync(path) && statSync(path).isFile()) found.push([...parts, name]);
    }
  };
  walk(root, []);
  return found.sort((a, b) => {
    for (let k = 0; k < Math.min(a.length, b.length); k += 1) if (a[k] !== b[k]) return byCodePoint(a[k], b[k]);
    return a.length - b.length;
  });
}

// SHA-256 read a megabyte at a time: the captures include long videos.
function digest(path: string) {
  const hash = createHash('sha256');
  const block = Buffer.alloc(1024 * 1024);
  const fd = openSync(path, 'r');
  try {
    for (let read = readSync(fd, block); read > 0; read = readSync(fd, block)) hash.update(block.subarray(0, read));
  } finally {
    closeSync(fd);
  }
  return hash.digest('hex');
}

type Row = { path: string, bytes: number } & Record_ & { verdict: string, sha256?: string };

function inventory(root: string, withHash = false): Row[] {
  // rglob below a root that is not a directory finds nothing
  if (!existsSync(root) || !statSync(root).isDirectory()) return [];
  return files(root).map(parts => {
    const path = join(root, ...parts);
    const info = classify(parts);
    const size = statSync(path).size;
    const row: Row = { path: parts.join('/'), bytes: size, ...info,
      verdict: size === 0 ? 'empty-unusable' : info.authority === 'unknown' ? 'needs-manual-classification' : 'indexed-not-manifested' };
    if (withHash) row.sha256 = digest(path);
    return row;
  });
}

const width = (text: string) => [...text].length;
const left = (text: string, size: number) => text + ' '.repeat(Math.max(0, size - width(text)));
const right = (text: string, size: number) => ' '.repeat(Math.max(0, size - width(text))) + text;

function main(argv: readonly string[]): number {
  const args = pyArgs(argv, 'index-observations.ts', [{ name: '--json', takes: 'flag' }, { name: '--hash', takes: 'flag' },
    { name: '--strict', takes: 'flag' }], [{ name: 'root', optional: true }]);
  if ('exit' in args) {
    (args.exit ? console.error : console.log)(args.text);
    return args.exit;
  }
  const flags = new Set(Object.keys(args.options));
  const positional = args.positionals;
  const root = pyPath(positional[0] ?? 'captures');

  const rows = inventory(root, flags.has('--hash'));
  if (flags.has('--json')) console.log(pyDumps({ root, artifacts: rows }, 2));
  else {
    console.log(`${rows.length} artifact(s) under ${root}`);
    console.log('bytes       authority              kind                       join  path');
    for (const row of rows) {
      console.log(`${right(String(row.bytes), 10)}  ${left(row.authority, 21)}  ${left(row.kind, 25)}  ${right(row.join || '-', 4)}  ${row.path}`);
      if (row.note) console.log(`            note: ${row.note}`);
      if (row.verdict !== 'indexed-not-manifested') console.log(`            verdict: ${row.verdict}`);
    }
    if (!rows.length) console.log('capture root is absent or empty');
  }
  return flags.has('--strict') && rows.some(row => row.verdict !== 'indexed-not-manifested') ? 1 : 0;
}

process.exitCode = main(process.argv.slice(2));
