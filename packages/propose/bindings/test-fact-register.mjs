#!/usr/bin/env node
// Refuse an actuating module that decides a fact on weaker evidence than the
// repository already has a producer for.
//
// This is the gate for the class of miss that cost 2026-09-11 a night and a
// hypothesis. `intersection-state-gate.ts` consumes the helper's native button
// downstroke scores for maskOn and says "a missing stroke score is a refusal,
// never a luma fallback". The executor answers the same question from the 20x9
// grid and falls back to exactly that luma refutation -- and every CORRECTED
// gate in the 2026-09-12T02-20 run decided on a frame whose screen the
// classifier could not even identify. Both files had been in the tree for
// weeks. Nothing compared them, because nothing was looking at FACTS.
//
// The rule is narrow on purpose. It fires only where the weakness can actuate:
// a producer under `packages/play/src/campaign`, the lane that presses buttons, using
// evidence ranked below the best the tree offers for that fact. Facts whose
// authority the charter fixes -- screen identity and the night origin, where
// the Python classifier is authoritative BECAUSE a detector that knows one way
// to be dead must not be what says you are alive -- are reported and never
// ranked.
import { execSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, FACTS, ANCHOR_AIMS, ANCHOR_AIM_MIN_MARGIN_MS, UNTRACKED_WINNER_DEBT, anchorAimFor } from './fact-register.mjs';
import { compileBundle } from '../bin/plans/bundle.mjs';
import { stableHash } from '@sixam/kernel/contracts';
import { BINDINGS_DIR } from '@sixam/kernel';
import { winnerFiles } from '@sixam/review/evidence-pack';

const ROOT = resolve(join(fileURLToPath(new URL('.', import.meta.url)), '../../..'));

const ACTUATING = 'packages/play/src/campaign';
let failed = 0;
const fail = message => { failed += 1; process.stdout.write(`  FAIL ${message}\n`); };

const register = build();
for (const [fact, info] of Object.entries(register.facts)) {
  const rank = FACTS[fact].evidenceRanking;
  const best = info.strongestAvailable;
  if (info.authorityFixedByCharter) {
    process.stdout.write(`${fact}: not ranked ` +
      `(${info.producers.length} producers)\n`);
    continue;
  }
  if (!best) { process.stdout.write(`${fact}: no producer found\n`); continue; }
  const bestAt = rank.indexOf(best);
  // The rule is "must USE the strongest available evidence", not "must contain
  // no weaker path". A guarded fallback is legitimate -- the executor keeps the
  // bright-grid refutation for helper builds that publish no stroke scores, and
  // that is the abort case a night would otherwise end on. What is refused is
  // an actuating module that decides the fact WITHOUT the strongest evidence
  // the tree offers.
  const offenders = info.producers.filter(p => p.file.startsWith(ACTUATING) &&
    !p.evidence.includes(best));
  process.stdout.write(`${fact}: best available ${best}; ` +
    `${info.producers.length} producers, ${offenders.length} actuating without it\n`);
  for (const p of offenders) {
    const weakest = [...p.evidence].sort((a, b) => rank.indexOf(b) - rank.indexOf(a))[0];
    fail(`${p.file} decides ${fact} on ${weakest} without ${best}, which is available in ` +
      `${info.producers.filter(q => q.evidence.includes(best)).map(q => q.file).join(', ')}. ` +
      `This is the lane that presses buttons; a weak read here does not report a ` +
      `mistake, it makes one.`);
  }
}

// The anchored release aims where the register says, and the register says
// where the evidence measured -- for the binding that is actually bound.
for (const [hash, entry] of Object.entries(ANCHOR_AIMS)) {
  const found = anchorAimFor(hash);
  if (!found.ok) { fail(`anchor aim ${hash}: ${found.reason}`); continue; }
  process.stdout.write(`anchor aim ${hash}: ${entry.aimMs} ms + L [${entry.latencyMs?.min ?? 0}, ${entry.latencyMs?.max ?? 0}] inside [${found.band.fromMs}, ${found.band.toMs}] ` +
    `with >= ${ANCHOR_AIM_MIN_MARGIN_MS} ms margin, ${JSON.parse(readFileSync(join(ROOT, entry.evidence), 'utf8')).confirmations3000.length} clean 3000-seed rows\n`);
}
// A registered binding must be rebuildable from the tree: its winner.json,
// hashed as stored, must be committed under packages/propose/bindings/<game>/. The
// thirteen bindings registered before 2026-09-15 were carried as a closed debt
// list; on 2026-09-25 ten of the eleven left were found on this machine and
// committed, and the one that no longer rebuilds is all that remains. Anything
// else without a tracked winner is refused, and so is any growth of that list.
const trackedWinners = new Map(winnerFiles(ROOT)
  .map(file => [stableHash(JSON.parse(readFileSync(join(ROOT, file), 'utf8'))), basename(file)]));
const DEBT_CEILING = 1;
if (Object.keys(UNTRACKED_WINNER_DEBT).length > DEBT_CEILING)
  fail(`UNTRACKED_WINNER_DEBT grew past its ${DEBT_CEILING} closed entries: commit the winner instead`);
for (const hash of Object.keys(UNTRACKED_WINNER_DEBT))
  if (!ANCHOR_AIMS[hash]) fail(`UNTRACKED_WINNER_DEBT names ${hash}, which has no anchor entry`);
for (const [hash, entry] of Object.entries(ANCHOR_AIMS)) {
  if (trackedWinners.has(hash)) {
    process.stdout.write(`binding ${hash} (night ${entry.night}): tracked winner ${trackedWinners.get(hash)}\n`);
    if (UNTRACKED_WINNER_DEBT[hash]) fail(`binding ${hash} is tracked now: remove it from UNTRACKED_WINNER_DEBT`);
  } else if (UNTRACKED_WINNER_DEBT[hash]) {
    process.stdout.write(`binding ${hash} (night ${entry.night}): UNTRACKED winner -- ${UNTRACKED_WINNER_DEBT[hash]}\n`);
  } else {
    fail(`binding ${hash} (night ${entry.night}) has an anchor aim but no tracked ${BINDINGS_DIR}/<game>/*-winner.json with that stableHash`);
  }
}
// The newest Night 5 qualification names the binding a run will carry; that
// binding must have an aim, or the next run anchors on nothing (which
// night-run.sh treats as "release the old way" -- loudly, but silently to
// the model).
// "Newest" is by the commit that last touched the file, not by name: two
// qualifications bound on the same day sort by name in the wrong order.
const committedAt = name => {
  try {
    return Number(execSync(`git log -1 --format=%ct -- ${JSON.stringify(join('docs/evidence', name))}`,
      { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()) || 0;
  } catch { return 0; }
};
const qualifications = readdirSync(join(ROOT, 'docs/evidence'))
  .filter(name => /^qualification-.*night5.*\.json$/.test(name));
const times = new Map(qualifications.map(name => [name, committedAt(name)]));
// A shallow clone (CI's checkout has depth 1) gives every file the same commit
// time; there "newest by commit" is meaningless and the name tie-break picked
// the wrong binding on 2026-09-12 (master red at d97cec8). Only judge the
// newest where history can order the files; say so otherwise.
const orderable = new Set(times.values()).size > 1 || qualifications.length === 1;
if (qualifications.length && orderable) {
  const newest = [...qualifications].sort((a, b) => times.get(a) - times.get(b) || a.localeCompare(b)).at(-1);
  const bound = JSON.parse(readFileSync(join(ROOT, 'docs/evidence', newest), 'utf8'));
  const hash = bound.policyHash ?? bound.winnerHash ?? bound.binding?.winnerHash;
  if (!hash) fail(`${newest} names no policy/winner hash`);
  else if (!ANCHOR_AIMS[hash])
    fail(`${newest} binds ${hash}, which has no anchor aim in ANCHOR_AIMS: derive its winning bands ` +
      '(docs/evidence/night5-anchor-aim-*.json) before a run anchors on a number priced for another policy');
  else process.stdout.write(`anchor aim: newest qualification ${newest} binds ${hash}, registered\n`);
} else if (qualifications.length) {
  const bound = qualifications.map(name => JSON.parse(readFileSync(join(ROOT, 'docs/evidence', name), 'utf8')))
    .map(q => q.policyHash ?? q.winnerHash ?? q.binding?.winnerHash).filter(Boolean);
  if (!bound.some(hash => ANCHOR_AIMS[hash]))
    fail(`none of the ${qualifications.length} Night 5 qualifications binds a policy with an anchor aim`);
  else process.stdout.write(`anchor aim: git history is shallow here, so the newest qualification cannot be ordered; ` +
    `${bound.filter(hash => ANCHOR_AIMS[hash]).length} of ${bound.length} bound policies have an aim (the full-history push gate checks the newest)\n`);
}
if (!ANCHOR_AIMS['fnv1a-81b5e51c'] || anchorAimFor('fnv1a-00000000').ok)
  fail('anchorAimFor must refuse an unknown binding');

// A migrated binding inherits an aim only while it emits the SAME schedule.
// The aim is a phase of the plan; the register's key is stableHash(winner),
// which moves when an unrelated KNOBS0 default is added. That happened to
// Night 6 h (observeUntilMs gained a default) and the migration was recorded
// only as prose in UNTRACKED_WINNER_DEBT, so every run since had to be
// hand-fed the aim -- twice, on 2026-09-20, into a release that discarded it.
// `alsoBinds` makes the inheritance executable, and this re-emits the winner
// to prove the claim that justifies it rather than trusting the note.
for (const [hash, entry] of Object.entries(ANCHOR_AIMS)) {
  for (const [migrated, file] of Object.entries(entry.alsoBinds ?? {})) {
    if (typeof entry.replayHash !== 'string') {
      fail(`binding ${hash} declares alsoBinds but no replayHash: without the plan hash nothing can ` +
        'check that the migrated winner still emits the schedule the aim was measured on');
      continue;
    }
    let stored;
    try { stored = JSON.parse(readFileSync(join(ROOT, file), 'utf8')); }
    catch (error) { fail(`alsoBinds ${migrated} -> ${hash}: ${file} unreadable (${error.message})`); continue; }
    const raw = stableHash(stored);
    if (raw !== migrated) {
      fail(`alsoBinds names ${file} for ${migrated}, but that file hashes to ${raw}: re-key the alias`);
      continue;
    }
    if (stored.gate?.replayHash !== entry.replayHash) {
      fail(`${file} carries gate.replayHash ${stored.gate?.replayHash}, the register ${entry.replayHash}`);
      continue;
    }
    // The winner's own gate can only restate what it was emitted with, so
    // compile it here: a plan drift that re-hashed the winner AND edited its
    // gate would pass every string comparison above.
    const out = mkdtempSync(join(tmpdir(), 'fnaf2-alsobinds-'));
    try {
      const built = compileBundle(stored, out);
      if (built.replay.hash !== entry.replayHash)
        fail(`alsoBinds ${migrated} -> ${hash}: ${file} now emits plan ${built.replay.hash}, not the ` +
          `${entry.replayHash} the aim was measured on. The aim belongs to the schedule: re-measure it ` +
          'or drop the alias -- never let a changed plan inherit a number priced for the old one.');
      else if (stableHash(built.winner ?? stored) !== migrated)
        fail(`alsoBinds ${migrated} -> ${hash}: ${file} normalises to ${stableHash(built.winner ?? stored)}; ` +
          'the alias key must be the hash a bundle manifest carries');
      else process.stdout.write(`anchor aim ${hash}: also binds ${migrated} (${file}), same plan ${entry.replayHash}\n`);
    } catch (error) {
      fail(`alsoBinds ${migrated} -> ${hash}: ${file} no longer emits (${error.message})`);
    } finally { rmSync(out, { recursive: true, force: true }); }
  }
}

if (failed) {
  process.stdout.write(`\nfact register: ${failed} finding(s).\n`);
  process.exit(1);
}
process.stdout.write('fact register: every actuating consumer decides on the strongest evidence ' +
  'the tree provides for that fact\n');
