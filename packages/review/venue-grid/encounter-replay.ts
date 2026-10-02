// Encounter harness: win-score.mjs's run() (artifacts/forensics/twin-nights-night6-cohort2/win-score.mjs),
// unchanged in its press/frame-clock/constructor handling, plus per-unit movement and encounter ledgers.
//   node packages/review/venue-grid/encounter-replay.ts CFG.json OUT.json
// Inputs are private frame traces and derived press schedules; outputs contain derived facts only.
// CFG: { nights: [{ name, presses, trace?, first?, seeds, phone? }], opts?, catchUp?, windowMs?, summaryOnly? }
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { Sim } from '@sixam/source/fnaf2';
import type { Unit } from '@sixam/source/fnaf2';
import { MODEL_CONTEXT_LIGHT } from '@sixam/source';

/** A press row: [ms, press|release, action]. */
type Press = [ms: number, kind: 'press' | 'release', action: string];
/** One configured night: its presses and optional frame trace, the seeds to replay, and the phone's reads. */
export interface NightCfg { name: string, presses: string, trace?: string, first: number, seeds: number[], phone?: string }
/** CFG.json, as the usage above lists it. */
interface ReplayCfg {
  nights: NightCfg[], opts?: Readonly<Record<string, unknown>>, catchUp?: boolean, windowMs?: number, summaryOnly?: boolean;
  night?: number, maxFrames?: number, quiet?: boolean, printRows?: number,
}

const CODE: Readonly<Record<string, string>> = { withbonnie: 'B', withchica: 'C', withfreddy: 'F', toybonnie: 'b', toychica: 'c', toyfreddy: 'f', mangle: 'M', bb: 'x' };

export function windowCode(firstCharacter: string | null, untilMs: number, replayEndMs: number) {
  if (firstCharacter) return CODE[firstCharacter] ?? '?';
  // An observed occupant is a positive read. Empty needs the entire window:
  // death or the replay bound cannot turn an unfinished observation into '.'.
  return replayEndMs < untilMs ? '?' : '.';
}

export function score(phone: string | null | undefined, w: string) {
  if (!phone) return null;
  let hits = 0, occ = 0, read = 0, agreeRead = 0, comparedRead = 0, unknownModel = 0;
  for (let j = 0; j < phone.length; j++) {
    const c = phone[j]; if (c === '?') continue;
    read++;
    if (c !== '.') occ++;
    // A terminated simulation did not observe the remaining windows.
    // Missing windows must never become agreements with an empty phone read.
    if (j >= w.length || w[j] === '?') { unknownModel++; continue; }
    const m = w[j];
    comparedRead++;
    if (c !== '.' && m === c) hits++;
    if (m === c) agreeRead++;
  }
  return { hits, occ, read, agreeRead, comparedRead, unknownModel };
}

function main(argv: string[]) {
  const [cfgPath, outPath] = argv;
  if (!cfgPath || !outPath) throw new Error('usage: encounter-replay.mjs CONFIG.json OUT.json');
  const cfg: ReplayCfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
  const DEFAULT_OPTS = { sourcedDropLightOrder: true, sourcedFoxyChain: true, sourcedUnconditionalDraws: true,
    sourcedEventDraws: true, sourcedBlackoutDraws: true, sourcedViewDraws: true, sourcedRollDraws: true,
    sourcedMonitorDownDraw: true, sourcedSecondPass: true, sourcedPuppetGlitchDraws: true, sourcedRouteForks: true,
    sourcedSheetOrder: true, sourcedVentCamDraws: true, sourcedRandomImageDraw: true,
    // the 2026-09-18 encounter-fidelity configuration (enc-cfg.json)
    sourcedLastViewPause: true, sourcedFootstepDraws: true, sourcedHallEntry: true, sourcedMonitorRaiseGate: true,
    sourcedMangleReturn: true };
  const OPTS = { ...DEFAULT_OPTS, ...(cfg.opts ?? {}) };

  function loadTrace(path: string | undefined) {
    if (!path) return null;
    const lines = readFileSync(path, 'utf8').split('\n');
    const cols = lines[1].split('\t'); const ii = cols.indexOf('image_ns');
    return lines.slice(2).filter(l => l.trim()).map(l => Number(l.split('\t')[ii]));
  }
  function deltasFor(traceNs: number[] | null, first: number, catchUp: boolean) {
    if (!traceNs) return null;
    if (!catchUp) return [1000 / 60, ...traceNs.slice(first + 1).map((t, k) => (t - traceNs[first + k]) / 1e6)];
    return [1000 / 60, ...traceNs.slice(first + 1).flatMap((t, k) => {
      const dt = (t - traceNs[first + k]) / 1e6; const n = Math.max(1, Math.min(3, Math.round(dt / (1000 / 60))));
      return [dt - (n - 1), ...Array(n - 1).fill(1)];
    })];
  }

  function run(night: NightCfg, seed: number, deltas: number[] | null, presses: readonly Press[]) {
    const fixed = 1000 / 60;
    const frameMs = (f: number) => (deltas ? (deltas[f - 1] ?? fixed) : fixed);
    const opts = { night: cfg.night ?? 6, seed, ...OPTS, frameMs, frameValue5: (f: number) => Math.min(4, frameMs(f) / (1000 / 60)) };
    const lcg = (x: number, n: number) => { for (let i = 0; i < n; i++) x = (x * 31415 + 1) & 0xffff; return x; };
    const probe = new Sim({ ...opts, seed });
    let k = 0; while (k <= 8 && lcg(seed & 0xffff, k) !== probe.rng.state) k++;
    if (k > 8) throw new Error(`seed ${seed}: constructor state not within 8 draws`);
    const s = k === 0 ? probe : new Sim({ ...opts, seed: lcg(seed & 0xffff, 1) });
    if (k > 0) s.rng.state = lcg(seed & 0xffff, k);
    // ledgers
    const hops: [frame: number, id: string, from: Unit['path'][number], to: Unit['path'][number]][] = [];
    // The Sim moves a unit through advanceUnit (its old name, advance, is PlantModel's clock since 2026-09-30).
    const origAdvance = s.advanceUnit.bind(s);
    s.advanceUnit = u => { const from = u.path[u.idx]; origAdvance(u); hops.push([s.frame, u.id, from, u.path[u.idx]]); };
    const maxFrames = cfg.maxFrames ?? 30000, windowMs = cfg.windowMs ?? 1500;
    let i = 0, cum = 0; const cumAt = [0];
    const windows: { t: number, frame: number, units: Set<string>, first: string | null, until: number }[] = [];
    let open = null as (typeof windows)[number] | null;
    while (s.alive && !s.won && s.frame < maxFrames) {
      const next = frameMs(s.frame + 1);
      while (i < presses.length && presses[i][0] <= cum + next / 2) {
        const [, kind, action] = presses[i++];
        const wasOn = s.maskOn;
        s[kind](action);
        if (kind === 'press' && action === 'mask' && !wasOn && s.maskOn) {
          open = { t: +cum.toFixed(1), frame: s.frame + 1, units: new Set(), first: null, until: cum + windowMs };
          windows.push(open);
        }
      }
      s.tick();
      cum += next; cumAt[s.frame] = cum;
      if (open) {
        if (s.blackout.active && s.blackout.unitId) { open.units.add(s.blackout.unitId); if (!open.first) open.first = s.blackout.unitId; }
        if (cum > open.until) open = null;
      }
    }
    const w = windows.map(x => windowCode(x.first, x.until, cum)).join('');
    const ms = (f: number) => +(cumAt[f] ?? cum).toFixed(0);
    const cues = s.events.filter(e => e.type === 'office-cue').map(e => [ms(e.f), e.data]);
    // No Sim emits this event (it came with the forensics copy this tool was made from): zeros counts none.
    const zeros = s.events.filter(e => (e.type as string) === 'x-cam8-zero');
    const leaveCam8: Record<string, number> = {};
    for (const [f, id, from] of hops) if (from === 8 && !(id in leaveCam8)) leaveCam8[id] = ms(f);
    const hopCount: Record<string, number> = {}; for (const [, id] of hops) hopCount[id] = (hopCount[id] ?? 0) + 1;
    const cueCount: Record<string, number> = {}; for (const [, id] of cues) cueCount[id] = (cueCount[id] ?? 0) + 1;
    const bbIn = s.events.filter(e => e.type === 'bb-inside').map(e => ms(e.f));
    const insides = s.events.filter(e => e.type === 'office-entry').map(e => [ms(e.f), e.data.who]);
    const foxyLock = s.events.filter(e => e.type === 'foxy-lock').map(e => ms(e.f));
    return { bbIn, insides, foxyLock, seed: seed & 0xffff, won: s.won, death: s.death?.reason ?? null, endMs: +cum.toFixed(0), w,
             windowStartMs: windows.map(x => x.t),
             cueCount, hopCount, leaveCam8, zeros: zeros.length, firstCueMs: cues[0]?.[0] ?? null,
             ...(cfg.summaryOnly ? {} : { cues, hops: hops.map(([f, id, a, b]) => [ms(f), id, a, b]) }) };
  }


  const out: { name: string, phone: string | null, rows: (ReturnType<typeof run> & { score?: ReturnType<typeof score> })[] }[] = [];
  for (const night of cfg.nights) {
    const traceNs = loadTrace(night.trace);
    const deltas = deltasFor(traceNs, night.first, cfg.catchUp ?? true);
    const presses = JSON.parse(readFileSync(night.presses, 'utf8')).actions
      .map(([t, k, a]: Press): Press => [t, k, a === 'light' ? MODEL_CONTEXT_LIGHT : a]);
    const rows = night.seeds.map(seed => {
      const r: ReturnType<typeof run> & { score?: ReturnType<typeof score> } = run(night, seed, deltas, presses);
      r.score = score(night.phone, r.w);
      return r;
    });
    out.push({ name: night.name, phone: night.phone ?? null, rows });
  }
  const id = `encounter-replay-${createHash('sha256').update(JSON.stringify({ night: cfg.night ?? 6, opts: OPTS, out })).digest('hex').slice(0, 16)}`;
  writeFileSync(outPath, JSON.stringify({ schema: 'encounter-replay-v1', id, claimLevel: 'MODEL_ONLY', opts: OPTS, cfg, out }));
  if (!cfg.quiet) console.log(`${id} MODEL_ONLY`);
  if (!cfg.quiet) for (const n of out) for (const r of n.rows.slice(0, cfg.printRows ?? 5))
    console.log(`${n.name} ${r.seed} ${r.won ? 'WON' : 'DEAD ' + r.death + '@' + r.endMs} ${r.w} ${r.score ? `hits ${r.score.hits}/${r.score.occ} agree ${r.score.agreeRead}/${r.score.comparedRead}, UNKNOWN ${r.score.unknownModel}` : ''} cues ${JSON.stringify(r.cueCount)} cam8 ${JSON.stringify(r.leaveCam8)} zeros ${r.zeros}`);


}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv.slice(2));
