// FNaF 3 on the rebuilt runtime, driven through the harness pilot channel.
// Object names are the office sheet's own (fnaf-apks/fnaf3/events/03-04-Office.txt);
// the frame indices are the rebuild's (0 setup, 1 title, 2 what day, 3 office).
import { appendFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const SAVE_NAME = 'freddy3';
export const TITLE = 1;
export const OFFICE = 3;
export const WINDOW = { w: 1024, h: 768 };
export const MAX_INSTANCES = 16;

const CAMS = ['cam 01', 'cam 02', 'cam 03', 'cam 04', 'cam 05', 'cam 06', 'cam 07', 'cam 08', 'cam 09', 'cam 10',
  'cam 11', 'cam 12', 'cam 13', 'cam 14', 'cam 15'];
const STAGES = ['attack stage 1', 'attack stage 2', 'attack stage 3', 'attack stage 4', 'GOT YOU', 'GOT YOU 2'];
export const WATCH = [
  'btn6thNight.Active', 'dhfgh', ...CAMS, ...STAGES,
  'viewing', 'viewing a screen', 'viewing little cam', 'viewing 2', 'you in', 'mon in',
  'what vent is closed', 'going to seal', 'sealing progress', 'seal vent button', 'seal vent text',
  'rebooting', 'progress bar', 'audio text', 'camera text', 'ventilation text', 'reboot all text', 'exit text',
  'audio error', 'camera error', 'ventilation error', 'blackout', 'hallucinating',
  'time of night', 'night number', 'AI', 'move counter', 'aggresive?', 'total turns', 'action selected',
  'play counter', 'play button', 'toggle button', 'flip it out', 'screen two flipper', 'olivier_FlipHitbox.Active',
  'scroll', 'screen2', 'monitor', 'pic random', 'time limit', 'hyper on?', 'office illusion', 'frozen',
  'phantom head', 'golden freddy', 'mangle', 'puppet', 'chica', 'BB', 'forced BB', 'forced chica',
  'forced Marionette', 'forced Golden Freddy', 'forced Mangle', 'scare cooldown', 'force move', 'force to',
  'olivier_cameraHitboxA.Active', 'olivier_cameraHitboxB.Active', 'olivier_btnTouchzone.Active',
  'Multiple Touch', 'olivier_touchDect4.Active', 'olivier_touchDect5.Active', 'olivier_MuteHitbox.Active', 'nose honk',
];

/** Accessors over one pilot state line. */
export function view(s) {
  const all = (n) => s.o[n] ?? [];
  const one = (n) => all(n)[0] ?? null;
  const al = (n, i) => one(n)?.al?.[i] ?? 0;
  const cv = (n) => one(n)?.cv ?? null;
  return { s, all, one, al, cv, frame: s.f, tick: s.t };
}

const overlaps = (a, b) => a && b && a.box && b.box &&
  a.box[0] < b.box[2] && b.box[0] < a.box[2] && a.box[1] < b.box[3] && b.box[1] < a.box[3];

/** Where the radar dot `dhfgh` stands: the cam/vent marker or attack stage it overlaps. */
export function whereIs(v) {
  const dot = v.one('dhfgh');
  if (!dot) return null;
  for (const n of [...STAGES, ...CAMS]) if (overlaps(dot, v.one(n))) return n;
  return 'none';
}

/** A tap queue: `tap` schedules a down now and an up `hold` updates later. */
class Hands {
  constructor() { this.queue = []; this.clock = 0; }
  at(delay, cmd) { this.queue.push({ due: this.clock + delay, cmd }); }
  tapObj(name, index = 0, hold = 3) { this.at(0, `downobj 0 ${index} ${name}`); this.at(hold, 'up 0'); }
  tapXY(x, y, hold = 3) { this.at(0, `down 0 ${x} ${y}`); this.at(hold, 'up 0'); }
  holdXY(x, y, hold) { this.at(0, `down 0 ${x} ${y}`); this.at(hold, 'up 0'); }
  busy() { return this.queue.length > 0; }
  drain() {
    const out = [];
    this.queue = this.queue.filter((q) => (q.due <= this.clock ? (out.push(q.cmd), false) : true));
    this.clock += 1;
    return out;
  }
}

function compact(v) {
  const pick = (n) => { const o = v.one(n); return o ? { v: o.v, c: o.c, al: o.al, cv: o.cv, an: o.an, af: o.af } : null; };
  const rec = { f: v.frame, t: v.tick, off: v.s.off, where: whereIs(v) };
  for (const n of ['viewing', 'viewing a screen', 'viewing 2', 'you in', 'mon in', 'what vent is closed',
    'going to seal', 'rebooting', 'time of night', 'AI', 'move counter', 'aggresive?', 'play counter',
    'toggle button', 'flip it out', 'screen two flipper', 'scroll', 'audio text', 'camera text',
    'ventilation text', 'blackout', 'sealing progress', 'play button', 'progress bar'])
    rec[n] = pick(n);
  rec.flip = v.all('olivier_FlipHitbox.Active').map((o) => ({ c: o.c, al: o.al, af32: o.af32 }));
  return rec;
}

/**
 * survey: 6th Night from the title, then a scripted sequence of office
 * touches, logging the watched state every 10 updates and around each touch.
 */
function survey({ run }) {
  const hands = new Hands();
  const out = join(run, 'survey.jsonl');
  writeFileSync(out, '');
  let officeTicks = 0;
  const script = [
    [120, 'pan right', (h) => h.holdXY(1000, 384, 90)],
    [260, 'monitor tab', (h) => h.tapObj('olivier_FlipHitbox.Active', 1)],
    [400, 'cam 10', (h) => h.tapObj('cam 10')],
    [500, 'cam 09', (h) => h.tapObj('cam 09')],
    [600, 'toggle map', (h) => h.tapObj('toggle button')],
    [700, 'cam 14 (vent)', (h) => h.tapObj('cam 14')],
    [760, 'seal', (h) => { h.tapObj('seal vent button'); h.at(8, 'downobj 0 0 seal vent button'); h.at(11, 'up 0'); }],
    [1000, 'toggle map back', (h) => h.tapObj('toggle button')],
    [1100, 'play audio', (h) => h.tapObj('play button')],
    [1300, 'monitor down', (h) => h.tapObj('olivier_FlipHitbox.Active', 1)],
    [1400, 'pan left', (h) => h.holdXY(20, 384, 90)],
    [1560, 'maintenance tab', (h) => h.tapObj('olivier_FlipHitbox.Active', 0)],
    [1700, 'reboot vent', (h) => h.tapObj('ventilation text')],
  ];
  let next = 0;
  let lastWhere = null;
  return {
    step(s) {
      const v = view(s);
      if (s.f === TITLE && s.t === 200) hands.tapObj('btn6thNight.Active');
      if (s.f === OFFICE) {
        officeTicks = s.t;
        while (next < script.length && s.t >= script[next][0]) {
          appendFileSync(out, JSON.stringify({ action: script[next][1], t: s.t }) + '\n');
          script[next][2](hands);
          next += 1;
        }
        const where = whereIs(v);
        const near = script.some(([t]) => s.t >= t - 2 && s.t <= t + 40);
        if (s.t % 10 === 0 || near || where !== lastWhere) appendFileSync(out, JSON.stringify(compact(v)) + '\n');
        lastWhere = where;
      }
      if (s.f === 4 || s.f === 6) this.done = true;   // static or game over
      return hands.drain();
    },
    summary: () => ({ officeTicks }),
  };
}

/** probe: one held touch in the office; every update's pan state. */
function probe({ run, knobs }) {
  const hands = new Hands();
  const out = join(run, 'probe.jsonl');
  writeFileSync(out, '');
  const [x, y] = knobs.at ?? [1000, 384];
  return {
    step(s) {
      const v = view(s);
      if (s.f === TITLE && s.t === 200) hands.tapObj('btn6thNight.Active');
      if (s.f === OFFICE) {
        if (s.t === (knobs.from ?? 120)) hands.holdXY(x, y, knobs.hold ?? 120);
        if (s.t >= 100 && s.t <= 400) appendFileSync(out, JSON.stringify({ t: s.t, gv10: s.gv[10], mt: v.one('Multiple Touch')?.al,
          scroll: v.one('scroll')?.al, sfl: v.one('scroll')?.af32, stf: v.one('screen two flipper')?.al, stff: v.one('screen two flipper')?.af32,
          d4: v.one('olivier_touchDect4.Active')?.c, d5: v.one('olivier_touchDect5.Active')?.c, viewing: v.cv('viewing') }) + '\n');
        if (s.t > 400) this.done = true;
      }
      return hands.drain();
    },
  };
}

const inWindow = (c) => c && c[0] >= 0 && c[0] < WINDOW.w && c[1] >= 0 && c[1] < WINDOW.h;

/** The instance of `hitbox` whose value 0 is `target`'s FixedValue (the port's proxy for it). */
export function proxyOf(v, hitbox, target) {
  const t = v.one(target);
  if (!t) return null;
  const list = v.all(hitbox);
  const i = list.findIndex((h) => h.al?.[0] === t.fx && inWindow(h.c));
  return i < 0 ? null : { index: i, c: list[i].c };
}

/** A tap at a proxy's centre, refused (null) when the centre is off the window. */
function tapProxy(hands, v, hitbox, target, hold = 3) {
  const p = proxyOf(v, hitbox, target);
  if (!p) return false;
  hands.tapXY(p.c[0], p.c[1], hold);
  return true;
}
function tapVisible(hands, v, name, hold = 3) {
  const o = v.one(name);
  if (!o || !inWindow(o.c)) return false;
  hands.tapXY(o.c[0], o.c[1], hold);
  return true;
}

/** survey2: the office's controls, each through its in-window proxy. */
function survey2({ run }) {
  const hands = new Hands();
  const out = join(run, 'survey.jsonl');
  writeFileSync(out, '');
  const note = (o) => appendFileSync(out, JSON.stringify(o) + '\n');
  const script = [
    [60, 'pan right', (v) => (hands.holdXY(1000, 384, 70), true)],
    [150, 'monitor up', (v) => tapProxy(hands, v, 'olivier_FlipHitbox.Active', 'flip it out')],
    [220, 'cam 10', (v) => tapProxy(hands, v, 'olivier_cameraHitboxA.Active', 'cam 10')],
    [280, 'cam 09', (v) => tapProxy(hands, v, 'olivier_cameraHitboxA.Active', 'cam 09')],
    [340, 'toggle to vents', (v) => tapVisible(hands, v, 'toggle button')],
    [400, 'vent 14', (v) => tapProxy(hands, v, 'olivier_cameraHitboxB.Active', 'cam 14')],
    [440, 'seal', (v) => tapVisible(hands, v, 'seal vent button')],
    [640, 'toggle to cams', (v) => tapVisible(hands, v, 'toggle button')],
    [700, 'cam 08', (v) => tapProxy(hands, v, 'olivier_cameraHitboxA.Active', 'cam 08')],
    [760, 'play audio', (v) => tapVisible(hands, v, 'play button')],
    [900, 'monitor down', (v) => tapProxy(hands, v, 'olivier_FlipHitbox.Active', 'flip it out')],
    [960, 'pan left', (v) => (hands.holdXY(20, 384, 70), true)],
    [1060, 'maintenance up', (v) => tapProxy(hands, v, 'olivier_FlipHitbox.Active', 'screen two flipper')],
    [1140, 'reboot vent', (v) => tapVisible(hands, v, 'ventilation text')],
    [1700, 'exit', (v) => tapVisible(hands, v, 'exit text')],
  ];
  let next = 0;
  return {
    step(s) {
      const v = view(s);
      if (s.f === TITLE && s.t === 200) hands.tapObj('btn6thNight.Active');
      if (s.f === OFFICE) {
        while (next < script.length && s.t >= script[next][0]) {
          const ok = script[next][1] && script[next][2](v);
          note({ action: script[next][1], t: s.t, ok });
          next += 1;
        }
        if (s.t % 5 === 0) {
          const rec = { t: s.t, off: s.off, where: whereIs(v), scroll: v.al('scroll', 0) };
          for (const n of ['viewing', 'viewing a screen', 'you in', 'mon in', 'what vent is closed', 'going to seal',
            'rebooting', 'time of night', 'play counter', 'drop it']) rec[n] = v.cv(n);
          for (const n of ['toggle button', 'seal vent button', 'screen two flipper', 'flip it out', 'audio text',
            'camera text', 'ventilation text', 'blackout', 'play button']) rec[n] = v.one(n)?.al;
          rec.cam10 = v.one('cam 10')?.c;
          if (s.t === 200) {
            rec.hitA = v.all('olivier_cameraHitboxA.Active').map((h) => [h.al?.[0], h.c, h.box]);
            rec.hitB = v.all('olivier_cameraHitboxB.Active').map((h) => [h.al?.[0], h.c, h.box]);
            rec.camsFx = Object.fromEntries(['cam 01','cam 02','cam 05','cam 09','cam 10','cam 11','cam 14'].map((n) => [n, [v.one(n)?.fx, v.one(n)?.c, v.one(n)?.v]]));
          }
          note(rec);
        }
        if (s.t > 2000) this.done = true;
      }
      if (s.f === 4 || s.f === 6) this.done = true;
      return hands.drain();
    },
  };
}

// --- guard: the controller ------------------------------------------------

// The vent each place can enter on `action selected` 4 (g228, g231, g237,
// g243, g247), in the order a seal protects: 14 and 15 kill outright, 11 and
// 12 enter the attack chain at stage 3, 13 at stage 1.
export const SEAL_FOR = { 'cam 10': 14, 'cam 02': 15, 'cam 09': 11, 'cam 07': 12, 'cam 05': 13 };
// Where a lure pulls him outward from each place (g319-g341's pairs, read as
// `lure on X pulls from Y`): stage 1 has one exit, CAM 02's lure, and g275
// advances stage 1 to stage 2 on any roll above 2 while a screen is up.
export const LURE_TO = { 'attack stage 1': 2, 'cam 03': 2, 'cam 04': 2, 'cam 02': 5, 'cam 05': 8, 'cam 07': 8, 'cam 08': 9, 'cam 09': 10 };
const DANGER = new Set(['attack stage 1', 'cam 03', 'cam 04', 'cam 02', 'cam 05']);
const CALM = new Set(['cam 10', 'cam 09']);
const LETHAL = new Set([14, 15]);
// Inside a vent he resolves on his next move: back to the camera he came from
// if that vent is sealed then, on toward the office if not (g604-g613).
const IN_VENT = { 'cam 11': 11, 'cam 12': 12, 'cam 13': 13, 'cam 14': 14, 'cam 15': 15 };
// A camera whose selection a phantom can use (g670-g681, g717, g726, g727).
function phantomSafe(v, cam) {
  if (cam === 4 && v.cv('mangle') === 2) return false;
  if (cam === 7 && v.cv('chica') === 2) return false;
  if (cam === 8 && v.cv('puppet') === 2) return false;
  if ([1, 7, 9, 10].includes(cam) && v.al('BBpeek', 0) === 1) return false;
  return true;
}

function* hold(ticks) { for (let i = 0; i < ticks; i += 1) yield []; }
function* until(ctx, pred, max) { for (let i = 0; i < max && !pred(ctx.v); i += 1) yield []; }
function* tapAt(c, ticks = 3) { yield [`down 0 ${c[0]} ${c[1]}`]; yield* hold(ticks - 1); yield ['up 0']; }
function* tapProxyTask(ctx, hitbox, target) {
  const p = proxyOf(ctx.v, hitbox, target);
  if (!p) { ctx.log({ miss: target }); return false; }
  yield* tapAt(p.c);
  return true;
}
function* tapNamed(ctx, name) {
  const o = ctx.v.one(name);
  if (!o || !inWindow(o.c)) { ctx.log({ miss: name }); return false; }
  yield* tapAt(o.c);
  return true;
}
function* panTo(ctx, right) {
  const done = (v) => (right ? v.al('scroll', 0) >= 1488 : v.al('scroll', 0) <= 512);
  if (done(ctx.v)) return;
  yield [`down 0 ${right ? 1000 : 20} 384`];
  yield* until(ctx, done, 120);
  yield ['up 0'];
}

const facts = (v) => ({
  where: whereIs(v), sealed: v.cv('what vent is closed'), going: v.cv('going to seal'),
  charge: v.al('seal vent button', 19), viewing: v.cv('viewing'), screen: v.cv('viewing a screen'),
  toggle: v.al('toggle button', 0), toggleAnim: v.al('toggle button', 1), youIn: v.cv('you in'),
  vent: v.al('ventilation text', 0), dwell: v.al('ventilation text', 1), audio: v.al('audio text', 0),
  rebooting: v.cv('rebooting'), scroll: v.al('scroll', 0), maint: v.al('screen two flipper', 0),
  hour: v.cv('time of night'), blackout: v.al('blackout', 1),
  // A phantom scare sets `frozen`, and from Night 3 that forces a move: CAM 05
  // to 02, CAM 02 to stage 1, CAM 06-10 to 05, 04 or 10 (g895-g902, g918-g920).
  frozen: v.cv('frozen'), force: v.cv('force move'),
});

/**
 * Whether the what-day screen routes this seed to a rare screen: its first
 * draw is `rare random` = Random(1000) + 1 (02-03-what_day g2), and 1 sends it
 * to a rare screen that jumps back to what-day (g12, rare3 g1). The draw is
 * the runtime's (harness.h: graine = graine * 31415 + 1, value = graine *
 * range >> 16) from the frame's seed. The harness seeds every visit with the
 * one seed, so such a seed never reaches the office (batch.mjs: NO_NIGHT).
 */
export function whatDayRare(seed) {
  const g = (((seed & 0xFFFF) * 31415) + 1) & 0xFFFF;
  return ((g * 1000) >>> 16) === 0;
}

/**
 * Where a lost night's chain began, for search.mjs: the first logged update
 * with Springtrap on an attack stage or a GOT YOU marker, or inside vent 14
 * or 15, whose far ends kill outright (g611, g613). A branch after it is
 * already lost. `records` are the policy log's lines, parsed.
 */
export function doomStart(records) {
  const r = records.find((x) => typeof x.where === 'string'
    && (/^attack stage|^GOT YOU/.test(x.where) || x.where === 'cam 14' || x.where === 'cam 15'));
  return r ? r.t : null;
}

// guard2's zones. From CAM 04 and CAM 03 two moves in three go toward the
// office (g249, g251), and a roll above 2 at stage 1 marks him for stage 2
// (g252/g275), so those three are lured back to CAM 02 at once. CAM 08-10 are
// three or more moves from stage 1, the only places a 10 s reboot is spent.
const NEAR = new Set(['cam 04', 'cam 03', 'attack stage 1']);
const FAR = new Set(['cam 08', 'cam 09', 'cam 10']);

/**
 * Plays left before audio errors: a play needs `audio text` > -10 and takes
 * AI from it (g301/g308), so from 0 at AI 7 there are two and the second
 * breaks audio.
 */
export function playsLeft(audio, ai) {
  if (!(audio > -10) || !(ai > 0)) return 0;
  return Math.floor((audio + 9) / ai) + 1;
}

/**
 * guard: live on the vent map (no camera selected, so no camera phantom can
 * arm), seal the vent beside Springtrap's place, and reboot ventilation when
 * it errors. Reads the rebuilt runtime's own objects -- an oracle, not a
 * player's view -- and acts only through in-window touches.
 *
 * `rev` 1 is the guard the committed record names. `guard2` (rev 2) is built
 * on the losses of rev 1's development block (seeds 0-53: 30 of 42 office
 * deaths entered stage 1 from CAM 02 or 03 with audio already at -10, and 8
 * were vent kills through 14 or 15 during a reboot). It spends a lure only on
 * CAM 04, CAM 03 and an unmarked stage 1, keeps the camera parked on CAM 02
 * while he is there so the lure is one tap, and reboots audio or ventilation
 * only while he is at CAM 08-10 with the vent beside him sealed, abandoning a
 * reboot the moment he reaches CAM 05 or nearer. A ventilation error can wait:
 * the blackout it brings advances only a Springtrap already in the attack
 * chain (g486, g487, g256, g259, g262, g483, g661), and aggression is on all
 * night on Nightmare anyway (g220/g662 with AI 7).
 */
function guard({ run, knobs }, rev = 1) {
  const out = join(run, 'guard.jsonl');
  writeFileSync(out, '');
  // knobs.quiet keeps the last 200 records in memory and writes them when the
  // night ends, for batch runs over many seeds.
  const ring = [];
  const ctx = { v: null, log: (o) => {
    const line = JSON.stringify({ t: ctx.v?.tick, ...o });
    if (!knobs.quiet) appendFileSync(out, line + '\n');
    else { ring.push(line); if (ring.length > 200) ring.shift(); }
  } };
  const flush = () => { if (knobs.quiet && ring.length) { appendFileSync(out, ring.join('\n') + '\n'); ring.length = 0; } };
  let task = null, taskName = null, last = null, outcome = null;
  const rebootAt = knobs.rebootAt ?? -10;

  function* raise() {
    yield* panTo(ctx, true);
    if (ctx.v.cv('viewing') === 0) {
      yield* tapProxyTask(ctx, 'olivier_FlipHitbox.Active', 'flip it out');
      yield* until(ctx, (v) => v.cv('viewing') >= 2, 60);
    }
  }
  function* toVents() {
    if (ctx.v.al('toggle button', 0) === 1) return;
    yield* until(ctx, (v) => v.al('toggle button', 1) === 0, 30);
    yield* tapNamed(ctx, 'toggle button');
    yield* until(ctx, (v) => v.al('toggle button', 0) === 1 && v.al('toggle button', 1) === 0, 40);
  }
  function* toCams() {
    if (ctx.v.al('toggle button', 0) === 0) return;
    yield* until(ctx, (v) => v.al('toggle button', 1) === 0, 30);
    yield* tapNamed(ctx, 'toggle button');
    yield* until(ctx, (v) => v.al('toggle button', 0) === 0 && v.al('toggle button', 1) === 0, 40);
  }
  function* seal(vent) {
    const target = `cam ${vent}`;
    yield* toVents();
    yield* tapProxyTask(ctx, 'olivier_cameraHitboxB.Active', target);
    yield* hold(6);
    yield* tapProxyTask(ctx, 'olivier_cameraHitboxB.Active', target);
    yield* until(ctx, (v) => v.cv('going to seal') > 0, 10);
    yield* until(ctx, (v) => v.cv('going to seal') === 0, 260);
  }
  function* watch(cam) {
    yield* toCams();
    yield* tapProxyTask(ctx, 'olivier_cameraHitboxA.Active', `cam ${String(cam).padStart(2, '0')}`);
    yield* until(ctx, (v) => v.cv('you in') === cam, 10);
  }
  function* rest() {
    yield* toVents();
    const back = ctx.v.cv('what vent is closed') || 14;
    if (ctx.v.cv('you in') < 11) yield* tapProxyTask(ctx, 'olivier_cameraHitboxB.Active', `cam ${back}`);
  }
  function* lure(cam) {
    const name = `cam ${String(cam).padStart(2, '0')}`;
    yield* toCams();
    yield* tapProxyTask(ctx, 'olivier_cameraHitboxA.Active', name);
    yield* until(ctx, (v) => v.cv('you in') === cam, 10);
    yield* tapNamed(ctx, 'play button');
    yield* until(ctx, (v) => v.cv('play counter') !== 7, 10);
  }
  function* reboot(system = 'ventilation text', abort = () => false) {
    yield* tapProxyTask(ctx, 'olivier_FlipHitbox.Active', 'flip it out');
    yield* until(ctx, (v) => v.cv('viewing') === 0, 60);
    yield* panTo(ctx, false);
    yield* tapProxyTask(ctx, 'olivier_FlipHitbox.Active', 'screen two flipper');
    yield* until(ctx, (v) => v.al('screen two flipper', 0) === 3, 60);
    yield* tapNamed(ctx, system);
    yield* until(ctx, (v) => v.cv('rebooting') !== 0, 10);
    yield* until(ctx, (v) => v.cv('rebooting') === 0 || abort(v), 1200);
    if (ctx.v.cv('rebooting') !== 0) ctx.log({ abandon: system, where: whereIs(ctx.v) });
    yield* tapNamed(ctx, 'exit text');
    yield* until(ctx, (v) => v.al('screen two flipper', 0) === 0 && v.cv('viewing a screen') === 0, 60);
  }

  // A reboot is abandoned once he reaches CAM 05 or nearer, or a vent.
  const closeIn = (v) => { const w = whereIs(v); return NEAR.has(w) || w === 'cam 05' || w === 'cam 02' || Boolean(IN_VENT[w]); };

  function decide2() {
    const f = facts(ctx.v);
    const ai = ctx.v.cv('AI') ?? 7;
    const ready = ctx.v.cv('play counter') === 7;
    const plays = playsLeft(f.audio, ai);
    if (f.maint !== 0 && f.rebooting === 0) return ['exit', (function* () { yield* tapNamed(ctx, 'exit text'); yield* hold(20); })()];
    if (f.viewing === 0) return ['raise', raise()];
    const where = f.where;
    const pic = ctx.v.cv('pic random');
    // 1. CAM 04, CAM 03, stage 1: pull him back to CAM 02 (g320-g322). Parked
    // on CAM 02 while he is elsewhere, `pic random` still re-rolls (g459).
    // With no play left the only move is a reboot: the mark still needs a
    // roll above 2 at stage 1, and the lure then needs the audio.
    const cam = ctx.v.cv('mon in');
    if (NEAR.has(where)) {
      if (ready && plays > 0) return [`lure 2 from ${where}`, lure(2)];
      if (plays === 0 && f.rebooting === 0) return ['reboot audio', reboot('audio text')];
      // Waiting out the play counter (g299): with `pic random` at 1, watch his
      // own camera so it stays 1 for when the lure lands him on CAM 02
      // (g246/g247, g459); at 0, stay off it so the 10 s tick can re-roll it.
      if (pic === 1 && cam >= 1 && cam <= 10 && phantomSafe(ctx.v, cam)) {
        if (f.toggle !== 0 || f.youIn !== cam) return [`hold coin ${cam}`, watch(cam)];
        return null;
      }
      if (f.toggle !== 0 || f.youIn !== 2) return ['park 2', watch(2)];
      return null;
    }
    // 2. Inside a vent: seal it and he goes back the way he came (g604-g613).
    const inVent = IN_VENT[where];
    const canSeal = f.going === 0 && f.charge === 0;
    if (inVent && f.sealed !== inVent && canSeal) return [`seal ${inVent}`, seal(inVent)];
    // 3. The vent beside him.
    const want = SEAL_FOR[where];
    if (want && f.sealed !== want && canSeal) return [`seal ${want}`, seal(want)];
    if (!canSeal) return null;
    // 4. No play left: reboot audio now, from anywhere short of CAM 04.
    if (plays === 0 && f.rebooting === 0) return ['reboot audio', reboot('audio text')];
    // 5. Other reboots only from CAM 08-10 with the vent beside him sealed,
    // abandoned if he closes in while a play is still in hand.
    const safe = FAR.has(where) && (!want || f.sealed === want);
    if (safe && plays < 2 && f.rebooting === 0) return ['reboot audio', reboot('audio text', closeIn)];
    if (safe && f.vent <= rebootAt && f.rebooting === 0) return ['reboot', reboot('ventilation text', closeIn)];
    // 6. At CAM 02 with `pic random` at 1, park on him: that freezes the coin
    // that sends his action 4 into sealed vent 15 (g246/g247, g459). At 0 his
    // action 4 goes straight to stage 1: pull him to CAM 05 while a play stays
    // in reserve, else stay off his camera so the coin can re-roll.
    if (where === 'cam 02') {
      if (pic === 1) {
        if (f.toggle !== 0 || f.youIn !== 2) return ['park 2', watch(2)];
        return null;
      }
      if (ready && plays >= 2) return ['lure 5 from cam 02', lure(5)];
      if (f.toggle !== 1 || f.youIn < 11) return ['rest', rest()];
      return null;
    }
    // 7. Otherwise as rev 1: hold `pic random` at 1 by watching his camera
    // when that is phantom-safe, or rest on the vent map.
    if (pic === 1 && !inVent && cam >= 1 && cam <= 10 && phantomSafe(ctx.v, cam)) {
      if (f.toggle !== 0 || f.youIn !== cam) return [`watch ${cam}`, watch(cam)];
      return null;
    }
    if (f.toggle !== 1 || f.youIn < 11) return ['rest', rest()];
    return null;
  }

  function decide() {
    if (rev >= 2) return decide2();
    const f = facts(ctx.v);
    const pic = ctx.v.cv('pic random');
    if (f.maint !== 0 && f.rebooting === 0) return ['exit', (function* () { yield* tapNamed(ctx, 'exit text'); yield* hold(20); })()];
    if (f.vent <= rebootAt && f.rebooting === 0) return ['reboot', reboot()];
    if (f.viewing === 0) return ['raise', raise()];
    const inVent = IN_VENT[f.where];
    const want = inVent ?? SEAL_FOR[f.where];
    const sealNow = want && f.sealed !== want && f.going === 0 && f.charge === 0;
    if (sealNow && (inVent || LETHAL.has(want))) return [`seal ${want}`, seal(want)];
    const lureCam = LURE_TO[f.where];
    const canLure = ctx.v.cv('play counter') === 7 && f.audio > -10;
    if (lureCam && canLure && (DANGER.has(f.where) || knobs.herd)) return [`lure ${lureCam} from ${f.where}`, lure(lureCam)];
    if (sealNow) return [`seal ${want}`, seal(want)];
    if (f.going !== 0 || f.charge !== 0) return null;
    if (f.audio < 0 && CALM.has(f.where) && f.sealed === want) return ['reboot audio', reboot('audio text')];
    // Watching his camera freezes `pic random` (g459); keep it at 1, the
    // coin that turns his action-4 move at CAM 02/05 into a sealed vent.
    const cam = ctx.v.cv('mon in');
    if (pic === 1 && !inVent && cam >= 1 && cam <= 10 && phantomSafe(ctx.v, cam)) {
      if (f.toggle !== 0 || f.youIn !== cam) return [`watch ${cam}`, watch(cam)];
      return null;
    }
    if (f.toggle !== 1 || f.youIn < 11) return ['rest', rest()];
    return null;
  }

  return {
    step(s) {
      if (s.f === TITLE) return s.t === 200 ? ['downobj 0 0 btn6thNight.Active'] : s.t === 203 ? ['up 0'] : [];
      if (s.f === 5) { outcome = outcome ?? '6AM'; this.done = true; return []; }
      if (s.f === 4 || s.f === 6) { outcome = outcome ?? `dead in frame ${s.f}`; this.done = true; return []; }
      if (s.f !== OFFICE) return [];
      ctx.v = view(s);
      const f = facts(ctx.v);
      const key = JSON.stringify([f.where, f.sealed, f.going, f.viewing, f.toggle, f.vent, f.rebooting, f.hour, f.maint, f.frozen, f.force]);
      if (key !== last || s.t % 600 === 0) { ctx.log({ ...f, task: taskName }); last = key; }
      if (!task) {
        const d = decide();
        if (d) { [taskName, task] = d; ctx.log({ start: taskName }); }
      }
      if (!task) return [];
      const r = task.next();
      if (r.done) { task = null; taskName = null; return r.value === true || r.value === false ? [] : (r.value ?? []); }
      return r.value ?? [];
    },
    summary: () => { flush(); return { outcome }; },
  };
}

export const POLICIES = { survey, survey2, probe, guard, guard2: (o) => guard(o, 2) };
