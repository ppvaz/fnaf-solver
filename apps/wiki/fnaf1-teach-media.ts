#!/usr/bin/env node
// Cut a FNaF 1 4/20 run's video into something to show: a README GIF and a phone-sized video.
//
//   node apps/wiki/fnaf1-teach-media.ts --run artifacts/runs/<id> --video FILE.mp4 --out DIR [--only gif|all]
//
// The run's own records place everything. The office's first frame is found in the video (the what_day
// card is black; the office is not), which puts the night's origin on the video's clock; the policy log
// then names a Bonnie visit -- a left check that shut the door and the reopen after his tick -- and that
// window becomes the GIF, the full frame on top and the teach panel enlarged 2x underneath, like the FNaF 2
// cycle GIF in the README.
//
// Outputs (never tracked unless a person chooses to): <out>/fnaf1-420-bonnie-visit.gif,
// <out>/fnaf1-420-whatsapp-4x.mp4 (the whole night at 4x) and <out>/fnaf1-420-whatsapp-highlights.mp4 (the
// visit and the 5 AM -> 6 AM end in real time). Ported from fnaf1-teach-media.py; it runs the same ffmpeg
// commands and prints what that printed.
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { isRecord } from '@sixam/kernel';
import { PyFloat, pyArgs, pyDumps, pyFixed, pyFloat, pyPath, pyRound, pySplit, pySplitLines } from '@sixam/kernel/py';

// The Companion's FNaF 1 panel, native pixels (Fnaf1Lesson.java).
const PANEL = [560, 110, 1340, 330];

class Exit extends Error {}

function run(cmd: readonly string[], capture = false): Buffer {
  const result = spawnSync(cmd[0], cmd.slice(1), { stdio: capture ? ['inherit', 'pipe', 'inherit'] : 'inherit', maxBuffer: 1 << 30 });
  if (result.status !== 0) throw new Exit(`Command '${cmd.join(' ')}' returned non-zero exit status ${result.status}.`);
  return result.stdout ?? Buffer.alloc(0);
}

function probeSize(video: string): [number, number] {
  const out = run(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', video], true)
    .toString('utf8').trim();
  const values = out.split(',').map(value => {
    if (!/^\s*[+-]?\d+(?:_\d+)*\s*$/.test(value)) throw new Exit(`invalid literal for int() with base 10: '${value}'`);
    return Number(value.replaceAll('_', ''));
  });
  if (values.length !== 2) throw new Exit(`expected 2 values to unpack (got ${values.length})`);
  return [values[0], values[1]];
}

/** Seconds into the video of the first bright office frame after the card. */
function officeOnset(video: string, limitS = 25.0): number {
  const w = 96, h = 44;
  const raw = run(['ffmpeg', '-v', 'error', '-t', pyFloatText(limitS), '-i', video, '-vf', `fps=20,scale=${w}:${h}`,
    '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], true);
  const size = w * h;
  const means: number[] = [];
  for (let i = 0; i + size <= raw.length; i += size) {
    let sum = 0;
    for (let k = i; k < i + size; k += 1) sum += raw[k];
    means.push(sum / size);
  }
  // The card and the load are near black; the office's first frame jumps.
  for (let i = 1; i < means.length; i += 1)
    if (means[i] > 18 && means[i - 1] < 12 && i / 20.0 > 2.0) return i / 20.0;
  throw new Exit(`fnaf1-teach-media: no office onset found in the first ${pyFixed(limitS, 0)} s`);
}

// str(float), which ffmpeg's -t received.
const pyFloatText = (x: number) => (Number.isInteger(x) ? `${x}.0` : String(x));

/** (start, end) night seconds of the first left check that shut the door, to its reopen. */
function bonnieVisit(events: readonly unknown[]): [number, number] {
  const logs: [number, string][] = [];
  for (const e of events) {
    if (!isRecord(e)) throw new Exit(`an event is not an object: ${JSON.stringify(e)}`);
    if (e.type === 'policy') {
      const m = e.m;
      if (typeof m !== 'string') throw new Exit(`a policy event's m is not text: ${JSON.stringify(m)}`);
      const first = pySplit(m)[0];
      if (first === undefined) throw new Exit('list index out of range');
      logs.push([float(first), m]);
    }
  }
  for (const [i, [t, m]] of logs.entries()) {
    if (!m.includes(' run check-left@')) continue;
    const shut = logs.slice(i + 1, i + 40).find(([u, n]) => n.includes('close-left') && u - t < 6)?.[0];
    if (shut === undefined) continue;
    const reopen = logs.slice(i + 1).find(([u, n]) => n.includes('reopen-left@') && u > shut)?.[0];
    if (reopen !== undefined && t > 40 && t < 500) return [t - 1.0, reopen + 2.5];
  }
  throw new Exit('fnaf1-teach-media: no Bonnie visit in the policy log');
}

// float() and round() as Python ran them: where Python raised, the run stops.
function float(text: string) {
  const value = pyFloat(text);
  if (value === null) throw new Exit(`could not convert string to float: '${text}'`);
  return value;
}
function whole(x: number) {
  const value = pyRound(x);
  if (value === null) throw new Exit(`cannot convert float ${x} to integer`);
  return value;
}

const megabytes = (path: string) => `${path} ${pyFixed(statSync(path).size / 1e6, 1)} MB`;
const round2 = (x: number) => new PyFloat(Number.isFinite(x) ? Number(pyFixed(x, 2)) : x);

interface Options { run: string, video: string, out: string, only: 'gif' | 'all' }

function parse(argv: readonly string[]): Options | number {
  const args = pyArgs(argv, 'fnaf1-teach-media.ts', [{ name: '--run', required: true }, { name: '--video', required: true },
    { name: '--out', required: true }, { name: '--only', choices: ['gif', 'all'] }]);
  if ('exit' in args) {
    (args.exit ? console.error : console.log)(args.text);
    return args.exit;
  }
  const text = (name: string) => String(args.options[name]);
  return { run: text('--run'), video: text('--video'), out: text('--out'), only: args.options['--only'] === 'gif' ? 'gif' : 'all' };
}

function main(argv: readonly string[]): number {
  const args = parse(argv);
  if (typeof args === 'number') return args;
  const video = pyPath(args.video);
  const out = pyPath(args.out);
  mkdirSync(out, { recursive: true });
  const events: unknown[] = pySplitLines(readFileSync(join(args.run, 'events.jsonl'), 'utf8')).map(line => JSON.parse(line));
  const probe: unknown = JSON.parse(readFileSync(join(args.run, 'probe.json'), 'utf8'));
  const night = isRecord(probe) ? probe.night : undefined;
  const offsetMs = isRecord(night) ? night.originOffsetMs : undefined;
  if (typeof offsetMs !== 'number') throw new Exit(`probe.json has no night.originOffsetMs: ${JSON.stringify(offsetMs)}`);
  const [w, h] = probeSize(video);
  const scale = w / 2400.0;
  const onset = officeOnset(video);
  const origin = onset + offsetMs / 1000.0;          // night 0 on the video's clock
  const [start, end] = bonnieVisit(events);
  console.log(pyDumps({ video, size: [w, h], officeOnsetS: new PyFloat(onset), visitNightS: [round2(start), round2(end)] }));

  const [x0, y0, x1, y1] = PANEL.map(v => whole(v * scale));
  const pw = x1 - x0, ph = y1 - y0;
  const gif = join(out, 'fnaf1-420-bonnie-visit.gif');
  const vf = `[0:v]split=2[a][b];[a]scale=960:-2[top];`
    + `[b]crop=${pw}:${ph}:${x0}:${y0},scale=960:-2:flags=neighbor[panel];`
    + '[top][panel]vstack,fps=8,split[s0][s1];[s0]palettegen=max_colors=96:stats_mode=diff[p];[s1][p]paletteuse=dither=bayer:bayer_scale=4';
  run(['ffmpeg', '-v', 'error', '-y', '-ss', pyFixed(origin + start, 2), '-t', pyFixed(end - start, 2), '-i', video, '-filter_complex', vf, gif]);

  if (args.only === 'gif') {
    console.log(megabytes(gif));
    return 0;
  }
  const full = join(out, 'fnaf1-420-whatsapp-4x.mp4');
  run(['ffmpeg', '-v', 'error', '-y', '-ss', pyFixed(Math.max(0, origin - 2), 2), '-t', '560', '-i', video,
    '-vf', 'setpts=PTS/4,fps=30,scale=1200:-2', '-an', '-c:v', 'libx264', '-preset', 'slow',
    '-crf', '30', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', full]);

  const hl = join(out, 'fnaf1-420-whatsapp-highlights.mp4');
  const parts: [number, number][] = [[origin - 1, 20], [origin + start, end - start], [origin + 520, 25]];
  let filters = parts.map(([a, d], i) => `[0:v]trim=start=${pyFixed(a, 2)}:duration=${pyFixed(d, 2)},setpts=PTS-STARTPTS,scale=1200:-2[v${i}];`).join('');
  filters += `${parts.map((_, i) => `[v${i}]`).join('')}concat=n=${parts.length}:v=1:a=0[v]`;
  run(['ffmpeg', '-v', 'error', '-y', '-i', video, '-filter_complex', filters, '-map', '[v]',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '27', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', hl]);
  for (const file of [gif, full, hl]) console.log(megabytes(file));
  return 0;
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (error) {
  if (!(error instanceof Exit)) throw error;
  console.error(error.message);
  process.exitCode = 1;
}
