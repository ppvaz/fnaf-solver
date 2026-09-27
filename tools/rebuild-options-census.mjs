#!/usr/bin/env node
// What the rebuild-matched model options change about the committed winners.
//
// Under `tools/recompile/sourced-rebuild-model-options.json` -- the default-off
// sourced options plus the frame-time hook at 60 fps -- the model spends the
// same draws with the same LCG state as the rebuilt Android runtime on every
// office update of seed 24850's no-input Nights 1-5 (tools/recompile/README.md,
// "Nights 1-5"). The committed winners were all measured on the default model.
// This scores each of them on both, on the same seeds, so the rate a binding
// is predicted to win at can be read beside the rate the rebuild-matched model
// predicts; a binding whose rate moves outside sampling noise is where the
// model's disagreement with the rebuild matters for the phone.
//
//   node tools/rebuild-options-census.mjs --jobs 3 --count 3000 --out docs/evidence/rebuild-options-census-YYYYMMDD.json
//        [--date YYYY-MM-DD] [--checkpoint DIR] [--assemble DIR]
//
// `--checkpoint DIR` saves each forked block's rows after every subject, so a
// block killed partway resumes after its last saved subject when the same
// command is run again (hours on a shared machine; the record is unchanged).
// `--assemble DIR` runs nothing: it writes the record from a stopped run's
// checkpoints (same --jobs and --count), and every subject that did not finish
// in all blocks is a NOT_RUN row with no figures, never an estimate.
//
// Subjects: every committed winner-v1 binding on each of its Nights 1-6, the
// Night 7 binding k3, and Night 7's preset schedule (night7-presets.mjs
// PRESET_KNOBS on the `golden-freddy` preset, 10/20, epoch 0, won only with the
// split armed, as its population lane counts it). Each winner replays exactly
// as its bundle gate replays it (`STRATEGY_REGISTRY[s].emit(winner, night)
// .replay(seed)`), after `compileBundle` has checked that gate on the default
// model. Bindings whose replay is identical (same strategy, night, knobs,
// plan and epoch) are scored once and the row says whose replay it shares.
//
// Option sets: `default` (no options), `rebuild` (the file as committed) and
// `rebuild-no-cam-markers` (the file with `footstepCamMarkers` off: the CCN's
// geometry puts CAM 01-04 under `hear footsteps`, full-06's audio does not, and
// that disagreement is open).
//
// The emitters build their own Sim, and several of these options are read in
// Sim's constructor (sourcedHourTable, sourcedFoxyChain, the hook checks), so
// switching them on at the first tick (winner-census.mjs --sim-opt) would not
// be exact. `withModelOptions` instead intercepts the constructor's own
// `this.opts = ...` assignment through a setter on Sim.prototype and merges the
// set into it, only while a replay runs; every replay then checks its Sim
// carries exactly the set it was scored under. Emission always runs outside
// that scope, so every binding is the plan the phone is sent.
//
// Seeds: the design block is 1..N, which the winners' own gates (1..8 or
// 1..3000) and the tuning cohorts reached; the held-out block is the first N
// seeds outside winner-census.mjs designBlock(). A set's rate is compared with
// the default's seed by seed (paired): the exact two-sided McNemar test on the
// seeds only one of them wins. A row is MOVED when that test is below 0.05 in
// both blocks in the same direction.
//
// MODEL_ONLY: the simulator under two option sets. No device run; actuator
// lateness, seam loss and the frame phase the phone re-rolls are not in it,
// and no option default changes.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Sim } from '@fnaf2-1020/core/mechanics';
import { STRATEGY_REGISTRY, compileBundle, validateWinner } from './device/bundle.mjs';
import { PRESET_KNOBS, loadPresets, runNight } from './device/night7-presets.mjs';
import { simOptionsFrom } from './recompile/model-draw-trace.mjs';
import { committedWinners, designBlock, forkBlocks, gitState, phoneCohorts } from './winner-census.mjs';
import { heldOutSeeds } from './winner-phase-census.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const KIND = 'fnaf2-rebuild-options-census-v1';
export const OPTIONS_FILE = 'tools/recompile/sourced-rebuild-model-options.json';
export const DISPUTED_OPTION = 'footstepCamMarkers';
export const K3_BINDING = 'tools/device/campaign-night7-k3-winner.json';
export const PRESET_ID = 'golden-freddy';
export const ALPHA = 0.05;
// A listing longer than this is kept as a count and a hash of the full list.
export const MAX_LISTED = 20;

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** The three option sets, as model-options JSON (not yet Sim options). */
export function optionSets() {
  const file = JSON.parse(readFileSync(join(ROOT, OPTIONS_FILE), 'utf8'));
  if (file[DISPUTED_OPTION] !== true) throw new Error(`${OPTIONS_FILE} no longer switches ${DISPUTED_OPTION} on`);
  return [
    { id: 'default', modelOptions: {} },
    { id: 'rebuild', modelOptions: file },
    { id: 'rebuild-no-cam-markers', modelOptions: { ...file, [DISPUTED_OPTION]: false } },
  ];
}

// --- constructor-time options -------------------------------------------
let active = null;
let installed = false;
function install() {
  if (installed) return;
  if (Object.getOwnPropertyDescriptor(Sim.prototype, 'opts')) throw new Error('Sim.prototype.opts is already defined');
  Object.defineProperty(Sim.prototype, 'opts', {
    configurable: true,
    set(value) {
      Object.defineProperty(this, 'opts', { value: active ? Object.assign(value, active) : value,
        writable: true, configurable: true, enumerable: true });
    },
  });
  installed = true;
}

/** Run `fn` with every Sim constructed inside it carrying `simOptions`. */
export function withModelOptions(simOptions, fn) {
  install();
  if (active) throw new Error('withModelOptions does not nest');
  active = Object.keys(simOptions).length ? simOptions : null;
  try { return fn(); } finally { active = null; }
}

/** The Sim was built with exactly this set: the injected values, or the defaults for an empty set. */
function assertCarries(sim, simOptions, tag) {
  const entries = Object.entries(simOptions);
  if (!entries.length) {
    if (sim.opts.sourcedHourTable !== false || sim.opts.frameMs !== null || sim.opts[DISPUTED_OPTION] !== false)
      throw new Error(`${tag}: a default replay carried a model option`);
    return;
  }
  for (const [key, value] of entries)
    if (sim.opts[key] !== value) throw new Error(`${tag}: the replay's Sim does not carry ${key}`);
}

// --- seeds ---------------------------------------------------------------
export function seedBlocks(count) {
  const design = Array.from({ length: count }, (_, i) => i + 1);
  const inDesign = new Set(designBlock().seeds);
  if (!design.every((seed) => inDesign.has(seed))) throw new Error(`seeds 1..${count} are not all in the design block`);
  return { design, heldOut: heldOutSeeds(count) };
}

// --- subjects ------------------------------------------------------------
/**
 * Every subject in a fixed order: { id, binding, night, replayKey, planSha256,
 * winnerSha256, play(seed) -> {sim, won, reason} }. `replayKey` is equal for
 * two bindings whose replays are identical by construction.
 */
export function subjects() {
  const out = [];
  for (const path of committedWinners()) {
    const text = readFileSync(join(ROOT, path));
    const winner = validateWinner(JSON.parse(text.toString('utf8')));
    for (const night of winner.nights) {
      if (!(night <= 6 || path === K3_BINDING)) continue;
      const emitted = STRATEGY_REGISTRY[winner.strategy].emit(winner, night);
      const epochMs = (winner.anchorEpochMs ?? 0) + (winner.phaseOffsetMs ?? 0);
      out.push({
        id: `${path.replace(/^tools\/device\/|-winner\.json$/g, '')}@${night}`, binding: path, night,
        strategy: winner.strategy, epochMs, winnerSha256: sha256(text), planSha256: sha256(emitted.text),
        replayKey: sha256(JSON.stringify({ strategy: winner.strategy, night, epochMs, knobs: emitted.knobs, plan: emitted.text })),
        play: (seed) => {
          const { sim } = emitted.replay(seed);
          return { sim, won: !!sim.won, reason: sim.won ? null : (sim.death?.reason ?? 'alive') };
        },
      });
    }
  }
  const preset = loadPresets().find((p) => p.id === PRESET_ID);
  if (!preset) throw new Error(`no ${PRESET_ID} preset in the menu model`);
  out.push({
    id: `night7-preset-${PRESET_ID}@7`, binding: null, night: 7, strategy: 'minus-toys', epochMs: 0,
    knobsSha256: sha256(JSON.stringify(PRESET_KNOBS)), dials: preset.dials,
    replayKey: sha256(JSON.stringify({ preset: PRESET_ID, knobs: PRESET_KNOBS })),
    play: (seed) => {
      const { sim, splitAt } = runNight({ preset, seed, knobs: PRESET_KNOBS });
      const won = !!sim.won && splitAt >= 0;
      return { sim, won, reason: won ? null : sim.won ? 'unarmed' : (sim.death?.reason ?? 'alive') };
    },
  });
  return out;
}

/** The first subject of each replayKey, in subject order. */
function uniqueSubjects(all) {
  const seen = new Set();
  return all.filter((s) => (seen.has(s.replayKey) ? false : seen.add(s.replayKey)));
}

/**
 * Losses of every (unique subject, set) over seeds[a..b): rows {key, set, n, losses: [seed, reason, frame]}.
 * With a checkpoint directory, the rows so far are saved after each subject and a restarted block resumes
 * after the last saved subject; the file names the block and the generator's hash, so a stale one is ignored.
 */
function censusBlock(a, b, count, checkpointDir = null) {
  const { design, heldOut } = seedBlocks(count);
  const seeds = [...design, ...heldOut].slice(a, b);
  const sets = optionSets().map((set) => ({ id: set.id, simOptions: simOptionsFrom(set.modelOptions) }));
  const started = Date.now();
  const unique = uniqueSubjects(subjects());
  const stamp = sha256(readFileSync(fileURLToPath(import.meta.url))).slice(0, 16);
  const checkpoint = checkpointDir ? join(checkpointDir, `block-${count}-${a}-${b}-${stamp}.json`) : null;
  let rows = [];
  if (checkpoint && existsSync(checkpoint)) {
    rows = JSON.parse(readFileSync(checkpoint, 'utf8'));
    console.error(`  seeds[${a}..${b}) resuming after ${rows.length / sets.length} subjects from ${checkpoint}`);
  }
  for (const [k, subject] of unique.entries()) {
    if (rows.some((row) => row.key === subject.replayKey)) continue;
    for (const set of sets) {
      const losses = [];
      for (const seed of seeds) {
        const tag = `${subject.id} ${set.id} seed ${seed}`;
        let result;
        try { result = withModelOptions(set.simOptions, () => subject.play(seed)); }
        catch (error) { losses.push([seed, `replay-error: ${String(error.message).slice(0, 160)}`, -1]); continue; }
        assertCarries(result.sim, set.simOptions, tag);
        if (!result.won) losses.push([seed, result.reason, result.sim.frame]);
      }
      rows.push({ key: subject.replayKey, set: set.id, n: seeds.length, losses });
    }
    if (checkpoint) writeFileSync(checkpoint, JSON.stringify(rows));
    console.error(`  seeds[${a}..${b}) ${k + 1}/${unique.length} ${subject.id} (${Math.round((Date.now() - started) / 1000)} s)`);
  }
  return rows;
}

// --- statistics ----------------------------------------------------------
const logFactorials = [0];
function logFactorial(n) {
  for (let i = logFactorials.length; i <= n; i += 1) logFactorials.push(logFactorials[i - 1] + Math.log(i));
  return logFactorials[n];
}

/** Exact two-sided McNemar p: the discordant seeds split b : c under p = 1/2. */
export function mcnemarExact(b, c) {
  const n = b + c;
  if (n === 0) return 1;
  let tail = 0;
  for (let k = 0; k <= Math.min(b, c); k += 1)
    tail += Math.exp(logFactorial(n) - logFactorial(k) - logFactorial(n - k) - n * Math.LN2);
  return Math.min(1, 2 * tail);
}

/** Wilson 95% interval for wins/n. */
export function wilson95(wins, n) {
  const z = 1.959963984540054;
  const p = wins / n;
  const centre = (p + z * z / (2 * n)) / (1 + z * z / n);
  const half = (z / (1 + z * z / n)) * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n));
  return [Math.max(0, centre - half), Math.min(1, centre + half)].map((x) => Number(x.toFixed(6)));
}

/** IDENTICAL, WITHIN_NOISE, ONE_BLOCK or MOVED, from the two blocks' paired comparisons. */
export function verdict(design, heldOut) {
  const sig = (x) => x.pExact < ALPHA;
  const sign = (x) => Math.sign(x.optionOnlyWins - x.defaultOnlyWins);
  if (design.defaultOnlyWins + design.optionOnlyWins + heldOut.defaultOnlyWins + heldOut.optionOnlyWins === 0) return 'IDENTICAL';
  if (sig(design) && sig(heldOut) && sign(design) === sign(heldOut)) return 'MOVED';
  if (sig(design) || sig(heldOut)) return 'ONE_BLOCK';
  return 'WITHIN_NOISE';
}

const listed = (list) => (list.length <= MAX_LISTED ? { list } : { list: list.slice(0, MAX_LISTED), truncated: true });

function blockSummary(seeds, losses) {
  const inBlock = new Set(seeds);
  const lost = losses.filter(([seed]) => inBlock.has(seed));
  const deaths = {};
  for (const [, reason] of lost) deaths[reason] = (deaths[reason] ?? 0) + 1;
  const wins = seeds.length - lost.length;
  return { wins, n: seeds.length, rate: Number((wins / seeds.length).toFixed(6)), wilson95: wilson95(wins, seeds.length),
    deaths, losses: { count: lost.length, sha256: sha256(JSON.stringify(lost)), ...listed(lost) } };
}

function paired(seeds, defaultLosses, setLosses) {
  const inBlock = new Set(seeds);
  const lostDefault = new Map(defaultLosses.filter(([seed]) => inBlock.has(seed)).map((row) => [row[0], row]));
  const lostSet = new Map(setLosses.filter(([seed]) => inBlock.has(seed)).map((row) => [row[0], row]));
  const lostOnlyUnderSet = [...lostSet.values()].filter(([seed]) => !lostDefault.has(seed));
  const wonOnlyUnderSet = [...lostDefault.values()].filter(([seed]) => !lostSet.has(seed));
  return {
    deltaWins: wonOnlyUnderSet.length - lostOnlyUnderSet.length,
    defaultOnlyWins: lostOnlyUnderSet.length, optionOnlyWins: wonOnlyUnderSet.length,
    pExact: Number(mcnemarExact(lostOnlyUnderSet.length, wonOnlyUnderSet.length).toPrecision(6)),
    lostOnlyUnderSet: listed(lostOnlyUnderSet), wonOnlyUnderSet: listed(wonOnlyUnderSet.map(([seed, reason, frame]) =>
      [seed, `default: ${reason}`, frame])),
  };
}

// --- the record ----------------------------------------------------------
export function buildRecord({ merged, count, all, winnerHashes, cohorts, git, date, command, wallSeconds, run = null }) {
  const { design, heldOut } = seedBlocks(count);
  const sets = optionSets();
  const byKey = new Map(merged.map((row) => [`${row.key} ${row.set}`, row.losses]));
  const firstOf = new Map();
  for (const s of all) if (!firstOf.has(s.replayKey)) firstOf.set(s.replayKey, s.id);
  const rows = [];
  // A subject is scored only when every option set has its row: a stopped run leaves the rest NOT_RUN, with no figures.
  const scoredKeys = new Set(all.map((s) => s.replayKey).filter((key) => sets.every((set) => byKey.has(`${key} ${set.id}`))));
  for (const s of all) {
    if (!scoredKeys.has(s.replayKey)) {
      for (const set of sets) rows.push({ subject: s.id, binding: s.binding, night: s.night, set: set.id, status: 'NOT_RUN' });
      continue;
    }
    const losses = (set) => {
      const found = byKey.get(`${s.replayKey} ${set}`);
      if (!found) throw new Error(`no census row for ${s.id} ${set}`);
      return found;
    };
    for (const set of sets) {
      const row = {
        subject: s.id, binding: s.binding, night: s.night, set: set.id, status: 'SCORED',
        ...(firstOf.get(s.replayKey) !== s.id ? { sharesReplayWith: firstOf.get(s.replayKey) } : {}),
        design: blockSummary(design, losses(set.id)), heldOut: blockSummary(heldOut, losses(set.id)),
      };
      if (set.id !== 'default') {
        const vsDesign = paired(design, losses('default'), losses(set.id));
        const vsHeld = paired(heldOut, losses('default'), losses(set.id));
        row.vsDefault = { verdict: verdict(vsDesign, vsHeld), design: vsDesign, heldOut: vsHeld };
      }
      // The disputed knob's own effect: the same set with and without it, paired.
      if (set.id === 'rebuild-no-cam-markers') {
        const vsDesign = paired(design, losses('rebuild'), losses(set.id));
        const vsHeld = paired(heldOut, losses('rebuild'), losses(set.id));
        row.vsRebuild = { verdict: verdict(vsDesign, vsHeld), design: vsDesign, heldOut: vsHeld };
      }
      rows.push(row);
    }
  }
  const bindings = all.map((s) => ({
    subject: s.id, binding: s.binding, night: s.night, strategy: s.strategy, epochMs: s.epochMs,
    ...(s.binding ? { winnerSha256: s.winnerSha256, winnerHash: winnerHashes[s.binding], planSha256: s.planSha256,
      phone: cohorts.filter((c) => c.binding === winnerHashes[s.binding] && c.night === s.night)
        .map(({ record, wins, counted, size, status }) => ({ record, wins, counted, size, status })) }
      : { schedule: 'night7-presets.mjs PRESET_KNOBS', knobsSha256: s.knobsSha256, preset: PRESET_ID, dials: s.dials,
          win: 'sim.won AND splitAt >= 0' }),
    replayKey: s.replayKey, status: scoredKeys.has(s.replayKey) ? 'SCORED' : 'NOT_RUN',
  }));
  const notRun = all.filter((s) => !scoredKeys.has(s.replayKey)).map((s) => s.id);
  const scoredRows = rows.filter((r) => r.status === 'SCORED');
  const tally = {};
  for (const set of sets.slice(1)) {
    tally[set.id] = { IDENTICAL: [], WITHIN_NOISE: [], ONE_BLOCK: [], MOVED: [] };
    for (const row of scoredRows.filter((r) => r.set === set.id)) tally[set.id][row.vsDefault.verdict].push(row.subject);
  }
  const markers = { IDENTICAL: [], WITHIN_NOISE: [], ONE_BLOCK: [], MOVED: [] };
  for (const row of scoredRows.filter((r) => r.vsRebuild)) markers[row.vsRebuild.verdict].push(row.subject);
  tally[`${DISPUTED_OPTION} (rebuild vs rebuild-no-cam-markers)`] = markers;
  const rateText = (b) => `${b.wins}/${b.n}`;
  const rowOf = (subject, set) => rows.find((r) => r.subject === subject && r.set === set);
  const flagged = scoredRows.filter((r) => r.vsDefault?.verdict === 'MOVED').map((r) => ({
    subject: r.subject, set: r.set,
    design: `${rateText(rowOf(r.subject, 'default').design)} -> ${rateText(r.design)}`,
    heldOut: `${rateText(rowOf(r.subject, 'default').heldOut)} -> ${rateText(r.heldOut)}`,
    deathsHeldOut: r.heldOut.deaths,
  })).concat(scoredRows.filter((r) => r.vsRebuild?.verdict === 'MOVED').map((r) => ({
    subject: r.subject, set: `${r.set} vs rebuild (${DISPUTED_OPTION} alone)`,
    design: `${rateText(rowOf(r.subject, 'rebuild').design)} -> ${rateText(r.design)}`,
    heldOut: `${rateText(rowOf(r.subject, 'rebuild').heldOut)} -> ${rateText(r.heldOut)}`,
    deathsHeldOut: r.heldOut.deaths,
  })));
  const errors = scoredRows.reduce((sum, r) => sum + Object.entries({ ...r.design.deaths, ...r.heldOut.deaths })
    .filter(([reason]) => reason.startsWith('replay-error')).length, 0);
  const defaultShort = scoredRows.filter((r) => r.set === 'default' && (r.design.wins < r.design.n || r.heldOut.wins < r.heldOut.n))
    .map((r) => `${r.subject} ${rateText(r.design)} + ${rateText(r.heldOut)}`);
  const answer = [
    notRun.length
      ? `PARTIAL: ${all.length - notRun.length} of ${all.length} subjects scored (${scoredKeys.size} of ` +
        `${new Set(all.map((s) => s.replayKey)).size} distinct replays), ${count} design + ${count} held-out seeds each; ` +
        `${notRun.length} NOT_RUN (${run?.status ?? 'not reached'}), with no figures: ${notRun.join(', ')}.`
      : `${all.length} subjects (${new Set(all.map((s) => s.replayKey)).size} distinct replays), ${count} design + ${count} held-out seeds each.`,
    defaultShort.length ? `Default model short of every seed: ${defaultShort.join('; ')}.`
      : 'Default model: every scored subject wins every seed of both blocks.',
    ...sets.slice(1).map((set) => {
      const t = tally[set.id];
      const moved = flagged.filter((f) => f.set === set.id);
      return `${set.id}: ${t.MOVED.length} MOVED, ${t.ONE_BLOCK.length} ONE_BLOCK, ${t.WITHIN_NOISE.length} WITHIN_NOISE, ` +
        `${t.IDENTICAL.length} IDENTICAL` + (moved.length ? ` -- ${moved.map((f) => `${f.subject} held-out ${f.heldOut}` +
        ` (${Object.entries(f.deathsHeldOut).map(([c, k]) => `${c} ${k}`).join(', ')})`).join('; ')}` : '') + '.';
    }),
    `${DISPUTED_OPTION} alone (rebuild against rebuild-no-cam-markers): ${markers.MOVED.length} MOVED, ` +
      `${markers.ONE_BLOCK.length} ONE_BLOCK, ${markers.WITHIN_NOISE.length} WITHIN_NOISE, ${markers.IDENTICAL.length} IDENTICAL.`,
    errors ? `${errors} row-block death tallies include replay errors (see deaths).` : '',
  ].filter(Boolean).join(' ');
  return {
    schema: 'evidence-record-v1', kind: KIND, id: `rebuild-options-census-${date.replace(/-/g, '')}`,
    claimLevel: 'MODEL_ONLY', date,
    question: 'For each committed FNaF 2 story-night winner (Nights 1-6), the Night 7 binding k3 and the Night 7 preset ' +
      'schedule, what win rate does the model predict with its default options, and with the options under which it ' +
      'matches the rebuilt Android runtime on no-input Nights 1-5 (with and without the disputed footstepCamMarkers), on ' +
      'the same design and held-out seeds? Which bindings move outside sampling noise?',
    answer, coverage: { scored: all.length - notRun.length, subjects: all.length, notRun }, flagged, tally,
    whyItIsModelOnly: 'No device run and no option default changed. Every figure is the simulator replaying the plan the ' +
      'phone is sent, on its scheduled frames, under two option sets; the rebuild match it leans on is one seed per night ' +
      'with no gameplay input (draws and LCG state only, rebuilt-runtime fidelity).',
    method: {
      tool: 'tools/rebuild-options-census.mjs', command, git, wallSeconds, ...(run ? { run } : {}),
      generatorSha256: sha256(readFileSync(fileURLToPath(import.meta.url))),
      optionsFile: { path: OPTIONS_FILE, sha256: sha256(readFileSync(join(ROOT, OPTIONS_FILE))) },
      optionSets: sets.map(({ id, modelOptions }) => ({ id, modelOptions })),
      injection: 'a setter on Sim.prototype.opts merges the set into the constructor\'s own opts object while a replay ' +
        'runs, so options read in the constructor are exact; each replay asserts its Sim carries the set; frameMs and ' +
        'frameValue5 become constant per-frame functions (model-draw-trace.mjs simOptionsFrom)',
      policyFamily: 'the committed winner-v1 bindings as emitted (minus-toys and minus7 schedules), each at its own ' +
        'anchorEpochMs + phaseOffsetMs, and the Night 7 preset schedule (PRESET_KNOBS, golden-freddy, epoch 0); no ' +
        'schedule is searched or selected here',
      lane: 'exact: STRATEGY_REGISTRY[strategy].emit(winner, night).replay(seed), each binding first recompiled by ' +
        'compileBundle on the default model; the preset through night7-presets.mjs runNight',
      designBlock: { definition: `seeds 1..${count}, inside winner-census.mjs designBlock() (the winners' gate seeds 1..8 ` +
        'or 1..3000 and the tuning cohorts)', n: design.length, sha256: sha256(JSON.stringify(design)) },
      heldOutBlock: { definition: `the first ${count} seeds outside winner-census.mjs designBlock() ` +
        '(winner-phase-census.mjs heldOutSeeds)', n: heldOut.length, sha256: sha256(JSON.stringify(heldOut)) },
      noise: `paired per seed against the default set (vsDefault), and rebuild-no-cam-markers also against rebuild ` +
        `(vsRebuild, ${DISPUTED_OPTION}'s own effect): exact two-sided McNemar on the seeds only one set wins; MOVED = ` +
        `p < ${ALPHA} in both blocks in the same direction, ONE_BLOCK = in one block only, WITHIN_NOISE = neither, ` +
        'IDENTICAL = no seed differs. Wilson 95% intervals per rate.',
      listings: `loss and discordant-seed lists hold the first ${MAX_LISTED} [seed, reason, frame] rows; count and sha256 cover the full list`,
    },
    bindings, rows,
  };
}

/**
 * The rows a stopped `--checkpoint` run left: the block files of the same `--jobs` partition, all written by one
 * generator (the stamp in their names). A (replay, set) row is kept only when every block finished it.
 */
export function assembleCheckpoints(dir, count, jobs) {
  const total = 2 * count;
  const size = Math.ceil(total / jobs);
  const files = readdirSync(dir);
  const parts = [];
  for (let a = 0; a < total; a += size) {
    const b = Math.min(a + size, total);
    const found = files.filter((f) => f.startsWith(`block-${count}-${a}-${b}-`) && f.endsWith('.json'));
    if (found.length !== 1) throw new Error(`--assemble: expected one checkpoint for seeds[${a}..${b}) in ${dir}, found ${found.length}`);
    const rows = JSON.parse(readFileSync(join(dir, found[0]), 'utf8'));
    for (const row of rows) if (row.n !== b - a) throw new Error(`--assemble: ${found[0]} holds a row of ${row.n} seeds, not ${b - a}`);
    parts.push({ file: found[0], stamp: found[0].slice(`block-${count}-${a}-${b}-`.length, -'.json'.length), rows });
  }
  const stamps = [...new Set(parts.map((p) => p.stamp))];
  if (stamps.length !== 1) throw new Error(`--assemble: the checkpoints come from different generators (${stamps.join(', ')})`);
  const keyed = parts.map((p) => new Map(p.rows.map((row) => [`${row.key} ${row.set}`, row])));
  const merged = [...keyed[0].keys()].filter((k) => keyed.every((m) => m.has(k))).map((k) => ({
    ...keyed[0].get(k),
    n: keyed.reduce((sum, m) => sum + m.get(k).n, 0),
    losses: keyed.flatMap((m) => m.get(k).losses).sort((x, y) => x[0] - y[0]),
  }));
  return { merged, stamp: stamps[0], blocks: parts.map((p) => ({ file: p.file, rows: p.rows.length })) };
}

/** JSON with arrays of scalars (and of scalar arrays) on one line. */
export function formatRecord(value, indent = '') {
  const inner = `${indent}  `;
  const flat = (x) => x === null || typeof x !== 'object' || (Array.isArray(x) && x.every((y) => y === null || typeof y !== 'object'));
  if (flat(value)) return JSON.stringify(value);
  if (Array.isArray(value)) {
    if (value.every(flat)) return `[${value.map((x) => JSON.stringify(x)).join(', ')}]`;
    return `[\n${value.map((x) => inner + formatRecord(x, inner)).join(',\n')}\n${indent}]`;
  }
  const entries = Object.entries(value);
  if (!entries.length) return '{}';
  return `{\n${entries.map(([k, v]) => `${inner}${JSON.stringify(k)}: ${formatRecord(v, inner)}`).join(',\n')}\n${indent}}`;
}

function parseArgs(argv) {
  const args = { jobs: 1, count: 3000, out: null, checkpoint: null, date: new Date().toISOString().slice(0, 10) };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === '--jobs') args.jobs = Number(argv[++i]);
    else if (flag === '--count') args.count = Number(argv[++i]);
    else if (flag === '--out') args.out = argv[++i];
    else if (flag === '--date') args.date = argv[++i];
    else if (flag === '--checkpoint') args.checkpoint = argv[++i];
    else if (flag === '--assemble') args.assemble = argv[++i];
    else throw new Error(`rebuild-options-census: unknown flag ${flag}`);
  }
  if (!Number.isInteger(args.jobs) || args.jobs < 1) throw new Error('--jobs must be a positive integer');
  if (!Number.isInteger(args.count) || args.count < 1 || args.count > 3000) throw new Error('--count must be 1..3000');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(args.date)) throw new Error('--date must be YYYY-MM-DD');
  return args;
}

async function main(argv) {
  if (argv[0] === '--child') {
    const [, a, b, count, checkpoint] = argv;
    process.send(censusBlock(Number(a), Number(b), Number(count), checkpoint || null));
    return;
  }
  const args = parseArgs(argv);
  const all = subjects();
  const scratch = mkdtempSync(join(tmpdir(), 'rebuild-options-census-'));
  const winnerHashes = {};
  try {
    for (const path of new Set(all.map((s) => s.binding).filter(Boolean))) {
      const built = compileBundle(JSON.parse(readFileSync(join(ROOT, path), 'utf8')), join(scratch, path.replace(/\//g, '_')));
      winnerHashes[path] = built.manifest.winnerHash;
    }
  } finally { rmSync(scratch, { recursive: true, force: true }); }
  const started = Date.now();
  const command = `node tools/rebuild-options-census.mjs --jobs ${args.jobs} --count ${args.count} --date ${args.date}`;
  let merged;
  let run = null;
  if (args.assemble) {
    const assembled = assembleCheckpoints(args.assemble, args.count, args.jobs);
    merged = assembled.merged;
    run = { status: 'STOPPED', assembledWith: `${command} --assemble DIR`,
      reason: 'the run was stopped before every subject finished; these rows are assembled from its per-block ' +
        'checkpoints, and a subject missing from any block is NOT_RUN',
      checkpointGeneratorStamp: assembled.stamp, blocks: assembled.blocks };
  } else {
    if (args.checkpoint) mkdirSync(args.checkpoint, { recursive: true });
    merged = await forkBlocks({ script: fileURLToPath(import.meta.url),
      args: [String(args.count), ...(args.checkpoint ? [args.checkpoint] : [])],
      start: 0, count: 2 * args.count, jobs: args.jobs });
  }
  const record = buildRecord({ merged, count: args.count, all, winnerHashes, cohorts: phoneCohorts(),
    git: gitState(['packages/core', 'tools/device', 'tools/recompile']), date: args.date,
    command: args.assemble ? `${command} --checkpoint DIR` : command,
    wallSeconds: args.assemble ? null : Math.round((Date.now() - started) / 1000), run });
  const text = `${formatRecord(record)}\n`;
  if (args.out) writeFileSync(args.out, text); else process.stdout.write(text);
  for (const row of record.rows) {
    if (row.status === 'NOT_RUN') { console.error(`  ${row.subject.padEnd(44)} ${row.set.padEnd(23)} NOT_RUN`); continue; }
    const v = row.vsDefault;
    console.error(`  ${row.subject.padEnd(44)} ${row.set.padEnd(23)} design ${String(row.design.wins).padStart(4)}/${row.design.n}` +
      ` held-out ${String(row.heldOut.wins).padStart(4)}/${row.heldOut.n}` + (v ? `  ${v.verdict}` : '') +
      (row.vsRebuild ? ` (vs rebuild ${row.vsRebuild.verdict})` : '') +
      (row.heldOut.wins < row.heldOut.n ? `  | ${Object.entries(row.heldOut.deaths).map(([c, k]) => `${c} ${k}`).join(', ')}` : ''));
  }
  console.error(`${record.id}: ${record.answer}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error) => { console.error(error.stack ?? error.message); process.exitCode = 1; });
}
