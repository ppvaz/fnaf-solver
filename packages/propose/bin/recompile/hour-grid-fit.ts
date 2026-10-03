#!/usr/bin/env node
// The phone's own hour grid, read from a retained frame trace (ROADMAP S2). Each in-game hour is 70 s of
// the same accumulated timer that paces the encounter rolls (g627's one-second cadence, g629/g630 advance
// the hour at 70), so the hour-transition interstitials measure the phone's night clock directly: its rate
// (the intervals) and its zero (the fitted grid phase, checked against the run's anchor fire).
//
//   node packages/propose/bin/recompile/hour-grid-fit.ts --trace FILE --first N --release-after-first MS --label NAME \
//        [--hours K,K,...] --out RESULT.json
//
// A transition is the first captured frame of the dark interstitial near each expected hour: grid luma
// below 20 from >= 30 on the previous frame, searched within +-8 s of release + 70000 k after the first
// night frame. The fit is the least-squares phase of t = zero + 70000 k. Content-free: times, luma and
// counts only. The reads are DEVICE_MEASURED observations from the retained capture; nothing here replays
// or promotes anything.
import { sha256 } from './sweep-common.ts';
import { parseArgs } from 'node:util';
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { traceColumns } from './phone-encounter-replay.ts';


/** An hour's transition: the first dark interstitial frame near it, or none found. */
export type Transition = { k: number, imageMs: number, luma: number, prevLuma: number } | { k: number, imageMs: null };
/** A phone-hour-grid-v1 record. */
export interface HourGridResult {
  schema: string, claimLevel: string, label: string, step: string, toolSha256: string;
  input: {
    tracePath: string, traceSha256: string, first: number, releaseAfterFirstFrameMs: number, hours: number[];
    anchorFireAfterFirstFrameMs?: number, anchorFireToleranceMs?: number, rule: string,
  };
  transitions: Transition[], fit: ReturnType<typeof fitHourGrid> & { zeroMinusAnchorFireMs: number | null };
  evidenceId: string | null, interpretation: string;
}
export const SCHEMA = 'phone-hour-grid-v1';
export const HOUR_MS = 70000;
export const DARK_LUMA = 20;
export const WARM_LUMA = 30;
export const SEARCH_MS = 8000;

/** The first dark-interstitial frame near each expected hour: { k, imageMs, luma, prevLuma }. */
export function hourTransitions(imageNs: readonly number[], luma: readonly number[], first: number, releaseAfterFirstMs: number,
  hours: readonly number[]) {
  if (!Number.isInteger(first) || first < 0 || first >= imageNs.length) throw new Error('first must name a trace frame');
  if (imageNs.length !== luma.length) throw new Error('image and luma columns differ in length');
  const t0 = imageNs[first];
  const at = (j: number) => (imageNs[j] - t0) / 1e6;
  const out: Transition[] = [];
  for (const k of hours) {
    const want = releaseAfterFirstMs + HOUR_MS * k;
    let hit = null as Transition | null;
    for (let j = 1; j < imageNs.length; j += 1) {
      const t = at(j);
      if (t < want - SEARCH_MS) continue;
      if (t > want + SEARCH_MS) break;
      if (luma[j] < DARK_LUMA && luma[j - 1] >= WARM_LUMA) { hit = { k, imageMs: Number(t.toFixed(1)), luma: luma[j], prevLuma: luma[j - 1] }; break; }
    }
    out.push(hit ?? { k, imageMs: null });
  }
  return out;
}

/** Least-squares phase of t = zero + 70000 k over the found transitions, with intervals and residuals. */
export function fitHourGrid(transitions: readonly Transition[]) {
  const found = transitions.filter((t) => t.imageMs !== null);
  if (!found.length) return { zeroMsAfterFirst: null, residualsMs: null, intervalsMs: null, found: 0 };
  const zero = found.reduce((s, t) => s + t.imageMs - HOUR_MS * t.k, 0) / found.length;
  const residuals = found.map((t) => Number((t.imageMs - HOUR_MS * t.k - zero).toFixed(1)));
  const intervals = found.slice(1).map((t, i) => Number((t.imageMs - found[i].imageMs).toFixed(1)));
  return { zeroMsAfterFirst: Number(zero.toFixed(1)), residualsMs: residuals, intervalsMs: intervals, found: found.length };
}

/** Recompute a result from its trace and its own rule; throws on the first difference. */
/** What check reads of a record: its schema and hashes, its transitions and fit, the anchor fire, and its id. */
export type Checked = Pick<HourGridResult, 'schema' | 'toolSha256' | 'transitions' | 'fit'> & {
  readonly input: Pick<HourGridResult['input'], 'traceSha256' | 'anchorFireAfterFirstFrameMs' | 'anchorFireToleranceMs'>;
  evidenceId?: string | null,
};

export function check(result: Checked, { traceBytes = null }: { traceBytes?: Buffer | null } = {}) {
  if (result.schema !== SCHEMA) throw new Error(`schema must be ${SCHEMA}`);
  if (!/^[a-f0-9]{64}$/.test(result.input.traceSha256)) throw new Error('trace hash must be sha256');
  if (!/^[a-f0-9]{64}$/.test(result.toolSha256)) throw new Error('tool hash must be sha256');
  if (traceBytes && sha256(traceBytes) !== result.input.traceSha256) throw new Error('trace hash differs');
  const fit = fitHourGrid(result.transitions);
  for (const key of ['zeroMsAfterFirst', 'residualsMs', 'intervalsMs', 'found'] as const) {
    if (JSON.stringify(fit[key]) !== JSON.stringify(result.fit[key])) throw new Error(`fit ${key} differs`);
  }
  const maxResidualMs = fit.residualsMs?.length ? Math.max(...fit.residualsMs.map(Math.abs)) : null;
  if (maxResidualMs !== null && maxResidualMs > 40) throw new Error('a transition residual exceeds 40 ms');
  if (result.fit.intervalsMs?.length && Math.max(...result.fit.intervalsMs.map((i) => Math.abs(i - HOUR_MS))) > 40)
    throw new Error('an interval strays more than 40 ms from 70 s');
  // Number.isFinite passed the anchor fire; a fit with no transition has no zero, which counts as 0 here as before.
  const zeroMinusAnchorFireMs = Number.isFinite(result.input.anchorFireAfterFirstFrameMs)
    ? Number((Number(fit.zeroMsAfterFirst) - (result.input.anchorFireAfterFirstFrameMs as number)).toFixed(1)) : null;
  if (zeroMinusAnchorFireMs !== null && Math.abs(zeroMinusAnchorFireMs) > (result.input.anchorFireToleranceMs ?? 50))
    throw new Error('fitted zero is outside the anchor-fire tolerance');
  if (result.fit.zeroMinusAnchorFireMs !== zeroMinusAnchorFireMs) throw new Error('anchor-fire phase differs');
  const { evidenceId, ...body } = result;
  const expectedEvidenceId = `phone-hour-grid-${sha256(JSON.stringify(body)).slice(0, 16)}`;
  if (evidenceId !== expectedEvidenceId) throw new Error('evidence ID differs from the record');
  return { found: result.fit.found, zero: result.fit.zeroMsAfterFirst, maxResidualMs, zeroMinusAnchorFireMs, evidenceId };
}

const HOUR_GRID_FLAGS = ['trace', 'out', 'first', 'release-after-first', 'anchor-fire-after-first', 'anchor-fire-tolerance',
  'hours', 'label'] as const;
/** The command line's flags, refusing any this tool does not read (a misspelled one would silently take its default). */
export function hourGridArgs(argv: readonly string[]) {
  const { values } = parseArgs({ args: [...argv], strict: true,
    options: Object.fromEntries(HOUR_GRID_FLAGS.map((name) => [name, { type: 'string' as const }])) });
  return (name: (typeof HOUR_GRID_FLAGS)[number]) => { const value = values[name]; return typeof value === 'string' ? value : null; };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const flag = hourGridArgs(process.argv.slice(2));
  const tracePath = flag('trace');
  const out = flag('out');
  if (!tracePath || !flag('first') || !flag('release-after-first') || !out) throw new Error('see usage at top of file');
  const anchorFireFlag = flag('anchor-fire-after-first');
  const bytes = readFileSync(tracePath);
  const columns = traceColumns(bytes.toString('utf8'), ['image_ns', 'grid_mean_luma']);
  const first = Number(flag('first'));
  const releaseAfterFirstFrameMs = Number(flag('release-after-first'));
  const hours = (flag('hours') ?? '1,2,3,4,5,6').split(',').map(Number);
  const transitions = hourTransitions(columns.image_ns, columns.grid_mean_luma, first, releaseAfterFirstFrameMs, hours);
  const fit = fitHourGrid(transitions);
  const result: HourGridResult = {
    schema: SCHEMA, claimLevel: 'the transition reads are DEVICE_MEASURED observations of the retained capture; the fit is arithmetic',
    label: flag('label') ?? tracePath, step: 'ROADMAP S2: the night clock measured from its own hour grid',
    toolSha256: sha256(readFileSync(new URL(import.meta.url))),
    input: { tracePath, traceSha256: sha256(bytes), first, releaseAfterFirstFrameMs, hours,
      ...(anchorFireFlag !== null ? { anchorFireAfterFirstFrameMs: Number(anchorFireFlag),
        anchorFireToleranceMs: Number(flag('anchor-fire-tolerance') ?? 50) } : {}),
      rule: 'the first captured frame with grid luma below 20 from at least 30 on the previous frame, within 8 s of release + 70000 k after the first night frame; the fit is the mean phase of t = zero + 70000 k' },
    transitions, fit: { ...fit, zeroMinusAnchorFireMs: anchorFireFlag !== null
      ? Number((Number(fit.zeroMsAfterFirst) - Number(anchorFireFlag)).toFixed(1)) : null },
    evidenceId: null,
    interpretation: 'Hour length is 70 s of the same accumulated timer that paces the encounter rolls, so the intervals measure the phone timer\'s rate against the capture clock and the fitted phase measures the night clock\'s zero. A zero at first-frame + 3836.7 (full-06) is the anchor fire instant (firedWallMs - seed 3917.0, first frame at seed + 81.0): the game\'s night clock starts at the night-go tap, about 3.84 s after the first captured night frame the retained reconstruction starts office updates at.',
  };
  result.evidenceId = `phone-hour-grid-${sha256(JSON.stringify({ ...result, evidenceId: undefined })).slice(0, 16)}`;
  check(result, { traceBytes: bytes });
  writeFileSync(out, `${JSON.stringify(result, null, 1)}\n`);
  console.log(`${result.evidenceId}: ${result.label} ${fit.found} transitions, zero = first frame + ${fit.zeroMsAfterFirst} ms, ` +
    `intervals ${JSON.stringify(fit.intervalsMs)}, residuals ${JSON.stringify(fit.residualsMs)}`);
}
