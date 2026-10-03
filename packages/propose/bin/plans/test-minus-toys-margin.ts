// Smoke gate for minus-toys-margin.ts. It is a model analysis tool (no run to
// grade), so this pins that it runs, that the shipped schedule clears at zero
// shift, and the two facts the writeup rests on: the split-arming pair has
// ~one-Fusion-poll margin, and the whole-schedule phase margin is far under the
// strategy's own ~660 ms/cycle budget.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { OPENING, LOOP } from './minus-toys-plan.ts';

const here = dirname(fileURLToPath(import.meta.url));
const out = execFileSync('node',
  [join(here, 'minus-toys-margin.ts'), '--night=2', '--seeds=24', '--max=264'],
  { encoding: 'utf8' });

const check: (ok: unknown, msg: string) => asserts ok = (ok, msg) => { if (!ok) throw new Error(msg); };

check(/Minus Toys margin map/.test(out), 'the tool printed no header');
check(/WHOLE-SCHEDULE PHASE/.test(out), 'the tool printed no whole-schedule phase margin');

// Every reported edge is a number, ">=N" or "N|banded@M"; the shipped schedule must clear at
// zero shift or the tool exits 1 before printing rows.
const rows = [...out.matchAll(/^\s+(opening|toys)\[\d+\].*early\s+(\S+)\s+late\s+(\S+)/gm)];
check(rows.length === OPENING.length + LOOP.length, `expected ${OPENING.length + LOOP.length} instruction rows, got ${rows.length}`);

// The CAM 09 -> monitor arming pair is the tightest thing in the schedule:
// one Fusion poll (33 ms) of slack. This is the geometry the device drag
// collapsed to 0 ms on n2-minustoys-0117. The pin is the writeup's band, one
// to two polls, both ways: no slack contradicts it as much as more does.
const arming = rows.filter(m => /opening\[(2|3)\]/.test(m[0]));
check(arming.length === 2, 'could not find the arming-pair rows');
for (const m of arming)
  check(/^\d+$/.test(m[2]) && +m[2] >= 33 && +m[2] <= 66,
    `arming row "${m[0].trim()}" reports ${m[2]} ms early margin; the writeup says one or two Fusion polls (33-66 ms)`);

// The whole-schedule phase response is banded (it clears again past its first
// failure), so its first edge is reported with the band, never as the budget
// (basin-edge.ts, mistake register item 11). That edge is still far under the
// 302 ms epoch bracket.
const phase = out.match(/WHOLE-SCHEDULE PHASE.*early\s+(\S+)\s+late\s+(\S+)/);
check(phase && /^\d+(\|banded@\d+)?$/.test(phase[1]) && parseInt(phase[1], 10) < 165,
  `whole-schedule phase early margin is ${phase && phase[1]}; the writeup says it is far under the 302 ms epoch bracket`);

console.log(`minus-toys-margin: ${rows.length} instruction margins mapped; arming pair ` +
  `${arming[0][2]}/${arming[1][2]} ms early, whole-schedule phase ${phase[1]}/${phase[2]} ms`);
