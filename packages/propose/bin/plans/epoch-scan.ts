#!/usr/bin/env node
// Score a minus-toys winner's knobs over a range of release epochs.
//
//   node packages/propose/bin/plans/epoch-scan.ts --winner W.json --night 6 [--from 0] [--to 10000] [--step 100]
//        [--seeds 100] [--knobs '{"maskOffMs":8960}'] [--epochs 4850,4816.67] [--json OUT]
//
// The Night 6 work of 2026-09-13 was done with this loop by hand: the winning
// bands on Withered Foxy's five-second roll grid, the 50 ms split-arming
// holes, the band's edges to the frame, and the 3000-seed confirmations an
// anchor aim needs (fact-register ANCHOR_AIMS). It replays the winner's
// schedule at each epoch (packages/propose/bin/plans/minus-toys-plan.ts replay) and prints
// wins and killers per row; `--epochs` scores exact epochs (use 3000 seeds
// there, the golden rule); `--step 16.67` walks one frame at a time.
// `--knobs` overrides winner knobs for a what-if without editing the winner.
// MODEL_ONLY: a row says what the model thinks, never what the phone does.
import { readFileSync, writeFileSync } from 'node:fs';
import { replay, KNOBS0 } from './minus-toys-plan.ts';

function arg(name: string): string | undefined;
function arg(name: string, fallback: string | number): string | number;
function arg(name: string, fallback?: string | number) { const i = process.argv.indexOf(`--${name}`); return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : fallback; }
const winnerPath = arg('winner');
if (!winnerPath || process.argv.includes('--help')) {
  console.error('usage: epoch-scan.ts --winner W.json --night N [--from MS] [--to MS] [--step MS] [--seeds N] [--knobs JSON] [--epochs a,b,c] [--json OUT]');
  process.exit(process.argv.includes('--help') ? 0 : 2);
}
const winner = JSON.parse(readFileSync(winnerPath, 'utf8'));
if (winner.strategy !== 'minus-toys') { console.error('epoch-scan covers minus-toys only'); process.exit(2); }
const night = Number(arg('night', winner.nights?.[0] ?? 6));
const seeds = Number(arg('seeds', 100));
const knobs = { ...(typeof winner.knobs === 'string' ? KNOBS0 : winner.knobs), ...JSON.parse(String(arg('knobs', '{}'))) };
const listed = arg('epochs');
const epochs = listed ? listed.split(',').map(Number)
  : (() => { const out: number[] = []; for (let ms = Number(arg('from', 0)); ms < Number(arg('to', 10000)); ms += Number(arg('step', 100))) out.push(+ms.toFixed(2)); return out; })();
const rows: { epochMs: number, seeds: number, wins: number, deaths: Record<string, number> }[] = [];
for (const epochMs of epochs) {
  let wins = 0; const deaths: Record<string, number> = {};
  for (let seed = 1; seed <= seeds; seed++) {
    const { sim } = replay({ night, seed, epochMs, knobs });
    if (sim.won) wins++; else { const r = sim.death?.reason ?? 'unknown'; deaths[r] = (deaths[r] ?? 0) + 1; }
  }
  rows.push({ epochMs, seeds, wins, deaths });
  console.log(`epoch ${String(epochMs).padStart(8)}: ${String(wins).padStart(4)}/${seeds} ${JSON.stringify(deaths)}`);
}
const jsonOut = arg('json');
if (jsonOut) writeFileSync(jsonOut, JSON.stringify({ schema: 'epoch-scan-v1', winner: winnerPath, night, knobs, rows }, null, 1) + '\n');
