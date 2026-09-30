#!/usr/bin/env node
// A census over a POLICY FAMILY, run from a pre-registered experiment-spec-v2.
//
// Every census before this one scored fixed schedules: a committed binding at
// the one epoch it declares (winner-census.mjs), or at whole-frame steps
// around it over 1000 seeds (winner-phase-census.mjs). The phone does not play
// a schedule at a declared epoch. It plays a POLICY: a binding released by an
// anchor whose aim, onset bias and input latency deliver some epoch inside an
// interval the fact register names (fact-register.mjs ANCHOR_AIMS), and the
// policy does not choose where in it. A policy's value is therefore its worst
// member over that band, and the family's P_max is the best policy's value.
//
// The spec fixes everything before a seed is run (ADR 0002 principle 7): the
// family and its grid, a development block that selects the policy, a
// disjoint named held-out block that decides, the competing explanations and
// the stopping rule. This tool refuses a spec that is not committed and clean
// (--unregistered is for fixtures and gates, never for a record), refuses
// either block under the 3000-seed floor (review's `seed-floor` rule, through
// @sixam/propose/census), and runs at most two worker processes.
//
//   node packages/propose/bin/census/policy-census.mjs --spec docs/evidence/<id>-predeclaration-<date>.json --jobs 2 --out FILE
//
// Families (FAMILIES below):
//   night7-anchor-band-v1  the committed Night 7 (10/20) Minus Toys bindings the spec names, each at
//                          every integer-ms epoch of its registered anchor's effective interval
//                          [aim + onsetBias + latency.min, aim + onsetBias + latency.max]. Members
//                          whose emitted press queue is identical are one schedule class: the replay
//                          is a deterministic function of (seed, queue) when reactiveBB is off, so
//                          one representative per class is replayed and its counts stand for every
//                          member of the class. The device lane replays each binding at its aim
//                          (aim + onsetBias) with every press late by an independent draw from the
//                          same latency band (actuator.mjs DeviceActuator, per press).
//
// A census is a MODEL result: it never stands in for a device claim.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Sim } from '@sixam/source/fnaf2';
import { validateExperimentSpecV2 } from '@sixam/kernel/contracts';
import { decideExperiment, rateOf, resolveCensusCohort } from '@sixam/propose/census';
import { STRATEGY_REGISTRY, compileBundle, validateWinner } from '../plans/bundle.mjs';
import { ANCHOR_AIMS } from '../../bindings/fact-register.mjs';
import { build, replay as replayToys, schedule } from '../plans/minus-toys-plan.mjs';
import { DeviceActuator } from '../../../play/bin/phone/actuator.mjs';
import { currentPath } from '@sixam/review/renamed-path';
import { forkBlocks, gitState } from './winner-census.mjs';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '../../../..');
export const CENSUS_KIND = 'policy-family-census-v1';
export const MAX_JOBS = 2;
// Losses listed per (subject, block); a subject that loses more is described by its count and hash.
const MAX_LISTED = 200;
const sha256 = (text) => createHash('sha256').update(text).digest('hex');

/** The spec file's bytes, sha256 and registration: tracked, clean, and the commit that last wrote it. */
export function registration(specPath, { unregistered = false } = {}) {
  const text = readFileSync(resolve(ROOT, specPath), 'utf8');
  const git = (...args) => execFileSync('git', ['-C', ROOT, ...args], { encoding: 'utf8' }).trim();
  const rel = relative(ROOT, resolve(ROOT, specPath));
  let commit = null;
  try { commit = git('log', '-1', '--format=%H', '--', rel) || null; } catch { commit = null; }
  const dirty = commit ? git('status', '--porcelain', '--', rel) !== '' : true;
  if (!unregistered && (!commit || dirty))
    throw new Error(`policy-census: ${rel} is not a committed, clean pre-registration (ADR 0002 principle 7); commit it alone first`);
  return { text, spec: JSON.parse(text), path: rel, sha256: sha256(text), commit: dirty ? null : commit };
}

// ---- the night7-anchor-band-v1 family -------------------------------------------------------

/** Each binding the spec names, checked against the tree: the same bytes, the same winner hash, the same band. */
export function anchorBandBindings(spec) {
  const scratch = mkdtempSync(join(tmpdir(), 'policy-census-'));
  try {
    return spec.family.grid.bindings.map((entry) => {
      // The spec keeps the path it was registered with; the winner is read where it lives now.
      const text = readFileSync(join(ROOT, currentPath(ROOT, entry.path) ?? entry.path), 'utf8');
      if (sha256(text) !== entry.winnerSha256) throw new Error(`policy-census: ${entry.path} is not the winner the spec registered`);
      const winner = validateWinner(JSON.parse(text));
      if (winner.strategy !== 'minus-toys' || !winner.nights.includes(spec.family.grid.night))
        throw new Error(`policy-census: ${entry.path} is not a Minus Toys night ${spec.family.grid.night} binding`);
      const winnerHash = compileBundle(JSON.parse(text), join(scratch, entry.name)).manifest.winnerHash;
      if (winnerHash !== entry.winnerHash) throw new Error(`policy-census: ${entry.path} hashes to ${winnerHash}, not ${entry.winnerHash}`);
      const aim = ANCHOR_AIMS[winnerHash];
      if (!aim) throw new Error(`policy-census: ${entry.path} has no registered anchor aim`);
      const band = [aim.aimMs + (aim.onsetBiasMs ?? 0) + aim.latencyMs.min, aim.aimMs + (aim.onsetBiasMs ?? 0) + aim.latencyMs.max];
      if (band[0] !== entry.bandMs.lo || band[1] !== entry.bandMs.hi)
        throw new Error(`policy-census: ${entry.path}'s registered band is [${band}], not the spec's [${entry.bandMs.lo}, ${entry.bandMs.hi}]`);
      const emitted = STRATEGY_REGISTRY['minus-toys'].emit(winner, spec.family.grid.night);
      if (emitted.knobs.reactiveBB) throw new Error(`policy-census: ${entry.path} is reactive; its replay is not a function of its queue`);
      return { ...entry, knobs: emitted.knobs, planSha256: sha256(emitted.text),
        aimEpochMs: aim.aimMs + (aim.onsetBiasMs ?? 0), latencyMs: [aim.latencyMs.min, aim.latencyMs.max] };
    });
  } finally { rmSync(scratch, { recursive: true, force: true }); }
}

/** The press queue a binding's knobs emit at an epoch -- exactly what replay() plays. */
export function queueAt(knobs, epochMs) {
  const { opening, loop, finish } = build(knobs);
  const periodMs = knobs.minimal ? knobs.minPeriodMs : knobs.loopPeriodMs;
  return schedule({ splitCamera: true, opening, loop, finish, periodMs,
    loopStartMs: knobs.minimal ? knobs.minLoopStartMs : 0, untilMs: knobs.minimal ? knobs.minStopAtMs : 420000, epochMs });
}

/** Members grouped into schedule classes: the epochs of the band whose emitted queues are identical. */
export function scheduleClasses(binding, stepMs) {
  const classes = new Map();
  for (let epochMs = binding.bandMs.lo; epochMs <= binding.bandMs.hi; epochMs += stepMs) {
    const queueSha256 = sha256(JSON.stringify(queueAt(binding.knobs, epochMs)));
    if (!classes.has(queueSha256)) classes.set(queueSha256, { queueSha256, epochsMs: [] });
    classes.get(queueSha256).epochsMs.push(epochMs);
  }
  return [...classes.values()].map((cls, index) => ({ id: `${binding.name}/c${String(index + 1).padStart(2, '0')}`,
    binding: binding.name, representativeMs: cls.epochsMs[0], ...cls }));
}

/** One exact-lane night of one member. A win is 6 AM with the split armed, as the phase census scores it. */
export function exactNight(binding, night, seed, epochMs) {
  const r = replayToys({ night, seed, knobs: binding.knobs, epochMs });
  const won = r.sim.won && r.splitAt >= 0;
  return { won, reason: r.sim.won ? (won ? 'won' : 'unarmed') : (r.sim.death?.reason ?? 'alive'), frame: r.sim.frame };
}

/** One device-lane night: the aim's epoch, every press late by its own draw from the latency band. */
export function deviceNight(binding, night, seed) {
  const sim = new Sim({ night, seed });
  const queue = queueAt(binding.knobs, binding.aimEpochMs);
  const actuator = new DeviceActuator(sim, { seed, lateMinMs: binding.latencyMs[0], lateMaxMs: binding.latencyMs[1] });
  let i = 0;
  let splitAt = -1;
  while (sim.alive && !sim.won) {
    while (i < queue.length && queue[i][0] <= sim.frame) {
      const [, kind, action] = queue[i++];
      actuator[kind](action);
    }
    actuator.deliver();
    sim.tick();
    if (splitAt < 0 && sim.camsUp && sim.viewing === 11 && sim.cam === 9) splitAt = sim.frame;
  }
  const won = sim.won && splitAt >= 0;
  return { won, reason: sim.won ? (won ? 'won' : 'unarmed') : (sim.death?.reason ?? 'alive'), frame: sim.frame,
    seamDrops: actuator.seamDrops };
}

export const FAMILIES = Object.freeze({
  'night7-anchor-band-v1': Object.freeze({ bindings: anchorBandBindings, classes: scheduleClasses, exact: exactNight, device: deviceNight }),
});

function familyOf(spec) {
  const family = FAMILIES[spec.family?.id];
  if (!family) throw new Error(`policy-census: no family ${spec.family?.id}; have ${Object.keys(FAMILIES).join(', ')}`);
  return family;
}

// ---- blocks -----------------------------------------------------------------------------------

/** Rows for seed indices [a, b) of one block in one lane, one per subject in a fixed order. */
function laneBlock(spec, blockName, lane, a, b) {
  const family = familyOf(spec);
  const seeds = resolveCensusCohort(spec)[blockName].slice(a, b);
  const bindings = family.bindings(spec);
  const night = spec.family.grid.night;
  if (lane === 'exact') {
    return bindings.flatMap((binding) => family.classes(binding, spec.family.grid.stepMs)).map((cls) => {
      const binding = bindings.find((item) => item.name === cls.binding);
      const losses = [];
      for (const seed of seeds) {
        const r = family.exact(binding, night, seed, cls.representativeMs);
        if (!r.won) losses.push([seed, r.reason, r.frame]);
      }
      return { subject: cls.id, n: seeds.length, losses };
    });
  }
  return bindings.map((binding) => {
    const losses = [];
    for (const seed of seeds) {
      const r = family.device(binding, night, seed);
      if (!r.won) losses.push([seed, r.reason, r.frame]);
    }
    return { subject: binding.name, n: seeds.length, losses };
  });
}

// ---- the record -------------------------------------------------------------------------------

const counts = (row) => ({ wins: row.n - row.losses.length, n: row.n,
  deaths: row.losses.reduce((acc, [, reason]) => ({ ...acc, [reason]: (acc[reason] ?? 0) + 1 }), {}),
  losses: row.losses.length <= MAX_LISTED ? row.losses : null, lostListed: Math.min(row.losses.length, MAX_LISTED),
  lossesSha256: sha256(JSON.stringify(row.losses)) });

/** A class's held-out standing: every seed won, every seed lost, or some of each. */
export const standing = (block) => (block.wins === block.n ? 'won' : block.wins === 0 ? 'lost' : 'partial');

/**
 * Selection on the development block: each policy's value is its worst class; the highest value
 * wins, then the highest mean over its members, then the spec's tie order.
 */
export function selectPolicy(spec, bindings) {
  const order = spec.family.grid.tieOrder;
  const score = (b) => ({ min: Math.min(...b.classes.map((c) => c.development.wins / c.development.n)),
    mean: b.classes.reduce((s, c) => s + c.epochsMs.length * c.development.wins / c.development.n, 0) /
      b.classes.reduce((s, c) => s + c.epochsMs.length, 0) });
  return bindings.map((b) => ({ name: b.name, ...score(b) }))
    .sort((x, y) => y.min - x.min || y.mean - x.mean || order.indexOf(x.name) - order.indexOf(y.name))[0].name;
}

/** The observation the spec's explanations are decided on, from the selected policy's held-out classes. */
export function observe(selected) {
  const standings = selected.classes.map((c) => standing(c.heldOut));
  return { classesLosing: standings.filter((s) => s !== 'won').length,
    classesPartial: standings.filter((s) => s === 'partial').length };
}

/** The family P_max lower bound: the selected policy's worst held-out class, jointly over its classes. */
export function pMaxRate(selected) {
  const worst = selected.classes.reduce((w, c) => (c.heldOut.wins < w.heldOut.wins ? c : w));
  return rateOf(`P_max lower bound: ${selected.name}'s worst deliverable epoch class (${worst.id}) on the held-out block`,
    worst.heldOut.wins, worst.heldOut.n, { method: 'wilson-bonferroni', confidence: 0.95, comparisons: selected.classes.length });
}

export function buildRecord({ spec, reg, bindings, classes, exactRows, deviceRows, git, date, command, wallSeconds }) {
  const byBlock = (rows, block, subject) => counts(rows[block].find((row) => row.subject === subject));
  const out = bindings.map((binding) => {
    const own = classes.filter((cls) => cls.binding === binding.name).map((cls) => ({
      id: cls.id, epochsMs: { lo: cls.epochsMs[0], hi: cls.epochsMs.at(-1), count: cls.epochsMs.length },
      representativeMs: cls.representativeMs, queueSha256: cls.queueSha256,
      development: byBlock(exactRows, 'development', cls.id), heldOut: byBlock(exactRows, 'heldOut', cls.id),
    }));
    const value = (block) => ({ minWins: Math.min(...own.map((c) => c[block].wins)), n: own[0][block].n,
      classesLosing: own.filter((c) => c[block].wins < c[block].n).length });
    return { name: binding.name, path: binding.path, winnerSha256: binding.winnerSha256, winnerHash: binding.winnerHash,
      planSha256: binding.planSha256, bandMs: binding.bandMs, members: own.reduce((s, c) => s + c.epochsMs.count, 0),
      classes: own, value: { development: value('development'), heldOut: value('heldOut') },
      device: { epochMs: binding.aimEpochMs, latencyMs: { lo: binding.latencyMs[0], hi: binding.latencyMs[1] },
        development: byBlock(deviceRows, 'development', binding.name), heldOut: byBlock(deviceRows, 'heldOut', binding.name) } };
  });
  const selectedName = selectPolicy(spec, out);
  const selected = out.find((b) => b.name === selectedName);
  const observations = observe(selected);
  const pMax = pMaxRate(selected);
  const rates = [pMax,
    ...out.map((b) => rateOf(`${b.name} device lane, held-out`, b.device.heldOut.wins, b.device.heldOut.n)),
  ];
  const result = decideExperiment(spec, {
    specSha256: reg.sha256, observations, rates,
    stopped: { rule: spec.stoppingRule.kind, reached: 'every schedule class of every binding and every device-lane binding ran on every seed of both blocks; nothing was added, dropped or rerun' },
    evidence: Object.fromEntries(spec.explanations.map((e) => [e.id, { policy: selectedName,
      classStandings: selected.classes.map((c) => ({ id: c.id, standing: standing(c.heldOut), wins: c.heldOut.wins, n: c.heldOut.n })) }])),
  });
  const surviving = result.explanations.filter((e) => e.status === 'surviving').map((e) => e.id);
  const tag = (name) => `${name}: worst class ${out.find((b) => b.name === name).value.heldOut.minWins}/${out[0].classes[0].heldOut.n} held-out`;
  const answer = `Selected on the development block: ${selectedName}. Over its ${selected.members} deliverable epochs ` +
    `(${selected.classes.length} schedule classes), ${observations.classesLosing} class(es) lose a held-out seed and ` +
    `${observations.classesPartial} lose some but not all; surviving: ${surviving.join(', ') || 'none'}. ` +
    `P_max over the family >= ${pMax.successes}/${pMax.n} held-out ` +
    `(${pMax.method} ${pMax.confidence} over ${pMax.comparisons} classes: [${pMax.interval.lo.toFixed(5)}, ${pMax.interval.hi.toFixed(5)}]). ` +
    `${out.map((b) => tag(b.name)).join('; ')}. Device lane (aim epoch, per-press lateness in the latency band), held-out: ` +
    `${out.map((b) => `${b.name} ${b.device.heldOut.wins}/${b.device.heldOut.n}`).join(', ')}.`;
  const record = {
    schema: 'evidence-record-v1', kind: CENSUS_KIND, id: `${spec.id}-${date.replace(/-/g, '')}`,
    claimLevel: 'MODEL_ONLY', date,
    question: spec.question, answer,
    whyItIsModelOnly: 'No device run. The exact lane replays each epoch class on its scheduled frames; the device lane ' +
      'is the actuator model, not the phone. A census never stands in for a device claim, and S2 (encounter ' +
      'fidelity) bounds what any model ceiling means.',
    preregistration: { spec: reg.path, specSha256: reg.sha256, commit: reg.commit },
    census: {
      population: spec.cohort.population,
      policy: { family: spec.family.id, members: out.reduce((s, b) => s + b.members, 0), classes: classes.length,
        definition: spec.family.description },
      seeds: { development: spec.cohort.development, heldOut: spec.cohort.heldOut },
      heldOutBlock: spec.cohort.heldOut.name,
      perturbation: 'exact lane: the delivered epoch, every integer ms of each binding\'s band; device lane: per-press lateness drawn from the latency band',
      constants: Object.fromEntries(bindings.map((b) => [b.name, { winnerSha256: b.winnerSha256, planSha256: b.planSha256 }])),
    },
    method: { tool: 'packages/propose/bin/census/policy-census.mjs', command, git, jobs: MAX_JOBS, wallSeconds,
      win: 'sim.won AND splitAt >= 0 (a 6 AM with the split armed), as winner-phase-census.mjs scores it',
      exactLane: 'minus-toys-plan.mjs replay({night, seed, knobs, epochMs}) at each class\'s representative epoch',
      deviceLane: 'the same queue at aim + onsetBias, each press through actuator.mjs DeviceActuator (perPress, lateness U[latency.min, latency.max] ms)' },
    bindings: out,
    selection: { rule: 'the highest worst-class win rate on the development block; then the highest member-weighted mean; then the spec\'s tie order',
      selected: selectedName },
    pMax: { definition: 'max over the family\'s policies of the policy\'s worst deliverable epoch: a lower bound scoped to this family, not to all policies',
      rate: pMax },
    result,
  };
  record.evidenceId = `${spec.id}-${sha256(JSON.stringify(record)).slice(0, 16)}`;
  return record;
}

// ---- main -------------------------------------------------------------------------------------

function parseArgs(argv) {
  const args = { spec: null, out: null, jobs: 1, date: new Date().toISOString().slice(0, 10), unregistered: false };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === '--spec') args.spec = argv[++i];
    else if (flag === '--out') args.out = argv[++i];
    else if (flag === '--jobs') args.jobs = Number(argv[++i]);
    else if (flag === '--date') args.date = argv[++i];
    else if (flag === '--unregistered') args.unregistered = true;
    else throw new Error(`policy-census: unknown flag ${flag}`);
  }
  if (!args.spec) throw new Error('policy-census: --spec is required');
  if (!Number.isInteger(args.jobs) || args.jobs < 1 || args.jobs > MAX_JOBS)
    throw new Error(`policy-census: --jobs must be 1..${MAX_JOBS}`);
  return args;
}

async function main(argv) {
  if (argv[0] === '--child') {
    const [, a, b, specPath, blockName, lane] = argv;
    const spec = JSON.parse(readFileSync(resolve(ROOT, specPath), 'utf8'));
    process.send(laneBlock(spec, blockName, lane, Number(a), Number(b)));
    return;
  }
  const args = parseArgs(argv);
  const reg = registration(args.spec, { unregistered: args.unregistered });
  const spec = validateExperimentSpecV2(reg.spec);
  if (spec.purpose !== 'census') throw new Error('policy-census: the spec is not a census');
  const family = familyOf(spec);
  const cohort = resolveCensusCohort(spec);
  const bindings = family.bindings(spec);
  const classes = bindings.flatMap((binding) => family.classes(binding, spec.family.grid.stepMs));
  if (classes.length !== spec.family.grid.classes)
    throw new Error(`policy-census: the family has ${classes.length} schedule classes, not the ${spec.family.grid.classes} registered`);
  const started = Date.now();
  const script = fileURLToPath(import.meta.url);
  const run = async (blockName, lane) => {
    console.error(`policy-census: ${lane} lane, ${blockName} block (${cohort[blockName].length} seeds)...`);
    return forkBlocks({ script, args: [reg.path, blockName, lane], start: 0, count: cohort[blockName].length, jobs: args.jobs });
  };
  const exactRows = { development: await run('development', 'exact'), heldOut: await run('heldOut', 'exact') };
  const deviceRows = { development: await run('development', 'device'), heldOut: await run('heldOut', 'device') };
  const command = `node packages/propose/bin/census/policy-census.mjs --spec ${reg.path} --jobs ${args.jobs}`;
  const record = buildRecord({ spec, reg, bindings, classes, exactRows, deviceRows, git: gitState(), date: args.date,
    command, wallSeconds: Math.round((Date.now() - started) / 1000) });
  const text = `${JSON.stringify(record, null, 2)}\n`;
  if (args.out) writeFileSync(args.out, text); else process.stdout.write(text);
  console.error(`policy census ${record.evidenceId}: ${record.answer}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error) => { console.error(error.message); process.exitCode = 1; });
}
