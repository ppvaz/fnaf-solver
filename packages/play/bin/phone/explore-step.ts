#!/usr/bin/env node
/**
 * One bounded exploration step on the handset, observed through the Cue
 * Helper, for learning a game's controls before a route exists.
 *
 *   explore-step.ts --session NAME snap [--label L]
 *   explore-step.ts --session NAME tap X Y [--hold MS] [--label L]
 *   explore-step.ts --session NAME double X Y [--gap MS] [--label L]
 *   explore-step.ts --session NAME hold X Y [SNAP_AT_MS] --hold MS [--label L]
 *   explore-step.ts --session NAME launch PACKAGE/ACTIVITY
 *   explore-step.ts --session NAME stop PACKAGE
 *
 * Every step appends to artifacts/runs/<session>/events.jsonl and, unless it
 * is `launch`/`stop`, ends with a native SNAP from the helper saved under
 * ~/fnaf-apks/explore/<session>/ (frames never enter the repository). A
 * coordinate given here must have been read off an earlier native frame of
 * the same session: the tool records the frame each step followed, so a later
 * reader can check the point against it. Contacts are HID presses (160 ms by
 * default -- the measured contact that every game here takes); `--hold` is a
 * longer contact, e.g. a pan. Needs the serial lease, and every verb but
 * `snap` needs --confirm-live.
 */
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { AdbCompanionPort, AdbHidProcess } from '../../src/campaign/physical-ports.ts';
import { HidWireTransport } from '../../src/venues/phone/hid.ts';
import { captureRoot, resolveSerial } from './local-profile.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
let SERIAL: string;                 // FNAF_SERIAL, else the local profile: resolved under the lease below
const CONTACT_MS = 160;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function fail(m: string): never { console.error(`explore-step: ${m}`); process.exit(2); }

const argv = process.argv.slice(2);
let session = null as string | null; let label = null as string | null; let holdMs = CONTACT_MS; let gapMs = 120; let confirmLive = false;
const rest: string[] = [];
for (let i = 0; i < argv.length; i += 1) {
  if (argv[i] === '--session') session = argv[++i];
  else if (argv[i] === '--label') label = argv[++i];
  else if (argv[i] === '--hold') holdMs = Number(argv[++i]);
  else if (argv[i] === '--gap') gapMs = Number(argv[++i]);
  else if (argv[i] === '--confirm-live') confirmLive = true;
  else rest.push(argv[i]);
}
if (!session || !/^[a-z0-9][a-z0-9-]{0,60}$/.test(session)) fail('--session is lowercase letters, digits, hyphens');
if (process.env.FNAF_LEASE_HELD !== '1') fail('run under the serial lease');
try { SERIAL = resolveSerial().serial; } catch (error) { fail((error as Error).message); }
const [verb, ...args] = rest;
// Anything that touches the game -- a contact, a launch, a stop -- needs the
// operator's explicit --confirm-live on top of the lease; a snap only reads.
if (verb !== 'snap' && !confirmLive) fail(`${verb} touches the phone: pass --confirm-live`);
const outdir = join(ROOT, 'artifacts', 'runs', session);
const framedir = captureRoot('explore', session);
await mkdir(outdir, { recursive: true });
await mkdir(framedir, { recursive: true });
const event = async (type: string, fields: object) => appendFile(join(outdir, 'events.jsonl'),
  `${JSON.stringify({ atWallMs: Date.now(), type, ...fields })}\n`);
const coord = (v: string | undefined, max: number) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0 || n >= max) fail(`coordinate ${v} outside 0..${max - 1}`);
  return n;
};
if (!Number.isInteger(holdMs) || holdMs < 16 || holdMs > 5000) fail('--hold is 16..5000 ms');

async function snap(name: string | null) {
  const port = new AdbCompanionPort({ serial: SERIAL });
  const n = existsSync(join(outdir, 'events.jsonl'))
    ? (await readFile(join(outdir, 'events.jsonl'), 'utf8')).split('\n').filter(Boolean).length : 0;
  const file = join(framedir, `${String(n).padStart(4, '0')}-${name ?? 'snap'}.png`);
  const r = await port.snap(`ex${n}`, file);
  await event('snap', { file, imageNs: String(r.imageNs) });
  console.log(file);
}

async function withHid(fn: (hid: HidWireTransport) => Promise<void>) {
  const proc = new AdbHidProcess({ serial: SERIAL });
  const hid = new HidWireTransport({ write: (l) => proc.write(l), ready: () => proc.ready(), contactMs: CONTACT_MS });
  await hid.start();
  try { await fn(hid); } finally { try { await hid.abort(); } catch { /* released */ } await proc.close(); }
}

if (verb === 'snap') {
  await snap(label);
} else if (verb === 'tap' || verb === 'double') {
  const point = { x: coord(args[0], 2400), y: coord(args[1], 1080) };
  await withHid(async (hid) => {
    const at = performance.now();
    await hid.send({ command: { action: { kind: holdMs > CONTACT_MS ? 'hold' : 'press', durationMs: holdMs } }, point });
    if (verb === 'double') {
      await sleep(gapMs);
      await hid.send({ command: { action: { kind: 'press', durationMs: CONTACT_MS } }, point });
    }
    await event(verb, { point, holdMs, gapMs: verb === 'double' ? gapMs : null, hostMs: at });
  });
  await sleep(350);
  await snap(label ?? `${verb}-${point.x}-${point.y}`);
} else if (verb === 'hold') {
  // A held contact with a native SNAP taken while it is still down: the only
  // way to see what a hold-to-act control (a flashlight, a door) does.
  const point = { x: coord(args[0], 2400), y: coord(args[1], 1080) };
  const snapAtMs = Number(args[2] ?? Math.floor(holdMs / 2));
  if (!Number.isInteger(snapAtMs) || snapAtMs < 0 || snapAtMs >= holdMs) fail('hold X Y [SNAP_AT_MS < --hold]');
  await withHid(async (hid) => {
    const at = performance.now();
    await Promise.all([
      hid.send({ command: { action: { kind: 'hold', durationMs: holdMs } }, point }),
      sleep(snapAtMs).then(() => snap(label ?? `hold-${point.x}-${point.y}-at${snapAtMs}`)),
    ]);
    await event('hold', { point, holdMs, snapAtMs, hostMs: at });
  });
} else if (verb === 'launch') {
  if (!/^com\.scottgames\.[a-z0-9.]+\/\.[A-Za-z]+$/.test(args[0] ?? '')) fail('launch takes com.scottgames.<pkg>/.<Activity>');
  const out = execFileSync('adb', ['-s', SERIAL, 'shell', 'am', 'start', '-W', '-n', args[0]], { encoding: 'utf8' });
  await event('launch', { component: args[0], ok: /Status: ok/.test(out) });
  console.log(out.trim().split('\n').find((l) => l.startsWith('Status')) ?? out.trim());
} else if (verb === 'stop') {
  if (!/^com\.scottgames\.[a-z0-9.]+$/.test(args[0] ?? '')) fail('stop takes com.scottgames.<pkg>');
  execFileSync('adb', ['-s', SERIAL, 'shell', 'am', 'force-stop', args[0]]);
  await event('stop', { package: args[0] });
  console.log(`stopped ${args[0]}`);
} else {
  fail('verb is snap | tap | double | hold | launch | stop');
}
