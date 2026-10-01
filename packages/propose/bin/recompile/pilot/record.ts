#!/usr/bin/env node
/**
 * recompile-pilot-night-v1: one rebuilt night won by the pilot and replayed
 * without it.
 *
 *   node packages/propose/bin/recompile/pilot/record.ts record --game fnaf3|fnaf4 --pilot DIR --replay DIR
 *        --input-out tools/recompile/fixtures/<name>.input --out tools/recompile/results/<name>.json
 *        --night TEXT --policy NAME [--knobs JSON] [--win-key KEY=VALUE ...]
 *   node packages/propose/bin/recompile/pilot/record.ts check RESULT.json ...
 *
 * `record` reads the pilot run (its policy summary) and the replay's
 * replay-summary.json (replay.ts), copies the applied input rows to a
 * committed fixture -- touch coordinates and update numbers, no game content
 * -- and writes the record: hashes of the binary, assets, save and input, the
 * two trace digests, the frames visited, and the save keys the game wrote.
 * A `--win-key` names a key the game writes only for this win (FNaF 3's
 * `4thstar=1`, FNaF 4's `beat8=1`); the record is WON only if the save before
 * the night lacks every one, the replay's save holds every one, and the
 * replay's trace equals the pilot's.
 * `check` re-derives the verdict and the evidenceId from the record and the
 * committed input fixture.
 */
import { createHash } from 'node:crypto';
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { currentPath } from '@sixam/review/renamed-path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../../../../..');
// A path a committed record names, where it lives now (records keep the paths they were written with).
const current = (path) => currentPath(ROOT, path) ?? path;
export const SCHEMA = 'recompile-pilot-night-v1';

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}

export function evidenceId(record) {
  const body = { ...record };
  delete body.evidenceId;
  return `recompile-pilot-night-${sha256(canonical(body)).slice(0, 16)}`;
}

/** `key=value` lines of an INI section, as the game wrote them. */
export function iniKeys(text) {
  const out = {};
  let section = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const sec = /^\[(.+)\]$/.exec(line);
    if (sec) { section = sec[1]; continue; }
    const kv = /^([^=]+)=(.*)$/.exec(line);
    if (kv && section) out[`${section}.${kv[1]}`] = kv[2];
  }
  return out;
}

/** The verdict a record's own fields support. */
export function verdict(r) {
  // A win key proves the win only if the game wrote it: absent (or other)
  // before the night, present after.
  const missing = r.winKeys.filter((k) => {
    const [key, value] = k.split('=');
    return r.saveAfter[key] !== value || r.saveBefore.keys[key] === value;
  });
  if (!r.replay.traceEqual) return { status: 'REPLAY_DIVERGED', missing };
  if (missing.length) return { status: 'NOT_WON', missing };
  return { status: 'WON', missing };
}

function parseArgs(argv) {
  const o: any = { winKeys: [], knobs: {} };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const v = () => argv[++i];
    if (a === '--game') o.game = v();
    else if (a === '--pilot') o.pilot = resolve(v());
    else if (a === '--replay') o.replay = resolve(v());
    else if (a === '--input-out') o.inputOut = resolve(v());
    else if (a === '--out') o.out = resolve(v());
    else if (a === '--night') o.night = v();
    else if (a === '--policy') o.policy = v();
    else if (a === '--knobs') o.knobs = JSON.parse(v());
    else if (a === '--win-key') o.winKeys.push(v());
    else throw new Error(`record: unknown argument ${a}`);
  }
  return o;
}

function record(o) {
  const rs = JSON.parse(readFileSync(join(o.replay, 'replay-summary.json'), 'utf8'));
  const ps = JSON.parse(readFileSync(join(o.pilot, 'pilot-summary.json'), 'utf8'));
  const input = readFileSync(join(o.replay, 'run.input'));
  copyFileSync(join(o.replay, 'run.input'), o.inputOut);
  const saveBefore = readFileSync(join(o.replay, 'save-before.ini'), 'utf8');
  const rec = {
    schema: SCHEMA,
    evidenceId: null,
    claimLevel: 'MODEL_ONLY',
    fidelity: 'rebuilt-runtime',
    game: o.game,
    night: o.night,
    recordedAt: new Date().toISOString().slice(0, 10),
    question: `Does the rebuilt ${o.game} reach 6 AM on its hardest night from the recorded touches alone?`,
    controller: {
      policy: o.policy, knobs: o.knobs, source: `tools/recompile/pilot/${o.game}.mjs`,
      reads: 'the rebuilt runtime\'s own objects each update (an oracle, not a player\'s view)',
      acts: 'in-window touches only, through the harness input path',
      pilotOutcome: ps.outcome ?? null,
    },
    binarySha256: rs.binarySha256,
    assetsSha256: rs.assetsSha256,
    seed: Number(readFileSync(join(o.replay, 'env'), 'utf8').match(/CHOWDREN_SEED=(\d+)/)[1]),
    saveBefore: { sha256: rs.saveBeforeSha256, keys: iniKeys(saveBefore) },
    input: { fixture: relative(ROOT, o.inputOut), sha256: sha256(input),
      rows: input.toString().split('\n').filter((l) => l && !l.startsWith('#')).length },
    pilotTrace: { rows: rs.pilotTrace.rows, sha256: rs.pilotTrace.sha256 },
    replay: { rows: rs.replayTrace.rows, sha256: rs.replayTrace.sha256, traceEqual: rs.traceEqual,
      visits: rs.replayTrace.visits },
    saveAfter: iniKeys(rs.saveAfter),
    winKeys: o.winKeys,
    status: null,
  };
  rec.status = verdict(rec).status;
  rec.evidenceId = evidenceId(rec);
  writeFileSync(o.out, JSON.stringify(rec, null, 1) + '\n');
  console.log(`${rec.evidenceId}: ${o.game} ${rec.status} (${rec.input.rows} rows, trace ${rec.replay.traceEqual ? 'equal' : 'DIVERGED'})`);
}

export function check(path) {
  const r = JSON.parse(readFileSync(path, 'utf8'));
  if (r.schema !== SCHEMA) throw new Error(`${path}: schema ${r.schema}`);
  const input = readFileSync(join(ROOT, current(r.input.fixture)));
  if (sha256(input) !== r.input.sha256) throw new Error(`${path}: ${r.input.fixture} sha256 differs from the record`);
  const rows = input.toString().split('\n').filter((l) => l && !l.startsWith('#')).length;
  if (rows !== r.input.rows) throw new Error(`${path}: ${rows} input rows, record says ${r.input.rows}`);
  const v = verdict(r);
  if (v.status !== r.status) throw new Error(`${path}: status ${r.status}, fields support ${v.status}`);
  if (evidenceId(r) !== r.evidenceId) throw new Error(`${path}: evidenceId ${r.evidenceId} is not ${evidenceId(r)}`);
  return r;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [cmd, ...rest] = process.argv.slice(2);
  try {
    if (cmd === 'record') record(parseArgs(rest));
    else if (cmd === 'check') for (const p of rest) { const r = check(p); console.log(`${r.evidenceId}: ${r.game} ${r.status} OK`); }
    else throw new Error('usage: record.ts record ... | check RESULT.json ...');
  } catch (e) { console.error(e.message); process.exit(1); }
}
