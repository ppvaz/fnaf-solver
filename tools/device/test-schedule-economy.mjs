#!/usr/bin/env node
// A schedule must not answer an empty building, and its hands-off claim must be
// derivable rather than asserted.
//
// Two ends of a night, both of which were prose until 2026-09-19:
//
// PREFIX. `idleUntilMs` returns the EARLIER of "the box drains" and "a threat
// can act". That is the right answer to "when must the pilot be awake at all"
// and the wrong answer to "when must the full cycle start", and the two
// coincide only on Night 1. From Night 2 up the box drains from hour 0, so
// `idleUntilMs` collapses to 0 and the emitted plan opens its full cycle at
// t=0 -- against a roster that `aiUpdates(night, 0)` says is empty. On the
// shipped Night 2 minus-toys plan that is 53 contacts in the first in-game
// hour, 7 of them wind and 46 answering nobody: 14 mask presses, 7 held
// camera-light flashes charged to a finite flashlight budget, 7 hall pulses
// for a Foxy who arms an hour later. Each is also a press the phone can lose.
//
// SUFFIX. `minStopAtMs = 360000` carries the comment "~5:08 AM: no route can
// reach the office before 6". Nothing derived it and nothing checked it. The
// box half of that claim IS derivable -- BOX_UNITS at BOX_DRAIN_PER_TICK per
// BOX_DRAIN_TICK_MS -- so this refuses a minimal schedule that stops winding
// later than a full box can survive. The animatronic half stays
// UNKNOWN(not-derived): after the box empties the Puppet still has
// PUPPET_ESCAPE_STAGES stages and a five-position route, and Foxy, Balloon Boy
// and the Withereds have their own last-moment that nothing here computes.
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boxSafeStopMs, threatIdleUntilMs } from '../../packages/propose/bin/plans/recipe.mjs';
import { KNOBS0 as TOYS_KNOBS } from '../../packages/propose/bin/plans/minus-toys-plan.mjs';
import { parsePlan, validateWinner, STRATEGY_REGISTRY } from '../../packages/propose/bin/plans/bundle.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
let failed = 0;
const fail = message => { failed += 1; process.stdout.write(`  FAIL ${message}\n`); };

// --- 1. the minimal suffix claim must sit inside the derived box bound -------
{
  const stopAt = TOYS_KNOBS.minStopAtMs;
  for (const night of [1, 2, 3, 4, 5, 6, 7]) {
    const bound = boxSafeStopMs(night);
    if (stopAt > bound)
      fail(`minStopAtMs ${stopAt} ms is later than night ${night}'s derived box safe stop ` +
        `${Math.round(bound)} ms: a full box left at ${stopAt} ms empties before 6 AM`);
  }
  process.stdout.write(`minimal stop ${stopAt} ms clears every night's derived box bound ` +
    `(tightest: night 1 at ${Math.round(boxSafeStopMs(1))} ms)\n`);
}

// --- 2. what each shipped plan spends before anything is armed ---------------
// Reported per plan rather than refused: the prefix is real on every night from
// 2 up, and the emitters do not yet carry a wind-only prefix cycle, so a
// refusal here would only restate a known finding as a red lane. The numbers
// are the characterization that a prefix-aware emitter has to improve on.
const winners = readdirSync(HERE)
  .filter(name => name.startsWith('campaign-') && name.endsWith('-winner.json')).sort();
const profile = JSON.parse(readFileSync(
  join(HERE, '../../apps/device/profiles/hid-mediaprojection.json'), 'utf8'));

const isBoxWork = row => row.kind === 'hold' && row.control === 'wind';

// Which semantic controls a row actually touches. A compound names more than
// one: `hallvent` holds the hall light AND the right vent light, and both are
// layer-0 objects that scroll with the view.
const controlsOf = row => {
  if (row.kind === 'tap' || row.kind === 'hold') return [row.control];
  if (row.kind === 'hall' || row.kind === 'hallraise') return ['hallLight'];
  if (row.kind === 'hallvent') return ['hallLight', 'rightVentLight'];
  if (row.kind === 'maskraise') return [row.mode === 'hall' ? 'hallLight' : 'monitor'];
  if (row.kind === 'camdrop') return ['cameraFeedLight', 'monitor'];
  if (row.kind === 'read') return ['leftVentLight'];
  if (row.kind === 'sweep') return ['cameraFeedLight'];
  return [];
};
const rows = [];
for (const file of winners) {
  let winner;
  try { winner = validateWinner(JSON.parse(readFileSync(join(HERE, file), 'utf8'))); }
  catch { continue; }
  const emit = STRATEGY_REGISTRY[winner.strategy]?.emit;
  if (typeof emit !== 'function') continue;
  for (const night of winner.nights) {
    const idle = threatIdleUntilMs(night);
    if (idle === 0) continue;
    let parsed;
    try { parsed = parsePlan(emit(winner, night).text, { strategy: winner.strategy, night, profile }); }
    catch { continue; }
    const period = parsed.period;
    const loopStart = Math.max(parsed.loopStart, Number(parsed.headers['idle-until'] ?? 0));
    let total = 0, box = 0;
    for (const [name, cycle] of Object.entries(parsed.cycles)) {
      if (name === 'opening' || name === 'finish') {
        for (const row of cycle.rows) if (row.at < idle) { total += 1; box += isBoxWork(row) ? 1 : 0; }
        continue;
      }
      for (let base = loopStart; base < idle; base += period)
        for (const row of cycle.rows) if (base + row.at < idle) { total += 1; box += isBoxWork(row) ? 1 : 0; }
    }
    rows.push({ file, night, idle, total, box, idleContacts: total - box });
  }
}

// --- 3. how much of each plan is tapped at a coordinate the view can move ---
// Sourced 2026-09-19 from application.ccn 04-Office: the office world is
// 1600x768 in a 1024x768 window, so 576 px of horizontal pan, and the Layers
// chunk gives layer 0 an xCoef of 1.00 -- the light hitboxes scroll 1:1 with
// the view. The flip mask button is layer 4 at xCoef 0.00 and does not move.
// The profile taps every control at a FIXED screen coordinate and nothing in
// the executor models pan state, so a pan-dependent contact is only correct at
// pan 0. That asymmetry -- mask lands, lights do not -- is what three Night 3
// device deaths looked like on 2026-09-19, across two strategies.
{
  const scroll = profile.viewScroll;
  if (!scroll) fail('the resolved profile records no viewScroll: pan dependence is unstated');
  else {
    process.stdout.write(`\ncontacts tapped at a coordinate the view can move ` +
      `(${scroll.maxPanPx} px of pan, ${scroll.panObservation ? 'pan observation: ' +
      String(scroll.panObservation).split(':')[0] : 'no pan observation'}):\n`);
    for (const file of winners) {
      let winner;
      try { winner = validateWinner(JSON.parse(readFileSync(join(HERE, file), 'utf8'))); }
      catch { continue; }
      const emit = STRATEGY_REGISTRY[winner.strategy]?.emit;
      if (typeof emit !== 'function') continue;
      for (const night of winner.nights) {
        let parsed;
        try { parsed = parsePlan(emit(winner, night).text, { strategy: winner.strategy, night, profile }); }
        catch { continue; }
        const counts = new Map();
        for (const cycle of Object.values(parsed.cycles))
          for (const row of cycle.rows) {
            for (const control of controlsOf(row)) {
              // `true` only. An UNKNOWN control is not counted as pan-dependent and
              // not counted as safe either; it is listed separately below.
              if (scroll.panDependent?.[control] !== true) continue;
              counts.set(control, (counts.get(control) ?? 0) + 1);
            }
          }
        const total = [...counts.values()].reduce((a, b) => a + b, 0);
        if (!total) continue;
        process.stdout.write(`  ${file} night ${night}: ${total} per cycle-set -- ` +
          `${[...counts.entries()].map(([c, n]) => `${c} x${n}`).join(', ')}\n`);
      }
    }
  }
}

process.stdout.write('\ncontacts scheduled before anything is armed:\n');
if (!rows.length) process.stdout.write('  none: every shipped plan already opens at its threat idle\n');
for (const row of rows)
  process.stdout.write(`  ${row.file} night ${row.night}: threat idle +${row.idle} ms, ` +
    `${row.total} contacts, ${row.box} box, ${row.idleContacts} answering nobody\n`);

if (failed) {
  process.stdout.write(`\nschedule economy: ${failed} schedule(s) claim a hands-off window the ` +
    'box cannot support.\n');
  process.exit(1);
}
process.stdout.write('\nschedule economy: every minimal stop is inside its derived box bound; ' +
  'the prefix counts above are a characterization, not a refusal\n');
