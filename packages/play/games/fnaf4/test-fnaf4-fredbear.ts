#!/usr/bin/env node
// FNaF 4's Fredbear hearing and hold, without a phone: the grid arithmetic,
// the hearing model's floors against the derived rows of the run they were
// measured on (docs/evidence/fnaf4-night5-n5b-20260927.json), the quiet-walk
// and release slots, and a door hold that is ONE contact.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import {
  HEARING_PATH, loadHearing, Grid, sideGrid, laughGrid, landings, laughs, walkSlot, quietTapAt, releaseAt, shadowOf,
} from './fnaf4-fredbear.ts';
import { Actor, type RunRecord, interruptibleSleep } from '../../bin/phone/night-kit.ts';
import { HidWireTransport } from '../../src/venues/phone/hid.ts';
import type { HearingRecord } from './fnaf4-hearing-evidence.ts';

const failures: string[] = [];
let checks = 0;
const ok = (what: string, c: unknown) => { checks += 1; if (!c) failures.push(what); };
/** A fake that implements only what the code under test calls. */
const fakeOf = <T>(value: unknown) => value as T;

const hearing = loadHearing();
const record: HearingRecord = JSON.parse(readFileSync(new URL('../../../../docs/evidence/fnaf4-night5-n5b-20260927.json', import.meta.url), 'utf8'));
const MARGIN = 0.04;       // a floor must clear what it separates by this much on each side

// --- the grid -------------------------------------------------------------------------
{
  const g = new Grid(1000, 3000, { onsetOffsetMs: -50, halfWidthMs: 150, decideAfterMs: 2000 });
  ok('tick k sounds at origin + k period + offset', g.at(2) === 1000 + 6000 - 50);
  ok('an onset inside the window is that tick', g.tickOf(g.at(5) + 149) === 5 && g.tickOf(g.at(5) - 149) === 5);
  ok('an onset outside every window is not his', g.tickOf(g.at(5) + 151) === null && g.tickOf(g.at(5) + 1500) === null);
  ok('next and last tick bracket a time', g.nextK(g.at(3) + 1) === 4 && g.lastK(g.at(3) + 1) === 3 && g.nextK(g.at(3)) === 3);
  ok('a tick is decided only after its candidates are in', !g.decided(3, g.at(3) + 1999) && g.decided(3, g.at(3) + 2000));
  ok('shadow nights are 7 and 8', shadowOf(5) === 0 && shadowOf(6) === 0 && shadowOf(7) === 1 && shadowOf(8) === 1);
  ok('Night 5 rolls on 3000 ms, Night 7 on 2000 ms', sideGrid(0, 5, hearing).periodMs === 3000 && sideGrid(0, 7, hearing).periodMs === 2000);
  ok('laughs are on 10000 ms', laughGrid(0, hearing).periodMs === 10000);
}

// --- landings and laughs on synthetic candidates ---------------------------------------
{
  const g = sideGrid(0, 5, hearing);
  const ev = (cue: string, k: number, ncc: number, dt = 0) => ({ cue, ncc, onsetMs: g.at(k) + dt });
  const rows = landings([ev('fb-right', 2, 0.30), ev('fb-left', 2, 0.08), ev('fb-left', 3, 0.35, 90),
    ev('fb-left', 4, 0.26), ev('fb-right', 4, 0.24), ev('fb-right', 5, 0.17), ev('fb-left', 6, 0.9, 400)], g, hearing.sideGrid);
  const by = Object.fromEntries(rows.map((r) => [r.k, r]));
  ok('a lone side over the floor is a landing', by[2]?.side === 'R');
  ok('an onset 90 ms off its tick still counts', by[3]?.side === 'L');
  ok('two sides close together are no landing (sideRatio)', by[4] && by[4].side === null);
  ok('a candidate under the floor is no landing', by[5] && by[5].side === null);
  ok('an off-grid candidate is not his, however strong', !by[6] && !by[7]);
  const lg = laughGrid(0, hearing);
  const ls = laughs([{ cue: 'laugh', ncc: 0.5, onsetMs: lg.at(3) }, { cue: 'laugh', ncc: 0.5, onsetMs: lg.at(4) + 40 },
    { cue: 'laugh', ncc: 0.9, onsetMs: lg.at(5) + 2000 }], lg, hearing.laughGrid, 30000);
  ok('a laugh on the 30 s tick is a room laugh', ls.find((l) => l.k === 3)?.room === true && ls.find((l) => l.k === 3)?.accepted);
  ok('a laugh on another 10 s tick is a fake', ls.find((l) => l.k === 4)?.room === false);
  ok('a laugh off the 10 s grid is nobody\'s', !ls.some((l) => l.k === 5));
}

// --- the floors against the runs they were measured on ---------------------------------
// Each Night 5 replay (audio.raw through the model's detector): its landings and
// laughs reproduce from the retained candidates, and the floors clear its silent
// grid instants and sit under its weakest event, each by MARGIN.
const replayed = (label: string, expectLandings: string, expectLaughs: string, { deaf = false }: { deaf?: boolean } = {}) => {
  const b = record.derived?.[label];
  ok(`the evidence record carries ${label}'s rows`, !!b?.hearing?.candidates?.length);
  if (!b) return null;
  const h = b.hearing;
  const origin = h.grid.levelOriginWallMs;
  const events = h.candidates.map(([cue, handle, ncc, rel]) => ({ cue, handle, ncc, onsetMs: origin + rel }));
  const g = sideGrid(origin, b.night, hearing);
  const rows = landings(events, g, hearing.sideGrid);
  const accepted = rows.filter((r) => r.side).map((r) => `${r.side}@${r.k * 3}s`).join(' ');
  ok(`${label}: landings replay as ${expectLandings} (${accepted})`, accepted === expectLandings);
  ok(`${label}: the recorded ticks say the same`, h.summary.landingsAccepted.join(' ') === expectLandings);
  const s = h.summary;
  // A deaf night (another app's music over the game) only has to accept nothing.
  ok(`${label}: the side floor ${hearing.sideGrid.minNcc} clears the silent ticks (max ${s.silentTickMaxNcc}) by ${deaf ? 0 : MARGIN}`,
    // Every replayed night has silent ticks and quiet laugh ticks.
    hearing.sideGrid.minNcc - (s.silentTickMaxNcc as number) >= (deaf ? 0.001 : MARGIN));
  if (s.landingMinNcc !== null) {
    ok(`${label}: the side floor ${hearing.sideGrid.minNcc} sits under the weakest landing (${s.landingMinNcc}) by ${MARGIN}`,
      s.landingMinNcc - hearing.sideGrid.minNcc >= MARGIN);
  }
  for (const r of rows.filter((x) => x.side)) {
    ok(`${label}: landing at ${r.k * 3}s beats the other side by the ratio`, r.ncc >= hearing.sideGrid.sideRatio * r.other);
  }
  const lg = laughGrid(origin, hearing);
  const ls = laughs(events, lg, hearing.laughGrid, hearing.laughGrid.roomPeriodMs.shadow0).filter((l) => l.accepted)
    .map((l) => `${l.room ? 'room' : 'fake'}@${l.k * 10}s`).join(' ');
  ok(`${label}: laughs replay as ${expectLaughs} (${ls})`, ls === expectLaughs);
  ok(`${label}: the laugh floor ${hearing.laughGrid.minNcc} clears the quiet laugh ticks (max ${s.quietLaughTickMaxNcc}) by ${MARGIN}`,
    hearing.laughGrid.minNcc - (s.quietLaughTickMaxNcc as number) >= MARGIN);
  if (s.laughMinNcc !== null) {
    ok(`${label}: the laugh floor ${hearing.laughGrid.minNcc} sits under the weakest laugh (${s.laughMinNcc}) by ${MARGIN}`,
      s.laughMinNcc - hearing.laughGrid.minNcc >= MARGIN);
  }
  // Each accepted onset sits inside its window with room to spare (the offset is measured, not assumed).
  for (const [cue, , ncc, rel] of h.candidates.filter(([cue, , ncc]) => cue !== 'laugh' && ncc >= hearing.sideGrid.minNcc)) {
    const k = Math.round((rel - hearing.sideGrid.onsetOffsetMs) / 3000);
    const dt = rel - (k * 3000 + hearing.sideGrid.onsetOffsetMs);
    ok(`${label}: ${cue} ${ncc} at ${rel} ms lies ${dt.toFixed(0)} ms from its tick, inside ${hearing.sideGrid.halfWidthMs - 30}`,
      Math.abs(dt) <= hearing.sideGrid.halfWidthMs - 30);
  }
  const opens = (b.views?.holds ?? []).map((x) => x.openAfterReleaseMs).filter((x): x is number => Number.isFinite(x));
  ok(`${label}: the door reads open ${opens.join('/')} ms after a release, inside the model's ${hearing.door.openAfterReleaseMs}`,
    opens.every((ms) => ms >= hearing.door.openAfterReleaseMs[0] && ms <= hearing.door.openAfterReleaseMs[1]));
  return b;
};

// n5b (2026-09-27): four landings and a room-period laugh, none published by the old detector.
const n5b = replayed('n5b-replay', 'R@6s L@9s R@15s R@21s', 'room@30s');
ok('the live n5b stream carried no landing and no laugh on the grid',
  record.derived?.['n5b-live']?.hearing?.summary?.landingsAccepted?.length === 0);
if (n5b?.views) {
  const v = n5b.views;
  ok('n5b\'s chained holds read open under a held button', v.holds.slice(0, 2).every((x) => x.lapses.length >= 1));
  ok('every n5b back pressed 1 ms after letting go was dropped', v.backs.filter((b) => b.sinceDoorReleaseMs !== null && b.sinceDoorReleaseMs < 50 && b.viewBefore !== 'doorR')
    .every((b) => !b.reachedRoomWithin3s));
}
// n5d (the fixed branch on the phone): the 51 s landing its mono floor missed is heard.
const n5d = replayed('n5d-replay', 'L@3s L@6s R@9s L@12s L@15s L@21s R@27s L@39s R@51s', 'fake@40s fake@50s');
// n5d ran with a 0.23 floor over a mono match: its live stream scored the 51 s
// landing under that floor (the policy row log has no 'landed R (tick 17)').
const t17 = record.derived?.['n5d-live']?.hearing?.sideTicks?.find((t) => t[0] === 17);
ok(`the live n5d stream scored the 51 s landing under the floor it ran with (${t17?.[3]} < 0.23)`, !!t17 && t17[3] > 0 && t17[3] < 0.23);
if (n5d?.views) {
  ok('n5d\'s one-contact holds never read open while held', n5d.views.holds.every((x) => x.lapses.length === 0));
  ok('every n5d back, pressed after the open view, walked home', n5d.views.backs.length >= 4 && n5d.views.backs.every((b) => b.reachedRoomWithin3s));
}
// n5c: another app's music in the mix (-22 dBFS): deaf, and the floor accepts nothing from it.
replayed('n5c-replay', '', 'fake@20s', { deaf: true });

// Every derived block was written under the hearing model on disk: a floor
// moved without regenerating the rows it cites fails here.
{
  const modelSha = createHash('sha256').update(readFileSync(HEARING_PATH)).digest('hex');
  for (const [k, b] of Object.entries(record.derived ?? {})) {
    ok(`${k} was derived under the current hearing model`, b.hearingModel?.sha256 === modelSha);
  }
}

// --- the nights without him: no laugh ever crosses the floor ---------------------------
const silence = Object.entries(record.derived ?? {}).filter(([k]) => k.startsWith('silence-'));
ok('the record carries the Nights 1-4 silence rows', silence.length >= 4);
for (const [k, b] of silence) {
  ok(`${k}: no laugh on the grid (max ${b.hearing.summary.quietLaughTickMaxNcc}) within ${MARGIN} of the floor`,
    b.hearing.summary.laughsAccepted.length === 0 && hearing.laughGrid.minNcc - (b.hearing.summary.quietLaughTickMaxNcc as number) >= MARGIN);
}

// --- our own run's sound, measured on every walk of Nights 1-5 -------------------------
{
  const rows = Object.entries(record.derived ?? {}).filter(([k]) => k !== 'n5b-live')
    .flatMap(([, b]) => b.runOnsets ?? [])
    .filter(([control, , from, , ms]) => ms !== null && (control !== 'back' || (['leftDoor', 'rightDoor', 'closet'] as (string | null)[]).includes(from)));
  for (const gesture of ['press', 'double']) {
    const ms = rows.filter((r) => r[1] === gesture).map((r) => r[4] as number);   // measured: filtered above
    const [lo, hi] = hearing.quietWalk.runOnsetAfterIssueMs[gesture];
    ok(`${gesture}: ${ms.length} measured run onsets (${Math.min(...ms)}..${Math.max(...ms)} ms) lie in the model's ${lo}..${hi}`,
      ms.length >= 50 && ms.every((x) => x >= lo && x <= hi));
  }
}

// --- walks and releases ---------------------------------------------------------------
{
  const g = sideGrid(0, 5, hearing);
  // A 3 s grid has both slots (checked next); a null one throws below, as it did untyped.
  const press = walkSlot(g, hearing, 'press') as [number, number];
  const dbl = walkSlot(g, hearing, 'double') as [number, number];
  ok(`a back has a quiet slot on a 3 s grid (${press})`, press && press[0] < press[1]);
  ok(`a door run has a quiet slot on a 3 s grid (${dbl})`, dbl && dbl[0] < dbl[1]);
  const q = hearing.quietWalk;
  for (const [gesture, slot] of [['press', press], ['double', dbl]] as const) {
    const [onLo, onHi] = q.runOnsetAfterIssueMs[gesture];
    ok(`${gesture}: its run starts after the tick window's first ${q.windowClearMs} ms`, slot[0] + onLo >= -g.halfWidthMs + q.windowClearMs);
    ok(`${gesture}: its run ends before the next window`, slot[1] + onHi + q.runLengthMs <= g.periodMs - g.halfWidthMs);
  }
  ok('a 2 s grid has no quiet slot for a 1.48 s run', walkSlot(sideGrid(0, 7, hearing), hearing, 'press') === null);
  const t = quietTapAt(g.at(11) + 5, g, hearing, 'press', 30000);
  ok('a walk waits for the slot after the tick', t === g.at(11) + press[0]);
  const t2 = quietTapAt(g.at(11) + press[1] + 1, g, hearing, 'press', 30000);
  ok('past the slot, the next tick\'s', t2 === g.at(12) + press[0]);
  const t3 = quietTapAt(g.at(19) + press[1] + 1, g, hearing, 'press', 30000);
  ok('a room tick (60 s) is skipped: its laugh must be heard', t3 === g.at(21) + press[0]);
  ok('now, when now is inside a slot', quietTapAt(g.at(11) + press[0] + 5, g, hearing, 'press', 30000) === g.at(11) + press[0] + 5);
  const rel = releaseAt(7, g, hearing);
  ok('a release comes after its tick\'s sound onset, so the door was shut on the tick', rel >= g.at(7) + hearing.door.releaseAfterOnsetMs);
  ok('and the door reads open before the back\'s slot closes', rel + hearing.door.openAfterReleaseMs[1] <= g.at(7) + press[1]);
  ok('an idle hold ends inside the stillness fuse', hearing.idle.holdCapS + g.periodMs / 1000 + hearing.door.openAfterReleaseMs[1] / 1000 < hearing.idle.stillS);
}

// --- Night 5's detector matches only his families --------------------------------------
{
  const { cueArgs, FREDBEAR_ONLY_FAMILIES } = await import('./fnaf4-run.ts');
  const n5 = cueArgs('/tmp/x', 5);
  ok('Night 5 spawns the detector with his families and no breathing',
    n5.includes('--no-breath') && n5[n5.indexOf('--families') + 1] === FREDBEAR_ONLY_FAMILIES.join(','));
  ok('his families are the hearing model\'s plus our own run',
    [...FREDBEAR_ONLY_FAMILIES].sort().join(',') === ['run', ...Object.keys(hearing.families)].sort().join(','));
  for (const night of [1, 4, 6, 7, 8, null]) {
    ok(`night ${night} keeps every family and the breathing`, !cueArgs('/tmp/x', night).includes('--families') && !cueArgs('/tmp/x', night).includes('--no-breath'));
  }
  ok('the detector is bound to the hearing model', n5.includes('--hearing'));
}

// --- a hold is ONE contact ------------------------------------------------------------
{
  const lines: { command: string, report: number[] }[] = [];
  const naps = interruptibleSleep();
  const hid = new HidWireTransport({ write: async (l) => { lines.push(JSON.parse(l)); }, sleep: naps.sleep, contactMs: 160 });
  const record0 = fakeOf<RunRecord>({ document: { inputsSent: 0 }, event: async () => ({}) });
  const act = new Actor(hid, record0, 160, { interrupt: naps.interrupt });
  const t0 = Date.now();
  let polls = 0;
  const r = await act.holdWhile('closeDoor', { x: 1990, y: 900 }, 5000, () => (++polls >= 4 ? 'moved' : null), { pollMs: 25 });
  const reports = lines.filter((l) => l.command === 'report');
  const downs = reports.filter((l) => l.report[2] === 3).length;
  const ups = reports.filter((l) => l.report[2] === 0).length;
  ok(`a stopped hold is one DOWN and one UP (${downs}/${ups})`, downs === 1 && ups === 1);
  ok(`it lets go when told (${r.why} after ${Date.now() - t0} ms)`, r.why === 'moved' && Date.now() - t0 < 1000);
  lines.length = 0;
  const r2 = await act.holdWhile('closeDoor', { x: 1990, y: 900 }, 200, () => null, { pollMs: 25 });
  const reports2 = lines.filter((l) => l.command === 'report');
  ok(`a hold that runs out is one contact too (${reports2.length} reports, ${r2.why})`, reports2.length === 2 && r2.why === 'max');
  let refused = false;
  try { await new Actor(hid, record0, 160).holdWhile('x', { x: 1, y: 1 }, 100, () => null); } catch { refused = true; }
  ok('holdWhile refuses a transport it cannot interrupt', refused);
}

console.log(`test-fnaf4-fredbear: ${checks - failures.length}/${checks} checks passed`);
for (const f of failures) console.log(`FAIL ${f}`);
process.exit(failures.length ? 1 : 0);
