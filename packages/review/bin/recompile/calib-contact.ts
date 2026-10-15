#!/usr/bin/env node
// Read-only landing ledger for one external primary-pointer contact in the
// first office visit of a research calibration log. No phone or model imports.
//   calib-contact.ts --calib DIR --out FILE [--claim-level DEVICE_MEASURED|FIXTURE]
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isRecord } from '@sixam/kernel';

interface Update { u: number; f: number; fu: number; m: number; tp: number; te: number }
interface Event { src: string; k: string; t: number; sdl_ms: number; u: number; x: number; y: number }
interface State { update: number; elapsed_ms: number; office: { camera: number } }

const integer = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;
const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

export function readRows(text: string): { rows: unknown[]; ignoredPartialTail: boolean } {
  const lines = text.split('\n');
  const rows: unknown[] = [];
  let ignoredPartialTail = false;
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    try { const value: unknown = JSON.parse(lines[i]); rows.push(value); }
    catch {
      if (i !== lines.length - 1) throw new Error(`invalid JSON at line ${i + 1}`);
      ignoredPartialTail = true;
    }
  }
  return { rows, ignoredPartialTail };
}

function update(value: unknown): Update {
  if (!isRecord(value) || ![value.u, value.f, value.fu, value.tp, value.te].every(integer) ||
      !(value.m === 0 || value.m === 1)) throw new Error('invalid calibration update');
  return value as unknown as Update;
}
function event(value: unknown): Event {
  if (!isRecord(value) || value.src !== 'sdl' || !(value.k === 'mdown' || value.k === 'mup') ||
      ![value.t, value.sdl_ms, value.u].every(integer) || !finite(value.x) || !finite(value.y))
    throw new Error('invalid SDL mouse event');
  return value as unknown as Event;
}
function state(value: unknown): State {
  if (!isRecord(value) || !integer(value.update) || !integer(value.elapsed_ms) ||
      !isRecord(value.office) || !finite(value.office.camera)) throw new Error('invalid practice state');
  return value as unknown as State;
}

function firstOffice(values: readonly unknown[]): Update[] {
  let rows: Update[] = [], started = false, ended = false;
  for (const value of values) {
    if (!isRecord(value)) throw new Error('calibration row must be an object');
    if (isRecord(value.session)) { rows = []; started = false; ended = false; continue; }
    if (!('fu' in value)) continue;
    const row = update(value);
    if (row.f !== 3) { if (started) ended = true; continue; }
    if (!ended) { rows.push(row); started = true; }
  }
  return rows;
}

export function contactLedger(updates: readonly unknown[], inputs: readonly unknown[], states: readonly unknown[]) {
  const office = firstOffice(updates);
  const unknown = (reason: string) => ({ status: 'UNKNOWN' as const, reason });
  if (office.length < 2 || office[0].fu !== 1 || office[0].m !== 0)
    return unknown('missing first-office released-button baseline');
  if (office.some((r, i) => r.fu !== i + 1 || (i > 0 &&
      (r.u !== office[i - 1].u + 1 || r.tp <= office[i - 1].tp)) || r.te < r.tp))
    return unknown('office update coverage or timestamp ordering is incomplete');
  const edges = office.filter((r, i) => i > 0 && r.m !== office[i - 1].m);
  if (edges.length !== 2 || edges[0].m !== 1 || edges[1].m !== 0)
    return unknown('expected exactly one polled press/release pair');
  if (inputs.some(v => isRecord(v) && v.src === 'mt' && integer(v.u) &&
      v.u >= office[0].u && v.u <= office[office.length - 1].u))
    return unknown('multitouch observations require a different contact protocol');
  const mouse = inputs.filter(v => isRecord(v) && v.src === 'sdl' && (v.k === 'mdown' || v.k === 'mup'))
    .map(event).filter(e => e.t >= office[0].tp && e.t <= office[office.length - 1].te);
  if (mouse.length !== 2 || mouse[0].k !== 'mdown' || mouse[1].k !== 'mup' || mouse[1].t <= mouse[0].t)
    return unknown('missing or ambiguous SDL press/release pair');
  if (mouse.some((e, i) => e.t > edges[i].tp || e.t <= office[edges[i].fu - 2].tp))
    return unknown('SDL receipt does not bracket the observed poll transition');
  const observed = states.map(state).filter(s => s.update <= office.length);
  if (!observed.length || observed[0].update !== 1 || observed.some((s, i) => s.office.camera < 0 ||
      (i > 0 && (s.update !== observed[i - 1].update + 1 || s.elapsed_ms < observed[i - 1].elapsed_ms))))
    return unknown('practice-state coverage or camera observation is incomplete');
  const baseline = observed.find(s => s.update === edges[0].fu - 1);
  const effect = observed.find(s => s.update >= edges[0].fu && s.office.camera > 0);
  if (!baseline || baseline.office.camera !== 0 || !effect || effect.elapsed_ms < mouse[0].sdl_ms)
    return unknown('monitor-raise effect was not observed from a camera-down baseline');
  return {
    status: 'MEASURED' as const,
    scope: 'one primary-pointer monitor raise; research runtime; first office visit',
    officeUpdates: office.length,
    edges: edges.map((r, i) => ({ edge: r.m ? 'down' : 'up', officeUpdate: r.fu, harnessTick: r.fu - 1,
      globalUpdate: r.u, receiptReportedUpdate: mouse[i].u, sdlReceiptMonoNs: mouse[i].t,
      pollEndMonoNs: r.tp, eventsEndMonoNs: r.te, nativePoint: { x: mouse[i].x, y: mouse[i].y },
      receiptToPollMs: (r.tp - mouse[i].t) / 1e6, receiptToEventsEndMs: (r.te - mouse[i].t) / 1e6 })),
    heldUpdates: edges[1].fu - edges[0].fu,
    effect: { stateUpdate: effect.update, camera: effect.office.camera,
      updatesAfterPress: effect.update - edges[0].fu, sdlEventToStateMs: effect.elapsed_ms - mouse[0].sdl_ms },
    hostToDeviceLatency: 'UNKNOWN',
    requestedUpdateAccuracy: 'NOT_TESTED',
  };
}

function main(argv: readonly string[]): number {
  if (!(argv.length === 4 || (argv.length === 6 && argv[4] === '--claim-level' &&
      (argv[5] === 'DEVICE_MEASURED' || argv[5] === 'FIXTURE'))) || argv[0] !== '--calib' || argv[2] !== '--out') {
    console.error('Usage: calib-contact.ts --calib DIR --out FILE [--claim-level DEVICE_MEASURED|FIXTURE]'); return 2;
  }
  try {
    const paths = ['calib-updates.jsonl', 'calib-input.jsonl', 'practice-state.jsonl'].map(p => join(argv[1], p));
    const text = paths.map(p => readFileSync(p, 'utf8'));
    const parsed = text.map(readRows);
    const result = contactLedger(parsed[0].rows, parsed[1].rows, parsed[2].rows);
    const body = { schema: 'research-calib-contact-v1', step: 'M3/S2', claimLevel: argv[5] ?? 'FIXTURE',
      inputs: paths.map((path, i) => ({ path, sha256: createHash('sha256').update(text[i]).digest('hex'),
        ignoredPartialTail: parsed[i].ignoredPartialTail })), result };
    const id = 'calib-contact-' + createHash('sha256').update(JSON.stringify(body)).digest('hex').slice(0, 16);
    writeFileSync(argv[3], JSON.stringify({ ...body, id }, null, 2) + '\n');
    console.log(`${id}: ${result.status}`);
    return result.status === 'MEASURED' ? 0 : 3;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error)); return 2;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
