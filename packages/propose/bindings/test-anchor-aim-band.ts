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
// The effective epoch is derived once, in fact-register.ts (`effectiveEpoch`),
// by the check that hands an aim to the phone; this gate reads that verdict
// rather than deriving its own. Two derivations drifted before: the gate took
// the evidence's onset bias while the phone check took the register's, with 0
// when the register stated none, so an entry could pass here at -70 and run at
// 0. Now the register's terms are the ones checked, and evidence that states
// a different bias or latency is refused.
import { ANCHOR_AIMS, ANCHOR_AIM_MIN_MARGIN_MS, anchorAimFor, effectiveEpoch } from './fact-register.ts';

let failed = 0;
const fail = (message: string) => { failed += 1; process.stdout.write(`  FAIL ${message}\n`); };

let checked = 0;
const unstatedBias: string[] = [];
for (const [hash, entry] of Object.entries(ANCHOR_AIMS)) {
  // A refuted aim is kept for the record; its band claim is already known not
  // to survive the phone, so re-checking it proves nothing.
  if (entry.refuted) continue;
  const found = anchorAimFor(hash);
  checked += 1;
  if (!found.ok) {
    fail(`${hash} night ${entry.night}: ${found.reason}. An aim is not an epoch -- multiply out the onset ` +
      'bias and the input latency before trusting one.');
    continue;
  }
  const { minMs, maxMs, biasStated } = found.effective;
  if (!biasStated) unstatedBias.push(hash);
  process.stdout.write(`  ${hash} night ${entry.night}: aim ${entry.aimMs} -> effective [${minMs}, ${maxMs}] ` +
    `inside [${found.band.fromMs}, ${found.band.toMs}] (${(minMs - found.band.fromMs).toFixed(1)} ms low margin, ` +
    `${(found.band.toMs - maxMs).toFixed(1)} ms high; ${ANCHOR_AIM_MIN_MARGIN_MS} ms required)` +
    `${biasStated ? '' : ' -- NO ONSET BIAS STATED: checked at 0'}\n`);
}
if (!checked) fail('no live anchor aim was checked: a gate that reads nothing passes nothing');

// Planted: the derivation refuses evidence that disagrees with the terms the
// register runs, and multiplies out the ones it agrees with.
{
  const entry = ANCHOR_AIMS['fnv1a-37278c63'];
  const agreed = effectiveEpoch(entry, { onsetBiasMs: -70, latencyMs: { min: 47, max: 82 } });
  if (!agreed.ok || agreed.minMs !== 4847 || agreed.maxMs !== 4882)
    fail(`the worked example 4870 - 70 + [47, 82] did not derive [4847, 4882]: ${JSON.stringify(agreed)}`);
  if (effectiveEpoch(entry, { onsetBiasMs: -75 }).ok)
    fail('evidence measuring a -75 ms bias passed against a register running -70');
  if (effectiveEpoch(entry, { latencyMs: { min: 200, max: 285 } }).ok)
    fail('evidence stating another latency passed against the register');
  if (effectiveEpoch({ ...entry, onsetBiasMs: undefined }, { onsetBiasMs: -70 }).ok)
    fail('evidence measuring a bias passed against a register that runs none');
}

if (failed) {
  process.stdout.write(`\nanchor aim band: ${failed} finding(s)\n`);
  process.exit(1);
}
process.stdout.write(`\nanchor aim band: ${checked} live aim(s) land inside a confirmed winning band at the ` +
  `epoch the phone check derives` +
  (unstatedBias.length ? `; ${unstatedBias.join(', ')} state no onset bias and are checked at 0` : '') + '\n');
