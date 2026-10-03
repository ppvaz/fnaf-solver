// Which files a CI step runs, read the way CI runs them: each `run:` of every .github/workflows file as
// command lines, through `npm run` scripts (package.json), the lanes as data (tools/lanes.json) and
// tools/test.ts's own selection (`--list`), never by matching a file's name in some text. The one
// answer the gates and Review's S7 row share (tools/test-mistake-register.ts item 13, the grade-run
// coverage gate, roadmap.ts): four readers of "does CI run this" had disagreed on the same file.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, posix } from 'node:path';
import { isRecord } from '@sixam/kernel';
import { readLanes } from './lanes.ts';
import type { Lane } from './lanes.ts';

const WORKFLOWS = '.github/workflows';

/** Split shell text into simple commands (arrays of words). Quote-aware,
 *  keeps `$(...)` as one word, and treats && || ; | & and newlines as
 *  separators. It reads command lines; it is not a shell. */
export function simpleCommands(text: string) {
  const commands: string[][] = [];
  let words: string[] = [];
  let word = '';
  let inWord = false;
  let quote: string | null = null;
  let depth = 0;
  const endWord = () => { if (inWord) words.push(word); word = ''; inWord = false; };
  const endCommand = () => { endWord(); if (words.length) commands.push(words); words = []; };
  const src = text.replace(/\\\r?\n/g, ' ');
  for (let i = 0; i < src.length; i += 1) {
    const c = src[i];
    if (quote) { if (c === quote) quote = null; else word += c; continue; }
    if (depth > 0) {
      word += c;
      if (c === '(') depth += 1;
      else if (c === ')') depth -= 1;
      continue;
    }
    if (c === "'" || c === '"') { quote = c; inWord = true; continue; }
    if (c === '$' && src[i + 1] === '(') { word += '$('; i += 1; depth = 1; inWord = true; continue; }
    if (c === '#' && !inWord) { while (i < src.length && src[i] !== '\n') i += 1; endCommand(); continue; }
    if (c === '&' && (word.endsWith('>') || src[i + 1] === '>')) { word += c; inWord = true; continue; }
    if (c === '\n' || c === ';' || c === '|' || c === '&') {
      endCommand();
      if ((c === '|' || c === '&') && src[i + 1] === c) i += 1;
      continue;
    }
    if (/\s/.test(c)) { endWord(); continue; }
    word += c;
    inWord = true;
  }
  endCommand();
  return commands;
}

const INTERPRETERS = new Set(['node', 'python3', 'python', 'bash', 'sh']);

/** What one simple command runs: an npm script, a file, or nothing tracked. */
function classify(words: string[]) {
  let i = 0;
  while (i < words.length && /^[A-Za-z_]\w*=/.test(words[i])) i += 1;
  const [command, ...rest] = words.slice(i);
  if (!command) return null;
  if (command === 'npm') {
    const at = rest.findIndex(word => word === 'run' || word === 'run-script');
    if (at < 0) return null;
    const script = rest.slice(at + 1).find(word => !word.startsWith('-'));
    return script ? { kind: 'npm' as const, script } : null;
  }
  if (INTERPRETERS.has(command)) {
    const at = rest.findIndex(word => !word.startsWith('-'));
    const flags = rest.slice(0, at < 0 ? rest.length : at);
    // Inline code or a module, not a file: `node -e`, `python3 -m pip`, `sh -c`.
    if (at < 0 || flags.some(flag => ['-e', '-p', '-c', '-m', '--eval', '--print'].includes(flag)))
      return null;
    return { kind: 'file' as const, path: rest[at], args: rest.slice(at + 1) };
  }
  if (command.includes('/') && /\.(?:sh|py|mjs|js|ts|mts)$/.test(command))
    return { kind: 'file' as const, path: command, args: rest };
  return null;
}

/** `- name:` / `run:` pairs of the CI job, single-line and `run: |` blocks. */
export function ciSteps(text: string) {
  const lines = text.split('\n');
  const steps = [];
  for (let i = 0; i < lines.length; i += 1) {
    const named = lines[i].match(/^(\s*)- name:\s*(.+?)\s*$/);
    if (!named) continue;
    let run = null;
    for (let j = i + 1; j < lines.length && !/^\s*- /.test(lines[j]); j += 1) {
      const single = lines[j].match(/^(\s*)run:\s*(.*?)\s*$/);
      if (!single) continue;
      if (single[2] !== '|') { run = single[2]; break; }
      const block = [];
      const indent = single[1].length;
      for (let k = j + 1; k < lines.length; k += 1) {
        if (lines[k].trim() && lines[k].search(/\S/) <= indent) break;
        block.push(lines[k]);
      }
      run = block.join('\n');
      break;
    }
    if (run !== null) steps.push({ name: named[2], run });
  }
  return steps;
}

/** One registered check as `tools/test.ts --list` prints it. */
export interface SuiteEntry {
  readonly name: string, readonly group: string, readonly path: string, readonly args: string[],
  readonly selected: boolean, readonly backlog: string | null, readonly extended: boolean,
}

/** What a walk reports: each npm script a line names (and whether it is defined), and each file (and whether these flags reach it). */
export interface Sink {
  script(name: string, via: string, known: boolean): void;
  file(path: string, via: string, reached: boolean, entry?: SuiteEntry): void;
}

/** The registries a command line can reach: package.json's scripts, the lane table and tools/test.ts's selection. */
export interface WalkContext {
  readonly scripts: Readonly<Record<string, string>>;
  readonly lanes: Readonly<Record<string, Lane>>;
  readonly suite: (args: readonly string[]) => readonly SuiteEntry[];
}

const isSuiteEntry = (value: unknown): value is SuiteEntry => isRecord(value) && typeof value.name === 'string'
  && typeof value.group === 'string' && typeof value.path === 'string' && typeof value.selected === 'boolean';

/**
 * root's registries. tools/test.ts answers what a flag set selects; this never re-derives its
 * --gates filter from the file's text (register item 11: read the tool's own computed output).
 * A checkout without tools/test.ts selects nothing through it.
 */
export function walkContext(root: string): WalkContext {
  const manifest: unknown = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const scripts: Record<string, string> = {};
  if (isRecord(manifest) && isRecord(manifest.scripts))
    for (const [name, body] of Object.entries(manifest.scripts)) if (typeof body === 'string') scripts[name] = body;
  const suiteCache = new Map<string, SuiteEntry[]>();
  const runner = join(root, 'tools/test.ts');
  const suite = (args: readonly string[]) => {
    const flags = args.filter(arg => arg !== '--list');
    const key = flags.join(' ');
    let entries = suiteCache.get(key);
    if (!entries) {
      entries = !existsSync(runner) ? [] : execFileSync(process.execPath, [runner, ...flags, '--list'], { cwd: root, encoding: 'utf8' })
        .trim().split('\n').filter(Boolean).map((line): SuiteEntry => {
          const entry: unknown = JSON.parse(line);
          if (!isSuiteEntry(entry)) throw new Error(`tools/test.ts --list printed an entry this does not read: ${line}`);
          return entry;
        });
      suiteCache.set(key, entries);
    }
    return entries;
  };
  return { scripts, lanes: readLanes(root), suite };
}

const normal = (path: string) => posix.normalize(path.replace(/^\.\//, ''));

/** Walk one command text, calling sink.file(path, via, reached) for every file
 *  it names and sink.script(name, via) for every `npm run` it names. `reached`
 *  is false for a tools/test.ts entry these flags do not select, and for a report. */
export function walk(text: string, via: string, sink: Sink, context: WalkContext, open = new Set<string>()) {
  const { scripts, lanes, suite } = context;
  for (const words of simpleCommands(text)) {
    const target = classify(words);
    if (!target) continue;
    if (target.kind === 'npm') {
      const known = Object.hasOwn(scripts, target.script);
      sink.script(target.script, via, known);
      if (!known || open.has(target.script)) continue;
      walk(scripts[target.script], `${via} > npm run ${target.script}`, sink, context, new Set([...open, target.script]));
      continue;
    }
    if (target.path.includes('$')) continue;   // a variable path is resolved at run time
    const path = normal(target.path);
    sink.file(path, via, true);
    if (path === 'tools/lanes.ts') {
      // A lane is data (tools/lanes.json): its node files run under node --test, then its steps.
      const name = target.args[0] ?? '';
      const lane = lanes[name];
      if (!lane) sink.file(`tools/lanes.json#${name}`, via, true);
      else if (!open.has(`lane:${name}`)) {
        const inside = `${via} > tools/lanes.ts ${name}`;
        for (const file of lane.node) sink.file(file, inside, true);
        for (const step of lane.steps)
          walk(step[0] === 'lane' ? `node tools/lanes.ts ${step[1]}` : step.join(' '), inside, sink, context,
            new Set([...open, `lane:${name}`]));
      }
    }
    if (path === 'tools/test.ts') {
      // A report selected by --reports is printed and never judged: not a gate.
      for (const entry of suite(target.args))
        sink.file(entry.path, `${via} > tools/test.ts ${target.args.join(' ')} [${entry.name}]`,
          entry.selected && entry.group !== 'reports', entry);
    }
  }
}

/** Every workflow under .github/workflows: CI's checks, and the Pages build that gates a deploy. */
function workflows(root: string) {
  const dir = join(root, WORKFLOWS);
  return (existsSync(dir) ? readdirSync(dir) : []).filter(name => /\.ya?ml$/.test(name)).sort()
    .map(name => ({ name, text: readFileSync(join(dir, name), 'utf8') }));
}

/** Every file a workflow step runs, with the first route that reaches it, and the
 *  BACKLOG reason of each tools/test.ts entry a step names but does not run. */
export function ciReach(root: string, { context = walkContext(root), ciText }: { context?: WalkContext, ciText?: string } = {}) {
  const texts = ciText === undefined ? workflows(root) : [{ name: 'ci.yml', text: ciText }];
  const reached = new Map<string, string>();
  const backlog = new Map<string, string>();
  const sink: Sink = {
    script: () => {},
    file: (path, via, isReached, entry) => {
      if (isReached && !reached.has(path)) reached.set(path, via);
      if (entry?.backlog) backlog.set(path, entry.backlog);
    },
  };
  for (const { name, text } of texts) for (const step of ciSteps(text)) walk(step.run, `${name} "${step.name}"`, sink, context);
  for (const path of reached.keys()) backlog.delete(path);
  return { reached, backlog };
}

const CI_EXEMPTIONS = 'tools/ci-exemptions.json';

/**
 * The test files no CI step runs, each with the decision that keeps it out (tools/ci-exemptions.json).
 * An entry is a decision, not a formality: deleting one is how a test gets promoted into a lane.
 * tools/test.ts's BACKLOG is the other exemption table, and ciReach returns its reasons.
 */
export function readCiExemptions(root: string): ReadonlyMap<string, string> {
  const table: unknown = JSON.parse(readFileSync(join(root, CI_EXEMPTIONS), 'utf8'));
  if (!isRecord(table)) throw new Error(`${CI_EXEMPTIONS}: not an object of path -> reason`);
  const out = new Map<string, string>();
  for (const [path, reason] of Object.entries(table)) {
    if (typeof reason !== 'string' || !reason.trim()) throw new Error(`${CI_EXEMPTIONS}: ${path} is exempt with no reason`);
    out.set(path, reason);
  }
  return out;
}
