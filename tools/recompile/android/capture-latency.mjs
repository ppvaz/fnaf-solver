#!/usr/bin/env node
// The Companion's capture latency, read off the calibration build's beacon.
//
// The calibration build (apply-calib-mod.py) draws each update's index as a
// 16-cell Gray code along the top of the frame and logs, on CLOCK_MONOTONIC,
// when that update's buffer swap returned. The Cue Helper copies registered
// rectangles out of every MediaProjection frame and reports each frame's
// image timestamp. This tool registers one row across the beacon's cell
// centres, decodes the update every captured frame shows, and joins it with
// the calibration log, so for each frame:
//   imageNs - ts(u)        capture latency after the swap that produced it
//   imageNs - ts(u + 1)    > 0 means the frame was already stale when stamped
// and, over the window, how many updates the capture never showed.
//
//   node capture-latency.mjs live --out DIR --seconds N --live   (under device-lock-exec.py)
//   node capture-latency.mjs grade --in DIR [--record FILE]
//
// DRY unless --live. The calibration build must be in front and the Cue
// Helper capturing (cue_setup). MODEL-free: every number is a device stamp.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { AdbCompanionPort } from '../../../packages/play/src/campaign/physical-ports.js';
import { resolveSerial } from '../../device/local-profile.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
export const SCHEMA = 'recompile-capture-latency-v1';
const PACKAGE = 'org.fnaf2practice.play';
// Cell b spans native x [150b, 150b + 150) and rows 0..10 (8 frame rows
// stretched to 11.25); sample row 5 at every cell centre, 75 + 150b, with a
// 50 px step (the helper allows at most 64): every third sample is a centre.
export const BEACON_REGION = Object.freeze({ x: 75, y: 5, width: 2251, height: 1, step: 50 });
const CENTRE_EVERY = 3;

function fail(message) { console.error(`capture-latency: ${message}`); process.exit(2); }
const opt = (args, name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const sha256 = text => createHash('sha256').update(text).digest('hex');

/** The update a beacon row shows, or null when any cell is not clearly black or white. */
export function decodeBeacon(pixels) {
  let gray = 0, margin = 255;
  for (let b = 0; b < 16; b++) {
    const rgb = pixels[b * CENTRE_EVERY];
    const luma = (((rgb >> 16) & 0xff) + ((rgb >> 8) & 0xff) + (rgb & 0xff)) / 3;
    margin = Math.min(margin, Math.abs(luma - 127.5));
    gray = (gray << 1) | (luma > 127.5 ? 1 : 0);
  }
  if (margin < 64) return { u16: null, margin };
  let u = gray;
  for (let s = gray >> 1; s; s >>= 1) u ^= s;
  return { u16: u, margin };
}

async function live(args) {
  if (!args.includes('--live')) fail('dry by default: add --live to read the phone');
  if (process.env.CUE_HELPER_LEASE_OWNER_PID === undefined) fail('run under tools/device/device-lock-exec.py SERIAL -- ...');
  const out = resolve(opt(args, '--out') ?? fail('--out DIR'));
  if (!relative(ROOT, out).startsWith('..')) fail('--out must be outside the repository');
  const seconds = Number(opt(args, '--seconds') ?? 20);
  if (!(seconds > 0 && seconds <= 120)) fail('--seconds must be in (0, 120]');
  mkdirSync(out, { recursive: true });
  const { serial } = resolveSerial();
  const adb = (a, timeout = 30000) => execFileSync('adb', ['-s', serial, ...a], { encoding: 'utf8', timeout, maxBuffer: 256 << 20 });
  const top = adb(['shell', 'dumpsys activity activities | grep -m1 topResumedActivity']);
  if (!top.includes(PACKAGE)) fail(`the calibration build is not in front: ${top.trim()}`);
  const port = new AdbCompanionPort({ serial });
  const channel = port.openRegions({ timeoutMs: 1500 });
  const frames = join(out, 'frames.jsonl');
  writeFileSync(frames, '');
  let reads = 0, distinct = 0;
  try {
    await channel.clear();
    await channel.set('beacon', BEACON_REGION);
    let last = -1;
    const until = performance.now() + seconds * 1000;
    while (performance.now() < until) {
      const r = await channel.read();
      reads++;
      if (r.seq < 0 || r.seq === last) continue;
      last = r.seq;
      distinct++;
      const { u16, margin } = decodeBeacon(r.regions.beacon.pixels);
      appendFileSync(frames, JSON.stringify({ seq: r.seq, imageNs: String(r.imageNs), snapshotNs: String(r.snapshotNs),
        rttMs: +r.rttMs.toFixed(3), u16, margin: +margin.toFixed(1) }) + '\n');
    }
  } finally {
    try { await channel.clear(); } catch { /* dropped with the session */ }
    channel.close();
  }
  // The calibration rows of the running session: everything after its header.
  const updates = adb(['exec-out', 'run-as', PACKAGE, 'sh', '-c',
    'tail -n +$(grep -n schema files/calib-updates.jsonl | tail -1 | cut -d: -f1) files/calib-updates.jsonl'], 120000);
  writeFileSync(join(out, 'calib-updates.jsonl'), updates);
  console.log(JSON.stringify({ reads, distinctFrames: distinct, seconds }));
}

function range(values) {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const q = f => s[Math.min(s.length - 1, Math.floor(f * (s.length - 1)))];
  return { n: s.length, min: +s[0].toFixed(3), p50: +q(0.5).toFixed(3), p90: +q(0.9).toFixed(3), max: +s.at(-1).toFixed(3) };
}

export function grade(framesText, updatesText) {
  const frames = framesText.split('\n').filter(Boolean).map(l => JSON.parse(l));
  const rows = [];
  for (const line of updatesText.split('\n')) {
    if (!line.startsWith('{"u"')) continue;
    try { rows.push(JSON.parse(line)); } catch { /* a row cut at the pull */ }
  }
  if (rows.length === 0) throw new Error('no calibration update rows');
  const byU = new Map(rows.map(r => [r.u, r]));
  const decoded = frames.filter(f => f.u16 !== null);
  const out = [];
  for (const f of decoded) {
    const img = Number(BigInt(f.imageNs));
    // The update whose low 16 bits match and whose swap is nearest before the image.
    const cands = rows.filter(r => (r.u & 0xffff) === f.u16 && r.ts > 0);
    if (cands.length === 0) continue;
    const r = cands.reduce((b, c) => (Math.abs(img - c.ts) < Math.abs(img - b.ts) ? c : b));
    const next = byU.get(r.u + 1);
    out.push({ seq: f.seq, u: r.u, afterSwapMs: (img - r.ts) / 1e6, afterEventsMs: (img - r.te) / 1e6,
      staleByMs: next && next.ts > 0 ? (img - next.ts) / 1e6 : null, replyAgeMs: (Number(BigInt(f.snapshotNs)) - img) / 1e6 });
  }
  const shown = new Set(out.map(o => o.u));
  const lo = Math.min(...out.map(o => o.u)), hi = Math.max(...out.map(o => o.u));
  const seqs = frames.map(f => f.seq).sort((a, b) => a - b);
  const seqSpan = seqs.at(-1) - seqs[0] + 1;
  return {
    capturedFrames: frames.length, decoded: decoded.length, undecodable: frames.length - decoded.length,
    joined: out.length,
    clock: out.length && Math.abs(out[0].afterSwapMs) < 1000 ? 'CLOCK_MONOTONIC (image stamps within 1 s of the swaps)' : 'UNKNOWN',
    afterSwapMs: range(out.map(o => o.afterSwapMs)),
    afterEventsMs: range(out.map(o => o.afterEventsMs)),
    staleFrames: out.filter(o => o.staleByMs !== null && o.staleByMs > 0).length,
    replyAgeMs: range(out.map(o => o.replyAgeMs)),
    updates: { span: hi - lo + 1, shown: shown.size, neverShown: hi - lo + 1 - shown.size },
    helperFrames: { seqSpan, read: frames.length, missedByReader: seqSpan - frames.length },
    rows: out,
  };
}

function gradeCmd(args) {
  const dir = resolve(opt(args, '--in') ?? fail('--in DIR'));
  const framesText = readFileSync(join(dir, 'frames.jsonl'), 'utf8');
  const updatesText = readFileSync(join(dir, 'calib-updates.jsonl'), 'utf8');
  const result = grade(framesText, updatesText);
  const inputs = { frames: sha256(framesText), calibUpdates: sha256(updatesText) };
  const record = {
    schema: SCHEMA, step: 'ROADMAP S4', claimLevel: 'DEVICE_MEASURED', fidelity: 'rebuilt-runtime display, Companion capture',
    evidenceId: `capture-latency-${sha256(JSON.stringify(inputs)).slice(0, 16)}`,
    question: 'How long after the game swaps a frame does the Cue Helper\'s MediaProjection image of it carry, and which updates does the capture never show?',
    instrument: { region: BEACON_REGION, beacon: '16-cell Gray code of the update index, top 8 frame rows (apply-calib-mod.py)' },
    inputsSha256: inputs,
    notClaimed: ['The retail runtime\'s own swap-to-display path; the capture side (SurfaceFlinger, MediaProjection, the helper) is the phone\'s.',
      'Photon time: the image timestamp is the compositor\'s, not the panel\'s.'],
    result,
  };
  const recordPath = opt(args, '--record');
  if (recordPath) writeFileSync(recordPath, JSON.stringify(record, null, 1) + '\n');
  const { rows, ...summary } = result;
  console.log(JSON.stringify({ evidenceId: record.evidenceId, ...summary }, null, 1));
  void rows;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [cmd, ...args] = process.argv.slice(2);
  if (cmd === 'live') await live(args);
  else if (cmd === 'grade') gradeCmd(args);
  else fail('usage: live --out DIR --seconds N --live | grade --in DIR [--record FILE]');
}
