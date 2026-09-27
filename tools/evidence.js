#!/usr/bin/env node
/** Inspect retained session/result bundles without re-entering measurements. */
import { readdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalJson, stableHash, validateArtifactRef } from '@fnaf2-1020/core/contracts';
import { validateManifest } from '@fnaf2-1020/core/contracts';
import { replayModelResult } from '@fnaf2-1020/research';
import { BUNDLE_SCHEMA, validateBundle } from './device/bundle.mjs';
import { isCampaignResult, campaignEntry, campaignPromotionChecks } from './evidence-campaign.mjs';
import { PACKS_DIR, resolvePackTargets, buildPack, buildFnaf1Pack, writePack, readPack, packPromotionChecks,
  trackedWinners, packEntry, recoveryCheck, attestationStatus, packCustody } from './evidence-pack.mjs';
import { GRAPH_FILE, attestPack, derivePromotion, formatGraph, promotionEdgeFor, promotionSummary, readGraph,
  recordPromotion } from './evidence-promotion.mjs';
import { computeCohort } from './evidence-cohort.mjs';
import { writeFileSync } from 'node:fs';

const ROOT = resolve(join(fileURLToPath(new URL('.', import.meta.url)), '..'));
const ARTIFACTS = join(ROOT, 'artifacts');
const PACKS = join(ROOT, PACKS_DIR);
const SESSION_RESULT_SCHEMAS = new Set(['device-run-result-v1', 'experiment-result-v1']);
const CLAIM_LEVELS = new Set(['MODEL_ONLY', 'FIXTURE', 'DEVICE_MEASURED']);
const help = () => console.log('Usage: npm run evidence -- <list|show|diff|replay|why|promote> [RUN_ID]\n'
  + '       npm run evidence -- pack <CAMPAIGN_ID|NIGHT_RUN_LABEL> [--replace] [--timeline GRADED_TIMELINE.json]\n'
  + '       npm run evidence -- attest <PACK_ID> --by agent --note "SESSION OR AGENT" [--replace]\n'
  + '       npm run evidence -- attest <PACK_ID> --by human --name "NAME" [--replace]\n'
  + '                  (re-derives every other check from the pack, refuses on any failure, writes plan12-attestation.json)\n'
  + '       npm run evidence -- promotions      (every pack against the gate and the graph, per night)\n'
  + '       npm run evidence -- recovery-check    (does run/campaign.log reproduce the campaigns still on disk?)\n'
  + '       npm run evidence -- cohort <PREDECLARATION.json> [--prefix LABEL_PREFIX]');

/** The value after a flag, or null. */
const flag = name => {
  const at = process.argv.indexOf(name);
  if (at < 0) return null;
  const value = process.argv[at + 1];
  if (value === undefined || value.startsWith('--')) throw new Error(`${name} needs a value`);
  return value;
};

/** Who attested a pack and whether the attestation binds it: printed by list, show and promote. */
const attestationView = packed => {
  if (!packed.attestation) return { attestedBy: null, valid: false, reason: 'no attestation' };
  const status = attestationStatus(packed.attestation, packed.digest);
  return { attestedBy: status.by, author: packed.attestation.attestedBy ?? null,
    date: packed.attestation.date ?? packed.attestation.at ?? null, schema: packed.attestation.schema,
    valid: status.valid, reason: status.reason };
};

async function readVerifiedArtifact(base, ref) {
  const artifact = validateArtifactRef(ref);
  if (typeof artifact.locator !== 'string' || artifact.locator.startsWith('/') ||
      artifact.locator.split('/').some(part => part === '..'))
    throw new Error('artifact locator must remain inside its run bundle');
  const text = await readFile(join(base, artifact.locator), 'utf8');
  if (stableHash(text) !== artifact.hash || Buffer.byteLength(text) !== artifact.size)
    throw new Error(`artifact integrity mismatch: ${artifact.locator}`);
  return text;
}

async function load(run) {
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

async function loadDeviceBundle(run) {
  if (!run || !/^[\w-]+$/.test(run)) throw new Error('a safe RUN_ID is required');
  const base = join(ARTIFACTS, run);
  const manifest = JSON.parse(await readFile(join(base, 'manifest.json'), 'utf8'));
  if (manifest.schema !== BUNDLE_SCHEMA) throw new Error('not a device bundle');
  return { bundle: validateBundle(base), kind: 'device-bundle' };
}

async function loadCampaign(run) {
  const base = join(ARTIFACTS, run);
  const wrapper = JSON.parse(await readFile(join(base, 'result.json'), 'utf8'));
  if (!isCampaignResult(wrapper)) throw new Error('not a device campaign result');
  return { kind: 'device-campaign', entry: campaignEntry(run, wrapper), wrapper, files: await readdir(base) };
}

// A committed run pack (tools/evidence-pack.mjs): the same campaign facts, verified against
// the pack's own hashes, readable on any checkout.
function loadPack(run) {
  if (!run || !/^[\w.-]+$/.test(run)) throw new Error('a safe RUN_ID is required');
  const packed = readPack(join(PACKS, run));
  if (packed.pack.kind === 'fnaf1-run')
    return { kind: 'fnaf1-run', entry: { id: run, kind: 'fnaf1-run', outcome: packed.pack.outcome?.ended ?? null,
      claimLevel: packed.pack.claimLevel, status: packed.pack.status }, files: packed.files, packed };
  return { kind: 'device-campaign', entry: packEntry(run, packed), wrapper: packed.wrapper,
    files: packed.files, packed };
}

async function loadAny(run) {
  try { return { ...(await load(run)), kind: 'session' }; }
  catch (sessionError) {
    try { return await loadDeviceBundle(run); }
    catch {
      try { return await loadCampaign(run); }
      catch {
        try { return loadPack(run); }
        catch { throw sessionError; }
      }
    }
  }
}

async function list() {
  let entries = [];
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
          runs.push({ id: entry.name, kind: 'device-campaign', outcome: 'INVALID_CAMPAIGN', reason: error.message });
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
            claimLevel: bundle.manifest.gate?.claimLevel ?? 'MODEL_ONLY',
            profile: bundle.profile.id });
        } catch (error) {
          runs.push({ id: entry.name, kind: 'device-bundle', outcome: 'INVALID_BUNDLE',
            reason: error.message });
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
  let packs = [];
  try { packs = await readdir(PACKS, { withFileTypes: true }); } catch { /* no packs committed yet */ }
  const graph = readGraph(ROOT);
  for (const pack of packs.filter(item => item.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    try {
      const { packed, entry } = loadPack(pack.name);
      const view = attestationView(packed);
      const edge = promotionEdgeFor(graph, pack.name);
      runs.push({ ...entry, source: 'pack', campaign: packed.pack.campaign, packSha256: packed.digest,
        custody: packCustody(packed.pack), attestedBy: view.attestedBy, attestation: packed.attestation ? (view.valid ? 'VALID' : `INVALID: ${view.reason}`) : null,
        promoted: Boolean(edge && edge.packSha256 === packed.digest) ? edge.from : null });
    } catch (error) {
      runs.push({ id: pack.name, kind: 'run-pack', outcome: 'INVALID_PACK', reason: error.message });
    }
  }
  console.log(JSON.stringify({ schema: 'evidence-index-v1', runs }, null, 2));
}

// Build a frame-free run pack for every campaign the id names and write it under PACKS_DIR.
function pack(id, { replace = false, timeline = null } = {}) {
  const targets = resolvePackTargets(ROOT, id);
  if (timeline && targets.length !== 1) throw new Error('--timeline names one run; this id packs several campaigns');
  const results = targets.map(target => {
    const built = target.fnaf1RunDir ? buildFnaf1Pack({ root: ROOT, home: homedir(), ...target })
      : buildPack({ root: ROOT, home: homedir(), ...target, timeline });
    const status = writePack(join(PACKS, target.packId), built, { replace });
    const { pack: made } = built;
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

const stable = value => canonicalJson(value);

async function main([operation = 'help', first, second]) {
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
    const by = flag('--by');
    const derivedFor = trackedWinners(ROOT);
    const outcome = attestPack(ROOT, first, derivedFor, { by, note: flag('--note') ?? undefined, name: flag('--name') ?? undefined,
      date: new Date().toISOString().slice(0, 10) }, { replace: process.argv.includes('--replace') });
    const { derived } = outcome;
    console.log(JSON.stringify({ schema: 'plan12-attest-result-v1', evidenceId: first, status: outcome.status,
      packSha256: derived.digest, custody: derived.custody, claim: derived.claim,
      attestedBy: outcome.attestation?.attestedBy ?? null,
      file: outcome.attestation ? `${PACKS_DIR}/${first}/plan12-attestation.json` : null,
      verified: derived.verified.map(item => ({ check: item.check, pass: item.pass, ...(item.pass ? {} : { failed: item.detail.failed }) })),
      ...(outcome.failed.length ? { refused: outcome.failed } : {}) }, null, 2));
    if (outcome.status === 'REFUSED') process.exitCode = 1;
    return;
  }
  if (operation === 'promotions') return console.log(JSON.stringify(promotionSummary(ROOT, trackedWinners(ROOT)), null, 2));
  if (operation === 'show') {
    const loaded = await loadAny(first);
    if (loaded.kind === 'device-campaign') {
      const packView = loaded.packed ? (() => {
        const edge = promotionEdgeFor(readGraph(ROOT), first);
        return { source: 'pack', packSha256: loaded.packed.digest, custody: loaded.packed.pack.custody ?? { kind: 'original', lost: [] },
          attestation: attestationView(loaded.packed),
          promotion: edge && edge.packSha256 === loaded.packed.digest ? edge : edge ? { stale: true, edge } : null };
      })() : {};
      return console.log(JSON.stringify({ kind: loaded.kind, ...loaded.entry, mode: loaded.wrapper?.mode ?? null,
        status: loaded.wrapper?.status ?? null, files: loaded.files, ...packView }, null, 2));
    }
    return console.log(JSON.stringify(loaded, null, 2));
  }
  if (operation === 'diff') {
    const [left, right] = await Promise.all([load(first), load(second)]);
    const changes = [];
    if (stable(left.result) !== stable(right.result)) changes.push('result');
    if (stable(left.manifest) !== stable(right.manifest)) changes.push('manifest');
    return console.log(JSON.stringify({ schema: 'evidence-diff-v1', left: first, right: second, changed: changes }, null, 2));
  }
  if (operation === 'replay') {
    const loaded = await loadAny(first);
    if (loaded.kind === 'device-campaign')
      return console.log(`replay=${first} status=NOT_REPLAYABLE reason="a night on the phone is not a deterministic replay; replay its bundle"`);
    if (loaded.kind === 'device-bundle') {
      const { bundle } = loaded;
      return console.log(`replay=${first} evaluations=${bundle.replay.results.length} resultHash=${bundle.manifest.replay.hash} status=REPLAYED`);
    }
    const { result, manifest, spec } = loaded;
    if (!manifest.events?.length || !manifest.profileHash || !result.evidenceId) throw new Error('bundle lacks replay inputs');
    if (!manifest.reproducer?.case || !spec) throw new Error('bundle does not contain a deterministic experiment spec');
    if (spec.id !== manifest.reproducer.case) throw new Error('reproducer case does not match experiment spec');
    const { evaluation, resultHash: replayHash } = replayModelResult(spec, result);
    if (replayHash !== result.resultHash) throw new Error(`replay result hash mismatch: ${replayHash} != ${result.resultHash}`);
    return console.log(`replay=${result.evidenceId} evaluations=${evaluation.evaluations.length} resultHash=${replayHash} status=REPLAYED`);
  }
  if (operation === 'why') {
    const { manifest } = await load(first);
    return console.log(JSON.stringify({ schema: 'causal-trace-v1', run: first, events: manifest.events.map(event => ({ type: event.type, component: event.component, at: event.at, data: event.data })) }, null, 2));
  }
  if (operation === 'promote') {
    const loaded = await loadAny(first);
    if (loaded.kind === 'fnaf1-run')
      return console.log(JSON.stringify({ schema: 'plan12-promotion-gate-v1', evidenceId: first, kind: 'fnaf1-run',
        source: 'pack', packSha256: loaded.packed.digest, accepted: false, status: 'REFUSED',
        reason: 'Plan 12 gates the FNaF 2 campaign; no promotion gate reads FNaF 1 runs yet' }, null, 2));
    if (loaded.kind === 'device-campaign' && loaded.packed) {
      // A pack: the five checks, then the claim the night supports, re-derived from the pack.
      // An accepted pack is recorded as a PROMOTED_BY edge in the evidence graph, naming who
      // attested and the pack's custody; a refused pack writes nothing.
      const winners = trackedWinners(ROOT);
      const checks = packPromotionChecks(loaded.packed, winners);
      const derived = derivePromotion(ROOT, first, winners);
      const identity = derived.verified.find(item => item.check === 'claimIdentity');
      const allChecks = { ...checks, claimIdentity: identity.pass };
      const accepted = Object.values(allChecks).every(Boolean);
      let recorded = null;
      if (accepted) {
        const result = recordPromotion(readGraph(ROOT), { id: first, claim: derived.claim, digest: loaded.packed.digest,
          attestation: loaded.packed.attestation, custody: derived.custody, nights: loaded.entry.nights });
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
      const gate = bundle.manifest.gate ?? {};
      const checks = {
        offlineEvidence: gate.claimLevel === 'DEVICE_MEASURED',
        terminalPass: gate.status === 'PASS' && bundle.replay.results.every(item => item.won === true),
        manifestComplete: true,
        plan12Attestation: bundle.manifest.plan12Gate?.status === 'PASS',
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
      plan12Attestation: manifest.plan12Gate?.status === 'PASS',
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

main(process.argv.slice(2)).catch(error => { console.error(`evidence: ${error.message}`); process.exitCode = 2; });
