// FNaF 4 on the rebuilt runtime, driven through the harness pilot channel.
// Object names are the sheets' own (fnaf-apks/fnaf4/events/); frame indices
// are the rebuild's (1 title, 2 what night, 3 level, 4 game over, 5 night
// win, 10 extras, 15 nightmare jumpscare).
import { appendFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readRows } from './pilot.ts';

export const SAVE_NAME = 'fn4';
export const TITLE = 1;
export const LEVEL = 3;
export const EXTRAS = 10;
export const WINDOW = { w: 1024, h: 768 };
export const MAX_INSTANCES = 16;

export const MARKERS = ['living room left', 'living room center', 'living room right', 'kitchen', 'in closet', 'on bed',
  'left hall far', 'right hall far', 'left hall near', 'right hall near'];
export const ACTORS = ['foxy', 'Bonnie', 'Chica', 'Fredbear'];
export const HUD = ['HUDDoorLeftHitzone.Active', 'HUDDoorRightHitzone.Active', 'HUDDoorClosetHitzone.Active',
  'HUDGoBackHitzone.Active', 'HUDResetHitzone.Active', 'HUDFlashlightHitzone.Active', 'HUDCloseDoorHitzone.Active'];
export const COUNTERS = ['Freddy counter', 'listening mode', 'viewing left hall', 'viewing right hall', 'viewing bed',
  'viewing closet', 'left door shut', 'right door shut', 'gameover', 'foxy got you', 'got you', 'hour', 'shadow',
  'Foxy AI', 'Chica AI', 'Bonnie AI', 'Freddy AI', 'Fredbear AI', 'Night', 'force turn', 'fredcheck', 'what side',
  'bonnie danger', 'chica danger', 'foxy danger', 'freddy danger', 'fredbear danger', 'total danger', 'random',
  'challenge mode', 'cheat mode', 'any cheats?'];
export const CHALLENGES = ['btnMain08_Challenges.Active', 'btnChallenge01_Blind.Active', 'btnChallenge02_MadFreddy.Active',
  'btnChallenge03_InstaFoxy.Active', 'btnChallenge04_AllNightmare.Active', 'btnChallenge01_Blind_Checkmark.Active',
  'btnChallenge02_MadFreddy_Checkmark.Active', 'btnChallenge03_InstaFoxy_Checkmark.Active',
  'btnChallenge04_AllNightmare_Checkmark.Active'];
export const WATCH = [
  'btnMain02_Continue.Active', 'btnMain04_Extra.Active', 'btnMain06_Nightmare.Active', 'btnNightmare_Start.Active', 'selection', ...CHALLENGES,
  'beat 6', 'beat 7', 'beat 8', 'Multiple Touch', 'follow', 'black flash', 'Active_room',
  ...MARKERS, ...ACTORS, ...HUD, ...COUNTERS,
];

export function view(s) {
  const all = (n) => s.o[n] ?? [];
  const one = (n) => all(n)[0] ?? null;
  const al = (n, i) => one(n)?.al?.[i] ?? 0;
  const cv = (n) => one(n)?.cv ?? null;
  return { s, all, one, al, cv, frame: s.f, tick: s.t };
}
const inWindow = (c) => c && c[0] >= 0 && c[0] < WINDOW.w && c[1] >= 0 && c[1] < WINDOW.h;

/** nav: title -> Extras -> Nightmare x8 -> Start, logging each frame's watched state. */
function nav({ run }) {
  const out = join(run, 'nav.jsonl');
  writeFileSync(out, '');
  const log = (o) => appendFileSync(out, JSON.stringify(o) + '\n');
  let queue = [];
  let lastFrame = null, frameStart = 0, taps = 0;
  const tap = (v, name, delay = 0) => {
    const o = v.one(name);
    if (!o || !inWindow(o.c)) { log({ t: v.tick, f: v.frame, miss: name, c: o?.c }); return; }
    queue.push({ at: delay, cmd: `down 0 ${o.c[0]} ${o.c[1]}` }, { at: delay + 3, cmd: 'up 0' });
  };
  return {
    step(s) {
      const v = view(s);
      if (s.f !== lastFrame) { log({ t: s.t, f: s.f, enter: true }); lastFrame = s.f; frameStart = 0; }
      frameStart += 1;
      if (s.f === TITLE && s.t === 300) tap(v, 'btnMain04_Extra.Active');
      if (s.f === EXTRAS) {
        if (s.t === 200) tap(v, 'btnMain06_Nightmare.Active');
        if (s.t >= 260 && s.t < 260 + 20 * 9 && (s.t - 260) % 20 === 0) tap(v, 'btnMain06_Nightmare.Active');
        if (s.t === 500) tap(v, 'btnNightmare_Start.Active');
        if (s.t % 20 === 0 && s.t <= 600) log({ t: s.t, f: s.f, sel: v.cv('selection'), shadow: v.cv('shadow'),
          nm: v.one('btnMain06_Nightmare.Active')?.al, start: v.one('btnNightmare_Start.Active')?.v,
          b7: v.cv('beat 7'), b8: v.cv('beat 8') });
      }
      if (s.f === LEVEL && s.t === 5) { log({ t: s.t, f: s.f, night: v.cv('Night'), shadow: v.cv('shadow'), cheats: v.cv('any cheats?') }); this.done = true; }
      const out2 = [];
      queue = queue.filter((q) => (q.at <= 0 ? (out2.push(q.cmd), false) : (q.at -= 1, true)));
      return out2;
    },
  };
}

const overlaps = (a, b) => a && b && a.box && b.box &&
  a.box[0] < b.box[2] && b.box[0] < a.box[2] && a.box[1] < b.box[3] && b.box[1] < a.box[3];
/** Which map marker each actor stands on. */
export function places(v) {
  const out = {};
  for (const a of ACTORS) {
    const o = v.one(a);
    out[a] = o ? (MARKERS.find((m) => overlaps(o, v.one(m))) ?? 'away') : null;
  }
  return out;
}

/** The Night 8 menu path as a reusable driver: returns commands for title/extras frames, null elsewhere. */
export function menuNight8() {
  let queue = [];
  const tap = (v, name, delay = 0) => {
    const o = v.one(name);
    if (!o || !inWindow(o.c)) return;
    queue.push({ at: delay, cmd: `down 0 ${o.c[0]} ${o.c[1]}` }, { at: delay + 3, cmd: 'up 0' });
  };
  return (s, v) => {
    if (s.f === TITLE && s.t === 300) tap(v, 'btnMain04_Extra.Active');
    if (s.f === EXTRAS) {
      if (s.t === 200) tap(v, 'btnMain06_Nightmare.Active');
      if (s.t >= 260 && s.t < 260 + 20 * 9 && (s.t - 260) % 20 === 0) tap(v, 'btnMain06_Nightmare.Active');
      if (s.t === 500) tap(v, 'btnNightmare_Start.Active');
    }
    const out = [];
    queue = queue.filter((q) => (q.at <= 0 ? (out.push(q.cmd), false) : (q.at -= 1, true)));
    return out;
  };
}

/** The story path: Continue on the title plays the save's own night (its `night` key). */
export function menuContinue() {
  let queue = [];
  return (s, v) => {
    if (s.f === TITLE && s.t === 300) {
      const o = v.one('btnMain02_Continue.Active');
      if (o && inWindow(o.c)) queue.push({ at: 0, cmd: `down 0 ${o.c[0]} ${o.c[1]}` }, { at: 3, cmd: 'up 0' });
    }
    const out = [];
    queue = queue.filter((q) => (q.at <= 0 ? (out.push(q.cmd), false) : (q.at -= 1, true)));
    return out;
  };
}

/**
 * still: the save's story night with no touch in the level -- or, given
 * `knobs.input` (CHOWDREN_INPUT rows), exactly those level rows -- with
 * Fredbear's place and the station counters logged on change. What the stream
 * does on its own or under a recorded night's touches, for reading the level's
 * random draws per update from the trace beside where he lands.
 */
function still({ run, knobs }) {
  const out = join(run, 'still.jsonl');
  writeFileSync(out, '');
  const log = (o) => appendFileSync(out, JSON.stringify(o) + '\n');
  const menu = menuContinue();
  // The harness applies a reply's touches on the next update: a row at (LEVEL, t) answers state t - 1.
  const rows = knobs?.input ? readRows(knobs.input).filter((r) => r.f === LEVEL) : [];
  let next = 0, last = null;
  return {
    step(s) {
      const v = view(s);
      if (s.f !== LEVEL) {
        if (s.f === 4 || s.f === 15) { log({ t: s.t, f: s.f, dead: true }); this.done = true; }
        return menu(s, v);
      }
      const rec = { at: places(v), listening: v.cv('listening mode'), leftShut: v.cv('left door shut'),
        rightShut: v.cv('right door shut'), gameover: v.cv('gameover') };
      const key = JSON.stringify(rec);
      if (key !== last) { log({ t: s.t, ...rec }); last = key; }
      const cmds = [];
      while (next < rows.length && rows[next].t <= s.t + 1) cmds.push(rows[next++].cmd);
      return cmds;
    },
  };
}

/**
 * The Night 7 challenge path (needs `beat8=1`): Extras -> Challenges ->
 * each named challenge (groups 197-200; a 10-frame cooldown between toggles,
 * g207) -> Nightmare -> Start. With `beat 8` = 1 the 20/20/20/20 arming
 * (groups 104/105) is closed, so Start plays Night 7 (`shadow` 1).
 */
export function menuChallenges(names) {
  let queue = [];
  const tap = (v, name, delay = 0) => {
    const o = v.one(name);
    if (!o || !inWindow(o.c)) return;
    queue.push({ at: delay, cmd: `down 0 ${o.c[0]} ${o.c[1]}` }, { at: delay + 3, cmd: 'up 0' });
  };
  return (s, v) => {
    if (s.f === TITLE && s.t === 300) tap(v, 'btnMain04_Extra.Active');
    if (s.f === EXTRAS) {
      if (s.t === 200) tap(v, 'btnMain08_Challenges.Active');
      names.forEach((n, i) => { if (s.t === 260 + 40 * i) tap(v, `btnChallenge0${n}.Active`); });
      if (s.t === 460) tap(v, 'btnMain06_Nightmare.Active');
      if (s.t === 520) tap(v, 'btnNightmare_Start.Active');
    }
    const out = [];
    queue = queue.filter((q) => (q.at <= 0 ? (out.push(q.cmd), false) : (q.at -= 1, true)));
    return out;
  };
}

/** survey: in the level, each station and control in turn; state logged on change. */
function survey({ run }) {
  const out = join(run, 'survey.jsonl');
  writeFileSync(out, '');
  const log = (o) => appendFileSync(out, JSON.stringify(o) + '\n');
  const menu = menuNight8();
  let queue = [];
  const press = (v, name, holdTicks = 3, delay = 0) => {
    const o = v.one(name);
    if (!o || !inWindow(o.c)) { log({ t: v.tick, miss: name, c: o?.c }); return; }
    queue.push({ at: delay, cmd: `down 0 ${o.c[0]} ${o.c[1]}` }, { at: delay + holdTicks, cmd: 'up 0' });
  };
  const script = [
    [60, 'left door', (v) => press(v, 'HUDDoorLeftHitzone.Active')],
    [260, 'light 60', (v) => press(v, 'HUDFlashlightHitzone.Active', 60)],
    [360, 'close 120', (v) => press(v, 'HUDCloseDoorHitzone.Active', 120)],
    [520, 'back', (v) => press(v, 'HUDGoBackHitzone.Active')],
    [720, 'closet', (v) => press(v, 'HUDDoorClosetHitzone.Active')],
    [920, 'close closet 60', (v) => press(v, 'HUDCloseDoorHitzone.Active', 60)],
    [1000, 'light closet 30', (v) => press(v, 'HUDFlashlightHitzone.Active', 30)],
    [1060, 'back', (v) => press(v, 'HUDGoBackHitzone.Active')],
    [1260, 'back at hub (bed?)', (v) => press(v, 'HUDGoBackHitzone.Active')],
    [1400, 'light bed 60', (v) => press(v, 'HUDFlashlightHitzone.Active', 60)],
    [1500, 'back', (v) => press(v, 'HUDGoBackHitzone.Active')],
    [1700, 'right door', (v) => press(v, 'HUDDoorRightHitzone.Active')],
    [1900, 'light 60', (v) => press(v, 'HUDFlashlightHitzone.Active', 60)],
    [2000, 'close 60', (v) => press(v, 'HUDCloseDoorHitzone.Active', 60)],
    [2100, 'back', (v) => press(v, 'HUDGoBackHitzone.Active')],
  ];
  let next = 0, last = null;
  return {
    step(s) {
      const v = view(s);
      if (s.f !== LEVEL) {
        if (s.f === 4 || s.f === 15) { log({ t: s.t, f: s.f, dead: true }); this.done = true; }
        return menu(s, v);
      }
      while (next < script.length && s.t >= script[next][0]) {
        log({ t: s.t, action: script[next][1] });
        script[next][2](v);
        next += 1;
      }
      const c = {};
      for (const n of COUNTERS) c[n] = v.cv(n);
      const rec = { follow: v.al('follow', 0), followX: v.one('follow')?.x, at: places(v), freddy: Math.round(c['Freddy counter']),
        ...Object.fromEntries(Object.entries(c).filter(([k]) => k !== 'Freddy counter')) };
      const key = JSON.stringify(rec);
      if (key !== last || s.t % 300 === 0) { log({ t: s.t, ...rec, hud: s.t === 30 || s.t === 300 ? Object.fromEntries(HUD.map((h) => [h, v.one(h)?.c])) : undefined }); last = key; }
      if (s.t > 2400) this.done = true;
      const cmds = [];
      queue = queue.filter((q) => (q.at <= 0 ? (cmds.push(q.cmd), false) : (q.at -= 1, true)));
      return cmds;
    },
  };
}

/** survey2: the double-tap walks and the station controls, HUD centres logged at each facing. */
function survey2({ run }) {
  const out = join(run, 'survey.jsonl');
  writeFileSync(out, '');
  const log = (o) => appendFileSync(out, JSON.stringify(o) + '\n');
  const menu = menuNight8();
  let queue = [];
  const at = (delay, cmd) => queue.push({ at: delay, cmd });
  const press = (v, name, holdTicks = 3, delay = 0) => {
    const o = v.one(name);
    if (!o || !inWindow(o.c)) { log({ t: v.tick, miss: name, c: o?.c }); return; }
    at(delay, `down 0 ${o.c[0]} ${o.c[1]}`); at(delay + holdTicks, 'up 0');
  };
  const double = (v, name) => { press(v, name, 3, 0); press(v, name, 3, 8); };
  const script = [
    [60, 'walk left door', (v) => double(v, 'HUDDoorLeftHitzone.Active')],
    [300, 'light 30', (v) => press(v, 'HUDFlashlightHitzone.Active', 30)],
    [360, 'close 100', (v) => press(v, 'HUDCloseDoorHitzone.Active', 100)],
    [500, 'back', (v) => press(v, 'HUDGoBackHitzone.Active')],
    [700, 'turn right', (v) => press(v, 'HUDCloseDoorHitzone.Active')],
    [800, 'walk right door', (v) => double(v, 'HUDDoorRightHitzone.Active')],
    [1040, 'light 30', (v) => press(v, 'HUDFlashlightHitzone.Active', 30)],
    [1100, 'close 100', (v) => press(v, 'HUDCloseDoorHitzone.Active', 100)],
    [1240, 'back', (v) => press(v, 'HUDGoBackHitzone.Active')],
    [1440, 'walk closet', (v) => double(v, 'HUDDoorClosetHitzone.Active')],
    [1680, 'close closet 80', (v) => press(v, 'HUDCloseDoorHitzone.Active', 80)],
    [1780, 'light closet 30', (v) => press(v, 'HUDFlashlightHitzone.Active', 30)],
    [1840, 'back', (v) => press(v, 'HUDGoBackHitzone.Active')],
    [2040, 'bed', (v) => press(v, 'HUDGoBackHitzone.Active')],
    [2140, 'light bed 100', (v) => press(v, 'HUDFlashlightHitzone.Active', 100)],
    [2260, 'back', (v) => press(v, 'HUDGoBackHitzone.Active')],
  ];
  let next = 0, last = null, lastFollow = null;
  return {
    step(s) {
      const v = view(s);
      if (s.f !== LEVEL) {
        if (s.f === 4 || s.f === 15) { log({ t: s.t, f: s.f, dead: true }); this.done = true; }
        return menu(s, v);
      }
      while (next < script.length && s.t >= script[next][0]) {
        log({ t: s.t, action: script[next][1] });
        script[next][2](v);
        next += 1;
      }
      const follow = v.al('follow', 0);
      if (follow !== lastFollow) {
        log({ t: s.t, follow, x: v.one('follow')?.x, hud: Object.fromEntries(HUD.map((h) => [h, v.one(h)?.c])) });
        lastFollow = follow;
      }
      const rec = { at: places(v), freddy: Math.round(v.cv('Freddy counter')), lds: v.cv('left door shut'), rds: v.cv('right door shut'),
        vlh: v.cv('viewing left hall'), vrh: v.cv('viewing right hall'), vb: v.cv('viewing bed'), vc: v.cv('viewing closet'),
        listen: v.cv('listening mode'), gameover: v.cv('gameover'), foxyAV2: v.one('foxy')?.al?.[2] ?? 0 };
      const key = JSON.stringify(rec);
      if (key !== last) { log({ t: s.t, ...rec }); last = key; }
      if (s.t > 2500) this.done = true;
      const cmds = [];
      queue = queue.filter((q) => (q.at <= 0 ? (cmds.push(q.cmd), false) : (q.at -= 1, true)));
      return cmds;
    },
  };
}

// --- warden: the controller -----------------------------------------------

const LEFT_DOOR = 10, RIGHT_DOOR = 17, CLOSET = 29, BED = 43;
const HUB = new Set([0, 2, 5]);
const FLASH = 'HUDFlashlightHitzone.Active', CLOSE = 'HUDCloseDoorHitzone.Active', BACK = 'HUDGoBackHitzone.Active';

function* hold(n) { for (let i = 0; i < n; i += 1) yield []; }
function* until(ctx, pred, max) { for (let i = 0; i < max && !pred(ctx.v); i += 1) yield []; }
const centre = (v, name) => { const o = v.one(name); return o && inWindow(o.c) ? o.c : null; };
function* tapName(ctx, name, ticks = 3) {
  const c = centre(ctx.v, name);
  if (!c) { ctx.log({ miss: name }); return false; }
  yield [`down 0 ${c[0]} ${c[1]}`]; yield* hold(ticks - 1); yield ['up 0'];
  return true;
}
function* doubleTap(ctx, name) {
  const c = centre(ctx.v, name);
  if (!c) { ctx.log({ miss: name }); return false; }
  yield [`down 0 ${c[0]} ${c[1]}`]; yield* hold(2); yield ['up 0']; yield* hold(4);
  const c2 = centre(ctx.v, name) ?? c;
  yield [`down 0 ${c2[0]} ${c2[1]}`]; yield* hold(2); yield ['up 0'];
  return true;
}
/** Hold a HUD zone while `keep` holds, up to `max` updates. */
function* holdZone(ctx, name, keep, max) {
  const c = centre(ctx.v, name);
  if (!c) { ctx.log({ miss: name }); return; }
  yield [`down 0 ${c[0]} ${c[1]}`];
  for (let i = 0; i < max && keep(ctx.v); i += 1) yield [];
  yield ['up 0'];
  yield* hold(2);
}

/**
 * Where a lost night's chain began, for search.ts: the first logged update
 * with the Freddy counter past 53 (from there the bed kills on arrival,
 * g427/g428, and away from it the counter climbs to the black flash), with
 * Foxy's got-you set (g282), or with the black flash counting (g468).
 * `records` are the warden log's lines, parsed.
 */
export function doomStart(records) {
  const r = records.find((x) => x.at && (x.freddy > 53 || x.foxyGot === 1 || x.flash > 0));
  return r ? r.t : null;
}

export function facts4(v) {
  const at = places(v);
  const al = (n, i) => v.one(n)?.al?.[i] ?? 0;
  return {
    at, follow: v.al('follow', 0), freddy: v.cv('Freddy counter') ?? 0, hour: v.cv('hour'),
    fredbearAI: v.cv('Fredbear AI') ?? 0, interlock: al('in closet', 5),
    bTag: al('Bonnie', 5), cTag: al('Chica', 5), bDwell: al('Bonnie', 6), cDwell: al('Chica', 6),
    bBed: al('Bonnie', 7), cBed: al('Chica', 7), foxy: al('foxy', 2), foxyGot: v.cv('foxy got you'),
    fbHall: al('Fredbear', 19), fbBed: al('Fredbear', 6), fbIdle: al('Fredbear', 12), fbView: Math.max(al('Fredbear', 8), al('Fredbear', 9)),
    idle: al('Fredbear', 13), freddyAI: v.cv('Freddy AI') ?? 0, flash: al('black flash', 3), fbAV4: al('Fredbear', 4), fbAV7: al('Fredbear', 7), lds: v.cv('left door shut'), rds: v.cv('right door shut'), gameover: v.cv('gameover'),
  };
}

/**
 * `rev` 1 is the warden the committed records name; `warden2` (rev 2) fixes
 * the two deaths of its 300-seed development block (seeds 0-299, 57 lost):
 * - 53 were a near occupant never shut out: with Foxy far in the same hall the
 *   flash branch came first, and a flash with the occupant near returns at
 *   once, so the door was never shut and the dwell ran to the black flash
 *   (g468). Rev 2 shuts the door on a near occupant first.
 * - 4 walked to the bed with the Freddy counter at 60 or more, which ends the
 *   night at the bed (g427/g428). The bed was blocked because Chica's dwell,
 *   once 20 or more, survives her leaving the hall (g478 resets only below 20)
 *   and clears only while her hall is viewed (g481). Rev 2 views a hall whose
 *   occupant has gone but whose dwell stands, unblocks the bed before Freddy
 *   gets close, and never starts the walk to the bed at a count one Freddy
 *   tick (g397) could carry past 59.
 * `warden3` (rev 3) adds the loss both of rev 2's held-out losses share
 * (seeds 30820 and 31175): Chica's dwell of 20, standing since before 4 AM
 * while she is away, makes the bed deadly (g480, then g375 on leaving it), and
 * Fredbear on the bed sends the warden there. After 4 AM rev 3 views the right
 * hall whenever her dwell stands and Fredbear is not on the bed, in the closet
 * or in the right hall (g481).
 */
function warden({ run, knobs }, rev = 1) {
  const out = join(run, 'warden.jsonl');
  writeFileSync(out, '');
  // knobs.quiet keeps the last 200 records in memory and writes them when the
  // night ends, for batch runs over many seeds.
  const ring = [];
  const ctx: any = { v: null, log: (o) => {
    const line = JSON.stringify({ t: ctx.v?.tick, ...o });
    if (!knobs.quiet) appendFileSync(out, line + '\n');
    else { ring.push(line); if (ring.length > 200) ring.shift(); }
  } };
  const flush = () => { if (knobs.quiet && ring.length) { appendFileSync(out, ring.join('\n') + '\n'); ring.length = 0; } };
  const menu = knobs.challenges ? menuChallenges(knobs.challenges) : menuNight8();
  let loggedLevel = false;
  let task = null, taskName = null, last = null, outcome = null;
  // Every play-frame update a task started on, for search.ts: the quiet log
  // keeps only its last 200 records.
  const starts = [];
  // rev 3 takes the knobs rev 2's development block chose (bedAt 24, foxyTo 3).
  const bedAt = knobs.bedAt ?? (rev >= 3 ? 24 : 32), foxyAt = knobs.foxyAt ?? 6;

  const STATIONS = [LEFT_DOOR, RIGHT_DOOR, CLOSET, BED];
  function* toHub() {
    // Let a station action (door close 20-25, flash 35-41, closet 32-34)
    // finish first: only a station or the hub takes the next control.
    yield* until(ctx, (v) => HUB.has(v.al('follow', 0)) || STATIONS.includes(v.al('follow', 0)), 90);
    for (let attempt = 0; attempt < 3 && !HUB.has(ctx.v.al('follow', 0)); attempt += 1) {
      if (STATIONS.includes(ctx.v.al('follow', 0))) yield* tapName(ctx, BACK);
      yield* until(ctx, (v) => HUB.has(v.al('follow', 0)), 150);
    }
  }
  function* face(side) {
    yield* toHub();
    const want = side === 'left' ? 2 : 5;
    const endX = side === 'left' ? 512 : 788;
    const done = (v) => v.al('follow', 0) === want && v.one('follow')?.x === endX;
    if (done(ctx.v)) return;
    // A held touch pans the hub view only while it is held (g21-g25: x < 205
    // at -12, x > 819 at +12 a frame, clamped to 512..788); y 120 is above
    // every hitzone. Hold to the clamp, then let the turn animation settle.
    const x = side === 'left' ? 60 : 980;
    yield [`down 0 ${x} 120`];
    yield* until(ctx, (v) => v.one('follow')?.x === endX, 60);
    yield ['up 0'];
    yield* until(ctx, done, 40);
  }
  function* door(side) {
    const target = side === 'left' ? LEFT_DOOR : RIGHT_DOOR;
    if (ctx.v.al('follow', 0) === target) return;
    for (let attempt = 0; attempt < 3 && ctx.v.al('follow', 0) !== target; attempt += 1) {
      yield* face(side);
      yield* hold(4);
      yield* doubleTap(ctx, side === 'left' ? 'HUDDoorLeftHitzone.Active' : 'HUDDoorRightHitzone.Active');
      yield* until(ctx, (v) => v.al('follow', 0) === target || v.al('follow', 0) === (side === 'left' ? 7 : 14), 30);
      yield* until(ctx, (v) => v.al('follow', 0) === target, 240);
    }
  }
  function* closet() {
    if (ctx.v.al('follow', 0) === CLOSET) return;
    yield* toHub();
    if (ctx.v.al('follow', 0) !== 0) {
      // The closet walk needs the centre facing (g172): catch it mid-turn.
      // Hold the pan until the turn passes through the centre state 0.
      const x = ctx.v.al('follow', 0) === 2 ? 980 : 60;
      yield [`down 0 ${x} 120`];
      yield* until(ctx, (v) => v.al('follow', 0) === 0, 30);
      yield ['up 0'];
    }
    yield* doubleTap(ctx, 'HUDDoorClosetHitzone.Active');
    yield* until(ctx, (v) => v.al('follow', 0) === CLOSET, 240);
  }
  function* bed() {
    if (ctx.v.al('follow', 0) === BED) return;
    yield* toHub();
    yield* tapName(ctx, BACK);
    yield* until(ctx, (v) => v.al('follow', 0) === BED, 90);
  }

  function* flashAt(side) {
    yield* door(side);
    const hallFar = side === 'left' ? 'left hall far' : 'right hall far';
    const near = side === 'left' ? 'left hall near' : 'right hall near';
    const occupantNear = (v) => Object.values(places(v)).includes(near);
    if (occupantNear(ctx.v)) return;
    yield* holdZone(ctx, FLASH, (v) => Object.values(places(v)).includes(hallFar) && !occupantNear(v), 20);
  }
  function* dismiss(side) {
    yield* door(side);
    const who = side === 'left' ? 'Bonnie' : 'Chica';
    const near = side === 'left' ? 'left hall near' : 'right hall near';
    yield* holdZone(ctx, CLOSE, (v) => places(v)[who] === near, 400);
  }
  function* drainFreddy() {
    yield* bed();
    yield* holdZone(ctx, FLASH, (v) => (v.cv('Freddy counter') ?? 0) > 1 && facts4(v).bDwell <= 11 && facts4(v).cDwell <= 10, 240);
  }
  function* serviceCloset() {
    yield* closet();
    yield* holdZone(ctx, CLOSE, (v) => (v.one('foxy')?.al?.[2] ?? 0) > (knobs.foxyTo ?? (rev >= 3 ? 3 : 1)) && (places(v) as any).foxy === 'in closet'
      && (v.cv('Freddy counter') ?? 0) < (knobs.bedUrgent ?? 42) + 2, 600);
  }
  function* listen(side) { yield* door(side); yield* hold(10); }
  // View a hall whose occupant has left while its dwell stands (g481/g485
  // zero it while the hall is viewed); a near occupant ends the hold, since
  // a light on a near occupant is a jumpscare (g345/g346).
  function* clearHall(side) {
    yield* door(side);
    const who = side === 'left' ? 'Bonnie' : 'Chica';
    const near = side === 'left' ? 'left hall near' : 'right hall near';
    const dwell = (v) => (side === 'left' ? facts4(v).bDwell : facts4(v).cDwell);
    yield* holdZone(ctx, FLASH, (v) => dwell(v) > 0 && places(v)[who] !== near && !Object.values(places(v)).includes(near), 12);
  }

  function decide() {
    const f = facts4(ctx.v);
    if (knobs.probe) {
      const n = (ctx.probeN = (ctx.probeN ?? 0) + 1);
      return n % 2 ? [`probe left ${n}`, door('left')] : [`probe right ${n}`, door('right')];
    }
    const at: any = f.at;
    if (f.fredbearAI > 0) return decideFredbear(f);
    const here = f.follow === LEFT_DOOR ? 'left' : f.follow === RIGHT_DOOR ? 'right' : null;
    const other = (side) => (side === 'left' ? 'right' : 'left');
    const bedSafe = f.bDwell <= 10 && f.cDwell <= 9;
    const nearOK = (side) => (side === 'left' ? f.bTag : f.cTag) === 2 && f.interlock === 0;
    const who = { left: 'Bonnie', right: 'Chica' };
    const threat = (side) => {
      const p = at[who[side]];
      if (p === `${side} hall near`) return 3;
      if (p === `${side} hall far` || at.foxy === `${side} hall far`) return 2;
      if (p === `living room ${side}`) return 1;
      return 0;
    };
    const dwell = { left: f.bDwell, right: f.cDwell };
    if (rev >= 2) {
      // Local work first, at the door we stand at: shut out a near occupant
      // (g342/g344), flash a far one (g84/g135, g83/g134), and view a hall
      // whose dwell outlived its occupant (g478/g481).
      if (here) {
        const w = at[who[here]];
        const nearHere = Object.values(at).includes(`${here} hall near`);
        if (w === `${here} hall near`) { if (nearOK(here)) return [`dismiss ${here}`, dismiss(here)]; }
        else if (!nearHere && (w === `${here} hall far` || at.foxy === `${here} hall far`)) return [`flash ${here}`, flashAt(here)];
        else if (!nearHere && dwell[here] > 0 && w !== `${here} hall far`) return [`clear ${here}`, clearHall(here)];
      }
      const foxyIn2 = at.foxy === 'in closet';
      // g397 adds Freddy AI every 4 s off the bed, and the walk to the bed is
      // under 4 s, so at most one tick lands before arrival.
      const bedMax = 59 - Math.max(f.freddyAI, 1);
      const walkable = f.freddy <= bedMax;
      if (f.freddy >= (knobs.bedUrgent ?? 42) && bedSafe && walkable) return ['bed', drainFreddy()];
      if (f.foxy >= (knobs.foxyUrgent ?? 8) && foxyIn2) return ['closet', serviceCloset()];
      if (f.freddy >= bedAt && bedSafe && walkable) return ['bed', drainFreddy()];
      // The bed is blocked by a dwell: go and clear the side that blocks it.
      if (f.freddy >= bedAt && !bedSafe && walkable) {
        const side = f.cDwell > 9 ? 'right' : 'left';
        if (here !== side) return [`unblock ${side}`, door(side)];
      }
      if (f.foxy >= foxyAt && foxyIn2) return ['closet', serviceCloset()];
      const target2 = here ? other(here) : (threat('right') > threat('left') ? 'right' : 'left');
      return [`go ${target2}`, door(target2)];
    }
    // Local work first, at the door we stand at: flash a far occupant
    // (g84/g135, g83/g134), dismiss a near one (g342/g344).
    if (here) {
      const w = at[who[here]];
      if (w === `${here} hall far` || (at.foxy === `${here} hall far`)) return [`flash ${here}`, flashAt(here)];
      if (w === `${here} hall near` && nearOK(here)) return [`dismiss ${here}`, dismiss(here)];
    }
    const foxyIn = at.foxy === 'in closet';
    if (f.freddy >= (knobs.bedUrgent ?? 42) && bedSafe) return ['bed', drainFreddy()];
    if (f.foxy >= (knobs.foxyUrgent ?? 8) && foxyIn) return ['closet', serviceCloset()];
    if (f.freddy >= bedAt && bedSafe) return ['bed', drainFreddy()];
    if (f.foxy >= foxyAt && foxyIn) return ['closet', serviceCloset()];
    // Ping-pong: go to the other door when its side needs a visit, or before
    // the idle accelerant (g593, AV13 >= 30) starts.
    const target = here ? other(here) : (threat('right') > threat('left') ? 'right' : 'left');
    return [`go ${target}`, door(target)];
  }

  function decideFredbear(f) {
    const at = f.at.Fredbear;
    const sideOf = (p) => (p && p.includes('left') ? 'left' : p && p.includes('right') ? 'right' : null);
    // On the bed: look at him until he leaves (g525-g527, AV7 > 1).
    if (at === 'on bed') return ['fredbear bed', (function* () {
      yield* bed(); yield* holdZone(ctx, FLASH, (v) => (places(v) as any).Fredbear === 'on bed', 300); })()];
    // In the closet: hold its door until the 3 s tick walks him out (g522/g523).
    if (at === 'in closet') return ['fredbear closet', (function* () {
      yield* closet(); yield* holdZone(ctx, CLOSE, (v) => (places(v) as any).Fredbear === 'in closet', 400); })()];
    const side = sideOf(at);
    const far = at === 'left hall far' ? 'left' : at === 'right hall far' ? 'right' : null;
    // At a far hall: shut that door; the 3 s tick pushes him off (g502/g503)
    // inside the 8 s hall fuse (g646-g648).
    if (far) return [`fredbear ${far}`, (function* () {
      yield* door(far);
      yield* holdZone(ctx, CLOSE, (v) => (places(v) as any).Fredbear === `${far} hall far`, 600);
    })()];
    // rev 3: with Fredbear not on the bed, in the closet or at a far hall,
    // clear a Chica dwell that outlived her (g478/g481) before the bed is needed.
    if (rev >= 3 && f.cDwell > 0 && !(at ?? '').includes('right hall')
      && !Object.values(f.at).includes('right hall near')) return ['clear right (fredbear)', clearHall('right')];
    // Walk before the idle flash (g564, AV12 >= 25): a door walk is a carpet run.
    if (f.fbIdle >= (knobs.fbWalkAt ?? 18)) return [`walk ${side ?? 'left'}`, door(side ?? 'left')];
    // Otherwise wait at the hub facing his side: one door is 2.3 s away, the
    // other a turn and 2.3 s.
    if (!HUB.has(f.follow)) return ['to hub', toHub()];
    if (side && f.follow !== (side === 'left' ? 2 : 5)) return [`face ${side}`, face(side)];
    return ['fredbear wait', (function* () { yield* hold(6); })()];
  }

  return {
    step(s) {
      const v = view(s);
      if (s.f !== LEVEL) {
        if (s.f === 5) { outcome = outcome ?? '6AM'; this.done = true; return []; }
        if (s.f === 4 || s.f === 15) { outcome = outcome ?? `dead in frame ${s.f}`; this.done = true; return []; }
        if (outcome) { this.done = true; return []; }
        return menu(s, v);
      }
      ctx.v = v;
      const f = facts4(v);
      if (!loggedLevel) {
        loggedLevel = true;
        ctx.log({ level: { night: v.cv('Night'), shadow: v.cv('shadow'), cheats: v.cv('any cheats?'),
          challenges: CHALLENGES.filter((n) => n.endsWith('_Checkmark.Active')).map((n) => [n.slice(15, -17), v.al(n, 0)]) } });
      }
      const key = JSON.stringify([f.at, f.follow, Math.floor(f.freddy / 10), f.foxy, f.bTag, f.cTag, f.interlock, f.hour, f.gameover, f.fredbearAI, f.flash > 0, f.fbHall, f.fbBed, f.fbView > 0]);
      if (key !== last || knobs.probe) { ctx.log({ ...f, freddy: Math.round(f.freddy), task: taskName, x: v.one('follow')?.x, mt: v.one('Multiple Touch')?.al }); last = key; }
      if (f.gameover) { outcome = outcome ?? `gameover at ${s.t}`; }
      if (!task) {
        const d = decide();
        if (d) { [taskName, task] = d; ctx.log({ start: taskName }); starts.push(s.t); }
      }
      if (!task) return [];
      const r = task.next();
      if (r.done) { task = null; taskName = null; return []; }
      return r.value ?? [];
    },
    summary: () => { flush(); return { outcome, starts }; },
  };
}

export const POLICIES = { nav, survey, survey2, still, warden, warden2: (o) => warden(o, 2), warden3: (o) => warden(o, 3) };
