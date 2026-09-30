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
//   run.input        the route to the office (--navigation, fixtures/continue.input by
//                    default), then pointer 0's down / up on the update whose poll first
//                    read the button down / up, at the point the runtime maps the SDL
//                    mouse event to (the 1024 x 768 frame, EXACT_FIT from 2400 x 1080),
//                    and pointers 1.. on the update the phone applied them
//   save-before.ini  the save the phone held when the night began
// `compare` reads the harness trace and reports the first update whose draw
// count or RNG state differs from the phone's, and how many agree.
//
//   node tools/recompile/calib-replay.mjs build --calib DIR --run DIR [--frame 3] [--navigation FILE]
//   node tools/recompile/calib-replay.mjs compare --calib DIR --run DIR [--record FILE]
//   node tools/recompile/calib-replay.mjs summary --out FILE --host-binary ID --phone-apk SHA
//        [--delivery CALIBDIR:PLANNED.input] [--question TEXT] LABEL=RUNDIR ...
//     (one results record composed from each run's own record.json or trace, never retyped)
//   node tools/recompile/calib-replay.mjs model --calib DIR --planned FILE --winner FILE --night N
//        [--custom-night FILE] [--model-options FILE] [--options-before FILE] [--landings phone|planned]
//        [--clock phone|fixed] [--vs phone|trace:RUNDIR] [--record FILE [--append]]
//     (the model on the phone's night: the winner's Sim queue at the phone's landings, seed and clock)
//
// Content-free: it reads and writes timings, counters and coordinates only;
// the run directory lives outside the repository beside the harness.
// MODEL_ONLY for the host side; the phone rows are rebuilt-runtime device
// measurements, never retail evidence.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { drawTrace } from './model-draw-trace.mjs';
import { DEFAULT_PROFILE, controlPoints, harnessRows, simAction, winnerSchedule } from './schedule-to-input.mjs';

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

/**
 * Harness rows for the office visit. Pointer 0 is the mouse play mode mirrors
 * once per update, so its edges are the polled button's transitions, at the
 * point the SDL mouse-down that poll took maps to. Pointers 1.. are the
 * calibration build's `mt` rows, each applied at the start of update `u`'s
 * events, after pointer 0's mirror, as the phone applies them.
 */
export function inputRows(office, input) {
  const downs = input.filter(r => r.src === 'sdl' && r.k === 'mdown');
  const u0 = office[0].u;
  const byTick = new Map();
  const add = (tick, row) => { if (!byTick.has(tick)) byTick.set(tick, []); byTick.get(tick).push(row); };
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
      add(tick, `3 ${tick} down 0 ${x} ${y}`);
    } else add(tick, `3 ${tick} up 0`);
    prev = r.m;
  }
  const last = office.at(-1).u;
  for (const m of input.filter(r => r.src === 'mt' && r.u >= u0 && r.u <= last)) {
    const tick = m.u - u0;
    if (m.k === 'new') add(tick, `3 ${tick} down ${m.p} ${m.x} ${m.y}`);
    else if (m.k === 'end') add(tick, `3 ${tick} up ${m.p}`);
    else if (m.k === 'move') add(tick, `3 ${tick} move ${m.p} ${m.x} ${m.y}`);
    else if (m.k === 'lost') throw new Error(`the phone dropped ${m.n} finger events at update ${m.u}`);
  }
  return [...byTick.keys()].sort((a, b) => a - b).flatMap(t => byTick.get(t));
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
  // The navigation to the office: the phone's own title route (Continue by
  // default; Custom Night's title and customize rows for a Night 7 visit).
  const navFile = resolve(opt(args, '--navigation') ?? join(ROOT, 'tools/recompile/fixtures/continue.input'));
  const title = readFileSync(navFile, 'utf8').split('\n').filter(l => !/^3\s/.test(l)).join('\n').trimEnd();
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

/** How a harness run's first office visit ended: its update count and the frame it went to. */
export function outcome(traceText, frame = 3) {
  let visits = 0, on = false, updates = 0, next = null;
  for (const line of traceText.split('\n')) {
    const seeded = line.match(/^# frame (\d+) seeded (\d+)/);
    if (seeded) {
      if (on) { next = { frame: Number(seeded[1]), seed: Number(seeded[2]) }; break; }
      if (Number(seeded[1]) === frame && ++visits === 1) on = true;
      continue;
    }
    if (on && line.startsWith(`${frame} `)) updates++;
  }
  return { officeUpdates: updates, nextFrame: next?.frame ?? null };
}

/**
 * Where the phone landed each planned office edge: planned rows (the harness
 * file the phone was driven from) against the landed edges the calibration
 * log holds, paired in order per pointer and edge, up to the office's end.
 */
export function delivery(office, input, plannedText) {
  const planned = plannedText.split('\n').filter(l => /^3\s/.test(l)).map(l => l.trim().split(/\s+/))
    .map(([, tick, op, pointer]) => ({ tick: Number(tick), op, pointer: Number(pointer) }));
  const landed = [];
  for (let i = 1; i < office.length; i++)
    if (office[i].m !== office[i - 1].m) landed.push({ pointer: 0, op: office[i].m ? 'down' : 'up', tick: office[i].fu - 1 });
  const u0 = office[0].u, last = office.at(-1).u;
  for (const m of input.filter(r => r.src === 'mt' && r.u >= u0 && r.u <= last))
    if (m.k === 'new' || m.k === 'end') landed.push({ pointer: m.p, op: m.k === 'new' ? 'down' : 'up', tick: m.u - u0 });
  const lastTick = office.at(-1).fu - 1;
  const due = planned.filter(r => r.tick <= lastTick);
  const offsets = {}, rows = [];
  let missing = 0, extra = 0;
  for (const pointer of [...new Set(due.map(r => r.pointer))]) for (const op of ['down', 'up']) {
    const P = due.filter(r => r.pointer === pointer && r.op === op), L = landed.filter(r => r.pointer === pointer && r.op === op);
    missing += Math.max(0, P.length - L.length);
    extra += Math.max(0, L.length - P.length);
    for (let i = 0; i < Math.min(P.length, L.length); i++) {
      const d = L[i].tick - P[i].tick;
      offsets[d] = (offsets[d] ?? 0) + 1;
      rows.push({ pointer, op, planned: P[i].tick, landed: L[i].tick });
    }
  }
  return { plannedDue: due.length, landed: landed.length, missing, extra, landedMinusPlanned: offsets,
    rows: rows.sort((a, b) => a.planned - b.planned) };
}

/**
 * The model's Sim queue for a night the phone played: each row of the winner's
 * queue moved to the update the phone landed its harness edge on. A queue row
 * is one harness edge of the same control, frame and direction (a press is a
 * down, a release an up); a tap's release and a camdrop's monitor release have
 * no queue row, because the Sim takes a tap as a press. Rows past the phone's
 * office keep their planned frame. Model frame F is harness update F - 1, so a
 * row applied before tick F is the harness row on tick F.
 */
export function landedQueue({ sched, points, office, input, plannedText }) {
  const planned = harnessRows(sched.contacts, points).rows.map(e => ({ ...e }));
  const plannedRows = plannedText.split('\n').filter(l => /^3\s/.test(l)).map(l => l.trim().split(/\s+/));
  if (planned.length !== plannedRows.length || planned.some((e, i) => e.tick !== Number(plannedRows[i][1]) || e.op !== plannedRows[i][2]))
    throw new Error('the planned input is not this winner\'s harness rows (schedule-to-input.mjs)');
  const d = delivery(office, input, plannedText);
  const landed = new Map(d.rows.map(r => [`${r.pointer}/${r.op}/${r.planned}`, r.landed]));
  const moved = [];
  let unmatched = 0;
  const rows = sched.queue.map(([frame, op, action]) => {
    const edge = planned.find(e => !e.used && e.tick === frame && e.op === (op === 'press' ? 'down' : 'up') && simAction(e.control) === action);
    if (!edge) { unmatched++; return [frame, op, action]; }
    edge.used = true;
    const at = landed.get(`${edge.pointer}/${edge.op}/${edge.tick}`);
    if (at === undefined) return [frame, op, action];
    if (at !== frame) moved.push({ action, op, planned: frame, landed: at });
    return [at, op, action];
  }).sort((a, b) => a[0] - b[0]);
  if (unmatched) throw new Error(`${unmatched} queue rows have no harness edge`);
  return { rows, moved };
}

/** The model on the phone's night: per update, the same draws and RNG state as the phone? */
export function compareModel(office, out) {
  let agree = 0, first = null;
  const n = Math.min(office.length, out.length - 1);
  for (let f = 1; f <= n; f++) {
    const p = office[f - 1], m = out[f];
    if (m.draws === p.rd && m.state === p.rs) agree++;
    else if (first === null) first = { update: f, phone: { draws: p.rd, state: p.rs }, model: { draws: m.draws, state: m.state } };
  }
  return { compared: n, agree, firstDivergence: first };
}

/** A harness run's first office visit as rows the model is compared with (draws, state). */
function traceOffice(traceText) {
  const out = []; let visits = 0, on = false;
  for (const l of traceText.split('\n')) {
    if (l.startsWith('# frame 3 seeded')) { visits++; on = visits === 1; continue; }
    if (l.startsWith('# frame ') && l.includes(' seeded')) { if (on) break; continue; }
    if (on && l.startsWith('3 ')) { const [, , d, g] = l.split(' '); out.push({ rd: Number(d), rs: Number(g) }); }
  }
  return out;
}

function modelCmd(args) {
  const calib = resolve(opt(args, '--calib') ?? fail('--calib DIR'));
  const plannedFile = resolve(opt(args, '--planned') ?? fail('--planned FILE (the harness input the phone was driven from)'));
  const winnerFile = resolve(opt(args, '--winner') ?? fail('--winner FILE'));
  const night = Number(opt(args, '--night') ?? fail('--night N'));
  const optionsFile = resolve(opt(args, '--model-options') ?? join(ROOT, 'tools/recompile/sourced-rebuild-model-options.json'));
  const customNightFile = opt(args, '--custom-night');
  const landings = opt(args, '--landings') ?? 'phone';
  const clock = opt(args, '--clock') ?? 'phone';
  const vs = opt(args, '--vs') ?? 'phone';
  if (!['phone', 'planned'].includes(landings) || !['phone', 'fixed'].includes(clock)) fail('--landings phone|planned, --clock phone|fixed');
  if (vs !== 'phone' && !vs.startsWith('trace:')) fail('--vs phone | trace:RUNDIR');
  const updatesText = readFileSync(join(calib, 'calib-updates.jsonl'), 'utf8');
  const inputText = readFileSync(join(calib, 'calib-input.jsonl'), 'utf8');
  const plannedText = readFileSync(plannedFile, 'utf8');
  const { seed, rows: office } = visit(rows(updatesText), 3);
  const winner = JSON.parse(readFileSync(winnerFile, 'utf8'));
  const sched = winnerSchedule(winner, night);
  const points = controlPoints(JSON.parse(readFileSync(join(ROOT, DEFAULT_PROFILE), 'utf8')));
  const { rows: queue, moved } = landings === 'phone'
    ? landedQueue({ sched, points, office, input: rows(inputText), plannedText })
    : { rows: sched.queue, moved: [] };
  // The reference: the phone's office rows, or a harness run's (the rebuild on the same inputs).
  const traceDir = vs.startsWith('trace:') ? resolve(vs.slice(6)) : null;
  const traceText = traceDir ? readFileSync(join(traceDir, 'trace'), 'utf8') : null;
  const reference = traceText ? traceOffice(traceText) : office;
  const customNight = customNightFile ? JSON.parse(readFileSync(resolve(customNightFile), 'utf8')) : undefined;
  const run = (file) => {
    const modelOptions = JSON.parse(readFileSync(file, 'utf8'));
    const { out, death, won } = drawTrace({ night, seed, frames: reference.length + 30000, rows: queue, customNight, modelOptions,
      ...(clock === 'phone' ? { frameTimes: office.map(r => r.dt * 1000) } : {}) });
    return { modelOptions: { path: relative(ROOT, file), sha256: sha256(readFileSync(file, 'utf8')) },
      ...compareModel(reference, out),
      model: { frames: out.length - 1, won, death: death ? { reason: death.reason ?? String(death), frame: out.length - 1 } : null } };
  };
  const before = opt(args, '--options-before');
  const comparison = {
    variant: { landings, clock, vs: traceDir ? `trace:${relative(dirname(calib), traceDir)}` : 'phone', seed, night },
    reference: { officeUpdates: reference.length, ...(traceText ? { traceSha256: sha256(traceText) } : {}) },
    movedRows: moved.length,
    ...(before ? { before: run(resolve(before)) } : {}),
    after: run(optionsFile),
  };
  const inputs = { calibUpdates: sha256(updatesText), calibInput: sha256(inputText), planned: sha256(plannedText),
    winner: sha256(readFileSync(winnerFile, 'utf8')),
    ...(customNightFile ? { customNight: sha256(readFileSync(resolve(customNightFile), 'utf8')) } : {}) };
  const out_ = opt(args, '--record');
  // --append collects comparisons into one record; its id covers every comparison's inputs.
  const record = out_ && args.includes('--append') && existsSync(out_) ? JSON.parse(readFileSync(out_, 'utf8')) : {
    schema: 'recompile-calib-model-v1', step: 'ROADMAP S2', claimLevel: 'MODEL_ONLY',
    question: opt(args, '--question') ?? 'Does the model, on the winner\'s queue at the phone\'s landings (or as planned), with the phone\'s seed and clock, play the reference night draw for draw?',
    inputsSha256: inputs, comparisons: [],
  };
  record.comparisons.push(comparison);
  record.evidenceId = `calib-model-${sha256(JSON.stringify(record.comparisons.map(c => [c.variant, c.reference, c.after.modelOptions, c.before?.modelOptions ?? null]))).slice(0, 16)}`;
  if (out_) writeFileSync(out_, JSON.stringify(record, null, 1) + '\n');
  const brief = r => r && `${r.agree}/${r.compared} first ${r.firstDivergence?.update ?? '-'} ${r.model.won ? 'won' : 'dead'}`;
  console.log(JSON.stringify({ evidenceId: record.evidenceId, variant: comparison.variant, before: brief(comparison.before), after: brief(comparison.after) }));
}

function summary(args) {
  const out = opt(args, '--out') ?? fail('--out FILE');
  const hostBinary = opt(args, '--host-binary') ?? fail('--host-binary ID (the pinned harness binary)');
  const phoneApk = opt(args, '--phone-apk') ?? fail('--phone-apk SHA (the calibration build installed)');
  const runs = args.filter(a => /^[\w.-]+=/.test(a) && !a.startsWith('--')).map(a => {
    const [label, dir] = a.split(/=(.*)/s);
    const d = resolve(dir);
    const env = readFileSync(join(d, 'env'), 'utf8');
    const traceText = readFileSync(join(d, 'trace'), 'utf8');
    const variant = { seed: Number(env.match(/CHOWDREN_SEED=(\d+)/)?.[1]), phoneFrameTimes: /CHOWDREN_FRAME_TIMES=/.test(env),
      runInputSha256: sha256(readFileSync(join(d, 'run.input'), 'utf8')) };
    // A run compared with a phone night carries its record; a host experiment carries its outcome.
    const record = existsSync(join(d, 'record.json')) ? JSON.parse(readFileSync(join(d, 'record.json'), 'utf8')) : null;
    return { label, variant, outcome: outcome(traceText), ...(record ?? { evidenceId: `calib-run-${sha256(traceText).slice(0, 16)}` }) };
  });
  const deliveryArg = opt(args, '--delivery');
  let deliveryResult = null;
  if (deliveryArg) {
    const [calibDir, plannedFile] = deliveryArg.split(':');
    const { rows: office } = visit(rows(readFileSync(join(resolve(calibDir), 'calib-updates.jsonl'), 'utf8')), 3);
    deliveryResult = delivery(office, rows(readFileSync(join(resolve(calibDir), 'calib-input.jsonl'), 'utf8')),
      readFileSync(resolve(plannedFile), 'utf8'));
  }
  if (runs.length === 0) fail('name at least one LABEL=RUNDIR');
  const composed = {
    schema: 'recompile-calib-replay-summary-v1', step: 'ROADMAP S2', claimLevel: 'MODEL_ONLY',
    fidelity: 'rebuilt-runtime',
    question: 'Does the host harness, given only the phone\'s seed, per-update dt and polled input updates, reproduce a night the calibration build played on the phone, and does each of the three matter?',
    hostBinary, phoneApkSha256: phoneApk,
    ...(opt(args, '--question') ? { question: opt(args, '--question') } : {}),
    ...(deliveryResult ? { delivery: deliveryResult } : {}),
    runs,
  };
  composed.evidenceId = `calib-replay-summary-${sha256(runs.map(r => r.evidenceId).join(',')).slice(0, 16)}`;
  writeFileSync(out, JSON.stringify(composed, null, 1) + '\n');
  console.log(JSON.stringify({ evidenceId: composed.evidenceId, runs: runs.map(r => [r.label, r.outcome.officeUpdates, r.outcome.nextFrame,
    r.result ? `${r.result.agree}/${r.result.compared}` : '']) }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [cmd, ...args] = process.argv.slice(2);
  if (cmd === 'build') build(args);
  else if (cmd === 'compare') compareCmd(args);
  else if (cmd === 'summary') summary(args);
  else if (cmd === 'model') modelCmd(args);
  else fail('usage: build --calib DIR --run DIR | compare --calib DIR --run DIR [--record FILE] | summary --out FILE ...');
}
