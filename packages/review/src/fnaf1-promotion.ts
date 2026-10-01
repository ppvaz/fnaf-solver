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
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { custodyWinnerFiles, packCustody } from './evidence-pack.ts';

const FNAF1_STARS_FILE = 'title-stars.json';
const FNAF1_STARS_SCHEMA = 'fnaf1-title-stars-v1';
const FNAF1_WINNER_SCHEMA = 'fnaf1-route-winner-v1';
const DIALS = ['freddy', 'bonnie', 'chica', 'foxy'];
const sha256 = (data) => createHash('sha256').update(data).digest('hex');

/** Committed FNaF 1 route winners (active and retired), repository-relative. */
function fnaf1WinnerFiles(root: string): string[] {
  return custodyWinnerFiles(root).filter((file) => {
    try { return JSON.parse(readFileSync(join(root, file), 'utf8')).schema === FNAF1_WINNER_SCHEMA; } catch { return false; }
  });
}

const sameDials = (a, b) => Boolean(a && b) && DIALS.every((dial) => a[dial] === b[dial]);

/** The claim a FNaF 1 Custom Night supports: named by the dial vector its readback observed. */
function fnaf1Claim(dials) {
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
export function deriveFnaf1Promotion(root: string, id: string, dir: string, loaded: any) {
  const { pack, digest } = loaded;
  const packed = (name) => pack.files.find((file) => file.name === name);
  const inputs = (...names) => names.map(packed).filter(Boolean).map((file) => ({ name: file.name, sha256: file.sha256 }));
  const json = (name) => (packed(name) ? JSON.parse(readFileSync(join(dir, name), 'utf8')) : null);
  const probe = json('probe.json');
  const events = packed('events.jsonl') ? readFileSync(join(dir, 'events.jsonl'), 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l)) : [];
  const stars = json(FNAF1_STARS_FILE);
  const verified = [];
  const add = (check, failed, detail, from) => verified.push({ check, pass: failed.length === 0, inputs: from, detail: failed.length ? { ...detail, failed } : detail });

  add('offlineEvidence', [
    ...(probe?.options?.live === true && probe?.options?.dryRun === false ? [] : ['the runner record is not a live night']),
    ...(String(probe?.claimLevel ?? '').startsWith('DEVICE_MEASURED') && pack.claimLevel === 'DEVICE_MEASURED' ? [] : ['not DEVICE_MEASURED']),
    ...(probe?.status === 'COMPLETE' ? [] : [`record status ${probe?.status ?? 'none'}, not COMPLETE`]),
  ], { live: probe?.options?.live ?? null, claimLevel: pack.claimLevel, status: probe?.status ?? null }, inputs('probe.json'));

  const origin = events.find((e) => e.type === 'night-origin');
  const ended = events.find((e) => e.type === 'night-ended');
  const captured = new Map<string, any>((probe?.capture?.frames ?? []).map((f) => [f.name, f]));
  const terminalFailed = [];
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
    .map((item) => ({ ...item, winner: JSON.parse(item.bytes.toString('utf8')) })).filter((item) => item.winner.won?.run === pack.run);
  const winnerFailed = [];
  const winner = candidates[0] ?? null;
  if (!winner) winnerFailed.push(`no committed ${FNAF1_WINNER_SCHEMA} names run ${pack.run}`);
  else {
    const w = winner.winner; const o = probe?.options ?? {};
    if (w.resolvedOptions?.policy !== o.mode) winnerFailed.push(`the winner's policy ${w.resolvedOptions?.policy} is not the run's mode ${o.mode}`);
    for (const key of ['chicaByCamera', 'originOffsetMs', 'stopAfterMs'])
      if (w.resolvedOptions?.[key] !== o[key]) winnerFailed.push(`the winner's ${key} ${w.resolvedOptions?.[key]} is not the run's ${o[key]}`);
    if (!sameDials(w.night?.dials, probe?.dialsSet)) winnerFailed.push('the winner\'s dials are not the dials the run set');
    const pinned = new Set(Object.values(w.sources ?? {}));
    for (const [name, binding] of Object.entries(probe?.bindings ?? {}) as [string, any][])
      if (name !== 'title' && !pinned.has(binding.sha256)) winnerFailed.push(`the run's ${name} model ${binding.sha256} is not among the winner's pinned sources`);
  }
  add('winnerCommitted', winnerFailed, { winner: winner?.file ?? null, run: pack.run },
    winner ? [{ name: winner.file, sha256: sha256(winner.bytes) }] : []);

  const set = events.find((e) => e.type === 'dials-set');
  const readback = set ? events.filter((e) => e.type === 'dial-read' && e.status === 'PASS' && e.atMonotonicMs <= set.atMonotonicMs).at(-1) : null;
  const claimFailed = [];
  if (!set) claimFailed.push('no dials-set event');
  if (!readback) claimFailed.push('no PASS Custom Night readback before the night began');
  else if (!sameDials(readback.dials, set?.dials)) claimFailed.push('the last readback differs from the dials set');
  if (set && !sameDials(set.dials, probe?.dialsSet)) claimFailed.push('the events and the record disagree on the dials set');
  if (origin && set && !(set.atMonotonicMs < origin.atMonotonicMs)) claimFailed.push('the dials were set after the night began');
  const claim = claimFailed.length ? null : fnaf1Claim(readback.dials);
  add('claimIdentity', claimFailed, { observedDials: readback?.dials ?? null, setDials: set?.dials ?? null }, inputs('events.jsonl', 'probe.json'));

  return { id, dir, loaded, digest, custody, claim, verified, pass: verified.every((item) => item.pass) };
}
