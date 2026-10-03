#!/usr/bin/env node
/**
 * Read small native-resolution regions from the Companion's projection.
 *
 * This is the observation path that replaces full-display screencaps, the
 * 20x9 grid and every luma reducer: the helper copies the registered
 * rectangles' raw pixels out of each native frame, and this tool registers a
 * named set from a `native-regions-v1` model and reads it back.
 *
 *   native-regions.ts set     --model M.json --set night
 *   native-regions.ts latency --model M.json --set night [--count 200]
 *   native-regions.ts record  --model M.json --set night --seconds 20 --out FILE.jsonl
 *   native-regions.ts png     --model M.json --set night --out DIR
 *
 * `latency` reports the host round trip and the frame age at reply (helper
 * clock minus image time), which is the measured replacement for the
 * `renderLagMs`/`readMs` bands in fnaf1-device-timing. `record` keeps every
 * distinct frame's pixels with its image time on the host clock. `png` writes
 * one PNG per region, upscaled by its step, for a person to look at. A `record` row carries the frame's own
 * `imageNs` (the helper's image clock, the frame trace's `image_ns`) beside its host time.
 */
import { writeFileSync, mkdirSync, readFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { AdbCompanionPort } from '../../src/campaign/physical-ports.ts';
import { resolveSerial } from './local-profile.ts';
import { REGION_STALL_MS, RegionStream } from './night-kit.ts';

/** A registered rectangle of native display pixels, sampled every `step`. */
interface Rect { readonly x: number, readonly y: number, readonly width: number, readonly height: number, readonly step?: number }
type RegionChannel = ReturnType<AdbCompanionPort['openRegions']>;
/** What `record` needs of a channel. */
type RecordChannel = Pick<RegionChannel, 'read' | 'close'>;

function fail(message: string): never { console.error(`native-regions: ${message}`); process.exit(2); }

export function loadRegionSet(path: string, name: string) {
  const model = JSON.parse(readFileSync(path, 'utf8'));
  if (model.schema !== 'native-regions-v1') fail(`${path} is not native-regions-v1`);
  const set: Readonly<Record<string, Rect>> | undefined = model.sets?.[name];
  if (!set) fail(`${path} has no set ${name}`);
  return { model, set };
}

export async function registerSet(channel: Pick<RegionChannel, 'clear' | 'set'>, set: Readonly<Record<string, Rect>>) {
  await channel.clear();
  for (const [name, r] of Object.entries(set)) {
    await channel.set(name, { x: r.x, y: r.y, width: r.width, height: r.height, step: r.step });
  }
}

/** A minimal RGB PNG encoder, so a region can be looked at without a dependency. */
// A region read names its step; a caller without one passes the scale.
export function pngFromRegion(region: { readonly cols: number, readonly rows: number, readonly step?: number, readonly pixels: ArrayLike<number> },
  scale = region.step as number) {
  const width = region.cols * scale;
  const height = region.rows * scale;
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 3 + 1)] = 0;
    for (let x = 0; x < width; x += 1) {
      const rgb = region.pixels[Math.floor(y / scale) * region.cols + Math.floor(x / scale)];
      const at = y * (width * 3 + 1) + 1 + x * 3;
      raw[at] = (rgb >> 16) & 0xff; raw[at + 1] = (rgb >> 8) & 0xff; raw[at + 2] = rgb & 0xff;
    }
  }
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf: Buffer) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const sum = Buffer.alloc(4); sum.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, sum]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const quantile = (sorted: number[], q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];

/**
 * Open a region channel with `set` registered on it: through the port's cached endpoint, or with `fresh` on a new
 * port that rediscovers the helper's endpoint (a capture restart leaves the cached one gone).
 */
export function regionOpener(serial: string, set: Readonly<Record<string, Rect>>,
  { port = new AdbCompanionPort({ serial }), timeoutMs = 1500 }: { port?: AdbCompanionPort, timeoutMs?: number } = {}) {
  let current = port;
  return async (fresh: boolean) => {
    if (fresh) current = new AdbCompanionPort({ serial });
    const opened = current.openRegions({ timeoutMs });
    try { await registerSet(opened, set); } catch (error) { opened.close(); throw error; }
    return opened;
  };
}

/**
 * Record every distinct copied frame for `seconds`, appending one row per frame (its pixels as base64 0xRRGGBB words,
 * its image clock) and one row per reopen. `open(fresh)` registers the set on a channel and returns
 * `{opened, read}`; the channel reopens itself the ways RegionStream holds (night-kit.ts), and a reopen that fails
 * both ways throws.
 */
export async function recordFrames<C extends RecordChannel>({ open, seconds, append, now = () => performance.now(), stallMs = REGION_STALL_MS }:
  { open: (fresh: boolean) => Promise<{ opened: C }>, seconds: number, append: (row: object) => void, now?: () => number,
    stallMs?: number }) {
  const stream = new RegionStream((await open(false)).opened, async (fresh) => (await open(fresh)).opened, { now, stallMs });
  const until = now() + seconds * 1000;
  const done = () => now() >= until;
  let rows = 0;
  for (let next = await stream.next(done); next; next = await stream.next(done)) {
    if ('reopen' in next) { append(next.reopen); continue; }
    const r = next.frame;
    const regions = Object.fromEntries(Object.entries(r.regions).map(([k, v]) =>
      [k, { cols: v.cols, rows: v.rows, step: v.step, hex: Buffer.from(new Uint8Array(v.pixels.buffer)).toString('base64') }]));
    append({ seq: r.seq, imageNs: r.imageNs === null ? null : String(r.imageNs), imageHostMs: r.imageHostMs, rttMs: r.rttMs, regions });
    rows += 1;
  }
  return { rows, reopened: stream.reopened, channel: stream.channel };
}

async function main(argv: string[]) {
  const verb = argv[0];
  const opt = { model: null as string | null, set: 'night', count: 200, seconds: 10, out: null as string | null };
  for (let i = 1; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === '--model') opt.model = argv[++i];
    else if (flag === '--set') opt.set = argv[++i];
    else if (flag === '--count') opt.count = Number(argv[++i]);
    else if (flag === '--seconds') opt.seconds = Number(argv[++i]);
    else if (flag === '--out') opt.out = argv[++i];
    else fail(`unknown flag ${flag}`);
  }
  if (!['set', 'latency', 'record', 'png'].includes(verb)) fail('verb is set | latency | record | png');
  if (!opt.model) fail('--model is required');
  if (process.env.FNAF_LEASE_HELD !== '1' && process.env.FNAF1_LEASE_HELD !== '1') {
    fail('run under the serial lease (tools/device/lease.sh or the night wrapper)');
  }
  const { set } = loadRegionSet(opt.model, opt.set);
  let serial: string;
  try { ({ serial } = resolveSerial()); } catch (error) { fail((error as Error).message); }
  // A channel on this port reuses its cached endpoint. `fresh` rediscovers it, which a capture restart needs (the
  // stopped session's endpoint is gone) and which a long night can fail (its logcat line rotates out: 2026-10-01,
  // night7-k3-sr03 lost its recorder that way while merely waiting through the intro card).
  const openSet = regionOpener(serial, set);
  const open = async (fresh = false) => {
    const opened = await openSet(fresh);
    // The first read after registration is seq -1 until a frame is copied.
    let read = await opened.read();
    for (let i = 0; i < 50 && read.seq < 0; i += 1) read = await opened.read();
    return { opened, read };
  };
  let { opened: channel, read: first } = await open();
  try {
    // `record` waits instead: MediaProjection copies a frame only when the screen changes, and a night's intro card
    // is still for seconds (2026-10-01, night7-k3-sr02: the recorder started there and gave up within a second).
    if (first.seq < 0 && verb !== 'record') fail('no frame was copied after registration: is capture running and the display awake?');
    if (verb === 'set') { console.log(`registered ${Object.keys(set).length} regions; seq ${first.seq}`); return; }
    if (verb === 'png') {
      if (!opt.out) fail('--out DIR is required');
      mkdirSync(opt.out, { recursive: true });
      for (const [name, region] of Object.entries(first.regions)) {
        writeFileSync(join(opt.out, `${name}.png`), pngFromRegion(region));
      }
      console.log(`wrote ${Object.keys(first.regions).length} PNGs to ${opt.out} (seq ${first.seq})`);
      return;
    }
    if (verb === 'latency') {
      const rtt: number[] = []; const age: number[] = []; const seqs = new Set<number>();
      for (let i = 0; i < opt.count; i += 1) {
        const r = await channel.read();
        rtt.push(r.rttMs);
        // A read the helper answered names both clocks; one that did not throws here, as it did untyped.
        if ((r.imageNs as bigint) >= 0n) age.push(Number((r.snapshotNs as bigint) - (r.imageNs as bigint)) / 1e6);
        seqs.add(r.seq);
      }
      rtt.sort((a, b) => a - b); age.sort((a, b) => a - b);
      const row = (xs: number[]) => ({ p50: +quantile(xs, 0.5).toFixed(2), p95: +quantile(xs, 0.95).toFixed(2), max: +(xs.at(-1) as number).toFixed(2) });
      console.log(JSON.stringify({ reads: opt.count, distinctFrames: seqs.size, rttMs: row(rtt),
        frameAgeAtReplyMs: row(age), note: 'frame age = helper clock at reply minus image timestamp' }));
      return;
    }
    if (verb === 'record') {
      if (!opt.out) fail('--out FILE.jsonl is required');
      try { channel.close(); } catch { /* recordFrames opens its own channel */ }
      const out = opt.out;
      let done: { rows: number, reopened: number, channel: RegionChannel };
      try {
        done = await recordFrames({ open, seconds: opt.seconds, append: (row) => appendFileSync(out, `${JSON.stringify(row)}\n`) });
      } catch (error) { fail((error as Error).message); }
      channel = done.channel;
      console.log(`recorded ${done.rows} frames to ${opt.out} (${done.reopened} reopen(s) after ${REGION_STALL_MS} ms without a frame)`);
    }
  } finally {
    try { await channel.clear(); } catch { /* the helper drops regions with its session */ }
    channel.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2)).catch((error: Error) => fail(error.message));
}
