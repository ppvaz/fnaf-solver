// The trainer in a real browser: the menu loads, the arcade lab's fixture path
// scores, saves, exports and resets, a full night starts and takes taps and
// holds, and a finished night draws its report. Until 2026-10-02 this printed
// each value and passed on any run without a console error, so a monitor tap
// that lowered the monitor and a camera tap the game refused both "passed".
//
//   node apps/trainer/test/browser.test.ts [url]   # default: the dev server on :8731
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { is, openApp } from './cdp.ts';
import type { Page } from './cdp.ts';

let page: Page;
before(async () => {
  page = await openApp();
});
after(async () => { await page?.close(); });

/** Pointer down then up on the control `selector`, as one tap; `id` is the pointer. */
const tap = (selector: string, id = 1) => page.evaluate(`(() => {
  const el = document.querySelector(${JSON.stringify(selector)});
  for (const type of ['pointerdown', 'pointerup']) el.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: ${id} }));
  return true; })()`);
const pointer = (selector: string, type: 'pointerdown' | 'pointerup', id: number) => page.evaluate(`(() => {
  document.querySelector(${JSON.stringify(selector)}).dispatchEvent(new PointerEvent('${type}', { bubbles: true, pointerId: ${id} }));
  return true; })()`);
const shown = (id: string) => `document.getElementById(${JSON.stringify(id)}).classList.contains("shown")`;
/** A unit's stun left in frames, under whichever movement clock the Sim runs. */
const STUN_LEFT = '(u => window.app.sim.opts.sourcedMovementClock ? u.stunRemaining : Math.max(0, u.stunUntil - window.app.sim.frame))';

test('the menu loads', async () => {
  assert.equal(await page.evaluate('document.title'), 'Minus 7 Trainer');
  assert.equal(await page.evaluate('document.querySelectorAll("#mode-list .mode").length'), 10, 'one row per lesson');
  assert.equal(await page.evaluate(shown('menu')), true);
  // Chrome runs with --enable-automation, so a bot's trace posts dry and never
  // enters the human census (main.ts postTrace).
  assert.equal(await page.evaluate('navigator.webdriver'), true, 'the page knows a bot is playing');
});

test('the arcade lab scores, saves, exports and resets its fixture set', async () => {
  await page.evaluate('localStorage.removeItem("m7.arcade.progress")');
  await page.evaluate('document.querySelector(\'[data-ui="arcade"]\').click()');
  await page.waitFor('arcade panel', shown('arcade'), is(true), 2_000);
  assert.equal(await page.evaluate('document.getElementById("arcade").textContent.includes("FIXTURE / PRACTICE")'), true,
    'the fixture set says it is one');
  assert.equal(await page.evaluate('document.querySelectorAll("#arcade-choices [data-arcade-answer]").length'), 2);
  await page.evaluate('document.querySelector("#arcade-choices [data-arcade-answer]").click()');
  await page.waitFor('answer feedback', 'document.getElementById("arcade-feedback").textContent.length > 0', is(true), 2_000);
  assert.equal(await page.evaluate('JSON.parse(localStorage["m7.arcade.progress"]).scored'), 1, 'the answer is scored and saved');
  await page.evaluate('document.getElementById("btn-arcade-export").click()');
  assert.equal(await page.evaluate('!document.getElementById("arcade-export").hidden'), true, 'the export is shown');
  await page.evaluate('document.getElementById("btn-arcade-reset").click()');
  assert.equal(await page.evaluate('JSON.parse(localStorage["m7.arcade.progress"]).scored'), 0, 'reset clears the score');
  await page.evaluate('document.querySelector("#arcade [data-close]").click()');
  await page.waitFor('menu again', shown('menu'), is(true), 2_000);
});

test('a full night starts and runs', async () => {
  await page.evaluate('document.querySelector(\'[data-mode="night"]\').click()');
  await page.waitFor('the brief', shown('brief'), is(true), 2_000);
  await page.evaluate('document.getElementById("btn-brief-go").click()');
  await page.waitFor('the run panel', shown('run'), is(true), 3_000);
  assert.equal(await page.evaluate('!!document.querySelector("#hud .hud-timer")'), true, 'the stage has its HUD');
  assert.equal(await page.evaluate('document.querySelectorAll("#map .camb").length'), 12, 'one button per camera');
  await page.waitFor('the Sim advancing', 'window.app.sim.frame', value => typeof value === 'number' && value >= 60, 5_000);
  assert.match(String(await page.evaluate('document.getElementById("t-main").textContent')), /^\d+:\d\d$/, 'the timer reads m:ss');
});

test('taps and holds reach the Sim', async () => {
  // The night opens on the cameras, on CAM 11 (curriculum.ts, lesson `night`).
  assert.deepEqual(await page.evaluate('({ monitor: window.app.sim.monitor, cam: window.app.sim.cam })'), { monitor: 'up', cam: 11 });
  await tap('[data-act="cam:10"]');
  await page.waitFor('CAM 10 selected', 'window.app.sim.cam', is(10), 1_000);
  await pointer('[data-widget="camlight"]', 'pointerdown', 2);
  await page.waitFor('the camera light held', 'window.app.sim.lightHeld', is(true), 1_000);
  await pointer('[data-widget="camlight"]', 'pointerup', 2);
  await page.waitFor('the camera light released', 'window.app.sim.lightHeld', is(false), 1_000);
  // A flash on a unit's own start room holds nobody: stunCam exempts the
  // withereds on CAM 08, where all three start.
  await tap('[data-act="cam:8"]');
  await page.waitFor('CAM 08 selected', 'window.app.sim.cam', is(8), 1_000);
  await pointer('[data-widget="camlight"]', 'pointerdown', 2);
  await page.waitFor('the light on CAM 08', 'window.app.sim.lightHeld', is(true), 1_000);
  assert.equal(await page.evaluate(`Math.max(0, ...window.app.sim.units.filter(u => u.path[u.idx] === 8).map(${STUN_LEFT}))`), 0,
    'nobody on CAM 08 is held by the flash');
  await pointer('[data-widget="camlight"]', 'pointerup', 2);
  await tap('[data-act="monitor"]');
  await page.waitFor('the monitor down', 'window.app.sim.monitor', is('down'), 2_000);
  await tap('[data-act="monitor"]');
  await page.waitFor('the monitor up again', 'window.app.sim.monitor', is('up'), 2_000);
  console.log(`  screenshot: ${await page.screenshot('run.png')}`);
});

test('a finished night draws its report', async () => {
  // Play the rest of the night out at once, with no inputs, so the report has a whole night in it.
  await page.evaluate(`(() => { const a = window.app; a.running = false;
    while (a.sim.alive && !a.sim.won) { a.sim.tick(); a.sim.events.length = 0; }
    a.finish(); return true; })()`);
  await page.waitFor('the report', shown('report'), is(true), 3_000);
  assert.equal(await page.evaluate(`(() => { const s = window.app.sim, head = document.getElementById("rep-head").textContent;
    return s.won ? head === "6 AM — cleared" : !!s.death && head.startsWith("Died at "); })()`), true,
    'the headline says how the night ended');
  await page.waitFor('the timeline', 'document.getElementById("rep-canvas").width > 0', is(true), 2_000);
  assert.equal(await page.evaluate(`[...document.querySelectorAll("#rep-stats div")]
    .some(row => row.querySelector("b")?.textContent === "Light used")`), true, 'the stats include the light budget');
  assert.equal(await page.evaluate(`[...document.querySelectorAll("#rep-stats div")]
    .every(row => row.querySelector("b")?.textContent && row.querySelector("span")?.textContent)`), true,
    'every stat row has a label and a value');
  console.log(`  screenshot: ${await page.screenshot('report.png')}`);
});

test('no console error or uncaught exception', () => {
  assert.deepEqual(page.problems, []);
});
