#!/usr/bin/env node
// Classify every event group and report what the project has actually read.
//
// Targeted lookups answer a question but never tell you what you have not looked at. This walks the whole office
// frame, sorts each group by what it can change, and cross-references the group numbers cited anywhere in the repo
// -- so the blind spots are a list instead of a feeling.
//
//     packages/source/decompile/coverage.ts            # summary + the unread state clusters
//     packages/source/decompile/coverage.ts --map      # the full per-cluster map (Markdown)
//
// Classes, in order of how much a missing group would matter:
//
//   state         writes a character's position or alterable values, or one of the named gameplay counters -- a
//                 mechanic can hide here
//   setup         per-night constants (AI levels, battery, fuse length)
//   input         reads a touch or key and writes player-facing state
//   presentation  only draws: view frames, animations, sounds, transparency
//
// Ported from coverage.py: it reads, prints and exits as that did.
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pyAlign, pyArgs, pyCompare, pyInt, pyReadText, pyRegExp } from '@sixam/kernel/py';
import { Dump, type Group, at, cells, int } from './readdump.ts';

const OFFICE_FRAME = 3n;

const CHARACTERS = new Set([
  'old freddy', 'old bonnie', 'old chica', 'old foxy', 'new freddy', 'new bonnie', 'new chica', 'new foxy',
  'balloon boy', 'sockpuppet', 'paper pals', 'golden', 'yellowbear', 'JJ',
]);
const COUNTERS = new Set([
  'in danger', 'being attacked by', 'drop everything', 'got you stage', 'check and move', 'viewing', 'lit?', 'battery life', 'time left',
  'time allowed', 'viewing hall light', 'left light', 'right light', 'mask', 'flip panel button', 'your view', 'hall movement', 'blackout',
]);
const SETUP = new Set(['night', 'time of the night']);
const AI_COUNTERS = pyRegExp(String.raw`\bAI$`);

// Action numbers that only draw something.
const PRESENTATION_ACTIONS = new Set(['11', '17', '35', '26', '27', '24', '65', '13', '36', '41', '57', '40', '3', '23', '25']);
const POSITION = '1';
const SET_ALTERABLE = new Set(['31', '32']);
const SET_COUNTER = '80';

type Kind = 'state' | 'setup' | 'input' | 'presentation' | 'other';
type Row = [bigint, string[]];

/** text[:n], counted in code points. */
const head = (text: string, n: number) => [...text].slice(0, n).join('');

/** [class, subsystem-ish targets] for one group. */
export function classify(dump: Dump, group: Group): [Kind, string[]] {
  const state = new Set<string>(), setup = new Set<string>();
  let presentation = false, touchesInput = false;
  for (const line of group.lines) {
    const cell = cells(line.split('\t'));
    const name = dump.name(int(cell.get('OI') ?? '0'));
    const num = cell.get('NUM');
    if (line.startsWith(' C')) {
      if (cell.get('OT') === '-6' || cell.get('OT') === '46') touchesInput = true;
      continue;
    }
    if (CHARACTERS.has(name) && (num === POSITION || (num !== undefined && SET_ALTERABLE.has(num)))) state.add(name);
    else if (COUNTERS.has(name) && (num === SET_COUNTER || (num !== undefined && SET_ALTERABLE.has(num)))) state.add(name);
    else if (AI_COUNTERS.test(name) || SETUP.has(name)) setup.add(name);
    else if (num !== undefined && PRESENTATION_ACTIONS.has(num)) presentation = true;
  }
  if (state.size && touchesInput) return ['input', [...state].sort(pyCompare)];
  if (state.size) return ['state', [...state].sort(pyCompare)];
  if (setup.size) return ['setup', [...setup].sort(pyCompare)];
  if (presentation) return ['presentation', []];
  return ['other', []];
}

/** glob(pattern) relative to the working directory, as Python's glob reads it: hidden names skipped, `**` through
 *  every directory a symlink included (each real directory once, which finds the same files). */
function glob(directory: string, suffix: string, recursive: boolean): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  const walk = (relative: string) => {
    let real: string;
    try {
      real = realpathSync(relative || '.');
    } catch {
      return;
    }
    if (seen.has(real)) return;
    seen.add(real);
    let names: string[];
    try {
      names = readdirSync(relative || '.');
    } catch {
      return;
    }
    for (const name of names) {
      if (name.startsWith('.')) continue;
      const path = relative ? `${relative}/${name}` : name;
      if (name.endsWith(suffix)) found.push(path);
      if (recursive) {
        let isDirectory = false;
        try { isDirectory = statSync(path).isDirectory(); } catch { isDirectory = false; }
        if (isDirectory) walk(path);
      }
    }
  };
  walk(directory);
  return found;
}

/** Every group number referenced in the repo's docs and engine. */
export function citedGroups(): Set<number> {
  const found = new Set<number>();
  const pattern = pyRegExp(String.raw`(?:\bg|\bgroups?\s*)(\d{2,4})(?:\s*[-\u2013]\s*(\d{2,4}))?`, 'gi');
  const paths = [...glob('', '.md', true), ...glob('src', '.js', false), ...glob('tools', '.mjs', false)];
  const generatedMap = normalize('docs/android/ANDROID-GROUP-MAP.md');
  for (const path of paths) {
    // The report lists every group by construction; counting it would make the coverage map cite itself and erase
    // every blind spot.
    if (normalize(path) === generatedMap) continue;
    let text: string;
    try {
      text = pyReadText(readFileSync(path), 'replace');
    } catch {
      continue;
    }
    for (const match of text.matchAll(pattern)) {
      const low = Number(pyInt(match[1]));
      const high = Number(pyInt(match[2] ?? match[1]));
      if (low <= 2000 && high <= 2000 && high >= low) for (let k = low; k <= high; k += 1) found.add(k);
    }
  }
  return found;
}

/** Group consecutive indices into runs, so the report reads as blocks. */
export function cluster(rows: readonly Row[], gap = 3n): Row[][] {
  const runs: Row[][] = [];
  let current = [rows[0]];
  for (const row of rows.slice(1)) {
    if (row[0] - current[current.length - 1][0] <= gap) current.push(row);
    else {
      runs.push(current);
      current = [row];
    }
  }
  runs.push(current);
  return runs;
}

const byIndex = (a: Row, b: Row) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
const span = (run: readonly Row[]) => (run[0][0] === run[run.length - 1][0] ? `g${run[0][0]}` : `g${run[0][0]}-${run[run.length - 1][0]}`);
const targetsOf = (run: readonly Row[]) => [...new Set(run.flatMap(([, targets]) => targets))].sort(pyCompare);

function main(argv: readonly string[]): number {
  const args = pyArgs(argv, 'coverage.ts', [{ name: '--dump' }, { name: '--frame', type: 'int' }, { name: '--map', takes: 'flag' }]);
  if ('exit' in args) {
    (args.exit ? console.error : console.log)(args.text);
    return args.exit;
  }
  const dumpOption = args.options['--dump'], frameOption = args.options['--frame'];
  const dumpPath = typeof dumpOption === 'string' ? dumpOption : process.env.FNAF2_DUMP ?? '/private/tmp/fnaf2-android-dump/events-android.txt';
  const frameIndex = typeof frameOption === 'string' ? int(frameOption) : OFFICE_FRAME;
  if (!existsSync(dumpPath)) {
    console.error(`no dump at ${dumpPath} -- see docs/android/SOURCE-DUMP-GUIDE.md`);
    return 1;
  }
  const dump = new Dump(dumpPath);
  const frame = at(dump.frames, frameIndex);
  const cited = citedGroups();
  const isCited = (index: bigint) => cited.has(Number(index));

  const buckets = new Map<Kind, Row[]>();
  for (const group of frame.groups) {
    const [kind, targets] = classify(dump, group);
    const rows = buckets.get(kind) ?? [];
    rows.push([group.idx, targets]);
    buckets.set(kind, rows);
  }

  console.log(`frame ${frameIndex} (${frame.name}): ${frame.groups.length} groups`);
  for (const kind of ['state', 'input', 'setup', 'presentation', 'other'] as const) {
    const rows = buckets.get(kind) ?? [];
    if (!rows.length) continue;
    const seen = rows.filter(([index]) => isCited(index)).length;
    const pct = Math.floor(100 * seen / rows.length);
    console.log(`  ${pyAlign(kind, 13)} ${pyAlign(String(rows.length), 5, '>')}   cited ${pyAlign(String(seen), 4, '>')} (${pct}%)`);
  }

  const risky = [...(buckets.get('state') ?? []), ...(buckets.get('input') ?? [])].filter(([index]) => !isCited(index)).sort(byIndex);
  console.log(`\nunread groups that can change the game: ${risky.length}`);
  if (risky.length) {
    for (const run of cluster(risky)) {
      console.log(`  ${pyAlign(span(run), 14)} ${pyAlign(String(run.length), 3, '>')} groups  ${head(targetsOf(run).join(', '), 70)}`);
    }
  }

  if (args.options['--map'] === true) {
    console.log('\n## Full cluster map\n');
    console.log('| Groups | Class | Cited | Touches |');
    console.log('| --- | --- | --- | --- |');
    for (const kind of ['state', 'input', 'setup', 'presentation'] as const) {
      const rows = buckets.get(kind) ?? [];
      if (!rows.length) continue;
      for (const run of cluster([...rows].sort(byIndex))) {
        const seen = run.filter(([index]) => isCited(index)).length;
        const mark = seen === run.length ? 'yes' : seen ? 'partial' : '**no**';
        console.log(`| ${span(run)} | ${kind} | ${mark} | ${head(targetsOf(run).join(', '), 60) || '\u2014'} |`);
      }
    }
  }
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
