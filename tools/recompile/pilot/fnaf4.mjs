// FNaF 4 on the rebuilt runtime, driven through the harness pilot channel.
// Object names are the sheets' own (fnaf-apks/fnaf4/events/); frame indices
// are the rebuild's (1 title, 2 what night, 3 level, 4 game over, 5 night
// win, 10 extras, 15 nightmare jumpscare).
import { appendFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

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
export const WATCH = [
  'btnMain04_Extra.Active', 'btnMain06_Nightmare.Active', 'btnNightmare_Start.Active', 'selection',
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

export const POLICIES = { nav, survey, survey2 };
