// Plan 12 attestation and promotion over committed run packs.
//
// Until 2026-09-27 the attestation was a person's file and agents never wrote one, so 47 packed
// 6 AMs sat one check short of promotion and the evidence graph held no promotion edge. Pedro,
// 2026-09-27: "i give agents full permission, this is bullshit bureaucracy that is impeding
// progress" -- agents may now write Plan 12 attestations, and nothing else is delegated
// (`PEDRO-OK`, `--no-verify` and `commit -n` stay human-only or forbidden). The same day he
// accepted packs recovered from a night-run log fully (evidence-pack.mjs,
// packManifestComplete).
//
// The delegation is to write the file, not to wave a pack through, so an attestation is only
// ever written by `attestPack` after `derivePromotion` has re-derived every other check from the
// pack itself: the pack's files against their recorded hashes, the live campaign result, the
// executor's 6 AM proof (terminal, its verification, the save proof, the terminal event row, and
// no packed video grade that disagrees), custody, the committed winner, and the claim the night
// supports -- for a Custom Night, the dial vector its own menu readback observed. The attestation
// lists each check with the sha256 of every input it read, names its author, and binds the pack
// sha256. A promotion is never silent: `promote` records a PROMOTED_BY edge in
// docs/evidence/graph.json naming the attestation, its author and the pack's custody, and
// `list`/`show` print who attested and what custody lost.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { canonicalJson, stableHash, validateSaveProof } from '@sixam/kernel/contracts';
import { AI_DIALS, PUPPET_AI } from '@sixam/source/fnaf2';
import { campaignEntry } from './evidence-campaign.mjs';
import { AGENT_DELEGATION, ATTESTATION_FILE, ATTESTATION_SCHEMA, PACKS_DIR, RECOVERY_RECORD, attestationStatus,
  packCustody, packManifestComplete, packPromotionChecks, readPack, winnerFiles } from './evidence-pack.mjs';

export const GRAPH_FILE = 'docs/evidence/graph.json';
export const PROMOTION_EDGE = 'PROMOTED_BY';
export const PROMOTION_SUMMARY_SCHEMA = 'plan12-promotion-summary-v1';

const sha256 = data => createHash('sha256').update(data).digest('hex');
const night7Label = dials => AI_DIALS.every(dial => dials[dial] === 20) ? '10-20'
  : AI_DIALS.filter(dial => dials[dial] > 0).map(dial => `${dial}${dials[dial]}`).join('-') || 'all0';

/**
 * The claim a won night supports. Story nights are named by number. A Custom Night is named by
 * the dial vector the executor's own menu readback observed before the night began (the last
 * PASS readback before `state=night`, as evidence-cohort.mjs reads it), and, when the pack
 * kept request.json, only if that is the vector requested.
 * @returns {{pass: boolean, claim: any, detail: any}}
 */
function claimFor(night, mode, eventsText, requestText) {
  if (night >= 1 && night <= 6 && mode === 'story')
    return { pass: true, detail: { night, mode },
      claim: { id: `claim.fnaf2.night${night}.device-6am`, night, mode,
        label: `FNaF 2 Night ${night} reaches 6 AM on the phone (executor-proven)` } };
  if (night !== 7 || mode !== 'custom') return { pass: false, claim: null, detail: { night, mode, failed: ['not a FNaF 2 night 1-7'] } };
  let observed = null;
  let readback = null;
  for (const line of (eventsText ?? '').split('\n')) {
    if (!line.trim()) continue;
    const event = JSON.parse(line);
    if (event.type !== 'observation') continue;
    if (event.label === 'state=night') break;
    try {
      const read = JSON.parse(event.label);
      if (read?.status === 'PASS' && read.dials) { observed = read.dials; readback = read; }
    } catch { /* a lifecycle label, not a dial readback */ }
  }
  const request = requestText ? JSON.parse(requestText) : null;
  const requested = request?.spec?.nights?.find(item => item.night === 7)?.dials ?? null;
  const failed = [];
  if (!observed) failed.push('no PASS Custom Night readback before the night began');
  else {
    if (!AI_DIALS.every(dial => Number.isInteger(observed[dial]))) failed.push('the readback does not read all ten dials');
    if (readback.puppet !== PUPPET_AI) failed.push(`the readback reads Puppet ${readback.puppet}, not ${PUPPET_AI}`);
    if (Array.isArray(readback.unknown) && readback.unknown.length) failed.push(`the readback left ${readback.unknown.join(', ')} unknown`);
    if (requested && stableHash(requested) !== stableHash(observed)) failed.push('the readback differs from the requested dials');
  }
  const detail = { night, mode, observedDials: observed, requestedDials: requested,
    requested: requested ? 'request.json' : 'UNKNOWN (request.json not in the pack)', ...(failed.length ? { failed } : {}) };
  if (failed.length) return { pass: false, claim: null, detail };
  const vector = night7Label(observed);
  return { pass: true, detail, claim: { id: `claim.fnaf2.night7.${vector}.device-6am`, night, mode, dials: observed,
    label: vector === '10-20' ? 'FNaF 2 Custom Night 10/20 (all ten at 20) reaches 6 AM on the phone (executor-proven)'
      : `FNaF 2 Custom Night ${AI_DIALS.filter(dial => observed[dial] > 0).map(dial => `${dial} ${observed[dial]}`).join(', ')} (others 0) reaches 6 AM on the phone (executor-proven)` } };
}

/**
 * Re-derive every promotion check but the attestation from the pack itself. Nothing is written.
 * readPack refuses a pack whose files no longer match their recorded sha256.
 * @param {string} root repository root
 * @param {string} id pack directory name under PACKS_DIR
 * @param {Map<string, string>} winners trackedWinners(root)
 */
export function derivePromotion(root, id, winners) {
  if (!/^[\w.-]+$/.test(id ?? '')) throw new Error('a safe RUN_ID is required');
  const dir = join(root, PACKS_DIR, id);
  const loaded = readPack(dir);
  const { pack, wrapper, files, digest } = loaded;
  if (pack.kind === 'fnaf1-run') throw new Error(`${id} is a FNaF 1 run; Plan 12 gates the FNaF 2 campaign`);
  const packed = name => pack.files.find(file => file.name === name);
  const inputs = (...names) => names.map(packed).filter(Boolean).map(file => ({ name: file.name, sha256: file.sha256 }));
  const text = name => (packed(name) ? readFileSync(join(dir, name), 'utf8') : null);
  const verified = [];
  const add = (check, failed, detail, from) =>
    verified.push({ check, pass: failed.length === 0, inputs: from, detail: failed.length ? { ...detail, failed } : detail });

  // offlineEvidence: the executor's live reading of the phone.
  const entry = wrapper ? campaignEntry(id, wrapper) : null;
  add('offlineEvidence', [
    ...(wrapper?.mode === 'live' ? [] : [`campaign mode ${wrapper?.mode ?? 'none (result lost)'}, not live`]),
    ...(entry?.claimLevel === 'DEVICE_MEASURED' && pack.claimLevel === 'DEVICE_MEASURED' ? [] : ['not DEVICE_MEASURED']),
  ], { mode: wrapper?.mode ?? null, claimLevel: entry?.claimLevel ?? pack.claimLevel }, inputs('result.json'));

  // terminalPass: an executor-proven 6 AM, read from the retained attempt and the event log.
  const attempt = (wrapper?.result?.attempts ?? []).find(item => item.status === 'WIN' && item.terminal?.outcome === 'sixam' && item.proofHash);
  const terminalFailed = [];
  if (entry?.outcome !== 'WIN' || pack.outcome !== 'WIN') terminalFailed.push(`outcome ${entry?.outcome ?? pack.outcome}, not an executor WIN`);
  if (!attempt) terminalFailed.push('no WIN attempt with the sixam terminal and its campaign-proof hash');
  else {
    if (attempt.terminal.sixAm !== true || attempt.terminal.night !== attempt.night) terminalFailed.push('the terminal is not a positive 6 AM of this night');
    if (attempt.terminalVerification?.sixAm !== true || attempt.terminalVerification?.positive !== true)
      terminalFailed.push('the terminal verification is not positive');
    try { validateSaveProof(attempt.save, { night: attempt.night }); } catch (error) { terminalFailed.push(error.message); }
  }
  const terminalRow = (text('events.jsonl') ?? '').split('\n').filter(line => line.trim()).map(line => JSON.parse(line))
    .find(row => row.type === 'campaign.terminal.from-executor' && row.outcome === 'sixam');
  if (!terminalRow) terminalFailed.push('events.jsonl holds no campaign.terminal.from-executor sixam row');
  const timeline = text('run/timeline.json');
  const videoGrade = timeline ? JSON.parse(timeline).terminal?.outcome ?? 'UNKNOWN' : null;
  if (videoGrade !== null && videoGrade !== 'clear') terminalFailed.push(`the packed video grade reads ${videoGrade}, not clear`);
  add('terminalPass', terminalFailed, { night: attempt?.night ?? null, attempt: attempt?.attempt ?? null,
    proofHash: attempt?.proofHash ?? null, terminalEventAt: terminalRow?.at ?? null,
    videoGrade: videoGrade ?? 'none packed (the executor terminal stands alone)' },
  inputs('result.json', 'events.jsonl', 'run/timeline.json'));

  // manifestComplete: custody, including a recovery's own check.
  const custody = packCustody(pack);
  const manifestFailed = wrapper !== null && packManifestComplete(pack, files) ? [] : [`custody ${custody.kind} is not complete enough to promote`];
  const manifestInputs = inputs('result.json', 'events.jsonl', 'request.json');
  let recovery = null;
  if (custody.kind === 'recovered-from-run-log') {
    manifestInputs.push({ name: pack.custody.source, sha256: pack.custody.sourceSha256 });
    const record = join(root, RECOVERY_RECORD);
    if (!existsSync(record)) manifestFailed.push(`${RECOVERY_RECORD} is missing`);
    else {
      const bytes = readFileSync(record);
      recovery = JSON.parse(bytes.toString('utf8')).summary ?? {};
      manifestInputs.push({ name: RECOVERY_RECORD, sha256: sha256(bytes) });
      if (!(recovery.campaigns > 0 && recovery.eventsIdentical === recovery.campaigns && recovery.resultsIdentical === recovery.resultsPrinted))
        manifestFailed.push('the recovery check it cites is not byte-identical');
    }
  }
  add('manifestComplete', manifestFailed, { custody: custody.kind, lost: custody.lost,
    ...(pack.custody?.recovered ? { recovered: pack.custody.recovered } : {}), ...(recovery ? { recoveryCheck: recovery } : {}) },
  manifestInputs);

  // winnerCommitted: the binding can be re-run from a clean checkout.
  const winner = pack.bundle?.winnerHash ? winners.get(pack.bundle.winnerHash) : undefined;
  // The check names the winner `tools/device/<name>`, the words the attestations record; the file
  // itself sits in the bindings since 2026-09-30.
  const winnerFile = winner ? winnerFiles(root).map(file => join(root, file)).find(file => basename(file) === winner) ?? null : null;
  add('winnerCommitted', winnerFile && existsSync(winnerFile) ? [] : [`winner ${pack.bundle?.winnerHash ?? 'none recorded'} is not committed`],
    { winnerHash: pack.bundle?.winnerHash ?? null, bundle: pack.bundle?.path ?? null, winner: winner ? `tools/device/${winner}` : null },
    winnerFile && existsSync(winnerFile) ? [{ name: `tools/device/${winner}`, sha256: sha256(readFileSync(winnerFile)) }] : []);

  // claimIdentity: what the promotion edge will say the night showed.
  const named = attempt ? claimFor(attempt.night, attempt.mode, text('events.jsonl'), text('request.json'))
    : { pass: false, claim: null, detail: { failed: ['no winning attempt to name'] } };
  add('claimIdentity', named.pass ? [] : named.detail.failed ?? ['unnamed'], named.detail, inputs('events.jsonl', 'request.json'));

  return { id, dir, loaded, digest, custody, claim: named.claim, verified, pass: verified.every(item => item.pass) };
}

/**
 * The attestation `attestPack` writes. The date is the only field that is not derived.
 * @param {ReturnType<typeof derivePromotion>} derived
 * @param {{by: 'agent' | 'human', note?: string, name?: string, date: string}} author
 */
export function makeAttestation(derived, { by, note, name, date }) {
  if (by === 'agent' && !(typeof note === 'string' && note.trim())) throw new Error('an agent attestation needs --note naming the session or agent');
  if (by === 'human' && !(typeof name === 'string' && name.trim())) throw new Error('a human attestation needs --name');
  if (!['agent', 'human'].includes(by)) throw new Error('--by must be agent or human');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? '')) throw new Error('an attestation needs a YYYY-MM-DD date');
  return {
    schema: ATTESTATION_SCHEMA, status: 'PASS', evidenceId: derived.id, packSha256: derived.digest,
    attestedBy: by === 'agent' ? { kind: 'agent', delegation: AGENT_DELEGATION, note: note.trim() } : { kind: 'human', name: name.trim() },
    date, tool: 'npm run evidence -- attest', authority: 'plans/12-end-to-end-evidence-campaign.md',
    claim: derived.claim, custody: derived.custody, verified: derived.verified,
  };
}

const withoutDate = attestation => canonicalJson({ ...attestation, date: null });

/**
 * Re-derive, refuse on any failing check, and write the pack's plan12-attestation.json. An
 * identical attestation (up to its date) is left alone; a different one is refused unless
 * `replace`, because an attestation is evidence and is not edited in place.
 * @returns {{status: 'WRITTEN' | 'UNCHANGED' | 'REPLACED' | 'REFUSED', derived: any, attestation: any, failed: string[]}}
 */
export function attestPack(root, id, winners, author, { replace = false } = {}) {
  const derived = derivePromotion(root, id, winners);
  const failed = derived.verified.filter(item => !item.pass).map(item => item.check);
  if (failed.length) return { status: 'REFUSED', derived, attestation: null, failed };
  const attestation = makeAttestation(derived, author);
  const file = join(derived.dir, ATTESTATION_FILE);
  let status = 'WRITTEN';
  if (existsSync(file)) {
    const existing = JSON.parse(readFileSync(file, 'utf8'));
    if (withoutDate(existing) === withoutDate(attestation)) return { status: 'UNCHANGED', derived, attestation: existing, failed };
    if (!replace) throw new Error(`${id} already holds a different attestation; pass --replace to supersede it`);
    status = 'REPLACED';
  }
  writeFileSync(file, `${JSON.stringify(attestation, null, 2)}\n`);
  return { status, derived, attestation, failed };
}

/** The graph file in its committed layout: one node or edge per line. @param {any} graph */
export function formatGraph(graph) {
  const list = items => items.length ? `\n    ${items.map(item => JSON.stringify(item)).join(',\n    ')}\n  ` : '';
  const rest = Object.entries(graph).filter(([key]) => !['schema', 'version', 'nodes', 'edges'].includes(key));
  return `{\n  "schema": ${JSON.stringify(graph.schema)},\n  "version": ${JSON.stringify(graph.version)},\n`
    + rest.map(([key, value]) => `  ${JSON.stringify(key)}: ${JSON.stringify(value)},\n`).join('')
    + `  "nodes": [${list(graph.nodes)}],\n  "edges": [${list(graph.edges)}]\n}\n`;
}

/** @param {string} root */
export function readGraph(root) {
  const graph = JSON.parse(readFileSync(join(root, GRAPH_FILE), 'utf8'));
  if (graph.schema !== 'claim-evidence-v1' || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges))
    throw new Error(`${GRAPH_FILE} is not a claim-evidence-v1 graph`);
  return graph;
}

export const runNodeId = id => `run.${id}`;

/** The PROMOTED_BY edge recorded for a pack, if any. */
export const promotionEdgeFor = (graph, id) => graph.edges.find(edge => edge.type === PROMOTION_EDGE && edge.to === runNodeId(id)) ?? null;

/**
 * Record a promotion: the claim node, the run node, and a PROMOTED_BY edge from the claim to
 * the run that names the attestation, its author and the pack's custody. Idempotent; an edge
 * for the same run with another pack sha256 or author is replaced and reported as UPDATED.
 * @returns {{graph: any, status: 'ADDED' | 'ALREADY_RECORDED' | 'UPDATED', edge: any}}
 */
export function recordPromotion(graph, { id, claim, digest, attestation, custody, nights }) {
  const next = { ...graph, nodes: [...graph.nodes], edges: [...graph.edges] };
  const claimNode = { id: claim.id, kind: 'Claim', label: claim.label, claimLevel: 'DEVICE_MEASURED' };
  const runNode = { id: runNodeId(id), kind: 'Run', label: `Night ${nights.join(',')} 6 AM on the phone, run pack ${id}`,
    source: `${PACKS_DIR}/${id}/pack.json`, packSha256: digest };
  for (const node of [claimNode, runNode]) {
    const at = next.nodes.findIndex(item => item.id === node.id);
    if (at < 0) next.nodes.push(node);
    else next.nodes[at] = node;
  }
  const status = attestationStatus(attestation, digest);
  const edge = { from: claim.id, to: runNode.id, type: PROMOTION_EDGE, source: `${PACKS_DIR}/${id}/${ATTESTATION_FILE}`,
    packSha256: digest, attestedBy: status.by, attestedOn: attestation.date ?? attestation.at ?? null,
    custody: custody.kind, ...(custody.lost.length ? { lost: custody.lost } : {}), authority: 'plans/12-end-to-end-evidence-campaign.md' };
  const at = next.edges.findIndex(item => item.type === PROMOTION_EDGE && item.to === runNode.id);
  if (at >= 0 && canonicalJson(next.edges[at]) === canonicalJson(edge)
      && canonicalJson(graph.nodes.find(item => item.id === claimNode.id)) === canonicalJson(claimNode)
      && canonicalJson(graph.nodes.find(item => item.id === runNode.id)) === canonicalJson(runNode))
    return { graph, status: 'ALREADY_RECORDED', edge };
  if (at >= 0) next.edges[at] = edge;
  else next.edges.push(edge);
  return { graph: next, status: at >= 0 ? 'UPDATED' : 'ADDED', edge };
}

const nightOf = (id, pack) => pack?.kind === 'fnaf1-run' ? 'fnaf1'
  : pack?.nights?.length ? String(pack.nights[0]) : id.match(/^night(\d+)-/)?.[1] ?? 'UNKNOWN';

/**
 * Every committed pack against the promotion gate and the graph, per night: packs, executor
 * wins, valid attestations, recorded promotions, and each refused pack's failing checks. A
 * PROMOTED_BY edge whose pack no longer passes is reported as stale, never hidden.
 * @param {string} root
 * @param {Map<string, string>} winners
 */
export function promotionSummary(root, winners) {
  const graph = readGraph(root);
  const nights = {};
  const refusedWins = [];
  const stale = [];
  const promoted = [];
  for (const id of readdirSync(join(root, PACKS_DIR)).sort()) {
    let loaded = null;
    try { loaded = readPack(join(root, PACKS_DIR, id)); } catch (error) {
      (nights.INVALID ??= { packs: 0, executorWins: 0, attested: 0, promoted: 0, refused: {} }).packs += 1;
      refusedWins.push({ id, failing: [`INVALID_PACK: ${error.message}`] });
      continue;
    }
    const night = nightOf(id, loaded.pack);
    const row = nights[night] ??= { packs: 0, executorWins: 0, attested: 0, promoted: 0, refused: {} };
    row.packs += 1;
    const edge = promotionEdgeFor(graph, id);
    if (loaded.pack.kind === 'fnaf1-run') {
      row.refused['fnaf1-run (no FNaF 1 gate)'] = (row.refused['fnaf1-run (no FNaF 1 gate)'] ?? 0) + 1;
      if (edge) stale.push({ id, reason: 'a FNaF 1 run has no Plan 12 gate' });
      continue;
    }
    const checks = packPromotionChecks(loaded, winners);
    const attestation = attestationStatus(loaded.attestation, loaded.digest);
    if (loaded.pack.outcome === 'WIN') row.executorWins += 1;
    if (attestation.valid) row.attested += 1;
    const accepted = Object.values(checks).every(Boolean);
    if (accepted && edge?.packSha256 === loaded.digest) {
      row.promoted += 1;
      promoted.push({ id, night, claim: edge.from, custody: edge.custody, attestedBy: edge.attestedBy, packSha256: loaded.digest });
      continue;
    }
    const failing = Object.entries(checks).filter(([, pass]) => !pass).map(([check]) => check);
    if (accepted) failing.push('not recorded in the graph');
    if (edge) stale.push({ id, reason: accepted ? 'edge binds another pack sha256' : `edge recorded but ${failing.join(', ')} fail` });
    const key = failing.join(',');
    row.refused[key] = (row.refused[key] ?? 0) + 1;
    if (loaded.pack.outcome === 'WIN') refusedWins.push({ id, night, failing, custody: packCustody(loaded.pack).kind });
  }
  const body = {
    schema: PROMOTION_SUMMARY_SCHEMA, tool: 'npm run evidence -- promotions', authority: 'plans/12-end-to-end-evidence-campaign.md',
    packs: PACKS_DIR, graph: GRAPH_FILE,
    rule: 'promoted = every packPromotionChecks check passes (offlineEvidence, terminalPass, manifestComplete, plan12Attestation, winnerCommitted) and a PROMOTED_BY edge binds the same pack sha256',
    nights, totals: Object.values(nights).reduce((sum, row) => ({ packs: sum.packs + row.packs, executorWins: sum.executorWins + row.executorWins,
      attested: sum.attested + row.attested, promoted: sum.promoted + row.promoted }), { packs: 0, executorWins: 0, attested: 0, promoted: 0 }),
    claims: Object.entries(promoted.reduce((sum, item) => ({ ...sum, [item.claim]: (sum[item.claim] ?? 0) + 1 }), {}))
      .sort(([a], [b]) => a.localeCompare(b)).map(([claim, runs]) => ({ claim, runs })),
    promoted, refusedWins, staleEdges: stale,
  };
  return { ...body, evidenceId: `plan12-promotions-${stableHash(body)}` };
}
