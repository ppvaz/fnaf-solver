#!/usr/bin/env node
// Which AudioFlinger output thread carries a process's tracks? (content-free)
//
// Reads a saved `adb shell dumpsys media.audio_flinger` and prints, as one JSON object, every output
// thread (name, output flags, standby) that lists an active or fast track of the given pid, with the
// track rows' kind (fast track "F<n>" or normal) and sample rate. The rebuild's capture switch
// (debug.rebuild.audio_capture, android/audio_route.h) should move its track from the
// AUDIO_OUTPUT_FLAG_FAST thread to a PRIMARY or DEEP_BUFFER one. Ported from af-tracks.py; it prints
// what that printed.
//
//   node packages/review/bin/recompile/af-tracks.ts DUMPSYS.txt PID
import { readFileSync } from 'node:fs';
import { pyDumps } from '@sixam/kernel/py';

type Track = { kind: 'fast' | 'normal', slot: string | null, sampleRate: number };
type Thread = { thread: string, type: string, flags: string | null, standby: string | null, tracks: Track[] };

const [path, pid] = process.argv.slice(2);
if (path === undefined || pid === undefined) throw new Error('usage: af-tracks.ts DUMPSYS.txt PID');
// Read as Python's text mode did: any line ending becomes '\n' and each line keeps it, which the track
// row's closing \s may be.
const lines = readFileSync(path, 'utf8').replace(/\r\n?/g, '\n').match(/[^\n]*\n|[^\n]+$/g) ?? [];
const threads: Thread[] = [];
let cur: Thread | null = null;
for (const line of lines) {
  let m = /^Output thread (\S+), name (\S+), tid \d+, type \d+ \((\w+)\)/.exec(line);
  if (m) {
    cur = { thread: m[2], type: m[3], flags: null, standby: null, tracks: [] };
    threads.push(cur);
    continue;
  }
  if (line.startsWith('Input thread')) {
    cur = null;
    continue;
  }
  if (cur === null) continue;
  m = /^\s+AudioStreamOut: \S+ flags (\S+) \(([^)]*)\)/.exec(line);
  if (m) cur.flags = m[2];
  m = /^\s+Standby: (\w+)/.exec(line);
  if (m) cur.standby = m[1];
  // track rows: "    F1    17907    yes    6690/  10783 ..." (fast) or "          17907 ... 6690/ 10783"
  m = /^\s+(F\d+|\S*)\s+(\d+)\s+(yes|no)\s+(\d+)\/\s*(\d+)\s+[^\n]*?\s(\d{4,6})\s+(\d+)\s/.exec(line);
  if (m && m[4] === pid && !line.includes('removeTrack') && !line.includes('AT::'))
    cur.tracks.push({ kind: m[1].startsWith('F') ? 'fast' : 'normal', slot: m[1] || null, sampleRate: Number(m[6]) });
}
const outputs = threads.filter(t => t.tracks.length)
  .map(({ thread, type, flags, standby, tracks }) => ({ thread, type, flags, standby, tracks }));
console.log(pyDumps({ pid, outputs }, 1));
