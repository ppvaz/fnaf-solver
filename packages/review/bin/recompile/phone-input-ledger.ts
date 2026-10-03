#!/usr/bin/env node
// Per-cycle ledger of when the phone's own frames show each control acting, against the update the replayed contact
// acts on in a rebuild trace (ROADMAP S2b: did the replayed contacts register when the phone's did?).
//
// usage: phone-input-ledger.ts TRACE.tsv FIRST_ROW REBUILD_TRACE [--cycles N] [--period-ms 10000] [--json OUT]
//
// Phone side (fnaf2-frame-trace-v3): the office update clock is the retained reconstruction (update 0 = the first
// night frame, each later interval 1-3 updates under Fusion's catch-up), so every frame names the first update of the
// pass that drew it. Per cycle the first frame of: the bottom-control signature turning `monitor-up` and back to
// `office` (packages/adapters/src/button-strokes.js thresholds, 100 visible / 40 absent), the signature turning
// `mask-on` and back, the office view brightening by 3 or more grid-mean-luma over the previous office frames (the
// hall flash) and darkening again, and the window's right-eyehole occupant while the mask is on (grid cells rows 3-5,
// columns 11-18 of the 20x9 RGB grid: hue 230-285 Withered Bonnie, hue 20-50 at saturation >= 0.55 Withered Chica).
// Rebuild side: the first update of the same cycle where `viewing` > 0 / back to 0, the mask watch value != 0 / back
// to 0, `viewing hall light` > 0 / back to 0, and `in danger` > 0 with the `in office` overlap letter. A difference is
// phone update minus rebuild update; a display frame lags the update that drew it by an unmeasured one or two frames,
// so differences within about 2 updates are not registration differences. DEVICE_MEASURED frames against a
// MODEL_ONLY replay; nothing here is a phone claim about the game's rules.
//
// Ported from phone-input-ledger.py: it prints, writes and exits as that did.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PyFloat, type PyValue, pyAlign, pyArgs, pyDumps, pyFixed, pyFloat, pyInt, pyReadText, pyRound, pySplit, pyStrip } from '@sixam/kernel/py';

const FRAME_MS = 1000 / 60;
const [VISIBLE_MIN, ABSENT_MAX] = [100, 40];           // button-strokes.js
const [FLASH_LUMA_STEP, FLASH_BASELINE_FRAMES] = [3, 25];
const [OCCUPANT_MIN_CELLS, CELL_LUMA_MIN] = [10, 6];

/** SystemExit with a message: printed to stderr, exit 1. */
class Exit extends Error {}

/** int(text), its ValueError stopping the run. */
function int(text: string | undefined): number {
  const value = text === undefined ? null : pyInt(text);
  if (value === null) throw new RangeError(`invalid literal for int() with base 10: '${text}'`);
  return Number(value);
}
/** list[index] with Python's negative indices and its IndexError. */
function at<T>(list: readonly T[], index: number): T {
  if (index >= list.length || index < -list.length) throw new RangeError('list index out of range');
  return list[index < 0 ? list.length + index : index];
}
const round1 = (x: number) => new PyFloat(Number(pyFixed(x, 1)));
/** a % b as Python takes it of floats: the result has the divisor's sign. */
function pyMod(a: number, b: number) {
  const m = a % b;
  if (m === 0) return b < 0 ? -0 : 0;
  return (m < 0) !== (b < 0) ? m + b : m;
}
/** bisect.bisect_left. */
function bisectLeft(list: readonly number[], x: number) {
  let lo = 0, hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid] < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
/** open(path): strict UTF-8, universal newlines, a line at a time with its newline. */
const lines = (path: string) => pyReadText(readFileSync(path)).match(/[^\n]*\n|[^\n]+$/g) ?? [];

function readTrace(path: string): [string[], string[][]] {
  const all = lines(path);
  if (!(all[0] ?? '').startsWith('# schema=fnaf2-frame-trace-v')) throw new Exit('not a fnaf2 frame trace');
  const header = (all[1] ?? '').replace(/\n+$/, '').split('\t');
  return [header, all.slice(2).filter(line => pyStrip(line)).map(line => line.replace(/\n+$/, '').split('\t'))];
}

export function officeClock(imageNs: readonly bigint[], first: number): [number[], number[], number[]] {
  const deltas = [FRAME_MS], passStart = [0];
  for (let k = first + 1; k < imageNs.length; k += 1) {
    const dt = Number(imageNs[k] - imageNs[k - 1]) / 1e6;
    if (dt <= 0) throw new Exit(`frame trace not increasing at row ${k}`);
    passStart.push(deltas.length);
    const n = Math.max(1, Math.min(3, pyRound(dt / FRAME_MS) ?? 1));
    deltas.push(dt - (n - 1));
    for (let extra = 0; extra < n - 1; extra += 1) deltas.push(1.0);
  }
  const cum = [0.0];
  for (const d of deltas) cum.push(cum[cum.length - 1] + d);
  return [deltas, passStart, cum];
}

export function signature(maskDs: number, monitorDs: number): string | null {
  if (maskDs >= VISIBLE_MIN && monitorDs >= VISIBLE_MIN) return 'office';
  if (maskDs <= ABSENT_MAX && monitorDs >= VISIBLE_MIN) return 'monitor-up';
  if (maskDs >= VISIBLE_MIN && monitorDs <= ABSENT_MAX) return 'mask-on';
  return null;
}

/** colorsys.rgb_to_hsv. */
function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  const maxc = Math.max(r, g, b), minc = Math.min(r, g, b);
  const rangec = maxc - minc;
  if (minc === maxc) return [0.0, 0.0, maxc];
  const s = rangec / maxc;
  const [rc, gc, bc] = [(maxc - r) / rangec, (maxc - g) / rangec, (maxc - b) / rangec];
  const h = r === maxc ? bc - gc : g === maxc ? 2.0 + rc - bc : 4.0 + gc - rc;
  return [pyMod(h / 6.0, 1.0), s, maxc];
}

/** bytes.fromhex(text): a ValueError for anything but pairs of hex digits (spaces between pairs allowed). */
function fromHex(text: string): Uint8Array {
  const compact = text.replace(/(?<=^|[0-9a-fA-F]{2}) +/g, '');
  if (!/^(?:[0-9a-fA-F]{2})*$/.test(compact)) throw new RangeError('non-hexadecimal number found in fromhex() arg');
  return Uint8Array.from(compact.match(/../g) ?? [], pair => parseInt(pair, 16));
}

export function eyeholeLetter(gridHex: string): string | null {
  const b = fromHex(gridHex);
  let [R, G, B, n] = [0, 0, 0, 0];
  for (let r = 3; r < 6; r += 1) {
    for (let c = 11; c < 19; c += 1) {
      const cell = b.subarray((r * 20 + c) * 3, (r * 20 + c) * 3 + 3);
      if (cell.length !== 3) throw new RangeError(`not enough values to unpack (expected 3, got ${cell.length})`);
      const [rr, gg, bb] = cell;
      if (0.299 * rr + 0.587 * gg + 0.114 * bb >= CELL_LUMA_MIN) {
        R += rr;
        G += gg;
        B += bb;
        n += 1;
      }
    }
  }
  if (n < OCCUPANT_MIN_CELLS) return null;
  const [hue, s] = rgbToHsv(R / n / 255, G / n / 255, B / n / 255);
  const h = hue * 360;
  if (h >= 230 && h <= 285) return 'B';
  if (h >= 20 && h <= 50 && s >= 0.55) return 'C';
  return null;
}

function readRebuild(path: string, frame: number, untilUpdate: number) {
  const viewing = new Map<number, boolean>(), hall = new Map<number, boolean>(), danger = new Map<number, boolean>();
  const mask = new Map<number, number>(), occ = new Map<number, string | null>();
  let names: string[] | null = null;
  for (const line of lines(path)) {
    if (!line.startsWith('# ')) continue;
    const p = pySplit(line);
    const word = at(p, 1);
    if (word === 'overlaps') {
      const rest = line.replace(/\n+$/, '').slice('# overlaps '.length);
      const cut = rest.indexOf(':');
      if (cut < 0) throw new RangeError('list index out of range');
      names = rest.slice(cut + 1).split(',');
      continue;
    }
    if (p.length < 4 || p[2] !== String(frame) || !/^\p{Nd}+$/u.test(p[3])) continue;
    const u = int(p[3]);
    if (u > untilUpdate) break;
    const positive = (text: string) => text !== '-' && int(text) > 0;
    if (word === 'counter') {
      danger.set(u, positive(at(p, 5)));
      viewing.set(u, positive(at(p, 7)));
      hall.set(u, positive(at(p, 8)));
    } else if (word === 'overlap') {
      if (names === null) throw new TypeError("argument of type 'NoneType' is not iterable");
      const values = p.slice(4);
      let letter: string | null = null;
      for (const [name, value] of [['old bonnie', 'B'], ['old chica', 'C'], ['old freddy', 'F'], ['new freddy', 'f']] as const) {
        const index = names.indexOf(name);
        if (index >= 0 && at(values, index) === '1') {
          letter = value;
          break;
        }
      }
      occ.set(u, letter);
    } else if (word === 'watch') mask.set(u, int(at(p, 12)));
  }
  return { viewing, hall, danger, mask, occ };
}

const sha = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');

function main(argv: readonly string[]): number {
  const args = pyArgs(argv, 'phone-input-ledger.ts', [{ name: '--cycles', type: 'int' }, { name: '--period-ms', type: 'float' },
    { name: '--mask-window-ms', type: 'float' }, { name: '--frame', type: 'int' }, { name: '--json' }], [{ name: 'trace' }, { name: 'first' }, { name: 'rebuild' }]);
  if ('exit' in args) {
    (args.exit ? console.error : console.log)(args.text);
    return args.exit;
  }
  const option = (name: string) => { const value = args.options[name]; return typeof value === 'string' ? value : null; };
  const [tracePath, firstText, rebuildPath] = args.positionals;
  // first is type=int: argparse refuses a value int() refuses.
  if (pyInt(firstText) === null) {
    const text = `usage: phone-input-ledger.ts [-h] [--cycles CYCLES] [--period-ms PERIOD_MS] [--mask-window-ms MASK_WINDOW_MS] [--frame FRAME] [--json JSON] trace first rebuild`;
    console.error(`${text}\nphone-input-ledger.ts: error: argument first: invalid int value: '${firstText}'`);
    return 2;
  }
  const first = int(firstText);
  const cycles = int(option('--cycles') ?? '7'), periodMs = pyFloat(option('--period-ms') ?? '10000') ?? 10000;
  const maskWindowMs = pyFloat(option('--mask-window-ms') ?? '4270') ?? 4270, frame = int(option('--frame') ?? '3');
  try {
    const [header, rows] = readTrace(tracePath);
    const ix = new Map<string, number>();
    header.forEach((name, i) => ix.set(name, i));
    const column = (name: string) => {
      const index = ix.get(name);
      if (index === undefined) throw new RangeError(`KeyError: '${name}'`);
      return index;
    };
    const cell = (row: readonly string[], name: string) => at(row, column(name));
    const imageNs = rows.map(row => BigInt(int(cell(row, 'image_ns'))));
    const [, passStart, cum] = officeClock(imageNs, first);
    const origin = at(imageNs, first);
    const t = imageNs.map(ns => Number(ns - origin) / 1e6);
    const T = t.slice(first < 0 ? t.length + first : first);
    const sig = rows.map(row => signature(int(cell(row, 'mask_downstroke')), int(cell(row, 'monitor_downstroke'))));
    const mean = rows.map(row => int(cell(row, 'grid_mean_luma')));
    const until = Math.trunc(cycles * periodMs / FRAME_MS) + 400;
    const { viewing, hall, danger, mask, occ } = readRebuild(rebuildPath, frame, until);
    const flash = (k: number) => {
      if (sig[k] !== 'office') return false;
      const previous: number[] = [];
      for (let j = Math.max(first, k - FLASH_BASELINE_FRAMES); j < k; j += 1) if (sig[j] === 'office') previous.push(mean[j]);
      previous.sort((a, b) => a - b);
      return previous.length >= 8 && mean[k] >= previous[Math.floor(previous.length / 2)] + FLASH_LUMA_STEP;
    };
    const firstK = (pred: (k: number) => boolean, k0: number, k1: number) => {
      for (let k = k0; k < k1; k += 1) if (pred(k)) return k;
      return null;
    };
    const firstU = firstK;
    const pk = (k: number | null) => (k === null ? null : new Map<string, PyValue>([['row', BigInt(k)], ['update', BigInt(at(passStart, k - first))], ['ms', round1(at(t, k))]]));
    const pu = (u: number | null) => (u === null ? null : new Map<string, PyValue>([['update', BigInt(u)], ['ms', round1(at(cum, u))]]));
    const out: Map<string, PyValue>[] = [];
    for (let cyc = 0; cyc < cycles; cyc += 1) {
      const base = cyc * periodMs;
      const k0 = bisectLeft(T, base - 600) + first, k1 = bisectLeft(T, base + periodMs - 500) + first;
      const u0 = bisectLeft(cum, base - 600), u1 = bisectLeft(cum, base + periodMs - 500);
      const pUp = firstK(k => sig[k] === 'monitor-up', k0, k1);
      const pDown = pUp ? firstK(k => sig[k] === 'office', pUp, k1) : null;
      const pFlash = firstK(flash, k0, k1);
      const pFlashOff = pFlash ? firstK(k => !flash(k), pFlash, k1) : null;
      // the window's mask: the first mask-on signature at or after the cycle's window offset
      const kw = bisectLeft(T, base + maskWindowMs - 300) + first;
      const pMask = firstK(k => sig[k] === 'mask-on', kw, k1);
      const pMaskOff = pMask ? firstK(k => sig[k] === 'office', pMask, k1) : null;
      let pOcc: Map<string, PyValue> | null = null;
      if (pMask) {
        for (let k = pMask; k < Math.min(k1, pMask + 150); k += 1) {
          const letter = eyeholeLetter(cell(at(rows, k), 'grid_hex'));
          if (letter) {
            pOcc = new Map<string, PyValue>([['row', BigInt(k)], ['update', BigInt(at(passStart, k - first))], ['ms', round1(at(t, k))], ['letter', letter]]);
            break;
          }
        }
      }
      const rUp = firstU(u => viewing.get(u) ?? false, u0, u1);
      const rDown = rUp ? firstU(u => !(viewing.get(u) ?? true), rUp, u1) : null;
      const rFlash = firstU(u => hall.get(u) ?? false, u0, u1);
      const rFlashOff = rFlash ? firstU(u => !(hall.get(u) ?? true), rFlash, u1) : null;
      const uw = bisectLeft(cum, base + maskWindowMs - 300);
      const rMask = firstU(u => (mask.get(u) ?? 0) !== 0, uw, u1);
      const rMaskOff = rMask ? firstU(u => (mask.get(u) ?? 1) === 0, rMask, u1) : null;
      const rOcc = firstU(u => danger.get(u) ?? false, u0, u1);
      const diff = (k: number | null, u: number | null) => (k === null || u === null ? null : BigInt(at(passStart, k - first) - u));
      const events = new Map<string, PyValue>();
      for (const [name, k, u] of [['hallFlashOn', pFlash, rFlash], ['hallFlashOff', pFlashOff, rFlashOff], ['monitorUp', pUp, rUp],
        ['monitorDown', pDown, rDown], ['maskOn', pMask, rMask], ['maskOff', pMaskOff, rMaskOff]] as const) {
        events.set(name, new Map<string, PyValue>([['phone', pk(k)], ['rebuild', pu(u)], ['phoneMinusRebuildUpdates', diff(k, u)]]));
      }
      const rebuildOccupant = rOcc ? new Map<string, PyValue>([...(pu(rOcc) ?? new Map<string, PyValue>()), ['letter', occ.get(rOcc) ?? null]]) : null;
      out.push(new Map<string, PyValue>([['cycle', BigInt(cyc)], ['window', BigInt(cyc)], ['events', events],
        ['occupant', new Map<string, PyValue>([['phone', pOcc], ['rebuild', rebuildOccupant]])]]));
    }
    const record = new Map<string, PyValue>([
      ['schema', 'phone-input-ledger-v1'], ['claimLevel', 'DEVICE_MEASURED frames against a MODEL_ONLY replay'],
      ['inputs', new Map<string, PyValue>([['frameTrace', new Map<string, PyValue>([['path', tracePath], ['sha256', sha(tracePath)], ['first', BigInt(first)]])],
        ['rebuildTrace', new Map<string, PyValue>([['path', rebuildPath], ['sha256', sha(rebuildPath)]])]])],
      ['rule', new Map<string, PyValue>([['signatureThresholds', new Map<string, PyValue>([['visibleMin', BigInt(VISIBLE_MIN)], ['absentMax', BigInt(ABSENT_MAX)]])],
        ['flashLumaStep', BigInt(FLASH_LUMA_STEP)], ['eyeholeCells', 'rows 3-5, columns 11-18'], ['periodMs', new PyFloat(periodMs)],
        ['maskWindowMs', new PyFloat(maskWindowMs)], ['displayLagNote', 'a frame lags the update that drew it by an unmeasured 1-2 frames']])],
      ['cycles', out],
    ]);
    console.log(`${pyAlign('cyc', 3, '>')} ${pyAlign('event', 14)} ${pyAlign('phone upd', 10, '>')} ${pyAlign('rebuild upd', 12, '>')} ${pyAlign('diff', 6, '>')}`);
    for (const cycle of out) {
      const number = String(cycle.get('cycle'));
      const events = cycle.get('events');
      for (const [name, entry] of events instanceof Map ? events : []) {
        const read = (key: string) => (entry instanceof Map ? entry.get(key) : null);
        const phone = read('phone'), rebuild = read('rebuild'), d = read('phoneMinusRebuildUpdates');
        const p = phone instanceof Map ? String(phone.get('update')) : '-', r = rebuild instanceof Map ? String(rebuild.get('update')) : '-';
        const shown = typeof d === 'bigint' ? `${d >= 0n ? '+' : ''}${d}` : '';
        console.log(`${pyAlign(number, 3, '>')} ${pyAlign(name, 14)} ${pyAlign(p, 10, '>')} ${pyAlign(r, 12, '>')} ${pyAlign(shown, 6, '>')}`);
      }
      const occupant = cycle.get('occupant');
      const side = (key: string) => (occupant instanceof Map ? occupant.get(key) : null);
      const phone = side('phone'), rebuild = side('rebuild');
      const label = (value: PyValue | undefined) => (value instanceof Map ? `${String(value.get('letter') ?? 'None')}@${String(value.get('update'))}` : '-');
      console.log(`${pyAlign(number, 3, '>')} ${pyAlign('occupant', 14)} ${pyAlign(label(phone), 10, '>')} ${pyAlign(label(rebuild), 12, '>')}`);
    }
    const jsonPath = option('--json');
    if (jsonPath) writeFileSync(jsonPath, `${pyDumps(record, 1)}\n`);
    return 0;
  } catch (error) {
    if (error instanceof Exit) {
      console.error(error.message);
      return 1;
    }
    throw error;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
