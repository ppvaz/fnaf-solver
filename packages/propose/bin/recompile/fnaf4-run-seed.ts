#!/usr/bin/env node
// Does the rebuilt FNaF 4, given a phone night's own touches, play that night the way the phone did at some seed --
// and at which? (ROADMAP S6: the rebuild against the phone, FNaF 4's counterpart of S2's seed scan.)
//
//   node packages/propose/bin/recompile/fnaf4-run-seed.ts rows --run RUN_DIR [--press-ms 82] [--release-ms 20] [--out FILE]
//   node packages/propose/bin/recompile/fnaf4-run-seed.ts scan --predeclaration PRE.json --binary FILE --assets FILE
//        --out DIR [--jobs 3]
//   node packages/propose/bin/recompile/fnaf4-run-seed.ts decide --predeclaration PRE.json --results DIR/results.jsonl
//        [--out FILE]
//
// rows: a fnaf4-run-v1 night's touches (events.jsonl) as CHOWDREN_INPUT rows. A touch lands `--press-ms` after its
// send and lets go `--release-ms` after its release; the level's update 0 is LEVEL_ORIGIN_MS before the night epoch
// (fnaf4-run.ts), at 60 updates a second; the window point is the screen point over the profile's FULL stretch.
// scan: stage 1 keeps the seeds whose Fredbear rolls, read off the generator alone, give the night's first heard
// ticks; stage 2 replays each kept seed in the rebuild with the rows (pilot `still` with `knobs.input`) and records
// where he lands on every roll tick and when the level ends. decide: the predeclared rule over those rows.
// The roll rule: in an update that holds a 3000 ms roll, g229's four draws come first and his direction is the
// fourth (Random(2), 1 = right); the roll (g286, Random(20) + 1 <= AI) is the next draw, or the eighth when the
// 5000 ms group's three draws share the update. MODEL_ONLY over a DEVICE_MEASURED night. Host-only.
import { parseArgs } from 'node:util';
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { LEVEL_ORIGIN_MS } from '../../../play/games/fnaf4/fnaf4-run.ts';
import { resumedSeeds, sha256 } from './sweep-common.ts';
import { spawnPilot } from './pilot/pilot-child.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../../../..');
export const SCHEMA = 'fnaf4-run-seed-v1';
const UPDATES_PER_S = 60;
// controls-fnaf4-moto-g56-v204.json `view.mapping`: Display Mode FULL stretches the 1024 x 768 window to 2400 x 1080.
const SCREEN_PER_WINDOW = { x: 2400 / 1024, y: 1080 / 768 };
const CONTINUE_ROWS = ['1 301 down 0 512.0 460.0', '1 304 up 0'];

type Event = { type: string, control?: string, kind?: string, gapMs?: number, point?: { x: number, y: number },
  hostMs: number, firstReleasedHostMs?: number };
/** The predeclaration, as the scan and the decision read it. */
interface Predeclaration {
  tool: { path: string, sha256: string }, sources: readonly { path: string, sha256: string }[];
  run: { dir: string }, mapping: { pressMs: number, releaseMs: number }, rows: { sha256: string };
  save: { path: string }, maxTicks: number, rollTicks: readonly number[];
  prefix: readonly { update: number, before: number, withFive: boolean, heard: string }[];
  validity: { seeds: readonly number[] }, decisionRule: { ticks: string, deathWindow: [number, number] };
}

/** A fnaf4-run-v1 night's touches as CHOWDREN_INPUT rows: Continue on the title, then the level's contacts. */
export function phoneRows(runDir: string, pressMs: number, releaseMs: number) {
  const run = JSON.parse(readFileSync(join(runDir, 'run.json'), 'utf8'));
  const origin = run.night.epochHostMs + LEVEL_ORIGIN_MS;
  const tick = (ms: number) => Math.round(((ms - origin) * UPDATES_PER_S) / 1000);
  const events: Event[] = readFileSync(join(runDir, 'events.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const rows = [...CONTINUE_ROWS];
  let asked: Event | null = null;
  for (const e of events) {
    if (e.type === 'input.requested') { asked = e; continue; }
    if (e.type !== 'input.released' || !asked || asked.control === 'continue') continue;
    // A level touch's request names its point; a double's names its gap, and its release the first contact's.
    const p = asked.point as { x: number, y: number };
    const at = `${(p.x / SCREEN_PER_WINDOW.x).toFixed(1)} ${(p.y / SCREEN_PER_WINDOW.y).toFixed(1)}`;
    const contacts = asked.kind === 'double'
      ? [[asked.hostMs, e.firstReleasedHostMs as number], [(e.firstReleasedHostMs as number) + (asked.gapMs as number), e.hostMs]]
      : [[asked.hostMs, e.hostMs]];
    for (const [down, up] of contacts) rows.push(`3 ${tick(down + pressMs)} down 0 ${at}`, `3 ${tick(up + releaseMs)} up 0`);
    asked = null;
  }
  return `${rows.join('\n')}\n`;
}

/** The generator's values after `n` steps from `seed` (x -> 31415x + 1 mod 65,536). */
export function stream(seed: number, n: number) {
  const out = new Array<number>(n);
  let x = seed;
  for (let i = 0; i < n; i += 1) { x = (x * 31415 + 1) & 0xffff; out[i] = x; }
  return out;
}
const random = (state: number, n: number) => (state * n) >> 16;

/** Fredbear's roll in an update that starts `before` draws into the level: passed, and the side he would land. */
export function roll(states: readonly number[], before: number, withFive: boolean, ai = 12) {
  return { pass: random(states[before + (withFive ? 7 : 4)], 20) + 1 <= ai, side: random(states[before + 3], 2) === 1 ? 'R' : 'L' };
}

/** Stage 1: every seed whose rolls at the predeclared prefix ticks give the heard result there. */
export function prefilter(prefix: readonly { before: number, withFive: boolean, heard: string }[]) {
  const need = Math.max(...prefix.map((p) => p.before)) + 8;
  const kept = [];
  for (let seed = 0; seed < 65536; seed += 1) {
    const st = stream(seed, need);
    if (prefix.every((p) => { const r = roll(st, p.before, p.withFive); return p.heard === '-' ? !r.pass : r.pass && r.side === p.heard; })) kept.push(seed);
  }
  return kept;
}

/**
 * Where a still.jsonl puts him on each roll tick -- L or R when he moved onto a living-room side that update (the
 * policy logs on change), '-' otherwise -- and the update `gameover` turned 1: the black onset the phone records.
 */
export function readNight(stillJsonl: string, rollTicks: readonly number[]) {
  const rows = stillJsonl.split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const at = new Map(rows.filter((r) => r.at).map((r) => [r.t, r.at.Fredbear]));
  const side = (p: string | undefined) => (p === 'living room left' ? 'L' : p === 'living room right' ? 'R' : '-');
  const over = rows.find((r) => r.at && r.gameover);
  return { ticks: rollTicks.map((t) => side(at.get(t))).join(''), dead: rows.some((r) => r.dead), gameoverAt: over ? over.t : null };
}

type Row = { seed: number, kept?: boolean, error?: string, ticks?: string, dead?: boolean, gameoverAt?: number | null, prefixOk?: boolean };
/** The predeclared rule over the scan's rows (the kept seeds' and the validity seeds'). */
export function decide(rule: { ticks: string, deathWindow: [number, number] }, rows: readonly Row[]) {
  const stage2 = rows.filter((r) => r.kept && !r.error);
  const errors = rows.filter((r) => r.kept && r.error).length;
  const prefixBroken = rows.filter((r) => r.prefixOk === false).map((r) => r.seed);
  const landingsOnly = stage2.filter((r) => r.ticks === rule.ticks).map((r) => r.seed);
  const matches = stage2.filter((r) => r.ticks === rule.ticks && r.gameoverAt != null
    && r.gameoverAt >= rule.deathWindow[0] && r.gameoverAt <= rule.deathWindow[1]).map((r) => r.seed);
  const kept = rows.filter((r) => r.kept).length;
  const verdict = prefixBroken.length || errors > 0.01 * kept ? 'UNINFORMATIVE'
    : matches.length === 1 ? 'REPRODUCED_UNIQUE' : matches.length > 1 ? 'REPRODUCED_MULTIPLE' : 'NOT_REPRODUCED';
  return { verdict, matches, landingsOnly, kept, errors, prefixBroken };
}

/** Each subcommand's flags; any other is refused (it used to be accepted and ignored). */
const SUBCOMMAND_FLAGS: Readonly<Record<string, readonly string[]>> = {
  rows: ['run', 'press-ms', 'release-ms', 'out'],
  scan: ['predeclaration', 'binary', 'assets', 'out', 'jobs'],
  decide: ['predeclaration', 'results', 'out'],
};

/** A subcommand's flags as text, refusing an unknown subcommand or a flag that subcommand does not read. */
export function runSeedArgs(argv: readonly string[]): Readonly<Record<string, string>> {
  const flags = SUBCOMMAND_FLAGS[argv[0]];
  if (!flags) throw new Error('see usage at top of file');
  const { values } = parseArgs({ args: argv.slice(1), strict: true,
    options: Object.fromEntries(flags.map((name) => [name, { type: 'string' as const }])) });
  return Object.fromEntries(Object.entries(values).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
}

async function runSeed(pre: Predeclaration, o: Readonly<Record<string, string>>, rowsPath: string, seed: number) {
  const dir = join(o.out, `s${seed}`);
  const { code, out, err } = await spawnPilot(['--game', 'fnaf4', '--run', dir, '--binary', o.binary, '--assets', o.assets,
    '--save', resolve(ROOT, pre.save.path), '--policy', 'still', '--knobs', JSON.stringify({ input: rowsPath }),
    '--seed', String(seed), '--max-ticks', String(pre.maxTicks)]);
  let row: Row;
  try {
    const night = readNight(readFileSync(join(dir, 'still.jsonl'), 'utf8'), pre.rollTicks);
    // The prefix the stage-1 rule read must be this seed's own: its draws before each prefix roll.
    const cum = readFileSync(join(dir, 'trace'), 'utf8').split('\n').filter((l) => l && !l.startsWith('#'))
      .map((l) => l.split(' ')).filter((r) => r[0] === '3').map((r) => Number(r[2]));
    const prefixOk = pre.prefix.every((p) => cum[p.update - 1] === p.before);
    row = { seed, ticks: night.ticks, dead: night.dead, gameoverAt: night.gameoverAt, prefixOk };
  } catch (e) {
    row = { seed, error: `${code}: ${String(e).slice(0, 200)} | ${err.trim().split('\n').slice(-2).join(' | ')}` };
  }
  rmSync(dir, { recursive: true, force: true });
  return { ...row, stdout: out.trim().split('\n').pop()?.slice(0, 200) };
}

async function scan(o: Readonly<Record<string, string>>) {
  const preBytes = readFileSync(o.predeclaration);
  const pre: Predeclaration = JSON.parse(preBytes.toString('utf8'));
  // This tool, the pilot and its policy decide every row: each must be the predeclared file, and stay so (a seed
  // spawns a fresh pilot that reads them again).
  const pinned = [{ path: pre.tool.path, sha256: pre.tool.sha256 }, ...pre.sources];
  const drift = () => pinned.filter((s) => sha256(readFileSync(resolve(ROOT, s.path))) !== s.sha256).map((s) => s.path);
  if (drift().length) throw new Error(`scan: not the predeclared ${drift().join(', ')}`);
  mkdirSync(o.out, { recursive: true });
  const rowsPath = join(o.out, 'night.input');
  writeFileSync(rowsPath, phoneRows(resolve(ROOT, pre.run.dir), pre.mapping.pressMs, pre.mapping.releaseMs));
  if (sha256(readFileSync(rowsPath)) !== pre.rows.sha256) throw new Error('scan: the rows are not the predeclared ones');
  const kept = prefilter(pre.prefix);
  const resultsPath = join(o.out, 'results.jsonl');
  // Each row names the predeclaration it was scanned under, so a resume reuses only its own scan's rows.
  const predeclarationSha256 = sha256(preBytes);
  const done = resumedSeeds(resultsPath, 'predeclarationSha256', predeclarationSha256);
  const todo = [...kept, ...pre.validity.seeds].filter((s) => !done.has(s));
  console.log(`stage 1: ${kept.length} of 65,536 seeds kept; stage 2: ${todo.length} to replay`);
  let next = 0;
  const worker = async () => {
    while (next < todo.length) {
      if (drift().length) throw new Error(`scan: ${drift().join(', ')} changed during the scan`);
      const seed = todo[next++];
      const row = await runSeed(pre, o, rowsPath, seed);
      appendFileSync(resultsPath, `${JSON.stringify({ ...row, kept: kept.includes(seed), predeclarationSha256 })}\n`);
    }
  };
  await Promise.all(Array.from({ length: Number(o.jobs ?? 3) }, worker));
}

function main(argv: string[]) {
  const o = runSeedArgs(argv);
  if (argv[0] === 'rows') {
    const text = phoneRows(resolve(o.run), Number(o['press-ms'] ?? 82), Number(o['release-ms'] ?? 20));
    if (o.out) writeFileSync(o.out, text); else process.stdout.write(text);
    return;
  }
  if (argv[0] === 'scan') { scan(o).catch((e) => { console.error(e.stack ?? String(e)); process.exit(1); }); return; }
  if (argv[0] === 'decide') {
    const pre: Predeclaration = JSON.parse(readFileSync(o.predeclaration, 'utf8'));
    const rows: Row[] = readFileSync(o.results, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    const result = { schema: SCHEMA, ...decide(pre.decisionRule, rows) };
    if (o.out) writeFileSync(o.out, `${JSON.stringify(result, null, 1)}\n`);
    console.log(JSON.stringify(result));
    return;
  }
  throw new Error('see usage at top of file');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv.slice(2));
