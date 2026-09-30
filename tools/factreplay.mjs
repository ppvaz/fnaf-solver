// Record a night's observation/decision stream, then drive the controller from
// the recording and prove it rebuilds the same decisions. ROADMAP Track A1's
// "recorded facts" half.
//
//   node tools/factreplay.mjs --record captures/traces/night1-seed0.jsonl
//   node tools/factreplay.mjs --replay captures/traces/night1-seed0.jsonl
//   node tools/factreplay.mjs --assert          # record + replay a short night
//
// SCOPE: this is an OFFLINE fact stream produced by the simulator's observer
// model. It is not a device capture and carries no device claim -- Plan 09 P2's
// open item is a manifest from a real phone run, which this is not and does not
// pretend to be. What it establishes is determinism: the same recorded
// observations, replayed, must rebuild the same beliefs and the same decisions.
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import * as C from '@sixam/source/fnaf2';
import { Sim, Rng } from '@sixam/source/fnaf2';
import { Observer } from '@sixam/core/sensing';
import { CycleController, getCycle } from '@sixam/core/control';
import { canonicalJson, stableHash } from '@sixam/kernel/contracts';

export const FACT_STREAM_SCHEMA = 'offline-fact-stream-v1';

const LIBRARY_IDS = ['observe-and-hold', 'defensive-mask', 'wind-and-anchor',
  'foxy-hall-reset', 'verify-and-resume', 'select-box-cam', 'lower-monitor', 'unmask'];
const WIND_AT = 0.55;

function route(cycle, hypothesis, _gate, controller) {
  const st = controller.reduced;
  const want = (() => {
    if (hypothesis.hazard === 'active') return st.maskOn ? null : 'defensive-mask';
    if (st.maskOn) return 'unmask';
    if (st.box < WIND_AT) {
      if (st.monitor !== 'up') return 'verify-and-resume';
      if (st.viewedCamera !== C.BOX_CAM) return 'select-box-cam';
      return 'wind-and-anchor';
    }
    return st.monitor === 'up' ? 'lower-monitor' : 'observe-and-hold';
  })();
  return cycle.id === want
    ? { risk: 0, resourceMargin: 10 } : { risk: 1, resourceMargin: 0 };
}

function exactReplay(sim, cycle) {
  if (cycle.id === 'observe-and-hold') return { accepted: true };
  const copy = Sim.fromSnapshot(sim.opts, sim.snapshot());
  const origin = copy.frame;
  for (const action of cycle.actions) {
    const target = origin + action.atFrame;
    while (copy.alive && !copy.won && copy.frame < target) copy.tick();
    if (!copy.alive) return { accepted: false, reason: 'exact-death-before-action' };
    copy[action.kind](action.action);
  }
  const end = origin + cycle.durationFrames;
  while (copy.alive && !copy.won && copy.frame < end) copy.tick();
  return (copy.alive || copy.won) ? { accepted: true } : { accepted: false, reason: 'exact-death' };
}

const commitOf = (controller, decision, frame) => controller.commit(decision, { frame });

/** Drive one night live, retaining every observation and every decision. */
function record({ night, seed, limitFrames }) {
  const sim = new Sim({ night, seed });
  const observer = new Observer({ interval: 4, rng: new Rng(seed ^ 0x9e3779b9) });
  const controller = new CycleController({ cycles: LIBRARY_IDS.map(getCycle) });
  const boundaries = [];
  const pending = [];
  while (sim.alive && !sim.won && sim.frame < limitFrames) {
    if (sim.frame % 4 === 0) {
      const facts = observer.read(sim);
      controller.observe(facts, { frame: sim.frame });
      // The exact gate is a proof oracle over the live engine, so its verdicts
      // are retained with the stream: a replay has no engine to consult and
      // must not be allowed to invent one.
      const gates = {};
      const decision = controller.plan({
        exactGate: cycle => {
          const verdict = exactReplay(sim, cycle);
          gates[cycle.id] = verdict.accepted;
          return verdict;
        },
        score: route,
      });
      const committed = commitOf(controller, decision, sim.frame);
      for (const action of committed.actions) sim[action.kind](action.action);
      for (const action of committed.deferred) pending.push(action);
      boundaries.push({
        frame: sim.frame, facts, gates,
        selected: decision.selected ?? null,
        reason: decision.reason ?? decision.record?.reason ?? null,
        actions: committed.actions.map(a => ({ kind: a.kind, action: a.action })),
      });
    }
    for (let i = pending.length - 1; i >= 0; i--) {
      if (sim.frame < pending[i].dueFrame) continue;
      const action = pending[i];
      if (controller.releaseDeferred(action, { frame: sim.frame }).accepted)
        sim[action.kind](action.action);
      pending.splice(i, 1);
    }
    sim.tick();
  }
  return { boundaries, outcome: { won: sim.won, frame: sim.frame,
    death: sim.death?.reason ?? null } };
}

/** Rebuild the same decisions from the stream alone. No engine is consulted. */
function replay(stream) {
  const controller = new CycleController({ cycles: LIBRARY_IDS.map(getCycle) });
  const pending = [];
  const rebuilt = [];
  let frame = 0;
  for (const boundary of stream.boundaries) {
    // Advance the caller's queue exactly as the recording did.
    while (frame < boundary.frame) {
      for (let i = pending.length - 1; i >= 0; i--) {
        if (frame < pending[i].dueFrame) continue;
        controller.releaseDeferred(pending[i], { frame });
        pending.splice(i, 1);
      }
      frame++;
    }
    controller.observe(boundary.facts, { frame: boundary.frame });
    const decision = controller.plan({
      exactGate: cycle => {
        const accepted = boundary.gates[cycle.id];
        if (accepted === undefined)
          throw new Error(`replay: no retained verdict for ${cycle.id} @${boundary.frame}`);
        return { accepted, reason: accepted ? null : 'retained-refusal' };
      },
      score: route,
    });
    const committed = commitOf(controller, decision, boundary.frame);
    for (const action of committed.deferred) pending.push(action);
    rebuilt.push({
      frame: boundary.frame,
      selected: decision.selected ?? null,
      reason: decision.reason ?? decision.record?.reason ?? null,
      actions: committed.actions.map(a => ({ kind: a.kind, action: a.action })),
    });
  }
  return rebuilt;
}

function commitId() {
  try { return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(); }
  catch { return 'UNKNOWN'; }
}

function manifestFor(stream, { night, seed, limitFrames }) {
  return {
    schema: FACT_STREAM_SCHEMA,
    producer: 'tools/factreplay.mjs',
    claim: 'MODEL_ONLY',
    note: 'simulator observer model; not a device capture, carries no device claim',
    night, seed, limitFrames,
    observer: { interval: 4, rngSeed: seed ^ 0x9e3779b9 },
    library: LIBRARY_IDS,
    windAt: WIND_AT,
    commit: commitId(),
    boundaries: stream.boundaries.length,
    outcome: stream.outcome,
    streamHash: stableHash(stream.boundaries),
  };
}

function write(path, stream, options) {
  mkdirSync(dirname(path), { recursive: true });
  const lines = [canonicalJson(manifestFor(stream, options)).trim()];
  for (const boundary of stream.boundaries) lines.push(canonicalJson(boundary).trim());
  writeFileSync(path, `${lines.join('\n')}\n`);
}

function read(path) {
  const lines = readFileSync(path, 'utf8').trim().split('\n');
  const manifest = JSON.parse(lines[0]);
  if (manifest.schema !== FACT_STREAM_SCHEMA)
    throw new Error(`unexpected stream schema ${manifest.schema}`);
  const boundaries = lines.slice(1).map(line => JSON.parse(line));
  const hash = stableHash(boundaries);
  if (hash !== manifest.streamHash)
    throw new Error(`stream digest mismatch: manifest ${manifest.streamHash}, actual ${hash}`);
  return { manifest, boundaries };
}

const argOf = name => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
};
const ASSERT = process.argv.includes('--assert');
const night = Number(argOf('--night') ?? 1);
const seed = Number(argOf('--seed') ?? 0);
const limitFrames = Number(argOf('--frames') ?? (ASSERT ? C.s(120) : C.NIGHT_FRAMES));

const recordPath = argOf('--record');
const replayPath = argOf('--replay');
const path = recordPath ?? replayPath ??
  `captures/traces/night${night}-seed${seed}.jsonl`;

if (!replayPath || recordPath) {
  const stream = record({ night, seed, limitFrames });
  write(path, stream, { night, seed, limitFrames });
  console.log(`recorded ${stream.boundaries.length} boundaries -> ${path}`);
  console.log(`  outcome ${JSON.stringify(stream.outcome)}`);
}

const loaded = read(path);
const rebuilt = replay(loaded);
console.log(`replayed ${rebuilt.length} boundaries from ${path}` +
  ` (digest ${loaded.manifest.streamHash.slice(0, 12)})`);

const mismatches = [];
for (const [index, expected] of loaded.boundaries.entries()) {
  const actual = rebuilt[index];
  const want = canonicalJson({ frame: expected.frame, selected: expected.selected,
    reason: expected.reason, actions: expected.actions });
  const got = canonicalJson({ frame: actual.frame, selected: actual.selected,
    reason: actual.reason, actions: actual.actions });
  if (want !== got) mismatches.push({ index, frame: expected.frame, want, got });
}

if (mismatches.length) {
  console.error(`replay diverged at ${mismatches.length}/${loaded.boundaries.length} boundaries`);
  for (const mismatch of mismatches.slice(0, 3))
    console.error(`  @${mismatch.frame}\n    recorded ${mismatch.want.trim()}\n    replayed ${mismatch.got.trim()}`);
  process.exitCode = 1;
} else {
  console.log(`ok   replay rebuilt all ${rebuilt.length} decisions identically`);
}

if (ASSERT && !mismatches.length) {
  const selected = rebuilt.filter(entry => entry.selected).length;
  if (selected === 0) { console.error('FAIL replay selected no cycle at all'); process.exitCode = 1; }
  else console.log(`ok   the replayed stream contains ${selected} real cycle selections`);
}
