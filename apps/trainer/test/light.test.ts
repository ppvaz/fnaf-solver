// The office flashlight and the camera light are separate controls in separate
// places; exactly one must be on screen at a time, and the coach must cue the
// one that is actually visible.
//
//   node apps/trainer/test/light.test.ts [url]   # default: the dev server on :8731
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { launch, pageUrl } from './cdp.ts';
import type { Page } from './cdp.ts';

let page: Page;
before(async () => {
  page = await launch();
  await page.open(pageUrl());
  await page.waitFor('the app', '!!window.app', value => value === true, 10_000);
  await page.evaluate('localStorage.removeItem("m7.progress"); location.reload(); true');
  await page.waitFor('the app after a reload', '!!window.app && document.getElementById("menu").classList.contains("shown")',
    value => value === true, 10_000);
});
after(async () => { await page?.close(); });

const is = (want: unknown) => (value: unknown) => value === want;
const VISIBLE = `[...document.querySelectorAll('[data-widget]')]
  .filter(e => !e.classList.contains('hidden-ctrl')).map(e => e.dataset.widget).sort().join()`;
/** Leave whatever is running, open lesson `id`'s brief and start it. */
async function openLesson(id: string) {
  await page.evaluate('document.getElementById("btn-quit")?.click(); document.querySelector("[data-close]")?.click(); true');
  await page.evaluate(`document.querySelector('[data-mode="${id}"]').click()`);
  await page.waitFor(`the ${id} brief`, 'document.getElementById("brief").classList.contains("shown")', is(true), 2_000);
  await page.evaluate('document.getElementById("btn-brief-go").click()');
  await page.waitFor(`the ${id} lesson running`, 'window.app.running && window.app.modeKey', is(id), 3_000);
}

test('the sweep lesson, cameras up, shows the camera light', async () => {
  await openLesson('sweep');
  assert.equal(await page.evaluate(VISIBLE), 'camlight');
  assert.equal(await page.evaluate('window.app.coach.cue.sel'), '.camb[data-cam="10"]', 'the first cue is CAM 10');
  // The light cue appears only once the camera has been selected.
  await page.evaluate(`(() => { const el = document.querySelector('.camb[data-cam="10"]');
    for (const type of ['pointerdown', 'pointerup']) el.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 41 }));
    return true; })()`);
  await page.waitFor('then the camera light cue', 'window.app.coach.cue.sel', is('[data-widget="camlight"]'), 1_000);
});

test('the office lesson, cameras down, shows the office flashlight', async () => {
  await openLesson('office');
  assert.equal(await page.evaluate('window.app.sim.camsUp'), true, 'it starts with the cameras up');
  await page.evaluate('window.app.sim.setMonitor(false); window.app.sim.monAnim = 0; window.app.sim.monitor = "down"; true');
  await page.waitFor('the office light showing', VISIBLE, is('light,mask,monitor'), 1_000);
  assert.equal(await page.evaluate('window.app.coach.lightSel'), '[data-widget="light"]', 'the coach cues the office light');
});

test('in the full cycle the two lights swap as the monitor moves', async () => {
  await openLesson('cycle');
  await page.evaluate('window.app.sim.monitor = "down"; true');
  await page.waitFor('down: the office light', VISIBLE, is('light,mask,monitor,wind'), 1_000);
  await page.evaluate('window.app.sim.monitor = "up"; true');
  await page.waitFor('up: the camera light', VISIBLE, is('camlight,mask,monitor,wind'), 1_000);
});

test('both lights can be dragged while calibrating', async () => {
  await page.evaluate('document.getElementById("btn-quit").click(); true');
  await page.evaluate('document.querySelector(\'[data-ui="settings"]\').click(); true');
  await page.waitFor('the settings panel', 'document.getElementById("settings").classList.contains("shown")', is(true), 2_000);
  await page.evaluate('document.getElementById("btn-calibrate").click(); true');
  await page.waitFor('calibrating', 'window.app.ui.calibrating', is(true), 2_000);
  await page.waitFor('every control shown', VISIBLE, is('camlight,light,mask,monitor,ventL,ventR,wind'), 1_000);
  assert.equal(await page.evaluate('document.querySelectorAll(".collide").length'), 0, 'no overlap is flagged');
});

test('no console error or uncaught exception', () => {
  assert.deepEqual(page.problems, []);
});
