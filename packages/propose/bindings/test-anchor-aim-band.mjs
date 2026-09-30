#!/usr/bin/env node
// An anchor aim must put the EFFECTIVE epoch inside a confirmed winning band.
//
// An aim is not an epoch. The executor releases the schedule at
// `latched onset + aimMs + k*periodMs`, the latched onset leads the frame-trace
// onset, and the game then acts an input latency later, so
//
//   effective = aimMs + k*periodMs + onsetBiasMs + inputLatency
//
// and only `effective` can be compared against the epochs a census scored.
// Nothing checked that. On 2026-09-20, reconstructing a lost Night 6 aim, I
// derived one from the band alone -- omitting the -70 ms onset bias entirely
// and using the monitor-up press-to-effect figure (200-285 ms) in place of the
// binding's own hall-lit input latency (47 ms, 1-82). Both errors are invisible
// to every existing gate: the aim is a number in a register and the band is a
// number in an evidence file, and no check multiplies them out.
//
// `night6-anchor-aim-h-20260913.json` has all three terms and is the worked
// example: 4870 - 70 + [47, 82] = [4847, 4882], inside [4766.67, 4916.67] with
// 80 ms to the low edge and 34 ms to the high one.
//
// This reads each ANCHOR_AIMS entry's own evidence record. An entry whose
// evidence carries the terms must land; one that does not is reported, because
// an aim nobody can re-derive is the shape the untracked-winner debt already
// has too much of.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ANCHOR_AIMS } from './fact-register.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');
let failed = 0;
const fail = message => { failed += 1; process.stdout.write(`  FAIL ${message}\n`); };

const bandsOf = record => (Array.isArray(record.winningBands) ? record.winningBands : [])
  .filter(b => Number.isFinite(b?.fromMs) && Number.isFinite(b?.toMs));

let checked = 0;
let unverifiable = 0;
for (const [hash, entry] of Object.entries(ANCHOR_AIMS)) {
  // A refuted aim is kept for the record and must not be run; its band claim is
  // already known not to survive the phone, so re-checking it proves nothing.
  if (entry.refuted) continue;
  if (typeof entry.evidence !== 'string') { unverifiable += 1; continue; }
  let record;
  try { record = JSON.parse(readFileSync(join(ROOT, entry.evidence), 'utf8')); }
  catch { fail(`${hash}: evidence ${entry.evidence} could not be read`); continue; }

  const bands = bandsOf(record);
  const latency = record.latencyMs ?? entry.latencyMs;
  const onsetBias = record.onsetBiasMs;
  if (!bands.length || !Number.isFinite(latency?.min) || !Number.isFinite(latency?.max) ||
      !Number.isFinite(onsetBias)) {
    process.stdout.write(`  unverifiable ${hash} (${entry.evidence}): needs winningBands, ` +
      'latencyMs{min,max} and onsetBiasMs to re-derive the effective epoch\n');
    unverifiable += 1;
    continue;
  }

  const period = entry.periodMs ?? record.periodMs;
  const wrap = value => ((value % period) + period) % period;
  const low = wrap(entry.aimMs + onsetBias + latency.min);
  const high = wrap(entry.aimMs + onsetBias + latency.max);
  checked += 1;
  // A wrapped interval that straddles 0 cannot be contained by one band.
  const inside = low <= high &&
    bands.some(b => low >= b.fromMs && high <= b.toMs);
  if (!inside) {
    fail(`${hash} night ${entry.night}: aim ${entry.aimMs} ms puts the effective epoch at ` +
      `[${low.toFixed(2)}, ${high.toFixed(2)}] ms, which is not inside any confirmed winning band ` +
      `(${bands.map(b => `[${b.fromMs}, ${b.toMs}]`).join(', ')}). effective = aim + onsetBias ` +
      `(${onsetBias}) + latency [${latency.min}, ${latency.max}].`);
    continue;
  }
  const band = bands.find(b => low >= b.fromMs && high <= b.toMs);
  process.stdout.write(`  ${hash} night ${entry.night}: aim ${entry.aimMs} -> effective ` +
    `[${low.toFixed(2)}, ${high.toFixed(2)}] inside [${band.fromMs}, ${band.toMs}] ` +
    `(${(low - band.fromMs).toFixed(1)} ms low margin, ${(band.toMs - high).toFixed(1)} ms high)\n`);
}

if (failed) {
  process.stdout.write(`\nanchor aim band: ${failed} aim(s) release outside their own confirmed ` +
    'band. An aim is not an epoch -- multiply out the onset bias and the input latency before ' +
    'trusting one.\n');
  process.exit(1);
}
process.stdout.write(`\nanchor aim band: ${checked} aim(s) land inside a confirmed winning band; ` +
  `${unverifiable} carry no re-derivable evidence\n`);
