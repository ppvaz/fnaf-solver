#!/usr/bin/env node
/** Inspect retained session/result bundles without re-entering measurements. */
import { createHash } from 'node:crypto';
import { type Dirent, existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isRecord } from '@sixam/kernel';
import { type SessionManifest, canonicalJson, stableHash, validateArtifactRef } from '@sixam/kernel/contracts';
import { validateManifest } from '@sixam/kernel/contracts';
import { type ModelExperimentSpec, replayModelResult } from '@sixam/propose/experiment';
import { BUNDLE_SCHEMA, validateBundle } from '../../../packages/propose/bin/plans/bundle.ts';
import { isCampaignResult, campaignEntry, campaignPromotionChecks } from '@sixam/review/evidence-campaign';
import { PACKS_DIR, resolvePackTargets, buildPack, buildFnaf1Pack, writePack, readPack, packPromotionChecks,
  trackedWinners, packEntry, recoveryCheck, attestationStatus, packCustody } from '@sixam/review/evidence-pack';
import { GRAPH_FILE, attestPack, derivePromotion, fnaf1PromotionChecks, formatGraph, promotionEdgeFor, promotionSummary, readGraph,
  recordPromotion } from '@sixam/review/evidence-promotion';
import { computeCohort } from '@sixam/review/evidence-cohort';
import { FNAF2, promotionSummaryEnvelope, showEnvelope } from '@sixam/review/envelopes';
import { writeFileSync } from 'node:fs';

const ROOT = resolve(join(fileURLToPath(new URL('.', import.meta.url)), '../../..'));
const ARTIFACTS = join(ROOT, 'artifacts');
const PACKS = join(ROOT, PACKS_DIR);
const SESSION_RESULT_SCHEMAS = new Set(['device-run-result-v1', 'experiment-result-v1']);
const CLAIM_LEVELS = new Set(['MODEL_ONLY', 'FIXTURE', 'DEVICE_MEASURED']);
const help = () => console.log('Usage: npm run evidence -- <list|show|replay|why|promote> RUN_ID\n'
  + '       npm run evidence -- show RUN_ID --envelope   (the same object, as a claim-envelope-v1)\n'
  + '       npm run evidence -- diff LEFT_ID RIGHT_ID\n'
  + '                  (an id is read from artifacts/<id> first, then from the committed pack docs/evidence/runs/<id>)\n'
  + '       npm run evidence -- pack <CAMPAIGN_ID|NIGHT_RUN_LABEL> [--replace] [--timeline GRADED_TIMELINE.json]\n'
  + '       npm run evidence -- attest <PACK_ID> --by agent --note "SESSION OR AGENT" [--replace]\n'
  + '       npm run evidence -- attest <PACK_ID> --by human --name "NAME" [--replace]\n'
  + '                  (re-derives every other check from the pack, refuses on any failure, writes plan12-attestation.json)\n'
  + '       npm run evidence -- promotions [--envelope]   (every pack against the gate and the graph, per night)\n'
  + '       npm run evidence -- recovery-check    (does run/campaign.log reproduce the campaigns still on disk?)\n'
  + '       npm run evidence -- cohort <PREDECLARATION.json> [--prefix LABEL_PREFIX]');

/** A session's result.json, as load() checks it. */
interface SessionResult {
  readonly schema: string, readonly evidenceId: string, readonly claimLevel: string, readonly outcome: string,
  readonly resultHash?: unknown, readonly specHash?: unknown, readonly profile?: unknown,
}
/** What loadAny read: a session, a compiled device bundle, a campaign directory, or a committed pack. */
type Loaded =
  | (Awaited<ReturnType<typeof load>> & { readonly kind: 'session', readonly packed?: undefined })
  | (Awaited<ReturnType<typeof loadDeviceBundle>> & { readonly packed?: undefined })
  | (Awaited<ReturnType<typeof loadCampaign>> & { readonly packed?: undefined })
  | ReturnType<typeof loadPack>;
/** A campaign directory or a pack: the records diff and why compare file by file. */
type Held = Extract<Loaded, { readonly kind: 'device-campaign' | 'fnaf1-run' }>;
type Place = ReturnType<typeof holder>;

/** A field of a JSON value: `value?.[key]`, read only off an object. */
const field = (value: unknown, key: string) => (isRecord(value) ? value[key] : undefined);

/** The value after a flag, or null. */
const flag = (name: string) => {
  const at = process.argv.indexOf(name);
  if (at < 0) return null;
  const value = process.argv[at + 1];
  if (value === undefined || value.startsWith('--')) throw new Error(`${name} needs a value`);
  return value;
};

/** `--envelope`: `show` and `promotions` print their object as a claim-envelope-v1 (Plan 28 step 1). */
const envelope = process.argv.includes('--envelope');

/** What a shown record is about, where it was read, and its own claim level. */
function showTarget(id: string, loaded: Loaded) {
  if (loaded.packed) {
    const where = `${PACKS_DIR}/${id}/pack.json`;
    if (loaded.kind === 'fnaf1-run') {
      const pkg = field(loaded.packed.pack.target, 'package');
      return { target: typeof pkg === 'string' && /^com\.scottgames\.[a-z0-9]+$/.test(pkg) ? pkg
        : { kind: 'UNKNOWN' as const, reason: `${where} names no target package` }, source: where, claimLevel: loaded.entry.claimLevel };
    }
    return { target: FNAF2, source: where, claimLevel: loaded.entry.claimLevel };
  }
  const source = `artifacts/${id}`;
  if (loaded.kind === 'device-campaign') return { target: FNAF2, source, claimLevel: loaded.entry.claimLevel };
  if (loaded.kind === 'session') return { target: { kind: 'UNKNOWN' as const, reason: 'a session result names no game package' }, source,
    claimLevel: loaded.result.claimLevel };
  return { target: FNAF2, source, claimLevel: field(loaded.bundle.manifest.gate, 'claimLevel') ?? 'MODEL_ONLY' };
}

/** Who attested a pack and whether the attestation binds it: printed by list, show and promote. */
const attestationView = (packed: ReturnType<typeof readPack>) => {
  if (!packed.attestation) return { attestedBy: null, valid: false, reason: 'no attestation' };
  const status = attestationStatus(packed.attestation, packed.digest);
  return { attestedBy: status.by, author: field(packed.attestation, 'attestedBy') ?? null,
    date: field(packed.attestation, 'date') ?? field(packed.attestation, 'at') ?? null, schema: field(packed.attestation, 'schema'),
    valid: status.valid, reason: status.reason };
};

async function readVerifiedArtifact(base: string, ref: unknown) {
  const artifact = validateArtifactRef(ref);
  if (typeof artifact.locator !== 'string' || artifact.locator.startsWith('/') ||
      artifact.locator.split('/').some(part => part === '..'))
    throw new Error('artifact locator must remain inside its run bundle');
  const text = await readFile(join(base, artifact.locator), 'utf8');
  if (stableHash(text) !== artifact.hash || Buffer.byteLength(text) !== artifact.size)
    throw new Error(`artifact integrity mismatch: ${artifact.locator}`);
  return text;
}

async function load(run: string): Promise<{ result: SessionResult, manifest: SessionManifest, spec: unknown }> {
  if (!run || !/^[\w-]+$/.test(run)) throw new Error('a safe RUN_ID is required');
  const base = join(ARTIFACTS, run);
  const result = JSON.parse(await readFile(join(base, 'result.json'), 'utf8'));
  const manifest = JSON.parse(await readFile(join(base, 'session-manifest.json'), 'utf8'));
  validateManifest(manifest);
  if (!SESSION_RESULT_SCHEMAS.has(result.schema)) throw new Error('result schema is not a supported session result');
  if (typeof result.evidenceId !== 'string' || typeof result.claimLevel !== 'string' ||
      typeof result.outcome !== 'string' || !CLAIM_LEVELS.has(result.claimLevel))
    throw new Error('result lacks evidence identity, outcome, or valid claim ceiling');
  if (manifest.id !== result.evidenceId) throw new Error('result and manifest identify different runs');
  if (manifest.resultHash && manifest.resultHash !== result.resultHash)
    throw new Error('manifest result hash does not match the result');
  if (manifest.specHash && manifest.specHash !== result.specHash)
    throw new Error('manifest spec hash does not match the result');
  if (manifest.artifacts.result?.schema === 'artifact-ref-v1') {
    await readVerifiedArtifact(base, manifest.artifacts.result);
    const payload = { ...result };
    delete payload.resultHash;
    if (result.resultHash !== stableHash(payload)) throw new Error('result hash does not match its payload');
  }
  let spec = null;
  if (manifest.artifacts.spec?.schema === 'artifact-ref-v1') {
    const specText = await readVerifiedArtifact(base, manifest.artifacts.spec);
    spec = JSON.parse(specText);
    if (result.specHash !== stableHash(spec)) throw new Error('experiment spec hash does not match the result');
  }
  if (manifest.manifestHash) {
    const manifestPayload = { ...manifest };
    delete manifestPayload.manifestHash;
    const fullPayloadMatches = manifest.manifestHash === stableHash(manifestPayload);
    const servicePayloadMatches = manifest.manifestHash === stableHash({
      id: manifest.id, profileHash: manifest.profileHash, modelHash: manifest.modelHash,
      policyHash: manifest.policyHash, events: manifest.events, artifacts: manifest.artifacts,
    });
    if (!fullPayloadMatches && !servicePayloadMatches) throw new Error('manifest hash does not match its payload');
  }
  return { result, manifest, spec };
}

async function loadDeviceBundle(run: string) {
  if (!run || !/^[\w-]+$/.test(run)) throw new Error('a safe RUN_ID is required');
  const base = join(ARTIFACTS, run);
  const manifest = JSON.parse(await readFile(join(base, 'manifest.json'), 'utf8'));
  if (manifest.schema !== BUNDLE_SCHEMA) throw new Error('not a device bundle');
  return { bundle: validateBundle(base), kind: 'device-bundle' as const };
}

async function loadCampaign(run: string) {
  const base = join(ARTIFACTS, run);
  const wrapper = JSON.parse(await readFile(join(base, 'result.json'), 'utf8'));
  if (!isCampaignResult(wrapper)) throw new Error('not a device campaign result');
  return { kind: 'device-campaign' as const, entry: campaignEntry(run, wrapper), wrapper, files: await readdir(base) };
}

// A committed run pack (packages/review/src/evidence-pack.ts): the same campaign facts, verified against
// the pack's own hashes, readable on any checkout.
function loadPack(run: string) {
  if (!run || !/^[\w.-]+$/.test(run)) throw new Error('a safe RUN_ID is required');
  if (!existsSync(join(PACKS, run, 'pack.json'))) throw new Error(`${PACKS_DIR}/${run} holds no pack.json`);
  const packed = readPack(join(PACKS, run));
  if (packed.pack.kind === 'fnaf1-run')
    return { kind: 'fnaf1-run' as const, entry: { id: run, kind: 'fnaf1-run', outcome: field(packed.pack.outcome, 'ended') ?? null,
      claimLevel: packed.pack.claimLevel, status: packed.pack.status } as { id: string, kind: 'fnaf1-run', outcome: unknown,
      claimLevel: unknown, status: unknown, nights?: undefined }, files: packed.files, packed };
  return { kind: 'device-campaign' as const, entry: packEntry(run, packed), wrapper: packed.wrapper,
    files: packed.files, packed };
}

/** The directories under `base`, or none when it does not exist. */
const directories = async (base: string) => {
  try { return (await readdir(base, { withFileTypes: true })).filter(item => item.isDirectory()).map(item => item.name); }
  catch { return []; }
};

/** Levenshtein distance: the typo a suggestion is ranked by. */
function editDistance(a: string, b: string) {
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1)
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    previous = current;
  }
  return previous[b.length];
}

/**
 * The error for an id that names nothing here, carrying the three nearest ids: those the typed
 * id is a prefix of first, then by edit distance. `artifacts/` is gitignored, so on a clean
 * checkout the committed packs are the only candidates.
 */
async function unknownRun(run: string, { packsOnly = false }: {packsOnly?: boolean} = {}) {
  const ids = [...new Set([...(packsOnly ? [] : await directories(ARTIFACTS)), ...await directories(PACKS)])];
  const nearest = ids.map(name => ({ name, prefix: name.startsWith(run) ? 0 : 1, distance: editDistance(run, name) }))
    .sort((a, b) => a.prefix - b.prefix || a.distance - b.distance || a.name.localeCompare(b.name))
    .slice(0, 3).map(item => `  ${item.name}`);
  return new Error([`no ${packsOnly ? 'pack' : 'run or pack'} named ${run}`,
    ...(nearest.length ? ['nearest ids:', ...nearest] : ['(this checkout holds no runs and no packs)']),
    '`npm run evidence -- list` shows them all'].join('\n'));
}

/**
 * artifacts/<run> first -- a session, a device bundle or a campaign directory -- then the
 * committed pack docs/evidence/runs/<run>, so every reading works on a clean checkout. An id
 * that names neither is refused with the nearest ids, never with a raw ENOENT.
 */
async function loadAny(run: string): Promise<Loaded> {
  if (!run || !/^[\w.-]+$/.test(run) || run.startsWith('.')) throw new Error('a safe RUN_ID is required');
  const local = existsSync(join(ARTIFACTS, run));
  const packed = existsSync(join(PACKS, run));
  if (!local && !packed) throw await unknownRun(run);
  if (local) {
    try { return { ...(await load(run)), kind: 'session' as const }; }
    catch (sessionError) {
      try { return await loadDeviceBundle(run); } catch { /* not a bundle: a campaign? */ }
      try { return await loadCampaign(run); } catch { /* not a campaign: the pack, if one exists */ }
      if (!packed) throw sessionError;
    }
  }
  return loadPack(run);
}

const sha256 = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
// What a campaign directory writes (packages/review/src/evidence-pack.ts packs the same four).
const CAMPAIGN_FILES = ['result.json', 'events.jsonl', 'request.json', 'observations.jsonl'];

/** Where a loaded campaign or pack keeps its text, and what its custody lost. */
const holder = (run: string, loaded: Held) => loaded.packed
  ? { source: 'pack', dir: join(PACKS, run), where: `${PACKS_DIR}/${run}`, custody: packCustody(loaded.packed.pack) }
  : { source: 'artifacts', dir: join(ARTIFACTS, run), where: `artifacts/${run}`, custody: null };

/** Why a campaign or pack lacks `name`, in words: lost with its custody, or never there. */
function lacking(place: Place, name: string) {
  const lost: readonly string[] = place.custody?.lost ?? [];
  return lost.includes(name)
    ? `${place.where} holds no ${name}: its custody (${place.custody?.kind}) lists it as lost (lost: ${lost.join(', ')})`
    : `${place.where} holds no ${name}`;
}

/** A campaign's or pack's text files by the sha256 of the bytes it holds. */
async function heldFiles(place: Place, loaded: Held) {
  if (loaded.packed) return new Map(loaded.packed.pack.files.map(file => [file.name, file.sha256]));
  const held = new Map<string, string>();
  for (const name of loaded.files.filter(item => CAMPAIGN_FILES.includes(item)).sort())
    held.set(name, sha256(await readFile(join(place.dir, name))));
  return held;
}

/** The facts two campaigns or packs are compared on, beside their files. */
function sideView(run: string, loaded: Held, place: Place) {
  return { source: place.source, kind: loaded.kind, outcome: loaded.entry.outcome ?? null,
    claimLevel: loaded.entry.claimLevel ?? null, nights: loaded.entry.nights ?? null,
    ...(loaded.packed ? { packSha256: loaded.packed.digest, winnerHash: loaded.packed.pack.bundle?.winnerHash ?? null,
      custody: place.custody } : {}) };
}

/** Everything one side cannot be compared on: what its pack lost, or a campaign file never written. */
function unavailable(place: Place, loaded: Held, held: Map<string, string>) {
  const { lost } = place.custody ?? { lost: CAMPAIGN_FILES.filter(name => !held.has(name)) };
  if (!lost.length) return [];
  return [loaded.packed ? `${place.where} lost ${lost.join(', ')} (custody ${place.custody?.kind}); not compared`
    : `${place.where} holds no ${lost.join(', ')}; not compared`];
}

async function list() {
  let entries: Dirent[] = [];
  try { entries = await readdir(ARTIFACTS, { withFileTypes: true }); } catch { /* no runs is a valid clean checkout */ }
  const runs = [];
  for (const entry of entries.filter(item => item.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    const base = join(ARTIFACTS, entry.name);
    try {
      const { result } = await load(entry.name);
      runs.push({ id: result.evidenceId, kind: 'session', outcome: result.outcome,
        claimLevel: result.claimLevel, profile: result.profile });
      continue;
    } catch { /* classify the other retained artifact families below */ }
    try {
      const result = JSON.parse(await readFile(join(base, 'result.json'), 'utf8'));
      if (SESSION_RESULT_SCHEMAS.has(result.schema)) {
        runs.push({ id: result.evidenceId ?? entry.name, kind: 'session', outcome: 'INVALID_SESSION',
          reason: 'session result or manifest failed validation' });
        continue;
      }
      if (isCampaignResult(result)) {
        try { runs.push(campaignEntry(entry.name, result)); }
        catch (error) {
          runs.push({ id: entry.name, kind: 'device-campaign', outcome: 'INVALID_CAMPAIGN', reason: (error as Error).message });
        }
        continue;
      }
    } catch { /* not a session result; inspect device and historical schemas */ }
    try {
      const manifest = JSON.parse(await readFile(join(base, 'manifest.json'), 'utf8'));
      if (manifest.schema === BUNDLE_SCHEMA) {
        try {
          const bundle = validateBundle(base);
          runs.push({ id: entry.name, kind: 'device-bundle', outcome: 'READY',
            claimLevel: field(bundle.manifest.gate, 'claimLevel') ?? 'MODEL_ONLY',
            profile: bundle.profile.id });
        } catch (error) {
          runs.push({ id: entry.name, kind: 'device-bundle', outcome: 'INVALID_BUNDLE',
            reason: (error as Error).message });
        }
      } else {
        // Historical manifests are retained for diagnosis, but are not runtime
        // session bundles and must not be reported as malformed current runs.
        runs.push({ id: entry.name, kind: 'legacy-artifact', outcome: 'LEGACY_ARCHIVE' });
      }
      continue;
    } catch { /* no manifest: distinguish scratch output from a known bundle */ }
    try {
      const winner = JSON.parse(await readFile(join(base, 'winner.json'), 'utf8'));
      runs.push({ id: entry.name, kind: winner.schema === 'winner-v1' ? 'incomplete-device-bundle' : 'unindexed',
        outcome: 'INCOMPLETE_BUNDLE' });
    } catch {
      runs.push({ id: entry.name, kind: 'unindexed', outcome: 'UNRECOGNIZED_ARTIFACT' });
    }
  }
  let packs: Dirent[] = [];
  try { packs = await readdir(PACKS, { withFileTypes: true }); } catch { /* no packs committed yet */ }
  const graph = readGraph(ROOT);
  for (const pack of packs.filter(item => item.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    try {
      const { packed, entry } = loadPack(pack.name);
      const view = attestationView(packed);
      const edge = promotionEdgeFor(graph, pack.name);
      runs.push({ ...entry, source: 'pack', campaign: packed.pack.campaign, packSha256: packed.digest,
        custody: packCustody(packed.pack), attestedBy: view.attestedBy, attestation: packed.attestation ? (view.valid ? 'VALID' : `INVALID: ${view.reason}`) : null,
        promoted: edge && edge.packSha256 === packed.digest ? edge.from : null });
    } catch (error) {
      runs.push({ id: pack.name, kind: 'run-pack', outcome: 'INVALID_PACK', reason: (error as Error).message });
    }
  }
  console.log(JSON.stringify({ schema: 'evidence-index-v1', runs }, null, 2));
}

// Build a frame-free run pack for every campaign the id names and write it under PACKS_DIR.
function pack(id: string, { replace = false, timeline = null }: { replace?: boolean, timeline?: string | null } = {}) {
  const targets = resolvePackTargets(ROOT, id);
  if (timeline && targets.length !== 1) throw new Error('--timeline names one run; this id packs several campaigns');
  const results = targets.map(target => {
    const built = target.fnaf1RunDir !== undefined ? buildFnaf1Pack({ root: ROOT, home: homedir(), ...target })
      : buildPack({ root: ROOT, home: homedir(), ...target, timeline });
    const status = writePack(join(PACKS, target.packId), built, { replace });
    // A FNaF 1 pack names no nights, bundle or custody: each reads as undefined.
    const made: typeof built.pack & { readonly nights?: unknown, readonly bundle?: { readonly winnerHash: string | null } | null,
      readonly custody?: unknown } = built.pack;
    const redactions = made.files.reduce((sum, file) => ({
      paths: sum.paths + file.redactions.paths, pixelArrays: sum.pixelArrays + file.redactions.pixelArrays,
      frameRefs: sum.frameRefs + file.redactions.frameRefs }), { paths: 0, pixelArrays: 0, frameRefs: 0 });
    return { id: made.id, status, dir: `${PACKS_DIR}/${made.id}`, outcome: made.outcome, claimLevel: made.claimLevel,
      nights: made.nights, files: made.files.length, bytes: made.files.reduce((sum, file) => sum + file.bytes, 0),
      withheld: made.withheld.length, withheldBytes: made.withheld.reduce((sum, item) => sum + (item.bytes ?? 0), 0),
      redactions, winnerHash: made.bundle?.winnerHash ?? null, ...(made.custody ? { custody: made.custody } : {}),
      winnerCommitted: Boolean(made.bundle?.winnerHash && trackedWinners(ROOT).has(made.bundle.winnerHash)) };
  });
  console.log(JSON.stringify({ schema: 'run-pack-result-v1', packs: results }, null, 2));
}

const stable = (value: unknown) => canonicalJson(value);

/** Each side of a diff is a campaign directory or a pack, or the diff is refused. */
function assertHeld(id: string, loaded: Loaded): asserts loaded is Held {
  if (!['device-campaign', 'fnaf1-run'].includes(loaded.kind))
    throw new Error(`diff compares two sessions, or two campaigns or packs; ${id} is a ${loaded.kind}`);
}

async function main([operation = 'help', first, second]: string[]) {
  if (operation === 'help' || operation === '--help') return help();
  if (operation === 'list') return list();
  if (operation === 'pack') {
    const flags = process.argv.slice(process.argv.indexOf('pack') + 2);
    const timelineAt = flags.indexOf('--timeline');
    if (timelineAt >= 0 && !flags[timelineAt + 1]) throw new Error('--timeline needs a file');
    return pack(first, { replace: flags.includes('--replace'),
      timeline: timelineAt >= 0 ? resolve(flags[timelineAt + 1]) : null });
  }
  if (operation === 'recovery-check') return console.log(JSON.stringify(recoveryCheck(ROOT), null, 2));
  if (operation === 'cohort') {
    if (!first) throw new Error('cohort needs a cohort-predeclaration-v1 file');
    const prefixAt = process.argv.indexOf('--prefix');
    const predeclaration = JSON.parse(await readFile(resolve(first), 'utf8'));
    return console.log(JSON.stringify(computeCohort(predeclaration, PACKS, {
      source: first, ...(prefixAt > 0 ? { prefix: process.argv[prefixAt + 1] } : {}) }), null, 2));
  }
  if (operation === 'attest') {
    if (first && /^[\w.-]+$/.test(first) && !first.startsWith('.') && !existsSync(join(PACKS, first)))
      throw await unknownRun(first, { packsOnly: true });
    const by = flag('--by');
    const derivedFor = trackedWinners(ROOT);
    // makeAttestation refuses any author but agent or human.
    const outcome = attestPack(ROOT, first, derivedFor, { by: by as 'agent' | 'human', note: flag('--note') ?? undefined, name: flag('--name') ?? undefined,
      date: new Date().toISOString().slice(0, 10) }, { replace: process.argv.includes('--replace') });
    const { derived } = outcome;
    console.log(JSON.stringify({ schema: 'plan12-attest-result-v1', evidenceId: first, status: outcome.status,
      packSha256: derived.digest, custody: derived.custody, claim: derived.claim,
      attestedBy: field(outcome.attestation, 'attestedBy') ?? null,
      file: outcome.attestation ? `${PACKS_DIR}/${first}/plan12-attestation.json` : null,
      verified: derived.verified.map(item => ({ check: item.check, pass: item.pass, ...(item.pass ? {} : { failed: item.detail.failed }) })),
      ...(outcome.failed.length ? { refused: outcome.failed } : {}) }, null, 2));
    if (outcome.status === 'REFUSED') process.exitCode = 1;
    return;
  }
  if (operation === 'promotions') {
    const summary = promotionSummary(ROOT, trackedWinners(ROOT));
    return console.log(JSON.stringify(envelope ? promotionSummaryEnvelope(summary) : summary, null, 2));
  }
  if (operation === 'show') {
    const loaded = await loadAny(first);
    // --envelope: the same object, as the claim of a claim-envelope-v1 at the record's own claim level.
    const print = (shown: Readonly<Record<string, unknown>>) => console.log(JSON.stringify(envelope ? showEnvelope(first, shown, showTarget(first, loaded)) : shown, null, 2));
    if (loaded.kind === 'device-campaign') {
      const packView = loaded.packed ? (() => {
        const edge = promotionEdgeFor(readGraph(ROOT), first);
        return { source: 'pack', packSha256: loaded.packed.digest, custody: loaded.packed.pack.custody ?? { kind: 'original', lost: [] },
          attestation: attestationView(loaded.packed),
          promotion: edge && edge.packSha256 === loaded.packed.digest ? edge : edge ? { stale: true, edge } : null };
      })() : {};
      // The entry names its kind too; kind stays the first key.
      return print({ kind: loaded.kind, ...(loaded.entry as Readonly<Record<string, unknown>>), mode: loaded.wrapper?.mode ?? null,
        status: loaded.wrapper?.status ?? null, files: loaded.files, ...packView });
    }
    return print(loaded);
  }
  if (operation === 'diff') {
    if (!first || !second) throw new Error('diff needs two ids: npm run evidence -- diff LEFT RIGHT');
    const left = await loadAny(first);
    const right = await loadAny(second);
    if (left.kind === 'session' && right.kind === 'session') {
      const changes: string[] = [];
      if (stable(left.result) !== stable(right.result)) changes.push('result');
      if (stable(left.manifest) !== stable(right.manifest)) changes.push('manifest');
      return console.log(JSON.stringify({ schema: 'evidence-diff-v1', left: first, right: second, changed: changes }, null, 2));
    }
    // A campaign directory or a committed pack: the text each holds, file by file, beside the
    // facts its index entry reads. What a pack lost is named, never compared as if empty.
    assertHeld(first, left);
    assertHeld(second, right);
    const sides = [[first, left], [second, right]] as const;
    const [[leftPlace, leftHeld], [rightPlace, rightHeld]] = await Promise.all(sides.map(async ([id, loaded]) => {
      const place = holder(id, loaded);
      return [place, await heldFiles(place, loaded)] as const;
    }));
    const names = [...new Set([...leftHeld.keys(), ...rightHeld.keys()])].sort();
    const both = names.filter(name => leftHeld.has(name) && rightHeld.has(name));
    return console.log(JSON.stringify({ schema: 'evidence-diff-v1', left: first, right: second,
      changed: both.filter(name => leftHeld.get(name) !== rightHeld.get(name)),
      onlyLeft: names.filter(name => !rightHeld.has(name)), onlyRight: names.filter(name => !leftHeld.has(name)),
      unchanged: both.filter(name => leftHeld.get(name) === rightHeld.get(name)),
      sides: { left: sideView(first, left, leftPlace), right: sideView(second, right, rightPlace) },
      unavailable: [...unavailable(leftPlace, left, leftHeld), ...unavailable(rightPlace, right, rightHeld)] }, null, 2));
  }
  if (operation === 'replay') {
    const loaded = await loadAny(first);
    if (loaded.kind === 'device-campaign')
      return console.log(`replay=${first} status=NOT_REPLAYABLE reason="a night on the phone is not a deterministic replay; replay its bundle"`);
    if (loaded.kind === 'fnaf1-run')
      return console.log(`replay=${first} status=NOT_REPLAYABLE reason="a FNaF 1 night on the phone is not a deterministic replay; its pack holds the runner's record and events only"`);
    if (loaded.kind === 'device-bundle') {
      const { bundle } = loaded;
      return console.log(`replay=${first} evaluations=${bundle.replay.results.length} resultHash=${bundle.manifest.replay.hash} status=REPLAYED`);
    }
    const { result, manifest, spec } = loaded;
    if (!manifest.events?.length || !manifest.profileHash || !result.evidenceId) throw new Error('bundle lacks replay inputs');
    if (!field(manifest.reproducer, 'case') || !spec) throw new Error('bundle does not contain a deterministic experiment spec');
    if (field(spec, 'id') !== field(manifest.reproducer, 'case')) throw new Error('reproducer case does not match experiment spec');
    // The spec the result's specHash names, which load() checked.
    const { evaluation, resultHash: replayHash } = replayModelResult(spec as ModelExperimentSpec, result);
    if (replayHash !== result.resultHash) throw new Error(`replay result hash mismatch: ${replayHash} != ${result.resultHash}`);
    return console.log(`replay=${result.evidenceId} evaluations=${evaluation.evaluations.length} resultHash=${replayHash} status=REPLAYED`);
  }
  if (operation === 'why') {
    const loaded = await loadAny(first);
    if (loaded.kind === 'session') {
      const { manifest } = loaded;
      return console.log(JSON.stringify({ schema: 'causal-trace-v1', run: first, events: manifest.events.map(event => ({ type: event.type, component: event.component, at: event.at, data: event.data })) }, null, 2));
    }
    if (loaded.kind === 'device-bundle')
      throw new Error(`${first} is a compiled device bundle, a plan rather than a run, so it has no causal trace; \`npm run evidence -- replay ${first}\` replays it`);
    // A campaign directory or a pack: the event rows as the executor (or a FNaF 1 runner) appended
    // them, verbatim -- their stamps keep their own clocks -- beside the custody they came through.
    const place = holder(first, loaded);
    if (!loaded.files.includes('events.jsonl'))
      throw new Error(`why reads a run's event rows, and ${lacking(place, 'events.jsonl')}`);
    const text = await readFile(join(place.dir, 'events.jsonl'), 'utf8');
    const events = text.split('\n').filter(line => line.trim()).map((line, index) => {
      try { return JSON.parse(line); } catch (error) { throw new Error(`${place.where}/events.jsonl line ${index + 1}: ${(error as Error).message}`); }
    });
    return console.log(JSON.stringify({ schema: 'causal-trace-v1', run: first, source: place.source, kind: loaded.kind,
      ...(place.custody ? { custody: place.custody } : {}), events }, null, 2));
  }
  if (operation === 'promote') {
    const loaded = await loadAny(first);
    if (loaded.kind === 'fnaf1-run') {
      // A FNaF 1 runner's pack: Plan 12's checks read from the runner's record, its events and the
      // title-star read (fnaf1-promotion.ts), then the attestation; recorded as the FNaF 2 path records.
      const checks = fnaf1PromotionChecks(ROOT, first, loaded.packed);
      const derived = derivePromotion(ROOT, first, new Map());
      // Every pack's derivation verifies claimIdentity.
      const identity = derived.verified.find(item => item.check === 'claimIdentity') as (typeof derived.verified)[number];
      const allChecks = { ...checks, claimIdentity: identity.pass };
      const accepted = Object.values(allChecks).every(Boolean);
      let recorded = null;
      if (accepted) {
        // claimIdentity passes only on a named claim.
        const result = recordPromotion(readGraph(ROOT), { id: first, claim: derived.claim as NonNullable<typeof derived.claim>, digest: loaded.packed.digest,
          attestation: loaded.packed.attestation, custody: derived.custody, nights: loaded.packed.pack.nights ?? [],
          runLabel: `FNaF 1 Custom Night 6 AM on the phone, run pack ${first}` });
        if (result.status !== 'ALREADY_RECORDED') writeFileSync(join(ROOT, GRAPH_FILE), formatGraph(result.graph));
        recorded = { graph: GRAPH_FILE, status: result.status, edge: result.edge };
      }
      return console.log(JSON.stringify({ schema: 'plan12-promotion-gate-v1', evidenceId: first, kind: 'fnaf1-run', source: 'pack',
        packSha256: loaded.packed.digest, custody: derived.custody, attestation: attestationView(loaded.packed), claim: derived.claim,
        authority: 'plans/12-end-to-end-evidence-campaign.md (its checks, read from a FNaF 1 runner pack: packages/review/src/fnaf1-promotion.ts)',
        accepted, checks: allChecks, status: accepted ? 'PROMOTED' : 'REFUSED', ...(recorded ? { recorded } : {}),
        ...(accepted ? {} : { failed: derived.verified.filter(item => !item.pass).map(item => ({ check: item.check, failed: item.detail.failed })) }) }, null, 2));
    }
    if (loaded.kind === 'device-campaign' && loaded.packed) {
      // A pack: the five checks, then the claim the night supports, re-derived from the pack.
      // An accepted pack is recorded as a PROMOTED_BY edge in the evidence graph, naming who
      // attested and the pack's custody; a refused pack writes nothing.
      const winners = trackedWinners(ROOT);
      const checks = packPromotionChecks(loaded.packed, winners);
      const derived = derivePromotion(ROOT, first, winners);
      // Every pack's derivation verifies claimIdentity.
      const identity = derived.verified.find(item => item.check === 'claimIdentity') as (typeof derived.verified)[number];
      const allChecks = { ...checks, claimIdentity: identity.pass };
      const accepted = Object.values(allChecks).every(Boolean);
      let recorded = null;
      if (accepted) {
        // claimIdentity passes only on a named claim.
        const result = recordPromotion(readGraph(ROOT), { id: first, claim: derived.claim as NonNullable<typeof derived.claim>, digest: loaded.packed.digest,
          // recordPromotion joins them: a pack naming no nights throws there, as it did untyped.
          attestation: loaded.packed.attestation, custody: derived.custody, nights: loaded.entry.nights as readonly number[] });
        if (result.status !== 'ALREADY_RECORDED') writeFileSync(join(ROOT, GRAPH_FILE), formatGraph(result.graph));
        recorded = { graph: GRAPH_FILE, status: result.status, edge: result.edge };
      }
      const view = attestationView(loaded.packed);
      return console.log(JSON.stringify({
        schema: 'plan12-promotion-gate-v1', evidenceId: first, kind: 'device-campaign', source: 'pack',
        packSha256: loaded.packed.digest, nights: loaded.entry.nights, outcome: loaded.entry.outcome,
        custody: loaded.packed.pack.custody ?? { kind: 'original', lost: [] },
        attestation: view, claim: derived.claim,
        authority: 'plans/12-end-to-end-evidence-campaign.md', accepted, checks: allChecks,
        status: accepted ? 'PROMOTED' : 'REFUSED', ...(recorded ? { recorded } : {}),
        reason: accepted ? null
          : `Plan 12 requires a live executor-proven 6 AM, complete custody, a committed winner, a nameable claim, and an attestation bound to pack sha256 ${loaded.packed.digest}`
            + (view.reason && !checks.plan12Attestation ? ` (attestation: ${view.reason})` : ''),
      }, null, 2));
    }
    if (loaded.kind === 'device-campaign') {
      const checks = campaignPromotionChecks(loaded.wrapper, loaded.files);
      const accepted = Object.values(checks).every(Boolean);
      return console.log(JSON.stringify({
        schema: 'plan12-promotion-gate-v1', evidenceId: first, kind: 'device-campaign', source: 'artifacts',
        nights: loaded.entry.nights, outcome: loaded.entry.outcome,
        authority: 'plans/12-end-to-end-evidence-campaign.md', accepted, checks,
        status: accepted ? 'READY_FOR_REVIEW' : 'REFUSED',
        reason: accepted ? null
          : 'Plan 12 requires external evidence, a passing terminal result, and an attestation; pack the run (npm run evidence -- pack) and attest the pack',
      }, null, 2));
    }
    if (loaded.kind === 'device-bundle') {
      const { bundle } = loaded;
      const gate: Readonly<Record<string, unknown>> = isRecord(bundle.manifest.gate) ? bundle.manifest.gate : {};
      const checks = {
        offlineEvidence: gate.claimLevel === 'DEVICE_MEASURED',
        terminalPass: gate.status === 'PASS' && bundle.replay.results.every(item => item.won === true),
        manifestComplete: true,
        plan12Attestation: field(bundle.manifest.plan12Gate, 'status') === 'PASS',
      };
      const accepted = Object.values(checks).every(Boolean);
      return console.log(JSON.stringify({
        schema: 'plan12-promotion-gate-v1', evidenceId: first,
        authority: 'plans/12-end-to-end-evidence-campaign.md', accepted, checks,
        status: accepted ? 'READY_FOR_REVIEW' : 'REFUSED',
        reason: accepted ? null : 'Plan 12 requires external evidence, a passing terminal result, and an explicit gate attestation',
      }, null, 2));
    }
    const { result, manifest } = loaded;
    const checks = {
      offlineEvidence: result.claimLevel === 'DEVICE_MEASURED',
      terminalPass: result.outcome === 'PASS',
      manifestComplete: manifest.outcome === 'COMPLETED' && Boolean(manifest.artifacts?.result),
      plan12Attestation: field(manifest.plan12Gate, 'status') === 'PASS',
    };
    const accepted = Object.values(checks).every(Boolean);
    return console.log(JSON.stringify({
      schema: 'plan12-promotion-gate-v1', evidenceId: result.evidenceId,
      authority: 'plans/12-end-to-end-evidence-campaign.md', accepted, checks,
      status: accepted ? 'READY_FOR_REVIEW' : 'REFUSED',
      reason: accepted ? null : 'Plan 12 requires external evidence, a passing terminal result, and an explicit gate attestation',
    }, null, 2));
  }
  throw new Error(`unknown evidence operation: ${operation}`);
}

main(process.argv.slice(2)).catch((error: Error) => { console.error(`evidence: ${error.message}`); process.exitCode = 2; });
