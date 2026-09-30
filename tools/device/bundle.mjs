// Winner -> device bundle compiler and validator.
//
// The bundle is deliberately a host-side, content-addressed handoff.  A
// runner may consume it, but it must not reconstruct a policy from loose
// environment variables.  New strategies register an emitter and a replay
// adapter below; the bundle format and validation gates stay shared.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { emitPlan as emitToysPlan, KNOBS0 as TOYS_KNOBS,
  replay as replayToys } from './minus-toys-plan.mjs';
import { emitPlan as emitMinus3Plan, KNOBS0 as MINUS3_KNOBS,
  replay as replayMinus3 } from './minus-3-plan.mjs';
import { build as buildMinus7, devicePlan as emitMinus7Plan,
  idleUntilMs, replay as replayMinus7, MASK_RAISE_GAP_MS } from './recipe.mjs';
import { compileArtifactPlans, persistArtifactPlans } from './artifact-commands.mjs';
import { canonicalJson, stableHash } from '@sixam/kernel/contracts';
import { resolveDeviceProfile } from '@sixam/source';
import { FNAF2_CONTROL_VOCABULARY as V } from '@sixam/source';
import * as C from '@sixam/source/fnaf2';

export const WINNER_SCHEMA = 'winner-v1';
export const BUNDLE_SCHEMA = 'device-bundle-v1';
export const REPLAY_SCHEMA = 'bundle-replay-v1';
export const ARTIFACT_SCHEMA = 'device-artifact-v1';

const ROOT = resolve(join(fileURLToPath(new URL('.', import.meta.url)), '../..'));
const PROFILE_DIR = join(ROOT, 'apps/device/profiles');
const MAX_REPLAY_SEEDS = 8;
const CONTROL_NAMES = new Set([
  V.monitor, V.mask, V.wind, V.cameraFeedLight, V.hallLight,
  V.leftVentLight, V.rightVentLight,
  'cam4', 'cam5', 'cam7', 'cam8', 'cam9', 'cam10', 'cam11',
]);
const ROW_KINDS = new Set(['tap', 'hold', 'hall', 'hallvent', 'hallraise', 'maskraise', 'sweep', 'read', 'camdrop']);

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fail = message => { throw new TypeError(`device bundle: ${message}`); };
const nonNegativeInt = (value, label) => {
  if (!Number.isInteger(value) || value < 0) fail(`${label} must be a non-negative integer`);
  return value;
};
const sha256 = text => createHash('sha256').update(text).digest('hex');
const jsonRead = path => JSON.parse(readFileSync(path, 'utf8'));
const jsonWrite = (path, value) => writeFileSync(path, canonicalJson(value));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function normalizeStrategy(strategy) {
  const aliases = { 'minus-3': 'minus3', 'minus_3': 'minus3',
    'minus-7': 'minus7', 'minus-07': 'minus7', 'minus_toys': 'minus-toys' };
  const normalized = aliases[strategy] ?? strategy;
  if (!['minus-toys', 'minus3', 'minus7'].includes(normalized))
    fail(`no device emitter is registered for strategy ${JSON.stringify(strategy)}`);
  return normalized;
}

function nightsOf(winner) {
  const nights = winner.nights ?? (winner.night === undefined ? undefined : [winner.night]);
  if (!Array.isArray(nights) || nights.length === 0) fail('nights must be a non-empty array');
  const unique = [...new Set(nights.map((night, index) => nonNegativeInt(night, `nights[${index}]`)))];
  if (unique.some(night => night < 1 || night > 7)) fail('nights must be in the range 1..7');
  if (unique.length !== nights.length) fail('nights must not contain duplicates');
  return unique;
}

// A death-targeting bundle is built to test a model prediction of a DEATH, not
// to win: the gate is honestly not PASS, and the prediction it carries is the
// claim the run will be read against (killer shares and death-time quantiles
// over the phases a drawn epoch can land on, at the 3000-replay standard).
// It rides in the manifest so nothing downstream can mistake such a run for a
// route claim. Written by tools/device/death-prediction.mjs.
export const DEATH_PREDICTION_SCHEMA = 'death-prediction-v1';
export const DEATH_TARGETED_STATUS = 'DEATH_TARGETED';
const MIN_PREDICTION_REPLAYS = 3000;

export function validateDeathPrediction(prediction, nights) {
  if (!isRecord(prediction) || prediction.schema !== DEATH_PREDICTION_SCHEMA)
    fail(`a ${DEATH_TARGETED_STATUS} gate requires a ${DEATH_PREDICTION_SCHEMA} prediction`);
  if (!nights.includes(prediction.night)) fail('death prediction night is not a winner night');
  if (!Number.isInteger(prediction.replays) || prediction.replays < MIN_PREDICTION_REPLAYS)
    fail(`death prediction needs at least ${MIN_PREDICTION_REPLAYS} replays`);
  // A phase-blind strategy (minus3, minus7: replay accepts no epoch) cannot
  // span phases, and twenty identical replays reported as a span would be a
  // tautology -- the same refusal this file already makes when it will not
  // certify "a phase no census has seen". Such a prediction must SAY it is
  // phase-blind and carry the single phase it really saw; it may not quietly
  // present one phase as many, nor claim blindness while listing several.
  // The phase space is the binding's release period. A hard 1000 here refused
  // the only correct sweep for a night that releases on the five-second Foxy
  // roll grid, which is nights 6 and 7 -- every one of their ANCHOR_AIMS
  // entries carries periodMs 5000.
  const predictionPeriodMs = prediction.periodMs ?? 1000;
  if (!Number.isInteger(predictionPeriodMs) || predictionPeriodMs < 1)
    fail('death prediction periodMs must be a positive integer');
  if (!Array.isArray(prediction.phasesMs) ||
      prediction.phasesMs.some(ms => !Number.isInteger(ms) || ms < 0 || ms >= predictionPeriodMs))
    fail(`death prediction phases must be integers in [0, ${predictionPeriodMs})`);
  if (prediction.phaseBlind === true) {
    if (prediction.phasesMs.length !== 1)
      fail('a phaseBlind death prediction must carry exactly the one phase it scored');
  } else if (prediction.phasesMs.length < 2)
    fail('death prediction must span several epoch phases in [0, 1000), or declare phaseBlind');
  if (!Number.isInteger(prediction.wins) || prediction.wins < 0 || prediction.wins > prediction.replays)
    fail('death prediction wins is invalid');
  if (!Array.isArray(prediction.killers) || prediction.killers.length === 0) fail('death prediction names no killer');
  let counted = 0;
  for (const entry of prediction.killers) {
    if (!isRecord(entry) || typeof entry.killer !== 'string' || !Number.isInteger(entry.count) || entry.count < 1)
      fail('death prediction killer entry is malformed');
    const t = entry.tSeconds;
    if (!isRecord(t) || ['min', 'p10', 'p50', 'p90', 'max'].some(k => typeof t[k] !== 'number' || !Number.isFinite(t[k])) ||
        !(t.min <= t.p10 && t.p10 <= t.p50 && t.p50 <= t.p90 && t.p90 <= t.max))
      fail(`death prediction quantiles for ${entry.killer} are malformed`);
    counted += entry.count;
  }
  if (counted + prediction.wins !== prediction.replays) fail('death prediction counts do not add up to its replays');
  if (typeof prediction.generatedBy !== 'string' || prediction.generatedBy.length === 0)
    fail('death prediction must name its generator');
  return prediction;
}

function validateGate(gate, engineHash, nights, seeds) {
  if (!isRecord(gate)) fail('gate is required');
  if (gate.status === DEATH_TARGETED_STATUS) validateDeathPrediction(gate.prediction, nights);
  else if (gate.status !== 'PASS') fail(`gate status must be PASS or ${DEATH_TARGETED_STATUS}, got ${JSON.stringify(gate.status)}`);
  if (gate.engineHash !== undefined && gate.engineHash !== engineHash)
    fail('gate.engineHash does not match winner.engineHash');
  if (gate.nights !== undefined && !same(gate.nights, nights)) fail('gate.nights does not match winner.nights');
  if (gate.seeds !== undefined && !same(gate.seeds, seeds)) fail('gate.seeds does not match winner.seeds');
  if (gate.claimLevel !== undefined && !['MODEL_ONLY', 'FIXTURE', 'DEVICE_MEASURED'].includes(gate.claimLevel))
    fail('gate.claimLevel is invalid');
  return gate;
}

export function validateWinner(input) {
  if (!isRecord(input) || input.schema !== WINNER_SCHEMA) fail('winner schema mismatch');
  const strategy = normalizeStrategy(input.strategy);
  if (!isRecord(input.knobs) && typeof input.knobs !== 'string') fail('knobs must be an object or named preset');
  if (strategy === 'minus7' && !isRecord(input.knobs)) fail('minus7 knobs must be an object');
  if (typeof input.engineHash !== 'string' || input.engineHash.length === 0) fail('engineHash is required');
  const nights = nightsOf(input);
  if (!Array.isArray(input.seeds) || input.seeds.length === 0) fail('seeds must be a non-empty array');
  const seeds = input.seeds.map((seed, index) => nonNegativeInt(seed, `seeds[${index}]`));
  if (input.replaySeeds !== undefined) {
    if (!Array.isArray(input.replaySeeds) || input.replaySeeds.length === 0)
      fail('replaySeeds must be a non-empty array when present');
    input.replaySeeds.forEach((seed, index) => nonNegativeInt(seed, `replaySeeds[${index}]`));
  }
  if (input.phaseOffsetMs !== undefined &&
      (!Number.isInteger(input.phaseOffsetMs) || input.phaseOffsetMs < 0 || input.phaseOffsetMs > 2000))
    fail('phaseOffsetMs must be an integer in 0..2000 ms');
  // The epoch the anchored release is registered to deliver (fact-register
  // ANCHOR_AIMS: aim + actuation latency), so the gate replays the phase the
  // phone will actually run. Night 6 wins only in a band of the five-second
  // Foxy roll grid; a gate scored at epoch 0 says nothing about that band.
  if (input.anchorEpochMs !== undefined &&
      (!Number.isInteger(input.anchorEpochMs) || input.anchorEpochMs < 0 || input.anchorEpochMs > 10000))
    fail('anchorEpochMs must be an integer in 0..10000 ms');
  validateGate(input.gate, input.engineHash, nights, seeds);
  if (input.profile !== undefined && typeof input.profile !== 'string' && !isRecord(input.profile))
    fail('profile must be a profile id, path, or object');
  const knobs = strategy === 'minus-toys' ? toysKnobs(input.knobs)
    : strategy === 'minus3' ? minus3Knobs(input.knobs) : { ...input.knobs };
  return { ...input, schema: WINNER_SCHEMA, strategy, nights, seeds, knobs };
}

function resolveProfile(spec) {
  if (isRecord(spec)) {
    resolveDeviceProfile(spec);
    return spec;
  }
  const id = spec ?? 'fixture-hid-screencap';
  if (typeof id !== 'string' || id.length === 0) fail('profile id is invalid');
  const path = id.endsWith('.json') ? resolve(ROOT, id) : join(PROFILE_DIR, `${id}.json`);
  let profile;
  try { profile = jsonRead(path); } catch (error) {
    fail(`cannot read profile ${JSON.stringify(id)}: ${error.message}`);
  }
  resolveDeviceProfile(profile);
  return profile;
}

function numberToken(value, label, { integer = false, positive = false } = {}) {
  if (!/^\d+(?:\.\d+)?$/.test(value ?? '')) fail(`${label} is not a non-negative number`);
  const result = Number(value);
  if (integer && !Number.isInteger(result)) fail(`${label} must be an integer`);
  if (positive && result <= 0) fail(`${label} must be positive`);
  return result;
}

function parseRow(line, cycle) {
  const fields = line.trim().split(/\s+/);
  const at = numberToken(fields.shift(), `${cycle} row time`, { integer: true });
  const kind = fields.shift();
  if (!ROW_KINDS.has(kind)) fail(`${cycle} contains unsupported instruction ${JSON.stringify(kind)}`);
  if (kind === 'tap' || kind === 'hold') {
    if (fields.length !== 2 || !CONTROL_NAMES.has(fields[0])) fail(`${cycle} ${kind} row has an unsupported control`);
    const duration = numberToken(fields[1], `${cycle} ${kind} contact`, { positive: true });
    return { at, kind, control: fields[0], duration };
  }
  if (kind === 'hall') {
    if (fields.length !== 1) fail(`${cycle} hall row shape is invalid`);
    return { at, kind, duration: numberToken(fields[0], `${cycle} hall contact`, { positive: true }) };
  }
  if (kind === 'hallvent') {
    if (fields.length !== 1) fail(`${cycle} hallvent row shape is invalid`);
    return { at, kind, duration: numberToken(fields[0], `${cycle} hall/right-vent contact`, { positive: true }) };
  }
  if (kind === 'hallraise') {
    if (fields.length !== 1) fail(`${cycle} hallraise row shape is invalid`);
    return { at, kind, duration: numberToken(fields[0], `${cycle} hallraise contact`, { positive: true }) };
  }
  if (kind === 'maskraise') {
    if (fields.length !== 3 || !['hall', 'up'].includes(fields[1])) fail(`${cycle} maskraise row shape is invalid`);
    const gap = numberToken(fields[0], `${cycle} maskraise gap`, { positive: true });
    const duration = numberToken(fields[2], `${cycle} maskraise duration`, { positive: true });
    if (gap < MASK_RAISE_GAP_MS)
      fail(`${cycle} maskraise gap must be at least the sourced ${MASK_RAISE_GAP_MS} ms mask-off completion gap`);
    return { at, kind, gap, mode: fields[1], duration };
  }
  if (kind === 'camdrop') {
    if (fields.length !== 3) fail(`${cycle} camdrop row shape is invalid`);
    return { at, kind, lead: numberToken(fields[0], `${cycle} camdrop lead`),
      contact: numberToken(fields[1], `${cycle} camdrop monitor contact`, { positive: true }),
      tail: numberToken(fields[2], `${cycle} camdrop tail`) };
  }
  if (kind === 'sweep') {
    if (fields.length !== 3) fail(`${cycle} sweep row shape is invalid`);
    const spacing = numberToken(fields[0], `${cycle} sweep spacing`, { positive: true });
    const contact = numberToken(fields[1], `${cycle} sweep contact`, { positive: true });
    const cams = fields[2].split(',');
    if (cams.length < 2 || cams.some(cam => !/^cam(?:4|5|7|8|9|10|11)(?::\d+)?$/.test(`cam${cam}`)))
      fail(`${cycle} sweep contains an unsupported camera list`);
    if (spacing <= contact) fail(`${cycle} sweep spacing must exceed contact`);
    for (const cam of cams) {
      const [name, override] = cam.split(':');
      if (override !== undefined) numberToken(override, `${cycle} sweep ${name} contact`, { positive: true });
    }
    return { at, kind, spacing, contact, cams };
  }
  // read duration gap [hallAt hallDuration [bangage hallAge]]
  if (fields.length < 2 || fields.length > 6) fail(`${cycle} read row shape is invalid`);
  const duration = numberToken(fields[0], `${cycle} read duration`, { positive: true });
  const gap = numberToken(fields[1], `${cycle} read gap`);
  if (fields.length === 2) return { at, kind, duration, gap };
  if (fields.length < 4) fail(`${cycle} read hall fields are incomplete`);
  const hallAt = numberToken(fields[2], `${cycle} read hall offset`);
  const hallDuration = numberToken(fields[3], `${cycle} read hall contact`, { positive: true });
  if (fields.length === 4) return { at, kind, duration, gap, hallAt, hallDuration };
  if (fields[4] !== 'bangage' || fields.length !== 6)
    fail(`${cycle} read conditional hall fields are invalid`);
  return { at, kind, duration, gap, hallAt, hallDuration,
    hallMode: 'bangage', hallAge: numberToken(fields[5], `${cycle} read bang age`, { positive: true }) };
}

function profileControlKey(control) {
  if (/^cam\d+$/.test(control)) return `cam:${control.slice(3)}`;
  return control;
}

function assertProfileControls(row, profile, cycle) {
  if (!profile?.controlMap) fail('profile has no controlMap');
  const controls = row.kind === 'tap' || row.kind === 'hold' ? [row.control]
    : row.kind === 'camdrop' ? [V.cameraFeedLight, V.monitor]
      : row.kind === 'sweep' ? row.cams.map(cam => `cam${cam.split(':')[0]}`)
        : row.kind === 'read' ? [V.leftVentLight, V.mask, ...(row.hallAt === undefined ? [] : [V.hallLight])]
          : row.kind === 'hall' || row.kind === 'hallraise' ? [V.hallLight]
            : row.kind === 'hallvent' ? [V.hallLight, V.rightVentLight]
              : row.kind === 'maskraise' ? [V.mask, row.mode === 'hall' ? V.hallLight : V.monitor] : [];
  for (const control of controls) {
    const key = profileControlKey(control);
    if (!Object.hasOwn(profile.controlMap, key)) fail(`${cycle} control ${control} is absent from profile.controlMap`);
  }
}

/** Parse and validate exactly the finite instruction vocabulary of the phone interpreter. */
export function parsePlan(text, { strategy, night, profile } = {}) {
  if (typeof text !== 'string' || text.length === 0) fail('plan text is required');
  const headers = {};
  const cycles = {};
  let current = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('#')) {
      const match = line.match(/^#(\S+)(?:\s+(.*))?$/);
      if (!match) fail('invalid plan header');
      const [, name, value = ''] = match;
      if (name === 'cycle') {
        const parts = value.split(/\s+/);
        if (!['opening', 'toys', 'clear', 'attack', 'finish'].includes(parts[0]))
          fail(`unknown cycle ${parts[0]}`);
        if (cycles[parts[0]]) fail(`duplicate cycle ${parts[0]}`);
        cycles[parts[0]] = { lengthMs: parts[1] === undefined ? null : numberToken(parts[1], `${parts[0]} length`), rows: [] };
        current = parts[0];
      } else {
        if (Object.hasOwn(headers, name)) fail(`duplicate #${name} header`);
        headers[name] = value;
      }
      continue;
    }
    if (!current) fail('plan row appears before a cycle header');
    cycles[current].rows.push(parseRow(line, current));
  }
  for (const required of ['policy', 'night', 'period', 'loop-start', 'stop-at', 'observe-until'])
    if (!Object.hasOwn(headers, required)) fail(`missing #${required} header`);
  const actualNight = numberToken(headers.night, '#night', { integer: true, positive: true });
  const period = numberToken(headers.period, '#period', { integer: true, positive: true });
  const loopStart = numberToken(headers['loop-start'], '#loop-start', { integer: true });
  const stopAt = numberToken(headers['stop-at'], '#stop-at', { integer: true });
  const observeUntil = numberToken(headers['observe-until'], '#observe-until', { integer: true });
  if (stopAt <= loopStart || observeUntil < stopAt) fail('plan observation bounds are invalid');
  if (strategy && headers.policy !== strategy) fail(`plan policy ${headers.policy} does not match ${strategy}`);
  if (night !== undefined && actualNight !== night) fail(`plan night ${actualNight} does not match ${night}`);
  if (!cycles.opening) fail('plan has no opening cycle');
  if (!cycles.toys && !cycles.clear) fail('plan has neither toys nor clear cycle');
  const maxActions = profile?.limits?.maxActions ?? Infinity;
  const maxDuration = profile?.limits?.maxDurationMs ?? Infinity;
  for (const [name, cycle] of Object.entries(cycles)) {
    if (cycle.rows.length > maxActions) fail(`${name} has ${cycle.rows.length} rows; profile allows ${maxActions}`);
    let previous = -1;
    for (const row of cycle.rows) {
      if (row.at < previous) fail(`${name} rows are not in non-decreasing time order`);
      previous = row.at;
      const durations = row.kind === 'tap' || row.kind === 'hold' || row.kind === 'hall' || row.kind === 'hallvent' || row.kind === 'hallraise'
        ? [row.duration] : row.kind === 'camdrop' ? [row.lead, row.contact, row.tail]
          : row.kind === 'maskraise' ? [row.gap, row.duration] : row.kind === 'sweep'
            ? [row.spacing, row.contact, ...row.cams.map(cam => cam.includes(':') ? Number(cam.split(':')[1]) : row.contact)]
            : [row.duration, row.gap, ...(row.hallAt === undefined ? [] : [row.hallAt, row.hallDuration])];
      if (durations.some(value => value > maxDuration)) fail(`${name} has a timing above profile maxDurationMs=${maxDuration}`);
      assertProfileControls(row, profile, name);
    }
  }
  const armDeclared = headers['arm-verify'] !== undefined ||
    headers['arm-verify-cameras'] !== undefined || headers['arm-verify-until'] !== undefined ||
    headers['arm-verify-viewing'] !== undefined;
  let armVerification;
  if (armDeclared) {
    if (headers['arm-verify'] !== '1') fail('plan #arm-verify must be 1 when arm verification is declared');
    const cameras = (headers['arm-verify-cameras'] ?? '').split(',').filter(Boolean);
    if (cameras.length !== 2 || cameras.some(camera => !/^cam:(?:[1-9]|1[0-2])$/.test(camera)) ||
        new Set(cameras).size !== cameras.length)
      fail('plan #arm-verify-cameras must contain two unique semantic cameras');
    const viewing = headers['arm-verify-viewing'] ?? 'cam:11';
    if (!/^cam:(?:[1-9]|1[0-2])$/.test(viewing) || !cameras.includes(viewing))
      fail('plan #arm-verify-viewing must name one highlighted camera');
    const untilMs = numberToken(headers['arm-verify-until'], '#arm-verify-until', { integer: true, positive: true });
    if (untilMs >= observeUntil) fail('plan arm-verification must close before the observation envelope');
    armVerification = { cameras: [...cameras].sort((a, b) => Number(a.slice(4)) - Number(b.slice(4))), viewing, untilMs };
  }
  return { headers, night: actualNight, period, loopStart, stopAt, observeUntil, cycles, armVerification };
}

function addCommonHeaders(raw, { strategy, night, period, loopStart, stopAt, observeUntil, idleUntil,
  phaseOffsetMs, lengths }) {
  const lines = raw.trimEnd().split(/\r?\n/).filter(Boolean);
  const insert = [`#policy ${strategy}`, `#night ${night}`, `#period ${period}`,
    `#loop-start ${loopStart}`, `#stop-at ${stopAt}`, `#observe-until ${observeUntil}`];
  if (idleUntil > 0) insert.push(`#idle-until ${idleUntil}`);
  if (phaseOffsetMs !== undefined) insert.push(`#phase-offset ${phaseOffsetMs}`);
  const out = [];
  for (const line of lines) {
    if (line === `#policy ${strategy}`) {
      out.push(...insert);
    } else if (line.startsWith('#cycle ')) {
      const parts = line.split(/\s+/);
      const length = lengths[parts[1]];
      out.push(length === undefined || parts[2] !== undefined ? line : `${line} ${length}`);
    } else if (!line.startsWith('#night ') && !line.startsWith('#period ') &&
               !line.startsWith('#loop-start ') && !line.startsWith('#stop-at ') &&
               !line.startsWith('#observe-until ') && !line.startsWith('#idle-until ')) {
      out.push(line);
    }
  }
  return out.join('\n') + '\n';
}

function toysKnobs(input) {
  if (input === undefined || input === 'KNOBS0') return { ...TOYS_KNOBS };
  if (!isRecord(input)) fail('minus-toys knobs must be an object or KNOBS0');
  for (const key of Object.keys(input)) if (!Object.hasOwn(TOYS_KNOBS, key)) fail(`unknown minus-toys knob ${key}`);
  const defaults = { ...TOYS_KNOBS };
  // A newly introduced default must not silently change the policy identity of
  // an older winner. Its emitted behavior still receives the default through
  // this function, while an explicit field remains an opt-in policy change.
  if (!Object.hasOwn(input, 'loopContactMs')) delete defaults.loopContactMs;
  return { ...defaults, ...input };
}

function minus3Knobs(input) {
  if (input === undefined || input === 'KNOBS0') return { ...MINUS3_KNOBS };
  if (!isRecord(input)) fail('minus3 knobs must be an object or KNOBS0');
  for (const key of Object.keys(input)) if (!Object.hasOwn(MINUS3_KNOBS, key)) fail(`unknown minus3 knob ${key}`);
  return { ...MINUS3_KNOBS, ...input };
}

// The three Toys are what the CAM 09 marker freezes. Everything else that the
// night arms is still moving while the stall holds.
const TOY_STALL_FREEZES = Object.freeze(['toyfreddy', 'toybonnie', 'toychica']);
const ROSTER = Object.freeze(['withfreddy', 'withbonnie', 'withchica', 'foxy', 'toyfreddy',
  'toybonnie', 'toychica', 'mangle', 'bb', 'golden']);

// `minimal` is not a size setting. It parks the monitor up and drops the mask,
// the camdrop and the hall pulse entirely -- its whole steady cycle is a 100 ms
// flash and a 4400 ms wind -- which is only sound when every armed threat is one
// the stall actually freezes, leaving the box as the single live problem.
//
// Measured 2026-09-19: Night 1 is the ONLY night where that holds. It arms
// exactly the three Toys, and the CAM 09 marker freezes all three. From Night 2
// up the stall leaves 4 to 7 characters moving (N2 foxy/mangle/bb/golden, N3 the
// three Withereds plus foxy and bb), and a maskless cadence answers none of them.
// Until now `minimal` was a boolean any winner could set on any night with
// nothing checking it against the roster.
function assertMinimalFitsNight(night) {
  const armed = ROSTER.filter(id => C.peakAi(night, id) > 0);
  const loose = armed.filter(id => !TOY_STALL_FREEZES.includes(id));
  if (loose.length)
    fail(`minus-toys minimal on night ${night} parks the monitor and drops the mask, but the ` +
      `CAM 09 toy stall does not freeze ${loose.join(', ')}; minimal fits only a night whose ` +
      'armed roster the stall covers entirely');
}

function minusToysEmitter(winner, night) {
  const knobs = toysKnobs(winner.knobs);
  if (knobs.minimal) assertMinimalFitsNight(night);
  const period = knobs.minimal ? knobs.minPeriodMs : knobs.loopPeriodMs;
  const raw = emitToysPlan(night, knobs);
  // Story-night pacing from the sourced rule (recipe.idleUntilMs): Night 1's
  // first two in-game hours need nothing (Toys arm at 2 AM, g674; the box
  // does not drain before 2 AM, g653-660), so the opening and the loop both
  // wait for the first hour that can matter. Every other night acts from 0.
  // The engine replay gates the full-cadence schedule; this emitted idle is
  // the same schedule with its dead prefix removed, safe by the same sourced
  // rule the minus7 recipe trusts.
  const idleStart = Math.max(knobs.minimal ? knobs.minLoopStartMs : 0, idleUntilMs(night));
  const text = addCommonHeaders(raw, { strategy: 'minus-toys', night, period,
    loopStart: idleStart,
    stopAt: knobs.minimal ? knobs.minStopAtMs : 420000,
    observeUntil: knobs.minimal ? knobs.minObserveUntilMs : knobs.observeUntilMs,
    idleUntil: 0, phaseOffsetMs: winner.phaseOffsetMs,
    lengths: { opening: 7000, toys: period, finish: 420000 } });
  // The emitted plan carries `#phase-offset`, so the replay that gates it must
  // run at that phase. Without this the gate scores epoch 0 while the device
  // runs a rotated stream, and `gate.replayHash` -- the check that is supposed
  // to bind evidence to the artifact -- stays byte-identical across the change.
  // The device applies `#phase-offset` after the anchored release, so the
  // delivered epoch is the anchor's plus the offset.
  return { text, knobs,
    replay: seed => replayToys({ night, seed, knobs,
      epochMs: (winner.anchorEpochMs ?? 0) + (winner.phaseOffsetMs ?? 0) }) };
}

function minus3Emitter(winner, night) {
  const knobs = minus3Knobs(winner.knobs);
  const customNight = night === 7 ? minus3CustomNight(winner) : undefined;
  const raw = emitMinus3Plan(night, knobs);
  const text = addCommonHeaders(raw, { strategy: 'minus3', night,
    period: knobs.periodMs, loopStart: knobs.loopStartMs,
    stopAt: knobs.stopAtMs, observeUntil: knobs.observeUntilMs,
    idleUntil: 0, lengths: { opening: knobs.periodMs / 2, clear: knobs.periodMs } });
  return { text, knobs, replay: seed => replayMinus3({ night, seed, knobs, customNight }) };
}

// A night-7 minus3 winner must name the Custom Night dial vector it was gated
// on; the replay plays that vector and the campaign is fed the same expectation.
const MINUS3_DIALS = ['withfreddy', 'withbonnie', 'withchica', 'foxy', 'toyfreddy',
  'toybonnie', 'toychica', 'mangle', 'bb', 'golden'];
function minus3CustomNight(winner) {
  if (!isRecord(winner.dials)) fail('minus3 night 7 requires winner.dials (the Custom Night vector)');
  for (const dial of MINUS3_DIALS) {
    const value = winner.dials[dial];
    if (!Number.isInteger(value) || value < 0 || value > 20)
      fail(`winner.dials.${dial} must be an integer in 0..20`);
  }
  for (const key of Object.keys(winner.dials)) if (!MINUS3_DIALS.includes(key))
    fail(`winner.dials has unknown dial ${key}`);
  return { ...winner.dials };
}

function minus7Emitter(winner, night) {
  const knobs = isRecord(winner.knobs) ? winner.knobs : {};
  const device = isRecord(winner.planOptions) ? winner.planOptions : {};
  const { search, searchKnobs, ...recipeKnobs } = knobs;
  const recipe = buildMinus7({ night, ...recipeKnobs, knobs: searchKnobs ?? search ?? {} });
  const plan = emitMinus7Plan(recipe, { ...device, knobs: searchKnobs ?? search ?? {} });
  const lengths = Object.fromEntries(Object.entries(recipe.cycles).map(([name, cycle]) => [name, cycle.lengthMs]));
  // Three facts have to agree before a minus7 plan means the same thing to the
  // phone that it meant to the census that gated it.  Until 2026-09-19 none of
  // them did, which is why the catalog bundle existed and had never run: the
  // campaign refuses it outright (`nights[0].timing bounds are invalid`).
  //
  // 1. The idle is a SHIFT, not a header.  recipe.mjs's replay starts the whole
  //    schedule at `f(idleUntilMs)` (`const start = pilotOffset + f(idleUntilMs)`),
  //    but device-local-executor.js deliberately does NOT offset opening rows --
  //    "Opening rows are authored on the night timeline" -- because offsetting
  //    them once moved Night 1's arm to its 140 s idle boundary and left the
  //    monitor in the wrong parity.  So the shift belongs in the authored row
  //    times, not in `#idle-until`.
  // 2. The steady loop starts AFTER the opening.  The replay sets
  //    `base = start + f(7000)`; the executor expands steady rows from
  //    `max(loopStartMs, idleUntilMs)`.  `#loop-start 0` made the phone begin
  //    the 5 s loop on top of the 7 s opening.
  // 3. The executor cannot branch.  `expandNightBlocks` sends every cycle that
  //    is not opening/toys/finish at every period, so a plan carrying both of
  //    minus7's steady cycles would actuate `clear` AND `attack` on one beat --
  //    never the alternative the left-opening read chooses in the model.
  const idle = idleUntilMs(night);
  const openingMs = lengths.opening;
  if (!Number.isInteger(openingMs) || openingMs <= 0) fail('minus7 recipe has no opening length');
  const shift = row => {
    const space = row.indexOf(' ');
    if (space < 0) fail(`minus7 plan row is malformed: ${JSON.stringify(row)}`);
    return `${Number(row.slice(0, space)) + idle}${row.slice(space)}`;
  };
  // Fact 3 is a refusal, not a silent drop: the steady schedule is `clear`, and
  // a night whose model can reach `attack` has no single-cycle device form.
  // The winner must carry the census that shows the branch is unreachable.
  const steadyNames = Object.keys(plan).filter(name => name !== 'opening');
  const emitted = { ...plan };
  if (steadyNames.length > 1) {
    if (typeof winner.attackFreeEvidence !== 'string' || winner.attackFreeEvidence.length === 0)
      fail(`minus7 night ${night} emits ${steadyNames.join('+')}; the device executor cannot ` +
        'branch, so the winner must carry attackFreeEvidence showing the attack branch is unreachable');
    for (const name of steadyNames) if (name !== 'clear') delete emitted[name];
  }
  const lines = [`#policy minus7`, `#night ${night}`, `#period 5000`,
    `#loop-start ${idle + openingMs}`,
    `#stop-at 420000`, `#observe-until 420000`, `#idle-until ${idle}`];
  for (const [name, rows] of Object.entries(emitted)) {
    lines.push(`#cycle ${name} ${lengths[name]}`);
    lines.push(...(name === 'opening' ? rows.map(shift) : rows));
  }
  const text = lines.join('\n') + '\n';
  // The gate replays the reduced plan, not the authored one: what the census
  // scores is then exactly the cycle set the phone will actuate.  If the
  // dropped branch were in fact reachable, the replay says so -- in those
  // words -- instead of the bundle certifying a schedule the device cannot
  // run.  Reaching a dropped cycle surfaced as `Cannot read properties of
  // undefined (reading 'slice')` until 2026-09-19, which names neither the
  // branch nor the claim it falsifies.
  const dropped = Object.keys(plan).filter(name => !Object.hasOwn(emitted, name));
  return { text, knobs, recipe, plan: emitted,
    replay: seed => {
      try { return replayMinus7(emitted, { night, seed }); }
      catch (error) {
        if (dropped.length && /Cannot read propert/.test(error.message))
          fail(`minus7 night ${night} seed ${seed} reached the ${dropped.join('/')} branch that ` +
            'winner.attackFreeEvidence says is unreachable; that evidence is wrong for this night');
        throw error;
      }
    } };
}

// This registry is the extension seam: a new strategy owns only its winner
// normalization/emission and replay adapter. The bundle validator, manifest,
// profile binding, hash checks, and trial handoff remain strategy-independent.
// `phaseAware` names the strategies whose replay accepts an epoch. minus3 and
// minus7 replay at epoch 0 only, so a phase offset on one of those winners
// would be emitted into the plan and never scored; the validator refuses it
// rather than certifying a phase no census has seen.
export const STRATEGY_REGISTRY = Object.freeze({
  'minus-toys': Object.freeze({ emit: minusToysEmitter, phaseAware: true,
    sources: Object.freeze(['tools/device/minus-toys-plan.mjs', 'tools/device/recipe.mjs']) }),
  minus3: Object.freeze({ emit: minus3Emitter,
    sources: Object.freeze(['tools/device/minus-3-plan.mjs', 'tools/device/arm-verification.mjs']) }),
  minus7: Object.freeze({ emit: minus7Emitter,
    sources: Object.freeze(['tools/device/recipe.mjs', 'tools/model/hid-device-pilot.mjs']) }),
});

function emitterFor(winner, night) {
  const strategy = normalizeStrategy(winner.strategy);
  const entry = STRATEGY_REGISTRY[strategy];
  if (winner.phaseOffsetMs !== undefined && !entry.phaseAware)
    fail(`${strategy} cannot replay a phase offset`);
  if (winner.anchorEpochMs !== undefined && !entry.phaseAware)
    fail(`${strategy} cannot replay an anchor epoch`);
  return entry.emit(winner, night);
}

function strategySourceDigest(strategy) {
  const sources = STRATEGY_REGISTRY[strategy].sources;
  const bytes = sources.map(path => `${path}\n${readFileSync(join(ROOT, path), 'utf8')}`).join('\n');
  return { sources, sha256: sha256(bytes) };
}

function replaySummary(strategy, result, seed, night) {
  const sim = result.sim;
  return { strategy, night, seed, won: !!sim.won, alive: !!sim.alive,
    death: sim.death?.reason ?? null, frame: sim.frame,
    traceHash: stableHash(sim.events), eventCount: sim.events.length,
    minBox: result.minBox ?? null, splitAt: result.splitAt ?? null,
    missed: result.missed ?? null, detections: result.detections ?? null };
}

function replayWinner(winner, emittedByNight, replaySeeds) {
  const results = [];
  for (const night of winner.nights) {
    const emitter = emittedByNight.get(night);
    for (const seed of replaySeeds) results.push(replaySummary(winner.strategy,
      emitter.replay(seed), seed, night));
  }
  return { schema: REPLAY_SCHEMA, seeds: replaySeeds, results,
    hash: stableHash({ strategy: winner.strategy, results }) };
}

function normalizedWinner(winner, replay) {
  return { ...winner, schema: WINNER_SCHEMA,
    gate: { ...winner.gate, engineHash: winner.engineHash,
      nights: winner.nights, seeds: winner.seeds, replayHash: replay.hash } };
}

function bundlePlanEntries(manifest, directory) {
  return manifest.plans.map(entry => {
    if (!isRecord(entry) || typeof entry.file !== 'string' || entry.file !== entry.file.split('/').pop() ||
        !/^night-[1-7]\.plan$/.test(entry.file)) fail('manifest contains an unsafe plan filename');
    const path = join(directory, entry.file);
    const text = readFileSync(path, 'utf8');
    if (sha256(text) !== entry.sha256) fail(`${entry.file} hash does not match manifest`);
    return { ...entry, text };
  });
}

function validateManifestShape(manifest) {
  if (!isRecord(manifest) || manifest.schema !== BUNDLE_SCHEMA) fail('manifest schema mismatch');
  if (!Array.isArray(manifest.plans) || manifest.plans.length === 0) fail('manifest has no plans');
  if (!isRecord(manifest.profile) || manifest.profile.file !== 'profile.json' || typeof manifest.profile.id !== 'string')
    fail('manifest profile reference is incomplete');
  if (!isRecord(manifest.replay) || manifest.replay.schema !== REPLAY_SCHEMA) fail('manifest replay is incomplete');
  if (!Array.isArray(manifest.replay.seeds) || manifest.replay.seeds.length === 0 ||
      typeof manifest.replay.hash !== 'string') fail('manifest replay reference is incomplete');
}

/** Compile a winner into a new bundle. Existing non-empty targets are refused. */
// `gate.replayHash` hashes the MODEL's traces, so it separates two plans only
// where the model can tell them apart. On 2026-09-20 binding h's plan and a
// copy with the mask coming off 300 ms later -- the one change the device's
// Balloon Boy defect turns on -- emitted different plan text, different winner
// hashes, and the SAME replay hash fnv1a-c651e2ff, because the model scores
// both 300/300 with identical event traces. bundle.mjs:444 already names this
// failure for `#phase-offset` and fixes it for that knob alone.
//
// So a gate may declare the plan it was measured against. It is optional,
// because adding it to a shipped winner would re-hash that winner and orphan
// its ANCHOR_AIMS entry (the drift that cost Night 6 five days); it is checked
// wherever it is present, and test-fact-register.mjs requires it of any newly
// registered binding.
/** @param {any} gate @param {Map<number, {text: string}>} emitted */
function checkGatePlans(gate, emitted) {
  if (gate.planSha256 === undefined) return;
  if (!isRecord(gate.planSha256)) fail('gate.planSha256 must be an object of night -> sha256');
  const nights = [...emitted.keys()].sort((a, b) => a - b);
  const declared = Object.keys(gate.planSha256).map(Number).sort((a, b) => a - b);
  if (!same(nights, declared))
    fail(`gate.planSha256 declares nights ${declared.join(',')}, the winner emits ${nights.join(',')}`);
  for (const night of nights) {
    const actual = sha256(emitted.get(night).text);
    if (gate.planSha256[night] !== actual)
      fail(`gate.planSha256 for night ${night} is ${gate.planSha256[night]}, the winner emits ${actual}: ` +
        'the gate was measured against a different plan');
  }
}

export function compileBundle(input, outDirectory) {
  const winner = validateWinner(input);
  const out = resolve(outDirectory);
  mkdirSync(out, { recursive: true });
  if (readdirSync(out, { withFileTypes: true }).length > 0) fail(`refusing to overwrite non-empty output ${out}`);
  const profile = resolveProfile(winner.profile ??
    (winner.strategy === 'minus3' ? 'hid-mediaprojection' : undefined));
  const emitted = new Map(winner.nights.map(night => [night, emitterFor(winner, night)]));
  for (const [night, value] of emitted) parsePlan(value.text, { strategy: winner.strategy, night, profile });
  const replaySeeds = (winner.replaySeeds ?? winner.seeds.slice(0, MAX_REPLAY_SEEDS)).map((seed, index) =>
    nonNegativeInt(seed, `replaySeeds[${index}]`));
  if (replaySeeds.length === 0) fail('replaySeeds must not be empty');
  const replay = replayWinner(winner, emitted, replaySeeds);
  if (winner.gate.replayHash !== undefined && winner.gate.replayHash !== replay.hash)
    fail('winner.gate.replayHash does not match the candidate replay');
  checkGatePlans(winner.gate, emitted);
  const finalWinner = normalizedWinner(winner, replay);
  const source = strategySourceDigest(winner.strategy);
  const winnerText = canonicalJson(finalWinner);
  const profileText = canonicalJson(profile);
  writeFileSync(join(out, 'winner.json'), winnerText);
  writeFileSync(join(out, 'profile.json'), profileText);
  const plans = [];
  for (const night of winner.nights) {
    const file = `night-${night}.plan`;
    const text = emitted.get(night).text;
    writeFileSync(join(out, file), text);
    plans.push({ night, file, policy: winner.strategy, sha256: sha256(text), bytes: Buffer.byteLength(text) });
  }
  const compiled = compileArtifactPlans(plans.map(plan => ({ ...plan, text: emitted.get(plan.night).text })), parsePlan, profile);
  const artifact = {
    schema: ARTIFACT_SCHEMA, version: 1, winnerHash: stableHash(finalWinner), engineHash: winner.engineHash,
    profileHash: sha256(profileText), plans: persistArtifactPlans(compiled),
  };
  jsonWrite(join(out, 'artifact.json'), artifact);
  const manifest = {
    schema: BUNDLE_SCHEMA, version: 1, strategy: winner.strategy, policy: winner.strategy,
    winnerHash: stableHash(finalWinner), engineHash: winner.engineHash,
    nights: winner.nights, profile: { id: profile.id, file: 'profile.json', sha256: sha256(profileText) },
    ...(winner.anchorEpochMs === undefined ? {} : { anchorEpochMs: winner.anchorEpochMs }),
    plans, gate: finalWinner.gate, replay,
    source: { compiler: 'tools/device/bundle.mjs', registry: Object.keys(STRATEGY_REGISTRY) },
    engine: { declaredHash: winner.engineHash, sourceSha256: source.sha256, sources: source.sources },
    artifact: { file: 'artifact.json', schema: ARTIFACT_SCHEMA, sha256: sha256(canonicalJson(artifact)) },
  };
  jsonWrite(join(out, 'manifest.json'), manifest);
  return validateBundle(out);
}

/** Validate every file and replay the bounded candidate sample from the bundle. */
export function validateBundle(directory, { night } = {}) {
  const out = resolve(directory);
  const manifest = jsonRead(join(out, 'manifest.json'));
  validateManifestShape(manifest);
  // Hash the winner exactly as the emitter stored it. validateWinner fills
  // knob defaults, and a default added after a bundle was built (observeUntilMs,
  // added 2026-09-13 16:03, refused the 15:00 Night 6 binding-h bundle on
  // 2026-09-14 with byte-identical plans) must not refuse the bundle: the
  // plan-hash checks below are what catch a default that changes what runs.
  const storedWinner = jsonRead(join(out, 'winner.json'));
  if (stableHash(storedWinner) !== manifest.winnerHash) fail('winner hash does not match manifest');
  const winner = validateWinner(storedWinner);
  if (winner.strategy !== manifest.strategy || manifest.policy !== manifest.strategy ||
      manifest.engineHash !== winner.engineHash || !same(winner.nights, manifest.nights))
    fail('manifest strategy/night/engine identity mismatch');
  const source = strategySourceDigest(winner.strategy);
  if (!isRecord(manifest.engine) || manifest.engine.declaredHash !== winner.engineHash ||
      manifest.engine.sourceSha256 !== source.sha256 || !same(manifest.engine.sources, source.sources))
    fail('manifest engine source hash mismatch');
  const profileText = readFileSync(join(out, manifest.profile.file), 'utf8');
  const profile = JSON.parse(profileText);
  resolveDeviceProfile(profile);
  if (profile.id !== manifest.profile.id || sha256(profileText) !== manifest.profile.sha256)
    fail('profile identity or hash mismatch');
  const expected = new Map(winner.nights.map(planNight => [planNight, emitterFor(winner, planNight)]));
  const selected = night === undefined ? winner.nights : [night];
  for (const planNight of selected) if (!winner.nights.includes(planNight)) fail(`night ${planNight} is not in this bundle`);
  const entries = bundlePlanEntries(manifest, out);
  if (entries.length !== winner.nights.length) fail('manifest plan count does not match winner nights');
  if (!same([...new Set(entries.map(entry => entry.night))].sort((a, b) => a - b),
    [...winner.nights].sort((a, b) => a - b))) fail('manifest plan nights are not a one-to-one set');
  for (const entry of entries) {
    if (!winner.nights.includes(entry.night)) fail(`manifest contains unexpected night ${entry.night}`);
    if (entry.policy !== winner.strategy) fail(`plan ${entry.file} policy mismatch`);
    if (entry.text !== expected.get(entry.night).text) fail(`${entry.file} is not the exact emission for winner.json`);
    parsePlan(entry.text, { strategy: winner.strategy, night: entry.night, profile });
  }
  const replaySeeds = manifest.replay.seeds;
  const actualReplay = replayWinner(winner, expected, replaySeeds);
  if (stableHash(actualReplay.results) !== stableHash(manifest.replay.results) ||
      actualReplay.hash !== manifest.replay.hash || actualReplay.hash !== winner.gate.replayHash)
    fail('candidate replay does not equal the winner replay hash');
  checkGatePlans(winner.gate, expected);
  const selectedPlans = entries.filter(entry => selected.includes(entry.night));
  let compiled;
  if (manifest.artifact !== undefined) {
    if (!isRecord(manifest.artifact) || manifest.artifact.file !== 'artifact.json' ||
        manifest.artifact.schema !== ARTIFACT_SCHEMA || typeof manifest.artifact.sha256 !== 'string')
      fail('manifest artifact reference is incomplete');
    const artifactText = readFileSync(join(out, manifest.artifact.file), 'utf8');
    if (sha256(artifactText) !== manifest.artifact.sha256) fail('compiled artifact hash does not match manifest');
    const artifact = JSON.parse(artifactText);
    if (!isRecord(artifact) || artifact.schema !== ARTIFACT_SCHEMA || artifact.version !== 1 ||
        artifact.winnerHash !== manifest.winnerHash || artifact.engineHash !== manifest.engineHash ||
        artifact.profileHash !== manifest.profile.sha256 || !Array.isArray(artifact.plans))
      fail('compiled artifact identity is incomplete');
    if (artifact.plans.length !== entries.length || artifact.plans.some(plan =>
      !isRecord(plan) || !Number.isInteger(plan.night) || !isRecord(plan.cycles)))
      fail('compiled artifact plan set is invalid');
    const byNight = new Map(artifact.plans.map(plan => [plan.night, plan]));
    if (entries.some(entry => !byNight.has(entry.night))) fail('compiled artifact plan nights do not match manifest');
    compiled = selectedPlans.map(entry => byNight.get(entry.night));
  }
  return { manifest, winner, profile, plans: selectedPlans, compiled, replay: actualReplay, status: 'READY' };
}
