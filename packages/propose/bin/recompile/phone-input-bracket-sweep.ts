#!/usr/bin/env node
// Exhaust the measured visual-response update brackets before full-06's first divergent window.
// This is a host-model sensitivity analysis, not a claim about device input dispatch.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import type { BinaryLike } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  check as checkEncounters, cumulative, landingLatency, maskPresses, mapSchedule, nativeResponses,
  officeClock, phoneSchedule, traceColumns, traceTick, windowCodes, WINDOW_MS, OFFICE_FRAME,
} from './phone-encounter-replay.ts';
import type { Clock, EncounterConfig, EncounterResult, NightConfig, NightRecord, ResponseRow } from './phone-encounter-replay.ts';
import { drawTrace, MODEL_SOURCES } from '../../../source/recompile/model-draw-trace.ts';
import { LEDGERS } from './compare-schedule-replay.ts';
import { controlPoints, formatRows, harnessRows, modelContacts } from './schedule-to-input.ts';
import type { Contact } from './schedule-to-input.ts';
import { currentPath } from '@sixam/review/renamed-path';
import type { Sim, Unit } from '@sixam/source/fnaf2';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
// A path a committed record names, where it lives now (records keep the paths they were written with).
const current = (path: string) => currentPath(ROOT, path) ?? path;
const CONFIG = 'packages/propose/bin/recompile/full06-response-experiment.json';
const RESPONSE_RESULT = 'tools/recompile/results/full06-responses-20260928.json';
const RESULT = 'tools/recompile/results/phone-input-bracket-full-06-20260928.json';
const SCHEMA = 'recompile-phone-input-bracket-sweep-v1';
const PHONE_CODE: Readonly<Record<string, string>> = Object.freeze({ withbonnie: 'B', withchica: 'C', withfreddy: 'F', toybonnie: 'b',
  toychica: 'c', toyfreddy: 'f', mangle: 'M', bb: 'x' });
const sha256 = (value: BinaryLike) => createHash('sha256').update(value).digest('hex');
const bytes = (path: string) => readFileSync(resolve(ROOT, current(path)));
const json = (path: string) => JSON.parse(bytes(path).toString('utf8'));
const idOf = (result: object) => `recompile-phone-input-bracket-${sha256(JSON.stringify({ ...result, evidenceId: undefined })).slice(0, 16)}`;
const sourceHash = (path: string) => sha256(bytes(path));

/** What observe records per model frame: the mask, the blackout's unit and start, and Withered Bonnie's place. */
interface Observation {
  mask: number, unit: string | null, blackoutUnit: string | null, blackoutStartFrame: number | null;
  withBonnie: { node: Unit['path'][number], idx: number, atOpening: boolean, openingSince: number | null, inside: boolean, done: boolean };
  /** Never recorded: the opening lookup below that reads it has never matched (flagged, 2026-10-02). */
  frame?: number;
}
/** A response row with its frames. */
type Observed = Extract<ResponseRow, { status: 'OBSERVED_RESPONSE' }>;

function modelWindowRows(schedule: readonly (readonly [number, string, string])[], model: { readonly out: readonly unknown[], readonly observed?: readonly unknown[] },
  deltas: readonly number[]) {
  const end = Math.max(model.out.length, ...schedule.map(([tick]) => tick)) + 2;
  const clock = cumulative(deltas, end);
  const state = (tick: number) => {
    // observe ran: one Observation per model frame.
    const observed = (model.observed as readonly Observation[])[tick + 1];
    if (!observed) return null;
    return { maskValue: observed.mask, occupant: observed.unit ? (PHONE_CODE[observed.unit] ?? '?') : null };
  };
  return { rows: windowCodes(maskPresses(schedule), state, clock, clock[model.out.length - 1]), clock };
}

function contactTicks(row: Observed, contact: Contact, clock: Clock, shift: number) {
  const late = traceTick(row.upperImageMs, clock);
  const early = Math.min(late, traceTick(row.priorImageMs, clock) + 1);
  const release = traceTick(contact.upMs + shift + row.latencyMs, clock);
  return { early, late, release };
}

function simulateFamily() {
  const config: EncounterConfig = json(CONFIG);
  const responseResult: EncounterResult = json(RESPONSE_RESULT);
  const verified = checkEncounters(responseResult);
  if (verified.status !== 'DIVERGENT') throw new Error('the retained full-06 response comparison is no longer divergent');
  const night = config.nights.find((row) => row.name === 'full-06');
  if (!night || config.responseExperiment?.window !== 6) throw new Error('the configured experiment no longer names full-06 window 6');
  const experiment = config.responseExperiment as NonNullable<EncounterConfig['responseExperiment']>;
  const recordedNight = responseResult.nights.find((row) => row.name === night.name);
  const ready = recordedNight?.variants.find((row) => row.variant === 'response-ready');
  const landed = recordedNight?.variants.find((row) => row.variant === 'landed');
  if (!ready?.responses || !landed) throw new Error('the retained response-ready control or landed window clock is missing');
  // The experiment's night has a frame trace, and its retained night holds the variants found above.
  const trace = night.trace as NonNullable<NightConfig['trace']>;
  const retainedNight = recordedNight as NightRecord;
  const traceBytes = readFileSync(resolve(ROOT, trace.path));
  if (sha256(traceBytes) !== trace.sha256) throw new Error('the retained phone frame trace hash differs from the experiment config');
  const columns = traceColumns(traceBytes.toString('utf8'), ['image_ns', 'monitor_luma', 'mask_downstroke', 'monitor_downstroke']);
  const clock = officeClock(columns.image_ns, trace.first, { catchUp: true });
  const shift = trace.releaseAfterFirstNightFrameMs - night.originMs;
  const winner = json(night.winner);
  if (sha256(bytes(night.winner)) !== retainedNight.winnerSha256) throw new Error('the configured winner differs from the response experiment');
  const schedule = phoneSchedule(winner, night.night, night.originMs);
  const measuredRows = nativeResponses(columns, trace.first, schedule.contacts, shift, { allowReadyAfterSend: true });
  if (JSON.stringify(measuredRows) !== JSON.stringify(ready.responses.rows)) throw new Error('native response rows differ from the retained response-ready record');
  const monitorSends = schedule.queueMs.filter(([, kind, action]) => kind === 'press' && action === 'monitor').map(([ms]) => ms + shift);
  const latency = landingLatency(columns, trace.first, monitorSends);
  if (JSON.stringify(latency) !== JSON.stringify(ready.landingLatency)) throw new Error('measured landing latency differs from the retained response-ready record');
  const deltas = clock.deltas.map((delta) => Number(delta.toFixed(6)));
  const frameTimesText = `# ${night.name} response-ready: office update timer deltas (ms)\n${deltas.map((delta) => delta.toFixed(6)).join('\n')}\n`;
  if (sha256(frameTimesText) !== ready.input.frameTimesSha256) throw new Error('the derived frame clock differs from the retained response-ready input');
  const baseTick = (ms: number) => traceTick(ms + shift + latency.medianMs, clock);
  const allMeasured = measuredRows.filter((row) => row.status === 'OBSERVED_RESPONSE');
  const rowByIndex = new Map(allMeasured.map((row) => [row.contactIndex, row]));
  const allLateTick = (ms: number, kind: string, control: string) => {
    const contact = schedule.contacts.find((candidate) => candidate.control === control &&
      Math.abs((kind === 'press' ? candidate.downMs : candidate.upMs) - ms) < 0.001);
    if (!contact || !['mask', 'monitor'].includes(control)) return baseTick(ms);
    const row = rowByIndex.get(schedule.contacts.indexOf(contact));
    if (!row) return baseTick(ms);
    const { late, release } = contactTicks(row, contact, clock, shift);
    return kind === 'press' ? late : release;
  };
  const lateMapped = mapSchedule(schedule, allLateTick);
  const profile = json(config.profile);
  const office = harnessRows(lateMapped.contacts, controlPoints(profile), { frame: OFFICE_FRAME });
  const navigation = readFileSync(resolve(ROOT, night.navigation), 'utf8');
  const body = formatRows(office);
  const header = [`# phone-encounter-replay ${night.name} response-ready: ${night.winner} night ${night.night} at ${night.originMs} ms after the seed`,
    `# clock ${config.variants['response-ready'].clock}, presses ${config.variants['response-ready'].presses}; ${lateMapped.stretched} contacts stretched to one update`];
  const inputText = `${navigation.endsWith('\n') ? navigation : `${navigation}\n`}${header.join('\n')}\n${body}`;
  if (sha256(inputText) !== ready.input.inputSha256) throw new Error('the reconstructed response-ready input differs from the retained baseline');

  const landedWindow = landed.windows.rows.find((row) => row.index === experiment.window);
  if (!landedWindow) throw new Error('the target phone window is absent from the landed control');
  // A window row's time is its tick's.
  const horizonMs = Number(((landedWindow.ms as number) + WINDOW_MS).toFixed(3));
  const candidatesMeasured = measuredRows.filter((row) => row.sendImageMs <= horizonMs);
  const observedPrefix = candidatesMeasured.filter((row) => row.status === 'OBSERVED_RESPONSE');
  const unknownPrefix = candidatesMeasured.filter((row) => row.status !== 'OBSERVED_RESPONSE');
  const relevantContacts = schedule.contacts.map((contact, contactIndex) => ({ contact, contactIndex }))
    .filter(({ contact }) => ['mask', 'monitor'].includes(contact.control) && contact.downMs + shift <= horizonMs);
  const responseIndexes = new Set(candidatesMeasured.map((row) => row.contactIndex));
  const unsupportedContacts = relevantContacts.filter(({ contactIndex }) => !responseIndexes.has(contactIndex));
  const dimensions = observedPrefix.map((row) => {
    const contact = schedule.contacts[row.contactIndex];
    const { early, late } = contactTicks(row, contact, clock, shift);
    const ticks = Array.from({ length: late - early + 1 }, (_, offset) => early + offset);
    return { contactIndex: row.contactIndex, control: row.control, sendImageMs: row.sendImageMs,
      lowerImageMs: row.lowerImageMs, upperImageMs: row.upperImageMs, readyAfterSend: row.readyAfterSend,
      minTick: early, maxTick: late, possibleTicks: ticks };
  }).filter((dimension) => dimension.possibleTicks.length > 1);
  const combinations = dimensions.reduce((count, dimension) => count * dimension.possibleTicks.length, 1);
  if (combinations > 4096) throw new Error(`the measured prefix has ${combinations} endpoint combinations; explicit review is required`);

  const modelOptions = json(config.modelOptions);
  // The experiment's night is a Custom Night.
  const customNight = json(night.customNight as string);
  const observe = (sim: Sim): Observation => {
    // Withered Bonnie is a unit on every night.
    const bonnie = sim.units.find((unit) => unit.id === 'withbonnie') as Unit;
    return { mask: LEDGERS.mask.model(sim), unit: sim.blackout.active ? sim.blackout.unitId : null,
      blackoutUnit: sim.blackout.active ? sim.blackout.unitId : null,
      blackoutStartFrame: sim.blackout.active ? sim.blackoutStartFrame : null,
      withBonnie: { node: bonnie.path[bonnie.idx], idx: bonnie.idx, atOpening: bonnie.atOpening,
        openingSince: bonnie.atOpening ? bonnie.openingSince : null, inside: bonnie.inside, done: bonnie.done } };
  };
  const simulate = (selectedTicks: ReadonlyMap<number, number>) => {
    const tickOf = (ms: number, kind: string, control: string) => {
      const contact = schedule.contacts.find((candidate) => candidate.control === control &&
        Math.abs((kind === 'press' ? candidate.downMs : candidate.upMs) - ms) < 0.001);
      if (!contact || !['mask', 'monitor'].includes(control)) return baseTick(ms);
      const contactIndex = schedule.contacts.indexOf(contact);
      const row = rowByIndex.get(contactIndex);
      if (!row) return baseTick(ms);
      const selected = selectedTicks.get(contactIndex);
      const { late, release } = contactTicks(row, contact, clock, shift);
      const down = selected ?? late;
      return kind === 'press' ? down : release - (late - down);
    };
    const mapped = mapSchedule(schedule, tickOf);
    const model = drawTrace({ night: night.night, seed: night.seed, frames: 40000, modelOptions, customNight,
      contacts: modelContacts(mapped.contacts), observe, frameTimes: deltas });
    const analysis = modelWindowRows(mapped.queue, model, deltas);
    const windows = analysis.rows.map((row) => row.code).join('');
    const targetWindow = analysis.rows.find((row) => row.index === experiment.window);
    // observe ran: one Observation per model frame.
    const observed = model.observed as Observation[];
    const targetObservation = targetWindow ? observed[targetWindow.tick + 1] : null;
    let bonnieOpening = null as Observation | null;
    let bonnieEncounter = null as Observation | null;
    if (targetObservation?.withBonnie.atOpening) {
      // At an opening, openingSince is its frame; a blackout of Withered Bonnie has a start frame.
      const openingSince = targetObservation.withBonnie.openingSince as number;
      bonnieOpening = observed.find((observation) => observation.frame === openingSince &&
        observation.withBonnie.atOpening && observation.withBonnie.openingSince === openingSince) ?? null;
      bonnieEncounter = observed.find((observation) => observation.blackoutUnit === 'withbonnie' &&
        (observation.blackoutStartFrame as number) >= openingSince) ?? null;
    }
    const encounterFrame = bonnieEncounter?.blackoutStartFrame as number;
    const targetState = targetWindow && targetObservation ? {
      windowIndex: targetWindow.index, windowTick: targetWindow.tick,
      windowClockMs: Number(analysis.clock[targetWindow.tick].toFixed(1)), modelOccupant: targetWindow.code,
      activeBlackoutUnit: targetObservation.blackoutUnit,
      withBonnie: targetObservation.withBonnie,
      ...(bonnieOpening ? { withBonnieOpeningFrame: bonnieOpening.frame,
        withBonnieOpeningClockMs: Number(analysis.clock[bonnieOpening.frame as number].toFixed(1)) } : {}),
      ...(bonnieEncounter ? { withBonnieEncounterFrame: encounterFrame,
        withBonnieEncounterClockMs: Number(analysis.clock[encounterFrame].toFixed(1)),
        encounterLeadUpdates: targetWindow.tick - encounterFrame } : {}),
    } : null;
    return { queue: mapped.queue, windows, targetState, model };
  };
  const baseline = simulate(new Map());
  if (baseline.windows !== ready.windows.model) throw new Error('the reconstructed all-late model does not reproduce response-ready windows');

  const family: {
    choices: { contactIndex: number, tick: number }[], scheduleSha256: string, modelWindows: string;
    targetState: ReturnType<typeof simulate>['targetState'], preservesPhonePrefix: boolean, targetCode: string, clearsTarget: boolean,
  }[] = [];
  const visit = (offset: number, selected: ReadonlyMap<number, number>) => {
    if (offset < dimensions.length) {
      const dimension = dimensions[offset];
      for (const tick of dimension.possibleTicks) visit(offset + 1, new Map([...selected, [dimension.contactIndex, tick]]));
      return;
    }
    const scenario = simulate(selected);
    const phone = night.phone.windows;
    const windowIndex = experiment.window;
    const prefixLength = windowIndex;
    family.push({
      choices: dimensions.map((dimension) => ({ contactIndex: dimension.contactIndex,
        tick: selected.get(dimension.contactIndex) ?? dimension.maxTick })),
      scheduleSha256: sha256(JSON.stringify(scenario.queue)),
      modelWindows: scenario.windows,
      targetState: scenario.targetState,
      preservesPhonePrefix: scenario.windows.slice(0, prefixLength) === phone.slice(0, prefixLength),
      targetCode: scenario.windows[windowIndex] ?? '?',
      clearsTarget: scenario.windows[windowIndex] === '.',
    });
  };
  visit(0, new Map());
  const targetPhoneCode = night.phone.windows[experiment.window];
  const built = {
    schema: SCHEMA,
    claimLevel: 'MODEL_ONLY',
    purpose: 'Exhaust all distinct per-contact update ticks admitted by the retained visual-response brackets through full-06 window 6, with each release shifted by the same update count as its press.',
    source: {
      config: { path: CONFIG, sha256: sourceHash(CONFIG) },
      responseResult: { path: RESPONSE_RESULT, sha256: sourceHash(RESPONSE_RESULT), evidenceId: responseResult.evidenceId },
      sourceTrace: { path: trace.path, sha256: trace.sha256 },
      winner: { path: night.winner, sha256: retainedNight.winnerSha256 },
      modelOptions: { path: config.modelOptions, sha256: sourceHash(config.modelOptions) },
      modelSources: Object.fromEntries(MODEL_SOURCES.map((path) => [path.slice(ROOT.length + 1), sha256(readFileSync(path))])),
      toolSha256: sourceHash('packages/propose/bin/recompile/phone-input-bracket-sweep.ts'),
    },
    target: { night: night.name, seed: night.seed, windowIndex: experiment.window,
      horizonMs, horizonRule: 'the landed window start plus its 1500 ms read interval',
      phoneWindows: night.phone.windows, baselineModelWindows: ready.windows.model,
      prefixLength: experiment.window, targetPhoneCode },
    coverage: { measuredResponseRowsThroughHorizon: candidatesMeasured.length,
      observedResponseRowsThroughHorizon: observedPrefix.length, unknownRowsThroughHorizon: unknownPrefix.length,
      relevantMaskOrMonitorContactsThroughHorizon: relevantContacts.length,
      contactsWithoutResponseRowsThroughHorizon: unsupportedContacts.map(({ contactIndex }) => contactIndex),
      responseBracketRows: candidatesMeasured.map((row) => ({ contactIndex: row.contactIndex, control: row.control,
        status: row.status, sendImageMs: row.sendImageMs, lowerImageMs: row.lowerImageMs ?? null,
        upperImageMs: row.upperImageMs ?? null, priorImageMs: row.priorImageMs ?? null,
        readyAfterSend: row.readyAfterSend ?? false,
        ...(row.status === 'OBSERVED_RESPONSE' ? (() => {
          const { early, late } = contactTicks(row, schedule.contacts[row.contactIndex], clock, shift);
          return { earlyTick: early, lateTick: late };
        })() : { earlyTick: null, lateTick: null }) })) },
    dimensions,
    candidateCount: family.length,
    candidates: family,
    conclusion: family.some((row) => row.preservesPhonePrefix && row.targetCode === targetPhoneCode)
      ? 'A measured response-bracket timing choice preserves the first six phone windows and matches window 6.'
      : 'No measured response-bracket timing choice preserves the first six phone windows and clears window 6.',
    limitations: [
      'A visible response bounds a possible input update; it does not measure Android dispatch or prove causation.',
      'Only mask and monitor contacts have response-classifier rows; wind and camera/light contacts retain their baseline timing mapping.',
      'The response brackets constrain press timing only. Releases shift by the same number of updates to preserve scheduled contact duration.',
      'This search is MODEL_ONLY; it reuses the retained phone trace, response rows, and phone window reads and performs no device run.',
    ],
  };
  const candidate: typeof built & { evidenceId?: string } = built;
  candidate.evidenceId = idOf(candidate);
  return candidate;
}
/** A recompile-phone-input-bracket-sweep-v1 record. */
type BracketResult = ReturnType<typeof simulateFamily>;

/** 'working tree', the first revision whose committed `path` has `expected` as its sha256, or null. */
export function committedVersion(path: string, expected: string) {
  // A record keeps the path it was computed at, and the file may have moved since (ADR 0002 migration
  // D1 moved the model sources to packages/source): a missing working file is only "not the working
  // tree", and `git log -- <old path>` still lists that path's revisions. The commit that moved it away
  // is listed too, with no file at the path, so only revisions that leave a file there are read.
  let working = null as Buffer | null;
  try { working = readFileSync(resolve(ROOT, path)); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  if (working !== null && sha256(working) === expected) return 'working tree';
  const revisions = execFileSync('git', ['-C', ROOT, 'log', '--diff-filter=ACMRT', '--format=%H', '--', path], { encoding: 'utf8' }).split('\n').filter(Boolean);
  for (const revision of revisions) {
    const bytes = execFileSync('git', ['-C', ROOT, 'show', `${revision}:${path}`], { maxBuffer: 64 << 20 });
    if (sha256(bytes) === expected) return revision;
  }
  return null;
}

/** True when a record's model-source paths name, in order, the model files the current sources begin
 *  with: by file name without its extension, because a record keeps the paths it was computed at, a move
 *  changes the directory, and the move to runtime TypeScript (2026-09-30) changed .js to .ts. The list
 *  begins with plant-model, config and rng and then grows by every module plant-model reaches (the splits
 *  of 2026-09-30), and the tool writes the whole list at run time, so an older record names a prefix. */
export function recordedModelFiles(recordedPaths: readonly string[], sourcePaths: readonly string[]) {
  const stem = (path: string) => basename(path).replace(/\.(?:js|ts)$/, '');
  const recorded = recordedPaths.map(stem), current = sourcePaths.map(stem);
  return recorded.length > 0 && recorded.length <= current.length && recorded.every((name, i) => name === current[i]);
}

export function check(result: BracketResult) {
  if (result.schema !== SCHEMA || result.claimLevel !== 'MODEL_ONLY') throw new Error('wrong input-bracket result schema or claim ceiling');
  const config: EncounterConfig = json(CONFIG);
  const responseResult: EncounterResult = json(RESPONSE_RESULT);
  const verified = checkEncounters(responseResult);
  if (result.source.responseResult.path !== RESPONSE_RESULT || verified.evidenceId !== result.source.responseResult.evidenceId ||
      responseResult.evidenceId !== result.source.responseResult.evidenceId)
    throw new Error('the source response experiment ID differs');
  for (const [key, sourcePath] of [['config', CONFIG], ['responseResult', RESPONSE_RESULT], ['modelOptions', config.modelOptions]] as const) {
    if (current(result.source[key].path) !== current(sourcePath) || result.source[key].sha256 !== sourceHash(sourcePath)) throw new Error(`${key} bytes differ`);
  }
  // The record keeps only the tool's hash, so every path the tool has stood at is searched.
  if (['tools/recompile/phone-input-bracket-sweep.mjs', 'packages/propose/bin/recompile/phone-input-bracket-sweep.mjs',
    'packages/propose/bin/recompile/phone-input-bracket-sweep.ts']
    .every((path) => committedVersion(path, result.source.toolSha256) === null))
    throw new Error('tool bytes are no committed version of this tool');
  // The record is about the model it was computed with, and the model moves on. Its bytes must be a
  // committed version of each source: the working file, or a revision in the file's history (CI checks
  // out full history). A re-run on the current model is a new record.
  for (const [path, expected] of Object.entries(result.source.modelSources)) {
    if (committedVersion(path, expected) === null) throw new Error(`model source bytes are no committed version: ${path}`);
  }
  // The retained config and comparison hold full-06, its response-ready and landed variants, and the target window.
  type Found<T> = NonNullable<T>;
  const night = config.nights.find((row) => row.name === 'full-06') as NightConfig;
  const trace = night.trace as Found<NightConfig['trace']>;
  const responseNight = responseResult.nights.find((row) => row.name === 'full-06') as NightRecord;
  const ready = responseNight.variants.find((row) => row.variant === 'response-ready') as NightRecord['variants'][number];
  const landed = responseNight.variants.find((row) => row.variant === 'landed') as NightRecord['variants'][number];
  const experiment = config.responseExperiment as Found<EncounterConfig['responseExperiment']>;
  const targetIndex = experiment.window;
  const landedWindow = landed.windows.rows.find((row) => row.index === targetIndex) as (typeof landed.windows.rows)[number];
  const horizonMs = Number(((landedWindow.ms as number) + WINDOW_MS).toFixed(3));
  const expectedResponseRows = (ready.responses as Found<typeof ready.responses>).rows.filter((row) => row.sendImageMs <= horizonMs).map((row) => ({
    contactIndex: row.contactIndex, control: row.control, status: row.status, sendImageMs: row.sendImageMs,
    lowerImageMs: row.lowerImageMs ?? null, upperImageMs: row.upperImageMs ?? null,
    priorImageMs: row.priorImageMs ?? null, readyAfterSend: row.readyAfterSend ?? false,
    earlyTick: row.status === 'OBSERVED_RESPONSE' ? result.coverage.responseBracketRows.find((candidate) => candidate.contactIndex === row.contactIndex)?.earlyTick ?? null : null,
    lateTick: row.status === 'OBSERVED_RESPONSE' ? result.coverage.responseBracketRows.find((candidate) => candidate.contactIndex === row.contactIndex)?.lateTick ?? null : null,
  }));
  const schedule = phoneSchedule(json(night.winner), night.night, night.originMs);
  const shift = trace.releaseAfterFirstNightFrameMs - night.originMs;
  const relevantContacts = schedule.contacts.map((contact, contactIndex) => ({ contact, contactIndex }))
    .filter(({ contact }) => ['mask', 'monitor'].includes(contact.control) && contact.downMs + shift <= horizonMs);
  const responseIndexes = new Set(expectedResponseRows.map((row) => row.contactIndex));
  const unsupported = relevantContacts.filter(({ contactIndex }) => !responseIndexes.has(contactIndex)).map(({ contactIndex }) => contactIndex);
  if (result.source.sourceTrace.path !== trace.path || result.source.sourceTrace.sha256 !== trace.sha256 ||
      result.source.winner.sha256 !== responseNight.winnerSha256 || result.target.phoneWindows !== night.phone.windows ||
      result.target.baselineModelWindows !== ready.windows.model || result.target.windowIndex !== targetIndex ||
      result.target.horizonMs !== horizonMs || result.target.horizonRule !== 'the landed window start plus its 1500 ms read interval' ||
      result.target.targetPhoneCode !== night.phone.windows[targetIndex] ||
      result.coverage.measuredResponseRowsThroughHorizon !== expectedResponseRows.length ||
      result.coverage.observedResponseRowsThroughHorizon !== expectedResponseRows.filter((row) => row.status === 'OBSERVED_RESPONSE').length ||
      result.coverage.unknownRowsThroughHorizon !== expectedResponseRows.filter((row) => row.status !== 'OBSERVED_RESPONSE').length ||
      result.coverage.relevantMaskOrMonitorContactsThroughHorizon !== relevantContacts.length ||
      JSON.stringify(result.coverage.contactsWithoutResponseRowsThroughHorizon) !== JSON.stringify(unsupported) ||
      JSON.stringify(result.coverage.responseBracketRows) !== JSON.stringify(expectedResponseRows))
    throw new Error('target, phone, trace, winner or baseline reference differs');
  if (result.target.targetPhoneCode !== night.phone.windows[experiment.window] ||
      result.target.prefixLength !== experiment.window) throw new Error('target window or prefix differs');
  const dimensions = result.dimensions;
  if (!Array.isArray(dimensions) || dimensions.some((dimension) => !Array.isArray(dimension.possibleTicks) ||
      dimension.possibleTicks.length < 2 || dimension.minTick !== dimension.possibleTicks[0] ||
      dimension.maxTick !== dimension.possibleTicks.at(-1) ||
      dimension.possibleTicks.some((tick, i) => !Number.isInteger(tick) || tick !== dimension.minTick + i)))
    throw new Error('an endpoint dimension is malformed');
  // An observed row has both ticks.
  type Bracketed = (typeof result.coverage.responseBracketRows)[number] & { earlyTick: number, lateTick: number };
  const expectedDimensions = result.coverage.responseBracketRows
    .filter((row): row is Bracketed => row.status === 'OBSERVED_RESPONSE' && (row.earlyTick as number) < (row.lateTick as number))
    .map((row) => ({ contactIndex: row.contactIndex, control: row.control, sendImageMs: row.sendImageMs,
      lowerImageMs: row.lowerImageMs, upperImageMs: row.upperImageMs, readyAfterSend: row.readyAfterSend,
      minTick: row.earlyTick, maxTick: row.lateTick,
      possibleTicks: Array.from({ length: row.lateTick - row.earlyTick + 1 }, (_, offset) => row.earlyTick + offset) }));
  if (JSON.stringify(dimensions) !== JSON.stringify(expectedDimensions)) throw new Error('ambiguous response brackets were omitted or changed');
  // The model's files by name, at the record's own paths; each path's bytes were checked above to be a
  // committed version of that path.
  if (!recordedModelFiles(Object.keys(result.source.modelSources), MODEL_SOURCES) || result.source.winner.path !== night.winner)
    throw new Error('model or winner provenance differs');
  let combinations = 1;
  for (const dimension of dimensions) combinations *= dimension.possibleTicks.length;
  if (combinations !== result.candidateCount || result.candidates.length !== combinations) throw new Error('candidate family is incomplete');
  const expected = new Set<string>();
  const enumerate = (offset: number, picked: readonly { contactIndex: number, tick: number }[]) => {
    if (offset === dimensions.length) { expected.add(JSON.stringify(picked)); return; }
    const d = dimensions[offset];
    for (const tick of d.possibleTicks) enumerate(offset + 1, [...picked, { contactIndex: d.contactIndex, tick }]);
  };
  enumerate(0, []);
  const actual = new Set<string>();
  for (const candidate of result.candidates) {
    const key = JSON.stringify(candidate.choices);
    if (!expected.has(key) || actual.has(key)) throw new Error('candidate choices are duplicated or outside a bracket');
    actual.add(key);
    const phone = result.target.phoneWindows;
    if (typeof candidate.modelWindows !== 'string' || !/^[.BCFbcfMx?]+$/.test(candidate.modelWindows) ||
        candidate.preservesPhonePrefix !== (candidate.modelWindows.slice(0, result.target.prefixLength) === phone.slice(0, result.target.prefixLength)) ||
        candidate.targetCode !== (candidate.modelWindows[result.target.windowIndex] ?? '?') ||
        candidate.clearsTarget !== (candidate.targetCode === '.')) throw new Error('candidate score differs from its windows');
    const state = candidate.targetState;
    if (!state || state.windowIndex !== result.target.windowIndex || state.modelOccupant !== candidate.targetCode ||
        !Number.isInteger(state.windowTick) || !Number.isFinite(state.windowClockMs) ||
        (state.withBonnieEncounterFrame !== undefined &&
          state.encounterLeadUpdates !== state.windowTick - state.withBonnieEncounterFrame))
      throw new Error('candidate target-state snapshot differs from its model window');
    if (!/^[a-f0-9]{64}$/.test(candidate.scheduleSha256)) throw new Error('candidate schedule hash is malformed');
  }
  const match = result.candidates.some((candidate) => candidate.preservesPhonePrefix && candidate.targetCode === result.target.targetPhoneCode);
  const conclusion = match
    ? 'A measured response-bracket timing choice preserves the first six phone windows and matches window 6.'
    : 'No measured response-bracket timing choice preserves the first six phone windows and clears window 6.';
  if (result.conclusion !== conclusion || idOf(result) !== result.evidenceId) throw new Error('input-bracket conclusion or evidence ID differs');
  return { evidenceId: result.evidenceId, candidates: result.candidateCount, match };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [mode, arg] = process.argv.slice(2);
  if (mode === 'run') {
    const output = resolve(arg ?? join(ROOT, RESULT));
    const result = simulateFamily();
    check(result);
    writeFileSync(output, `${JSON.stringify(result, null, 1)}\n`);
    console.log(`${result.evidenceId}: ${result.candidateCount} MODEL_ONLY candidates (${result.conclusion})`);
  } else if (mode === 'check') {
    if (!arg) throw new Error('usage: phone-input-bracket-sweep.ts check RESULT.json');
    const result = JSON.parse(readFileSync(arg, 'utf8'));
    const verified = check(result);
    console.log(`${verified.evidenceId}: ${verified.candidates} MODEL_ONLY candidates; record arithmetic rechecked`);
  } else throw new Error('usage: phone-input-bracket-sweep.ts run [RESULT.json] | check RESULT.json');
}
