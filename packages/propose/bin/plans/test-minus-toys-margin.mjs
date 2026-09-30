// Smoke gate for minus-toys-margin.mjs. It is a model analysis tool (no run to
// grade), so this pins that it runs, that the shipped schedule clears at zero
// shift, and the two facts the writeup rests on: the split-arming pair has
// ~one-Fusion-poll margin, and the whole-schedule phase margin is far under the
// strategy's own ~660 ms/cycle budget.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const out = execFileSync('node',
  [join(here, 'minus-toys-margin.mjs'), '--night=2', '--seeds=24', '--max=264'],
  { encoding: 'utf8' });

const check = (ok, msg) => { if (!ok) throw new Error(msg); };

check(/Minus Toys margin map/.test(out), 'the tool printed no header');
check(/WHOLE-SCHEDULE PHASE/.test(out), 'the tool printed no whole-schedule phase margin');

// Every reported edge is a number or ">=N"; the shipped schedule must clear at
// zero shift or the tool exits 1 before printing rows.
const rows = [...out.matchAll(/^\s+(opening|toys)\[\d+\].*early\s+(\S+)\s+late\s+(\S+)/gm)];
check(rows.length === 15, `expected 15 instruction rows, got ${rows.length}`);

// The CAM 09 -> monitor arming pair is the tightest thing in the schedule:
// one Fusion poll (33 ms) of slack. This is the geometry the device drag
// collapsed to 0 ms on n2-minustoys-0117.
const arming = rows.filter(m => /opening\[(2|3)\]/.test(m[0]));
check(arming.length === 2, 'could not find the arming-pair rows');
for (const m of arming)
  check(/^\d+$/.test(m[2]) && +m[2] <= 66,
    `arming row "${m[0].trim()}" reports ${m[2]} ms early margin; expected <= one or two Fusion polls`);

const phase = out.match(/WHOLE-SCHEDULE PHASE.*early\s+(\S+)\s+late\s+(\S+)/);
check(phase && /^\d+$/.test(phase[1]) && +phase[1] < 165,
  `whole-schedule phase early margin is ${phase && phase[1]}; the writeup says it is far under the 302 ms epoch bracket`);

console.log(`minus-toys-margin: 15 instruction margins mapped; arming pair ` +
  `${arming[0][2]}/${arming[1][2]} ms early, whole-schedule phase ${phase[1]}/${phase[2]} ms`);
