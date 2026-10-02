// The per-story-night matrix: every night the campaign can request must
// build, replay, and receive a configuration-correct model-gate verdict.
// No phone required.
//
// Why this file exists (plans/13, work package 1). `build()` used to end its
// template extraction with `throw new Error('no attack cycle in the sampled
// night')`, and Nights 1 and 3 both hit it. That single message covered two
// opposite facts:
//
//   Night 1  the sourced AI table never arms Balloon Boy (peak AI 0), so a
//            night with no attack cycle is CORRECT and the branch is carried
//            only as a fail-safe for an unexpected classifier read;
//   Night 3  the table arms him at AI 1 then 2, so he is rare, not absent --
//            the prior route's seed 7 did not roll him, and answering that by
//            dropping the branch would have shipped a plan with no BB handling
//            for a night that can produce one. The repaired route now samples
//            him at seed 7; the source-based invariant remains the same.
//
// Only the source table separates those, so `resolveAttack()` asks it. This
// gate holds the resulting matrix, and it holds the fail-closed direction too:
// a sample that shows an attack on a night whose table cannot produce one is
// an observation/config mismatch, and the builder must refuse it rather than
// quietly pick a night to believe.
//
// The device runs nothing this suite has not priced, so a night that fails
// here is a night the campaign runner may not request.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as C from '@sixam/source/fnaf2';
import { build, capture, devicePlan, replay, resolveAttack, TEMPLATE_NIGHT,
         idleUntilMs } from './recipe.ts';
import { modelGate, GATE_MIN_SURVIVAL, HUMAN_SLACK_MS, GATE_RUNS } from './human-gate.ts';
import { contractVerdict, formatRate } from '../../../review/src/stat.ts';
import { pool, closePool } from '../census/pool.ts';
import type { survivors } from './gate-worker.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const NIGHTS = [1, 2, 3, 4, 5, 6];
const EXACT_RUNS = 100;

let failed = 0;
const check = (name: string, cond: unknown, detail = '') => {
  if (!cond) { failed++; console.error(`FAIL ${name}${detail ? ` -- ${detail}` : ''}`); }
};

// Must match what --device-plan prints, header for header: this text is
// compared against a pinned file, and a header the CLI emits but this does not
// makes the pin compare two different plans.
/** A value the test reads where the matrix has it; a missing one fails the check that reads it. */
const found = <T>(value: T | null | undefined) => value as T;
const planText = (recipe: ReturnType<typeof build>, plan: ReturnType<typeof devicePlan>) =>
  `#night ${recipe.night}\n#idle-until ${idleUntilMs(recipe.night)}\n` +
  Object.entries(plan).map(([name, lines]) =>
    `#cycle ${name} ${(recipe.cycles as Readonly<Record<string, { lengthMs: number }>>)[name].lengthMs}\n${lines.join('\n')}`).join('\n') + '\n';

// The gate over six nights is 7200 simulated nights and was the whole wall
// time of the engine suite. It is embarrassingly parallel, so it goes through
// the pool -- named seeds in fixed chunks, so a chunk boundary cannot change
// which seeds ran and the result stays bit-identical to the serial gate.
const WORKER = new URL('./gate-worker.ts', import.meta.url).href;
const CHUNK = 150;
const chunks = [];
for (const night of NIGHTS)
  for (let from = 1; from <= GATE_RUNS; from += CHUNK)
    chunks.push({ night, from, to: Math.min(from + CHUNK - 1, GATE_RUNS),
                  slackMs: HUMAN_SLACK_MS });
// The pool hands back each chunk's survivors() across a structured clone.
const gateParts = await pool().map(WORKER, 'survivors', chunks) as ReturnType<typeof survivors>[];
const gateSurvivors = new Map(NIGHTS.map(n => [n, 0]));
for (const part of gateParts)
  gateSurvivors.set(part.night, found(gateSurvivors.get(part.night)) + part.won);

// ------------------------------------------------------------- the matrix
const rows = [];
for (const night of NIGHTS) {
  const recipe = build({ night });
  const plan = devicePlan(recipe);
  const attack = recipe.branches.attack;

  let won = 0, missed = 0, detections = 0;
  const deaths = new Map();
  for (let seed = 1; seed <= EXACT_RUNS; seed++) {
    const r = replay(plan, { night, seed });
    if (r.sim.won) won++;
    else deaths.set(found(r.sim.death).reason, (deaths.get(found(r.sim.death).reason) || 0) + 1);
    missed += r.missed;
    detections += r.detections;
  }
  const survived = found(gateSurvivors.get(night));
  const verdict = contractVerdict(survived, GATE_RUNS, GATE_MIN_SURVIVAL);
  const gate = { night, survived, runs: GATE_RUNS, slackMs: HUMAN_SLACK_MS,
                 minSurvival: GATE_MIN_SURVIVAL,
                 ok: verdict.ok, verdict: verdict.status,
                 interval: { low: verdict.low, high: verdict.high,
                   halfWidth: verdict.halfWidth } };

  rows.push({ night, recipe, plan, attack, won, missed, detections, deaths, gate });

  // Every night must build and replay from a fixed seed, exactly.
  //
  // RETRACTED 2026-08-26, same day, and the original is kept because the
  // mistake is the lesson. This block briefly carried a KNOWN_BROKEN exemption
  // for night 3 (13/100, 87 Foxy deaths) and attributed it to that day's
  // camera (g3/g4, g486-487) and hall-light-pin (g848-854) sourcing. **Both
  // were provably innocent**: isolated in a worktree, removing either left
  // night 3 at 13/100, and removing the Puppet rework alone restored 100/100.
  //
  // The real cause was `attackAnchor`. It identifies an attack cycle as a mask
  // press with no monitor press within 180 frames after it -- which is also
  // true of the LAST prophylactic flick of a night that simply ENDED, because
  // nothing follows it. Night 3 seed 1's final mask press sits 111 frames
  // before the night's end, so `build()` cut a 600-frame window from 59 frames
  // of log and emitted a two-line attack cycle. The pilot masked and then sat
  // still for ten seconds: Foxy's D climbs 2/s while masked, and every one of
  // the 87 deaths is "Foxy had locked on and no blackout covered the 10s
  // interval".
  //
  // The Puppet rework only *revealed* it, by adding per-second draws to the
  // single shared LCG and reshuffling which seed night 3 samples. That will
  // happen again on the next sourced change that alters draw counts, which is
  // why the fix is a fail-closed check in the emitter and not a re-pin.
  //
  // The lesson worth keeping: an exemption is a claim about a cause, and this
  // one named the wrong cause with real evidence available. Do not write a
  // KNOWN_BROKEN entry from the shape of a diff.
  check(`night ${night} replays exactly`, won === EXACT_RUNS,
    `${won}/${EXACT_RUNS}, deaths ${JSON.stringify([...deaths])}`);
  // ...and receive a verdict priced against ITS AI table, not night 6's.
  check(`night ${night} gated against its own night`, gate.night === night);
  // Corrected 2026-08-26 when GATE_RUNS moved from 100 to 1200: the old
  // per-night figures (99, 77, 89, 85, 78, 46 of 100) were all measured on
  // seeds 1..100, which is a favourable block on every night. The truth over
  // 1200 seeds was 99.1, 66.5, 77.1, 72.3, 62.5 and 37.4 per cent. Carrying
  // the omitted first Foxy reset on the post-read raise moves that same sample
  // to 99.1, 68.9, 78.8, 73.2, 63.9 and 56.1 per cent: all six now pass.
  // Night 3 is REFUSED by the gate, and that is the gate working. A route that
  // does not clear its night must not reach a phone.
  check(`night ${night} passes the model gate`, gate.ok,
    `${gate.survived}/${gate.runs} under +/-${HUMAN_SLACK_MS} ms ` +
    `(need ${Math.ceil(gate.runs * GATE_MIN_SURVIVAL)}, ${gate.verdict} ` +
    `[${(100 * gate.interval.low).toFixed(1)}%, ${
      (100 * gate.interval.high).toFixed(1)}%])`);
  // A plan that spends more flashlight than the night owns is not a plan.
  check(`night ${night} stays inside its power budget`,
    recipe.powerFramesHeadroom > 0,
    `${recipe.powerFramesSpentIfAllClear}/${recipe.powerFramesAvailable} frames`);
  // A missed read is a BB in the opening the branch never saw. The route's
  // whole claim is that it does not miss one.
  check(`night ${night} misses no Balloon Boy read`, missed === 0, `${missed} missed`);
}

// -------------------------------------- reachability agrees with the source
//
// Two independent statements, which is the point: the AI table says whether
// Balloon Boy can act, and 100 replays say whether he did. A night the table
// calls impossible that nonetheless produced a detection would mean the engine
// and the table disagree, and neither number alone would have shown it.
for (const { night, attack, detections } of rows) {
  const possible = C.canAct(night, 'bb');
  check(`night ${night} branch reachability matches the source table`,
    attack.reachable === possible,
    `reachable=${attack.reachable}, peak AI ${attack.peakAi}`);
  check(`night ${night} detections agree with reachability`,
    possible || detections === 0,
    `${detections} detections on a night whose peak Balloon Boy AI is ${attack.peakAi}`);
  if (!possible)
    check(`night ${night} still carries the attack branch`,
      attack.source === 'template' && attack.cutFrom.night === TEMPLATE_NIGHT,
      JSON.stringify(attack));
}

// Night 1 is the case that used to crash the builder, and Night 3 the case
// that must NOT be answered by dropping the branch. Name them, so a future
// change that collapses the two facts again fails here by name. Whether the
// fixed sample supplies Night 3's branch is deliberately not pinned.
{
  const n1 = found(rows.find(r => r.night === 1)).attack;
  const n3 = found(rows.find(r => r.night === 3)).attack;
  check('night 1 carries a borrowed, unreachable branch',
    !n1.reachable && n1.peakAi === 0 && n1.source === 'template', JSON.stringify(n1));
  check('night 3 keeps a real branch, cut from night 3',
    n3.reachable && n3.peakAi > 0 &&
      (n3.source === 'sampled' || n3.source === 'reseeded') && n3.cutFrom.night === 3,
    JSON.stringify(n3));
}

// ------------------------------------------------------------ fails closed
//
// The other direction of the same question. If a sample shows Balloon Boy
// attacking on a night whose sourced table never arms him, the engine and the
// AI table disagree about which night is being played; a plan built through
// that is a plan built against an unknown configuration.
{
  const nightSixLog = capture({ bbMode: 'left', deviceSweep: true, pulseLight: true,
    sweepSlotMs: 120, maskMarginMs: 900, readLatencyMs: 550, hallPulseMs: 130,
    pilotOffset: 10, prophylacticMask: true, night: 6, seed: 7 });
  let threw = '';
  try { resolveAttack({ night: 1, seed: 7 }, nightSixLog); }
  catch (e) { threw = (e as Error).message; }
  check('an unexpected Balloon Boy attack fails closed',
    /never arms him/.test(threw), threw || 'built a plan anyway');

  // And the builder, not just the resolver.
  let builtAnyway = false;
  try { build({ night: 1, captureFn: () => nightSixLog }); builtAnyway = true; } catch { /* expected */ }
  check('build() refuses the same mismatch', !builtAnyway);
}

// A plan that does not name its night is not gated against a guess.
{
  const { recipe, plan } = found(rows.find(r => r.night === 6));
  const unnamed = planText(recipe, plan).replace(/^#night 6\n/, '');
  let threw = '';
  try { modelGate(unnamed, { runs: 1 }); } catch (e) { threw = (e as Error).message; }
  check('an unnamed plan is refused', /does not name its night/.test(threw), threw);
}

// ------------------------------------------------------- night 6 stays put
//
// The refactor's contract: nothing above may move the shipped route. The
// pinned file is the plan as it was emitted before cycle-template extraction
// was separated from the night being evaluated, with only the new `#night`
// header added.
{
  const six = found(rows.find(r => r.night === 6));
  const emitted = planText(six.recipe, six.plan);
  const pinned = readFileSync(join(HERE, '../../../play/test/testdata/n6-device-plan.txt'), 'utf8');
  check('the shipped night 6 plan is unchanged', emitted === pinned,
    'the per-night refactor moved the best-studied route; if that is intended, ' +
    're-pin testdata/n6-device-plan.txt in the same commit and say why');
  check('night 6 cuts its own attack branch', six.attack.source === 'sampled');
}

// ------------------------------------------------------------------ report
for (const { night, recipe, attack, won, detections, gate } of rows) {
  const need = Math.ceil(gate.runs * GATE_MIN_SURVIVAL);
  console.log(
    `night ${night}  exact ${String(won).padStart(3)}/${EXACT_RUNS}` +
    `  human ${String(gate.survived).padStart(3)}/${gate.runs} ` +
    `(${formatRate(gate.survived, gate.runs, { label: 'survival' })}; need ${need})` +
    `  light ${String(recipe.powerFramesSpentIfAllClear).padStart(4)}/${recipe.powerFramesAvailable}` +
    `  BB ai ${String(attack.peakAi).padStart(2)} ${attack.reachable ? 'reachable' : 'UNREACHABLE'}` +
    ` (${attack.source} n${attack.cutFrom.night} s${attack.cutFrom.seed})` +
    `  reads ${detections}`);
}

closePool();
if (failed) { console.error(`${failed} night-matrix check(s) failed`); process.exit(1); }
console.log(`night matrix: nights ${NIGHTS.join(', ')} build, replay and gate`);
