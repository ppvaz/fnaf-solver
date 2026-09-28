#!/usr/bin/env node
/**
 * Who is playing sound on the phone before a night starts: every started
 * player in `dumpsys audio`'s PlaybackActivityMonitor, by uid and package.
 * A night that listens to the A2DP mix refuses when an app other than its
 * target game (or the Companion) holds a started player -- the mix is the
 * whole phone's, and on 2026-09-27 (n5c) org.fnaf2rebuild.play's title music,
 * left playing behind FNaF 4, raised the mix from -35 to -22 dBFS and the
 * detector heard neither Fredbear nor our own carpet runs all night.
 *
 *   tools/device/audio-players.mjs --target PACKAGE [--allow PACKAGE ...] [--serial SERIAL]
 *
 * Prints one JSON line; exits 0 READY, 3 REFUSED, 2 when the phone cannot be
 * read (UNKNOWN is not READY). Read-only: run it under the serial lease.
 */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export const COMPANION = 'com.ppvaz.fnafcompanion';
const FIRST_APP_UID = 10000;          // Android: uids below are the system's own

/** Started players of the `players:` list: [{ piid, uid, pid, type, usage }]. */
export function startedPlayers(dumpsysAudio) {
  const out = new Map();
  let inPlayers = false;
  for (const line of String(dumpsysAudio).split('\n')) {
    if (/^\s*players:\s*$/.test(line)) { inPlayers = true; continue; }
    if (inPlayers && /^\s*(ducked players|faded out players|muted|banned uids|current piid|Events log)/.test(line)) inPlayers = false;
    if (!inPlayers) continue;
    const m = line.match(/AudioPlaybackConfiguration piid:(\d+).*?type:(.*?) u\/pid:(\d+)\/(\d+) state:(\w+)(?:.*?usage=(\w+))?/);
    if (!m || m[5] !== 'started') continue;
    out.set(m[1], { piid: Number(m[1]), uid: Number(m[3]), pid: Number(m[4]), type: m[2].trim(), usage: m[6] ?? null });
  }
  return [...out.values()];
}

/** `pm list packages -U` -> Map(uid -> [package]). */
export function packagesByUid(pmList) {
  const map = new Map();
  for (const line of String(pmList).split('\n')) {
    const m = line.match(/^package:(\S+)\s+uid:(\d+)/);
    if (!m) continue;
    const uid = Number(m[2]);
    map.set(uid, [...(map.get(uid) ?? []), m[1]]);
  }
  return map;
}

/** The verdict over parsed players: an app (uid >= 10000) outside `allow` refuses. */
export function audioVerdict(players, byUid, allow) {
  const named = players.map((p) => ({ ...p, packages: byUid.get(p.uid) ?? [] }));
  const foreign = named.filter((p) => p.uid >= FIRST_APP_UID && !p.packages.some((pkg) => allow.includes(pkg)));
  if (!foreign.length) return { status: 'READY', started: named, foreign };
  const who = foreign.map((p) => `uid ${p.uid} ${p.packages.join('+') || 'UNKNOWN(package)'} (${p.type}, ${p.usage})`).join('; ');
  return { status: 'REFUSED', reason: `another app is playing into the mix: ${who}`, started: named, foreign };
}

/** Read the phone and decide. `adb` is injectable for tests. */
export function audioPreflight({ serial, target, allow = [], adb = (args) => execFileSync('adb', ['-s', serial, ...args], { encoding: 'utf8', timeout: 20000 }) }) {
  let dump; let pm;
  try {
    dump = adb(['shell', 'dumpsys', 'audio']);
    pm = adb(['shell', 'pm', 'list', 'packages', '-U']);
  } catch (e) {
    return { status: 'UNKNOWN', reason: `cannot read the phone's players: ${e.message}` };
  }
  if (!/PlaybackActivityMonitor/.test(dump)) return { status: 'UNKNOWN', reason: 'dumpsys audio carried no PlaybackActivityMonitor' };
  return audioVerdict(startedPlayers(dump), packagesByUid(pm), [target, COMPANION, ...allow]);
}

function main(argv) {
  let serial = process.env.FNAF_SERIAL ?? 'ZF525F5BH5'; let target = null; const allow = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--serial') serial = argv[++i];
    else if (argv[i] === '--target') target = argv[++i];
    else if (argv[i] === '--allow') allow.push(argv[++i]);
    else { console.error(`audio-players: unknown argument ${argv[i]}`); process.exit(2); }
  }
  if (!target) { console.error('audio-players: --target PACKAGE is required'); process.exit(2); }
  const v = audioPreflight({ serial, target, allow });
  console.log(JSON.stringify(v));
  process.exit(v.status === 'READY' ? 0 : v.status === 'REFUSED' ? 3 : 2);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main(process.argv.slice(2));
