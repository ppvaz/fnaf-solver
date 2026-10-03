// Plan 12's promotion, extended to a FNaF 1 runner's pack (ROADMAP S6: FNaF 1, 3 and 4 each need a PROMOTED_BY
// edge over a device run pack of their committed winner).
//
// The checks are Plan 12's, by name and by intent; only where each one reads differs, because a FNaF 1 night has
// no campaign executor and no result.json:
//   offlineEvidence   the runner's own record: a live, non-dry night, DEVICE_MEASURED, COMPLETE.
//   terminalPass      the save's own mark, read by an instrument: the packed title-stars.json (Play's
//                     fnaf1-title-stars.py over the run's retained title frames) reads one more star after the
//                     night than before it, every counted frame confidently the title and the same frame (by
//                     sha256) the run record captured, the before frames ahead of the night's origin and the after
//                     frames behind its end. A star appears only when the game records a completed night.
//   manifestComplete  the record, its events and the star read are packed, and the record says COMPLETE.
//   winnerCommitted   a committed fnaf1-route-winner-v1 names this run, and its options, dials and pinned model
//                     hashes are the ones the run record bound.
//   claimIdentity     the dial vector the run's own Custom Night readback observed before the night began.
// The attestation is written only by `npm run evidence -- attest` after these re-derive (evidence-promotion.ts).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { custodyWinnerFiles, packCustody, runnerGame } from './evidence-pack.ts';
import type { readPack } from './evidence-pack.ts';
import { jsonObject, jsonlRecords, objectOrNull, sha256 } from './records.ts';
import type { JsonObject } from './records.ts';
import { isList, isRecord } from '@sixam/kernel';

type Dials = Readonly<Record<string, number>>;
/** One row of a FNaF 1 runner's events.jsonl, by the fields these checks read. */
type RunnerEvent = { readonly type?: string, readonly atWallMs: number, readonly atMonotonicMs: number,
  readonly dials?: Dials, readonly status?: unknown, readonly ended?: unknown, readonly [field: string]: unknown };
/** The runner's probe.json or run.json record. */
type RunnerRecord = { readonly options?: Readonly<Record<string, unknown>>, readonly claimLevel?: unknown, readonly status?: unknown,
  readonly capture?: { readonly frames?: readonly { readonly name: string, readonly sha256?: string, readonly atWallMs: number }[] },
  readonly dialsSet?: Dials, readonly bindings?: Readonly<Record<string, { readonly sha256?: string }>> };
/** fnaf1-title-stars-v1: the stars a title frame shows, before and after the night. */
type TitleStars = { readonly schema?: unknown, readonly run?: unknown, readonly before: number, readonly after: number,
  readonly earned?: unknown, readonly reader?: unknown, readonly model?: unknown,
  readonly frames: readonly { readonly name: string, readonly sha256?: string, readonly phase: string, readonly confident?: boolean, readonly stars?: unknown }[],
  readonly [phase: string]: unknown };
/** fnaf1-route-winner-v1, by the fields that bind it to a run. */
type RouteWinner = { readonly won?: { readonly run?: unknown }, readonly resolvedOptions?: Readonly<Record<string, unknown>>,
  readonly night?: { readonly dials?: Dials }, readonly sources?: Readonly<Record<string, unknown>> };

const isDials = (value: unknown): value is Dials => isRecord(value) && Object.values(value).every((dial) => typeof dial === 'number');
const optional = (value: unknown, check: (present: unknown) => boolean) => value === undefined || check(value);
const isString = (value: unknown) => typeof value === 'string';

/** A runner's events.jsonl row, checked for the fields these checks read. */
function runnerEvent(row: JsonObject, index: number): RunnerEvent {
  if (typeof row.atWallMs !== 'number' || typeof row.atMonotonicMs !== 'number' || !optional(row.type, isString) || !optional(row.dials, isDials))
    throw new Error(`events.jsonl line ${index + 1} is not a runner event`);
  return row as unknown as RunnerEvent;
}

/** The runner's probe.json, checked for the fields these checks read. */
function runnerRecord(value: JsonObject): RunnerRecord {
  const frames = objectOrNull(value.capture)?.frames;
  if (!optional(value.options, isRecord) || !optional(value.dialsSet, isDials) || !optional(value.capture, isRecord)
    || !optional(frames, (list) => isList(list) && list.every((frame) => isRecord(frame) && typeof frame.name === 'string'
      && typeof frame.atWallMs === 'number' && optional(frame.sha256, isString)))
    || !optional(value.bindings, (bindings) => isRecord(bindings)
      && Object.values(bindings).every((binding) => isRecord(binding) && optional(binding.sha256, isString))))
    throw new Error('probe.json is not a runner record');
  return value as unknown as RunnerRecord;
}

/** title-stars.json, checked for the fields these checks read. */
function titleStars(value: JsonObject): TitleStars {
  if (typeof value.before !== 'number' || typeof value.after !== 'number' || !isList(value.frames)
    || !value.frames.every((frame) => isRecord(frame) && typeof frame.name === 'string' && typeof frame.phase === 'string'
      && optional(frame.sha256, isString) && optional(frame.confident, (confident) => typeof confident === 'boolean')))
    throw new Error(`${FNAF1_STARS_FILE} is not a title-stars record`);
  return value as unknown as TitleStars;
}

/** A fnaf1-route-winner-v1, checked for the fields that bind it to a run. */
function routeWinner(value: JsonObject, file: string): RouteWinner {
  if (!optional(value.won, isRecord) || !optional(value.resolvedOptions, isRecord) || !optional(value.sources, isRecord)
    || !optional(value.night, (night) => isRecord(night) && optional(night.dials, isDials)))
    throw new Error(`${file} is not a ${FNAF1_WINNER_SCHEMA}`);
  return value as unknown as RouteWinner;
}

const FNAF1_STARS_FILE = 'title-stars.json';
const FNAF1_STARS_SCHEMA = 'fnaf1-title-stars-v1';
const FNAF1_WINNER_SCHEMA = 'fnaf1-route-winner-v1';
const DIALS = ['freddy', 'bonnie', 'chica', 'foxy'];

/** Committed FNaF 1 route winners (active and retired), repository-relative. */
function fnaf1WinnerFiles(root: string): string[] {
  return custodyWinnerFiles(root).filter((file) => {
    try { return jsonObject(readFileSync(join(root, file), 'utf8'), file).schema === FNAF1_WINNER_SCHEMA; } catch { return false; }
  });
}

const sameDials = (a: Dials | null | undefined, b: Dials | null | undefined) => Boolean(a && b && DIALS.every((dial) => a[dial] === b[dial]));

/** The claim a FNaF 1 Custom Night supports: named by the dial vector its readback observed. */
function fnaf1Claim(dials: Dials) {
  const vector = DIALS.map((dial) => dials[dial]).join('-');
  const four20 = DIALS.every((dial) => dials[dial] === 20);
  return { id: `claim.fnaf1.custom-night.${vector}.device-6am`, night: 7, mode: 'custom', dials,
    label: four20 ? 'FNaF 1 Custom Night 4/20 (all four at 20) reaches 6 AM on the phone (the save earns its title star)'
      : `FNaF 1 Custom Night ${DIALS.map((dial) => dials[dial]).join('/')} reaches 6 AM on the phone (the save earns a title star)` };
}

/**
 * Every check but the attestation, from a FNaF 1 pack alone (and the committed winners). Same shape as
 * derivePromotion's FNaF 2 result. Nothing is written.
 */
export function deriveFnaf1Promotion(root: string, id: string, dir: string, loaded: ReturnType<typeof readPack>) {
  const { pack, digest } = loaded;
  const game = runnerGame(pack);
  if (game !== 'fnaf1') {
    // Every runner's pack carries this kind; another game's is refused by name, not judged by FNaF 1's checks.
    const failed = [`a ${game ?? 'unregistered game'} runner pack: no promotion gate reads ${game ?? 'its'} runner packs yet`];
    return { id, dir, loaded, digest, custody: packCustody(pack), claim: null,
      verified: ['offlineEvidence', 'terminalPass', 'manifestComplete', 'winnerCommitted', 'claimIdentity']
        .map((check) => ({ check, pass: false, inputs: [], detail: { game, failed } as Readonly<Record<string, unknown>> })),
      pass: false };
  }
  const packed = (name: string) => pack.files.find((file) => file.name === name);
  const inputs = (...names: string[]) => names.map(packed)
    .filter((file): file is NonNullable<ReturnType<typeof packed>> => Boolean(file))
    .map((file) => ({ name: file.name, sha256: file.sha256 }));
  const json = (name: string) => (packed(name) ? jsonObject(readFileSync(join(dir, name), 'utf8'), name) : null);
  const probeJson = json('probe.json');
  const probe = probeJson ? runnerRecord(probeJson) : null;
  const events = packed('events.jsonl')
    ? jsonlRecords(readFileSync(join(dir, 'events.jsonl'), 'utf8'), 'events.jsonl').map(runnerEvent) : [];
  const starsJson = json(FNAF1_STARS_FILE);
  const stars = starsJson ? titleStars(starsJson) : null;
  const verified: { check: string, pass: boolean, inputs: readonly { name: string, sha256: string }[], detail: Readonly<Record<string, unknown>> }[] = [];
  const add = (check: string, failed: readonly string[], detail: Readonly<Record<string, unknown>>, from: readonly { name: string, sha256: string }[]) => verified.push({ check, pass: failed.length === 0, inputs: from, detail: failed.length ? { ...detail, failed } : detail });

  add('offlineEvidence', [
    ...(probe?.options?.live === true && probe?.options?.dryRun === false ? [] : ['the runner record is not a live night']),
    ...(String(probe?.claimLevel ?? '').startsWith('DEVICE_MEASURED') && pack.claimLevel === 'DEVICE_MEASURED' ? [] : ['not DEVICE_MEASURED']),
    ...(probe?.status === 'COMPLETE' ? [] : [`record status ${probe?.status ?? 'none'}, not COMPLETE`]),
  ], { live: probe?.options?.live ?? null, claimLevel: pack.claimLevel, status: probe?.status ?? null }, inputs('probe.json'));

  const origin = events.find((e) => e.type === 'night-origin');
  const ended = events.find((e) => e.type === 'night-ended');
  const captured = new Map((probe?.capture?.frames ?? []).map((f) => [f.name, f] as const));
  const terminalFailed: string[] = [];
  if (!stars) terminalFailed.push(`${FNAF1_STARS_FILE} is not packed`);
  else {
    if (stars.schema !== FNAF1_STARS_SCHEMA) terminalFailed.push(`${FNAF1_STARS_FILE} is not ${FNAF1_STARS_SCHEMA}`);
    if (stars.run !== pack.run) terminalFailed.push(`${FNAF1_STARS_FILE} reads run ${stars.run}, not ${pack.run}`);
    if (!origin || !ended) terminalFailed.push('the events hold no night origin and end');
    for (const phase of ['before', 'after']) {
      const counted = stars.frames.filter((f) => f.phase === phase && f.confident);
      if (!counted.length) terminalFailed.push(`no confident title frame ${phase} the night`);
      if (counted.some((f) => f.stars !== stars[phase])) terminalFailed.push(`the ${phase} frames do not agree on ${stars[phase]} stars`);
      for (const f of counted) {
        const c = captured.get(f.name);
        if (!c || c.sha256 !== f.sha256) terminalFailed.push(`${f.name} is not the frame the run record captured`);
        else if (origin && ended && (phase === 'before' ? !(c.atWallMs < origin.atWallMs) : !(c.atWallMs > ended.atWallMs)))
          terminalFailed.push(`${f.name} is not ${phase} the night`);
      }
    }
    if (!(Number.isInteger(stars.before) && Number.isInteger(stars.after) && stars.after > stars.before && stars.earned === stars.after - stars.before))
      terminalFailed.push(`the title reads ${stars.before} stars before and ${stars.after} after: no star earned`);
  }
  add('terminalPass', terminalFailed, { starsBefore: stars?.before ?? null, starsAfter: stars?.after ?? null, earned: stars?.earned ?? null,
    nightEnded: ended?.ended ?? null, reader: stars?.reader ?? null, model: stars?.model ?? null },
  inputs(FNAF1_STARS_FILE, 'probe.json', 'events.jsonl'));

  const custody = packCustody(pack);
  const missing = ['probe.json', 'events.jsonl', FNAF1_STARS_FILE].filter((name) => !packed(name));
  add('manifestComplete', [...missing.map((name) => `${name} is not packed`), ...(pack.status === 'COMPLETE' ? [] : [`pack status ${pack.status}`]),
    ...(custody.lost.length ? [`custody lost ${custody.lost.join(', ')}`] : [])], { custody: custody.kind, lost: custody.lost }, inputs('probe.json', 'events.jsonl', FNAF1_STARS_FILE));

  const candidates = fnaf1WinnerFiles(root).map((file) => ({ file, bytes: readFileSync(join(root, file)) }))
    .map((item) => ({ ...item, winner: routeWinner(jsonObject(item.bytes.toString('utf8'), item.file), item.file) }))
    .filter((item) => item.winner.won?.run === pack.run);
  const winnerFailed: string[] = [];
  const winner = candidates[0] ?? null;
  if (!winner) winnerFailed.push(`no committed ${FNAF1_WINNER_SCHEMA} names run ${pack.run}`);
  else {
    const w = winner.winner; const o: Readonly<Record<string, unknown>> = probe?.options ?? {};
    if (w.resolvedOptions?.policy !== o.mode) winnerFailed.push(`the winner's policy ${w.resolvedOptions?.policy} is not the run's mode ${o.mode}`);
    for (const key of ['chicaByCamera', 'originOffsetMs', 'stopAfterMs'])
      if (w.resolvedOptions?.[key] !== o[key]) winnerFailed.push(`the winner's ${key} ${w.resolvedOptions?.[key]} is not the run's ${o[key]}`);
    if (!sameDials(w.night?.dials, probe?.dialsSet)) winnerFailed.push('the winner\'s dials are not the dials the run set');
    const pinned = new Set(Object.values(w.sources ?? {}));
    for (const [name, binding] of Object.entries(probe?.bindings ?? {}))
      if (name !== 'title' && !pinned.has(binding.sha256)) winnerFailed.push(`the run's ${name} model ${binding.sha256} is not among the winner's pinned sources`);
  }
  add('winnerCommitted', winnerFailed, { winner: winner?.file ?? null, run: pack.run },
    winner ? [{ name: winner.file, sha256: sha256(winner.bytes) }] : []);

  const set = events.find((e) => e.type === 'dials-set');
  const readback = set ? events.filter((e) => e.type === 'dial-read' && e.status === 'PASS' && e.atMonotonicMs <= set.atMonotonicMs).at(-1) : null;
  const claimFailed: string[] = [];
  if (!set) claimFailed.push('no dials-set event');
  if (!readback) claimFailed.push('no PASS Custom Night readback before the night began');
  else if (!sameDials(readback.dials, set?.dials)) claimFailed.push('the last readback differs from the dials set');
  if (set && !sameDials(set.dials, probe?.dialsSet)) claimFailed.push('the events and the record disagree on the dials set');
  if (origin && set && !(set.atMonotonicMs < origin.atMonotonicMs)) claimFailed.push('the dials were set after the night began');
  // A missing readback is already a failure; the second test only says so to the checker.
  const claim = claimFailed.length || !readback?.dials ? null : fnaf1Claim(readback.dials);
  add('claimIdentity', claimFailed, { observedDials: readback?.dials ?? null, setDials: set?.dials ?? null }, inputs('events.jsonl', 'probe.json'));

  return { id, dir, loaded, digest, custody, claim, verified, pass: verified.every((item) => item.pass) };
}
