// Drives the lesson ladder with an in-page "perfect player" that taps whatever
// the coach is currently cueing. Checks control gating, cueing, streaks and the
// pass screen. Each lesson waits for its pass screen, with a deadline, instead
// of sleeping a fixed 47-58 s.
//
//   node apps/trainer/test/lesson.test.ts [url] [--wind-only]
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { launch, pageUrl } from './cdp.ts';
import type { Page } from './cdp.ts';

const WIND_ONLY = process.argv.includes('--wind-only');

let page: Page;
before(async () => {
  page = await launch();
  await page.open(pageUrl());
  await page.waitFor('the app', '!!window.app', value => value === true, 10_000);
  await page.evaluate('localStorage.removeItem("m7.progress"); location.reload(); true');
  await page.waitFor('the app after a reload', '!!window.app && document.getElementById("menu").classList.contains("shown")',
    value => value === true, 10_000);
});
after(async () => {
  await page?.evaluate('clearInterval(window.__auto); window.__release && window.__release(); true').catch(() => {});
  await page?.close();
});

const is = (want: unknown) => (value: unknown) => value === want;
const atLeast = (floor: number) => (value: unknown) => typeof value === 'number' && value >= floor;
const show = async (label: string, expression: string) => { console.log(`  ${label}: ${JSON.stringify(await page.evaluate(expression))}`); };
const PASSED = 'document.getElementById("passed").classList.contains("shown")';
const VISIBLE = `[...document.querySelectorAll('[data-widget]')]
  .filter(e=>!e.classList.contains('hidden-ctrl')).map(e=>e.dataset.widget).sort().join()`;
/** A unit's stun left in frames, under whichever movement clock the Sim runs. */
const STUN_LEFT = '(u => window.app.sim.opts.sourcedMovementClock ? u.stunRemaining : Math.max(0, u.stunUntil - window.app.sim.frame))';
/** Click `selector`, then wait for `panel` to be shown. */
async function go(selector: string, panel: string) {
  await page.evaluate(`document.querySelector(${JSON.stringify(selector)}).click(); true`);
  await page.waitFor(`${panel} after ${selector}`, `document.getElementById(${JSON.stringify(panel)}).classList.contains("shown")`,
    is(true), 3_000);
}

// tapped as soon as each step falls due — a metronomically perfect player
// `hold` decides whether the bot lets go: a held input stays down until the
// next control is pressed, which is what the wind step now demands.
//
// Any other hold-mode control (the lights) is held for 100 ms, a finger's tap
// and the camera-flash hold the device schedules use. A pointerdown and
// pointerup in one task reach no Sim tick, so that flash froze nobody: the
// stalled units walked, the monitor was forced down, and since the coach
// grades what the game took (2026-09-30) the camera taps after it were
// refused on a seed-dependent share of runs.
const player = (hold: boolean) => `window.__auto && clearInterval(window.__auto);
window.__held = null;
window.__heldUntil = 0;
window.__release = () => { if (window.__held) {
  window.__held.dispatchEvent(new PointerEvent('pointerup', {bubbles:true, pointerId:31}));
  window.__held = null; window.__heldUntil = 0; } };
window.__auto = setInterval(() => {
  if (window.__heldUntil && performance.now() >= window.__heldUntil) window.__release();
  const app = window.app;
  if (!app || !app.running || !app.coach || !app.coach.enabled) return;
  const c = app.coach, e = c.expected;
  if (!e || c.cycleStart == null) return;
  if (app.sim.t < c.cycleStart + e.at) return;
  const cue = c.cue; if (!cue) return;
  const el = document.querySelector(cue.sel); if (!el) return;
  // A held cue remains current until its minimum duration has elapsed. Do not
  // turn the 8 ms poll into repeated pointerup/pointerdown pairs.
  if (window.__held === el) return;
  window.__release();
  el.dispatchEvent(new PointerEvent('pointerdown', {bubbles:true, pointerId:31}));
  if (${hold ? 'true' : 'false'} && e.hold) { window.__held = el; }
  else if (el.dataset.mode === 'hold' && !e.hold) { window.__held = el; window.__heldUntil = performance.now() + 100; }
  else el.dispatchEvent(new PointerEvent('pointerup', {bubbles:true, pointerId:31}));
}, 8); true`;
const AUTOPLAYER = player(true);
const STOP_PLAYER = 'clearInterval(window.__auto); window.__release && window.__release(); true';

// Fast focused regression for the only held coach input. This keeps the
// normal ladder's full target counts intact while making hold-plumbing bugs
// debuggable without waiting through the earlier lessons.
test('focused WIND hold', { skip: !WIND_ONLY }, async () => {
  await go('[data-mode="wind"]', 'brief');
  await go('#btn-brief-go', 'run');
  await page.evaluate(player(false));
  await page.waitFor('two graded cycles of tapping', 'window.app.coach.cycles', atLeast(2), 40_000);
  await show('after tap bot', `(()=>{const a=window.app; return {
    winding: a.sim.winding, expected: a.coach.expected?.id || null,
    monitor: a.sim.monitor, cam: a.sim.cam, dropEverything: a.sim.dropEverything,
    windFrames: a.coach.windFrames, lastHeld: a.coach.lastHeld || 0,
    streak: a.coach.streak, cycles: a.coach.cycles,
    mistakes: a.sim.mistakes.slice(-4).map(m=>m.code).join()
  };})()`);
  await page.evaluate(`clearInterval(window.__auto); window.__release && window.__release();
    window.app.start("wind").then(() => { window.app.sim.opts.stalledEnabled = false; return true; })`);
  await page.evaluate(AUTOPLAYER);
  await page.waitFor('holding builds a streak', 'window.app.coach.streak > 0', is(true), 60_000);
  await show('state', `(()=>{const a=window.app; return {
    held: window.__held?.dataset.act || null,
    winding: a.sim.winding, isWinding: a.sim.isWinding,
    monitor: a.sim.monitor, cam: a.sim.cam,
    expected: a.coach.expected?.id || null,
    windFrames: a.coach.windFrames, lastHeld: a.coach.lastHeld || 0,
    streak: a.coach.streak, cycles: a.coach.cycles,
    tail: a.coach.results.slice(-6).map(r=>r.grade).join()
  };})()`);
  await page.evaluate(STOP_PLAYER);
});

test('the menu is a ladder', { skip: WIND_ONLY }, async () => {
  assert.equal(await page.evaluate('document.querySelectorAll("#mode-list .mode").length'), 10, 'lesson count');
  assert.equal(await page.evaluate('document.querySelector("#mode-list .mode").className.includes("next")'), true, 'first is next');
  assert.equal(await page.evaluate('document.querySelectorAll("#mode-list .mode.later").length > 0'), true, 'later ones dimmed');
});

test('lesson 1, the beat, passes for a perfect player', { skip: WIND_ONLY }, async () => {
  await go('[data-mode="beat"]', 'brief');
  await show('pass criterion', 'document.getElementById("brief-pass").textContent');
  await go('#btn-brief-go', 'run');
  assert.equal(await page.evaluate(VISIBLE), 'light', 'only LIGHT visible');
  assert.equal(await page.evaluate('document.getElementById("map").classList.contains("dim-cams")'), true, 'cams dimmed');
  await page.evaluate(AUTOPLAYER);
  await page.waitFor('the beat passed', PASSED, is(true), 90_000);
  await show('passed text', 'document.getElementById("passed-title").textContent');
  assert.equal(await page.evaluate('JSON.parse(localStorage["m7.progress"]).beat.passed'), true, 'progress saved');
});

test('lesson 2, the sweep, is unlocked, reachable and passes', { skip: WIND_ONLY }, async () => {
  await page.evaluate(STOP_PLAYER);
  await go('#btn-next-lesson', 'brief');
  assert.equal(await page.evaluate('document.getElementById("brief-title").textContent'), 'The sweep', 'brief is sweep');
  await go('#btn-brief-go', 'run');
  assert.equal(await page.evaluate('document.getElementById("map").classList.contains("dim-cams")'), false, 'cams live');
  assert.equal(await page.evaluate('document.querySelector(\'[data-widget="monitor"]\').classList.contains("hidden-ctrl")'), true,
    'monitor hidden');
  assert.equal(await page.evaluate('window.app.sim.monitor'), 'up', 'starts on cams');
  await page.evaluate(AUTOPLAYER);
  await page.waitFor('the sweep passed', PASSED, is(true), 90_000);
  await show('stun held', `Math.max(0,...window.app.sim.units.filter(u=>[10,4,7].includes(u.path[u.idx])).map(${STUN_LEFT}))`);
});

test('winding must be HELD, not tapped', { skip: WIND_ONLY }, async () => {
  await page.evaluate(STOP_PLAYER);
  await go('#btn-passed-menu', 'menu');
  await go('[data-mode="wind"]', 'brief');
  await go('#btn-brief-go', 'run');
  await page.evaluate(player(false));            // taps the wind button instead of holding
  await page.waitFor('two graded cycles of tapping', 'window.app.coach.cycles', atLeast(2), 40_000);
  assert.equal(await page.evaluate('window.app.coach.streak'), 0, 'tapping wind never passes');
  await show('flagged', 'window.app.coach.results.slice(-4).map(r=>r.grade).join()');
  // The deliberately bad phase can let a nonlethal stalled unit reach its
  // opening and trigger the sourced monitor forcedown. Test correct holding
  // from a clean lesson rather than asking the bot to repair that state.
  await page.evaluate(`clearInterval(window.__auto); window.__release && window.__release();
    window.app.start("wind").then(() => { window.app.sim.opts.stalledEnabled = false; return true; })`);
  await page.evaluate(AUTOPLAYER);               // now actually hold it
  await page.waitFor('holding builds a streak', 'window.app.coach.streak > 0', is(true), 60_000);
  await show('held seconds', 'window.app.coach.lastHeld?.toFixed(2)');
});

test('the full cycle passes', { skip: WIND_ONLY }, async () => {
  await page.evaluate(STOP_PLAYER);
  await go('#btn-quit', 'menu');
  await go('[data-mode="cycle"]', 'brief');
  await go('#btn-brief-go', 'run');
  // This is a browser/coach contract check. Threat dynamics have their own
  // deterministic engine tests; a random nonlethal forcedown must not make a
  // metronomically correct input sequence flaky here.
  await page.evaluate('window.app.sim.opts.stalledEnabled = false; true');
  assert.equal(await page.evaluate(VISIBLE), 'camlight,mask,monitor,wind', 'controls (cams up)');
  await page.evaluate(AUTOPLAYER);
  await page.waitFor('the cycle passed', PASSED, is(true), 120_000);
  await show('cycles run', 'window.app.coach.cycles');
  await show('best streak', 'window.app.coach.bestStreak');
  await page.evaluate(STOP_PLAYER);
  console.log(`  screenshot: ${await page.screenshot('lesson.png')}`);
});

test('no console error or uncaught exception', () => {
  assert.deepEqual(page.problems, []);
});
