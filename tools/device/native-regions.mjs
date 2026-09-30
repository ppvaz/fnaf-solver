#!/usr/bin/env node
/**
 * Read small native-resolution regions from the Companion's projection.
 *
 * This is the observation path that replaces full-display screencaps, the
 * 20x9 grid and every luma reducer: the helper copies the registered
 * rectangles' raw pixels out of each native frame, and this tool registers a
 * named set from a `native-regions-v1` model and reads it back.
 *
 *   native-regions.mjs set     --model M.json --set night
 *   native-regions.mjs latency --model M.json --set night [--count 200]
 *   native-regions.mjs record  --model M.json --set night --seconds 20 --out FILE.jsonl
 *   native-regions.mjs png     --model M.json --set night --out DIR
 *
 * `latency` reports the host round trip and the frame age at reply (helper
 * clock minus image time), which is the measured replacement for the
 * `renderLagMs`/`readMs` bands in fnaf1-device-timing. `record` keeps every
 * distinct frame's pixels with its image time on the host clock. `png` writes
 * one PNG per region, upscaled by its step, for a person to look at.
 */
import { writeFileSync, mkdirSync, readFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { AdbCompanionPort } from '../../packages/play/src/campaign/physical-ports.js';
import { resolveSerial } from './local-profile.mjs';

function fail(message) { console.error(`native-regions: ${message}`); process.exit(2); }

export function loadRegionSet(path, name) {
  const model = JSON.parse(readFileSync(path, 'utf8'));
  if (model.schema !== 'native-regions-v1') fail(`${path} is not native-regions-v1`);
  const set = model.sets?.[name];
  if (!set) fail(`${path} has no set ${name}`);
  return { model, set };
}

export async function registerSet(channel, set) {
  await channel.clear();
  for (const [name, r] of Object.entries(set)) {
    await channel.set(name, { x: r.x, y: r.y, width: r.width, height: r.height, step: r.step });
  }
}

/** A minimal RGB PNG encoder, so a region can be looked at without a dependency. */
export function pngFromRegion(region, scale = region.step) {
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
  const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => {
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

const quantile = (sorted, q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];

async function main(argv) {
  const verb = argv[0];
  const opt = { model: null, set: 'night', count: 200, seconds: 10, out: null };
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
  let serial;
  try { ({ serial } = resolveSerial()); } catch (error) { fail(error.message); }
  const port = new AdbCompanionPort({ serial });
  const channel = port.openRegions({ timeoutMs: 1500 });
  try {
    await registerSet(channel, set);
    // The first read after registration is seq -1 until a frame is copied.
    let first = await channel.read();
    for (let i = 0; i < 50 && first.seq < 0; i += 1) first = await channel.read();
    if (first.seq < 0) fail('no frame was copied after registration: is capture running and the display awake?');
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
      const rtt = []; const age = []; const seqs = new Set();
      for (let i = 0; i < opt.count; i += 1) {
        const r = await channel.read();
        rtt.push(r.rttMs);
        if (r.imageNs >= 0n) age.push(Number(r.snapshotNs - r.imageNs) / 1e6);
        seqs.add(r.seq);
      }
      rtt.sort((a, b) => a - b); age.sort((a, b) => a - b);
      const row = (xs) => ({ p50: +quantile(xs, 0.5).toFixed(2), p95: +quantile(xs, 0.95).toFixed(2), max: +xs.at(-1).toFixed(2) });
      console.log(JSON.stringify({ reads: opt.count, distinctFrames: seqs.size, rttMs: row(rtt),
        frameAgeAtReplyMs: row(age), note: 'frame age = helper clock at reply minus image timestamp' }));
      return;
    }
    if (verb === 'record') {
      if (!opt.out) fail('--out FILE.jsonl is required');
      const until = performance.now() + opt.seconds * 1000;
      let last = -1; let rows = 0;
      while (performance.now() < until) {
        const r = await channel.read();
        if (r.seq === last) continue;
        last = r.seq;
        const regions = Object.fromEntries(Object.entries(r.regions).map(([k, v]) =>
          [k, { cols: v.cols, rows: v.rows, step: v.step, hex: Buffer.from(new Uint8Array(v.pixels.buffer)).toString('base64') }]));
        appendFileSync(opt.out, `${JSON.stringify({ seq: r.seq, imageHostMs: r.imageHostMs, rttMs: r.rttMs, regions })}\n`);
        rows += 1;
      }
      console.log(`recorded ${rows} frames to ${opt.out}`);
    }
  } finally {
    try { await channel.clear(); } catch { /* the helper drops regions with its session */ }
    channel.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2)).catch((error) => fail(error.message));
}
