#!/usr/bin/env node
// The same program on two machines: a night the calibration build played on
// the phone, replayed by the host harness with the phone's own seed, clock and
// input updates, and compared update for update.
//
// The calibration build (android/apply-calib-mod.py) logs, for every update,
// the exact `dt` the events ran with, the polled left button, the RNG draw
// count and state, and each frame load's seed. `build` turns the first visit
// to one frame (the office, 3) into a harness run directory:
//   env              CHOWDREN_SEED / _SEED_FRAME = the phone's seed for that frame
//                    CHOWDREN_FRAME_TIMES = the phone's dt for each of its updates
//   run.input        the title's Continue (fixtures/continue.input), then a
//                    down / up row on the update whose poll first read the
//                    button down / up, at the point the runtime maps the SDL
//                    mouse event to (the 1024 x 768 frame, EXACT_FIT from 2400 x 1080)
//   save-before.ini  the save the phone held when the night began
// `compare` reads the harness trace and reports the first update whose draw
// count or RNG state differs from the phone's, and how many agree.
//
//   node tools/recompile/calib-replay.mjs build --calib DIR --run DIR [--frame 3]
//   node tools/recompile/calib-replay.mjs compare --calib DIR --run DIR [--record FILE]
//   node tools/recompile/calib-replay.mjs summary --out FILE --host-binary ID --phone-apk SHA LABEL=RUNDIR ...
//     (one results record composed from each run's own record.json, never retyped)
//
// Content-free: it reads and writes timings, counters and coordinates only;
// the run directory lives outside the repository beside the harness.
// MODEL_ONLY for the host side; the phone rows are rebuilt-runtime device
// measurements, never retail evidence.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const SCHEMA = 'recompile-calib-replay-v1';
const GAME = [1024, 768], NATIVE = [2400, 1080];

function fail(message) { console.error(`calib-replay: ${message}`); process.exit(2); }
const opt = (args, name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const sha256 = text => createHash('sha256').update(text).digest('hex');

/** Rows of a calibration log; a row a killed process left cut is skipped. */
// Every log row begins with one of these keys, and no nested object does, so a
// row cut at any byte is split from whatever the next launch appended to it.
export const ROW_START = /(?=\{"(?:schema|u|seed|src|event)":)/;
export function rows(text) {
  const out = [];
  for (const line of text.split('\n')) {
    if (!line) continue;
    for (const piece of line.split(ROW_START)) {
      try { out.push(JSON.parse(piece)); } catch { /* cut row */ }
    }
  }
  return out;
}

/**
 * The first visit to `frame` in the log's last session (the rows after the
 * last session header): its seed row and its update rows, in order. The
 * harness replays a fresh process, so the phone's visit must be a fresh
 * process's first visit too.
 */
export function visit(allRows, frame) {
  const lastSession = allRows.map(r => !!r.session).lastIndexOf(true);
  const updates = lastSession >= 0 ? allRows.slice(lastSession + 1) : allRows;
  const seedIdx = updates.findIndex(r => r.seed !== undefined && r.f === frame);
  if (seedIdx < 0) throw new Error(`no seed row for frame ${frame}`);
  const out = [];
  for (let i = seedIdx + 1; i < updates.length; i++) {
    const r = updates[i];
    if (r.seed !== undefined) { if (out.length) break; continue; }
    if (r.u === undefined) continue;
    if (r.f !== frame) { if (out.length) break; continue; }
    out.push(r);
  }
  if (out.length === 0) throw new Error(`frame ${frame} logged no update after its seed`);
  return { seed: updates[seedIdx].seed, rows: out };
}

/** SDL mouse point (window px) -> frame point, as the runtime scales EXACT_FIT. */
export const toGame = (x, y) => [Math.floor(x * GAME[0] / NATIVE[0]), Math.floor(y * GAME[1] / NATIVE[1])];

export function inputRows(office, input) {
  const downs = input.filter(r => r.src === 'sdl' && r.k === 'mdown');
  const out = [];
  let prev = office[0].m;
  if (prev !== 0) throw new Error('the button was already down on the first update');
  for (let i = 1; i < office.length; i++) {
    const r = office[i];
    if (r.m === prev) continue;
    const tick = r.fu - 1;
    if (r.m === 1) {
      // The press this poll took: the last mouse-down queued before its pump ended.
      const q = downs.filter(d => d.t <= r.tp).at(-1);
      if (!q) throw new Error(`no SDL mouse-down before update ${r.u}`);
      const [x, y] = toGame(q.x, q.y);
      out.push(`3 ${tick} down 0 ${x} ${y}`);
    } else out.push(`3 ${tick} up 0`);
    prev = r.m;
  }
  return out;
}

function build(args) {
  const calib = resolve(opt(args, '--calib') ?? fail('--calib DIR'));
  const run = resolve(opt(args, '--run') ?? fail('--run DIR'));
  if (!relative(ROOT, run).startsWith('..')) fail('--run must be outside the repository');
  const frame = Number(opt(args, '--frame') ?? 3);
  if (frame !== 3) fail('only the office (frame 3) is wired: its input rows are frame-3 rows');
  const updates = rows(readFileSync(join(calib, 'calib-updates.jsonl'), 'utf8'));
  const input = rows(readFileSync(join(calib, 'calib-input.jsonl'), 'utf8'));
  const { seed, rows: office } = visit(updates, frame);
  mkdirSync(run, { recursive: true });
  const times = office.map(r => (r.dt * 1000).toFixed(6));
  writeFileSync(join(run, 'frametimes.txt'), `# phone dt of ${office.length} updates of frame ${frame}\n${times.join('\n')}\n`);
  const title = readFileSync(join(ROOT, 'tools/recompile/fixtures/continue.input'), 'utf8').trimEnd();
  const office_inputs = inputRows(office, input);
  writeFileSync(join(run, 'run.input'), `${title}\n# office: the phone's polled edges, on their updates\n${office_inputs.join('\n')}\n`);
  writeFileSync(join(run, 'env'), [
    `CHOWDREN_SEED=${seed}`, `CHOWDREN_SEED_FRAME=${frame}`,
    `CHOWDREN_FRAME_TIMES=${join(run, 'frametimes.txt')}`, `CHOWDREN_FRAME_TIMES_FRAME=${frame}`,
    `CHOWDREN_MAX_TOTAL_TICKS=${office.length + 2000}`,
  ].join('\n') + '\n');
  const save = join(calib, 'freddy2');
  if (!existsSync(save)) fail(`no save at ${save}`);
  writeFileSync(join(run, 'save-before.ini'), readFileSync(save));
  console.log(JSON.stringify({ run, seed, updates: office.length, inputRows: office_inputs.length }));
}

export function compare(office, traceText, frame = 3) {
  const trace = [];
  let visits = 0, inVisit = false;
  for (const line of traceText.split('\n')) {
    if (line.startsWith(`# frame ${frame} seeded`)) { visits++; inVisit = visits === 1; continue; }
    if (line.startsWith('# frame ') && line.includes(' seeded')) { if (inVisit) inVisit = false; continue; }
    if (!inVisit || line.startsWith('#') || !line.startsWith(`${frame} `)) continue;
    const [, tick, draws, graine] = line.split(' ').map(Number);
    trace.push({ tick, draws, graine });
  }
  const n = Math.min(trace.length, office.length);
  let first = null, agree = 0;
  for (let i = 0; i < n; i++) {
    const h = trace[i], p = office[i];
    if (h.tick !== p.fu - 1) throw new Error(`trace tick ${h.tick} is not phone update ${p.fu}`);
    const same = h.draws === p.rd && h.graine === p.rs;
    if (same) agree++;
    else if (first === null) first = { update: p.fu, phone: { draws: p.rd, state: p.rs }, host: { draws: h.draws, state: h.graine } };
  }
  return { compared: n, phoneUpdates: office.length, hostUpdates: trace.length, agree, firstDivergence: first };
}

function compareCmd(args) {
  const calib = resolve(opt(args, '--calib') ?? fail('--calib DIR'));
  const run = resolve(opt(args, '--run') ?? fail('--run DIR'));
  const updatesText = readFileSync(join(calib, 'calib-updates.jsonl'), 'utf8');
  const { seed, rows: office } = visit(rows(updatesText), 3);
  const traceText = readFileSync(join(run, 'trace'), 'utf8');
  const result = compare(office, traceText);
  const record = {
    schema: SCHEMA, step: 'ROADMAP S2', claimLevel: 'MODEL_ONLY', fidelity: 'rebuilt-runtime',
    question: 'Given the phone\'s seed, per-update dt and polled input updates, does the host harness reproduce the calibration build\'s office night draw for draw?',
    seed,
    inputsSha256: { calibUpdates: sha256(updatesText), frametimes: sha256(readFileSync(join(run, 'frametimes.txt'), 'utf8')),
      runInput: sha256(readFileSync(join(run, 'run.input'), 'utf8')), trace: sha256(traceText) },
    result,
  };
  record.evidenceId = `calib-replay-${sha256(JSON.stringify(record.inputsSha256)).slice(0, 16)}`;
  const out = opt(args, '--record');
  if (out) writeFileSync(out, JSON.stringify(record, null, 1) + '\n');
  console.log(JSON.stringify({ evidenceId: record.evidenceId, seed, ...result }, null, 1));
}

function summary(args) {
  const out = opt(args, '--out') ?? fail('--out FILE');
  const hostBinary = opt(args, '--host-binary') ?? fail('--host-binary ID (the pinned harness binary)');
  const phoneApk = opt(args, '--phone-apk') ?? fail('--phone-apk SHA (the calibration build installed)');
  const runs = args.filter(a => /^[\w.-]+=/.test(a) && !a.startsWith('--')).map(a => {
    const [label, dir] = a.split(/=(.*)/s);
    const record = JSON.parse(readFileSync(join(resolve(dir), 'record.json'), 'utf8'));
    const env = readFileSync(join(resolve(dir), 'env'), 'utf8');
    return { label, variant: { seed: Number(env.match(/CHOWDREN_SEED=(\d+)/)?.[1]),
      phoneFrameTimes: /CHOWDREN_FRAME_TIMES=/.test(env) }, ...record };
  });
  if (runs.length === 0) fail('name at least one LABEL=RUNDIR');
  const composed = {
    schema: 'recompile-calib-replay-summary-v1', step: 'ROADMAP S2', claimLevel: 'MODEL_ONLY',
    fidelity: 'rebuilt-runtime',
    question: 'Does the host harness, given only the phone\'s seed, per-update dt and polled input updates, reproduce a night the calibration build played on the phone, and does each of the three matter?',
    hostBinary, phoneApkSha256: phoneApk,
    runs,
  };
  composed.evidenceId = `calib-replay-summary-${sha256(runs.map(r => r.evidenceId).join(',')).slice(0, 16)}`;
  writeFileSync(out, JSON.stringify(composed, null, 1) + '\n');
  console.log(JSON.stringify({ evidenceId: composed.evidenceId, runs: runs.map(r => [r.label, r.result.agree, r.result.compared, r.result.firstDivergence?.update ?? null]) }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [cmd, ...args] = process.argv.slice(2);
  if (cmd === 'build') build(args);
  else if (cmd === 'compare') compareCmd(args);
  else if (cmd === 'summary') summary(args);
  else fail('usage: build --calib DIR --run DIR | compare --calib DIR --run DIR [--record FILE] | summary --out FILE ...');
}
