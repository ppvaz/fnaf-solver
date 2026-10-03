// Calibration smoke test: dragging a control must reposition it and must NOT
// register as a game input, and the saved layout must reach canonical core config.
//
//   node apps/trainer/test/calibration.test.ts [url]   # default: the dev server on :8731
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { after, before, test } from 'node:test';
import { launch, pageUrl } from './cdp.ts';
import type { Page } from './cdp.ts';

// This test exercises the save-to-config path, which really does rewrite
// core config. Snapshot it so a test run never leaves the repo edited.
const CONFIG = new URL('../../../packages/source/src/games/fnaf2/config.ts', import.meta.url).pathname;
const SNAPSHOT = readFileSync(CONFIG, 'utf8');
const restore = () => {
  try {
    if (readFileSync(CONFIG, 'utf8') !== SNAPSHOT) {
      writeFileSync(CONFIG, SNAPSHOT);
      execFileSync(process.execPath, [new URL('./build.ts', import.meta.url).pathname], { stdio: 'ignore' });
      console.log('(restored canonical core config and rebuilt)');
    }
  } catch (e) { console.error('RESTORE FAILED:', (e as Error).message); }
};
process.on('exit', restore);

let page: Page;
before(async () => {
  page = await launch();
  await page.open(pageUrl());
  await page.waitFor('the app', '!!window.app', value => value === true, 10_000);
});
after(async () => { await page?.close(); });

const is = (want: unknown) => (value: unknown) => value === want;
const shown = (id: string) => `document.getElementById(${JSON.stringify(id)}).classList.contains("shown")`;
/** Press `selector` with pointer `id`, move it by (dx, dy) and let go: a drag, as the page sees one. */
const drag = (selector: string, dx: number, dy: number, id: number) => page.evaluate(`(() => {
  const el = document.querySelector(${JSON.stringify(selector)});
  const b = el.getBoundingClientRect();
  const p = (type, x, y) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: ${id}, clientX: x, clientY: y }));
  p('pointerdown', b.left + 8, b.top + 8); p('pointermove', b.left + 8 + ${dx}, b.top + 8 + ${dy});
  p('pointerup', b.left + 8 + ${dx}, b.top + 8 + ${dy}); return true; })()`);
/** Drag `selector` and wait for `field` of the stored layout to leave its value. */
async function dragMoves(label: string, selector: string, field: string, dx: number, dy: number, id: number) {
  const before = await page.evaluate(field);
  await drag(selector, dx, dy, id);
  await page.waitFor(`${label} moved`, `${field} !== ${JSON.stringify(before)}`, is(true), 2_000);
}

test('calibration opens on its own session with every control placed', async () => {
  await page.evaluate('document.querySelector(\'[data-ui="settings"]\').click(); true');
  await page.waitFor('the settings panel', shown('settings'), is(true), 2_000);
  await page.evaluate('document.getElementById("btn-calibrate").click(); true');
  await page.waitFor('calibrating', 'window.app.ui.calibrating', is(true), 2_000);
  // The run panel slides in; a drag measured mid-transition lands short. Wait
  // for every animation that ends (the looping ones never do) to finish.
  await page.waitFor('the run panel settled', `document.getAnimations()
    .filter(a => a.effect?.getComputedTiming().iterations !== Infinity && a.playState === 'running').length`, is(0), 3_000);
  assert.equal(await page.evaluate(shown('run')), true, 'the run panel is shown');
  assert.equal(await page.evaluate('window.app.sim.monitor'), 'up', 'the monitor is forced up');
  assert.equal(await page.evaluate('document.getElementById("windbtn").classList.contains("shown")'), true, 'WIND is visible');
  assert.equal(await page.evaluate('[...document.querySelectorAll("[data-widget]")].every(e => e.style.left !== "")'), true,
    'every control is placed');
});

test('dragging a control moves it and is no game input', async () => {
  await dragMoves('WIND', '#windbtn', 'window.app.ui.widgets.wind.y', 40, -60, 7);
  assert.equal(await page.evaluate('window.app.sim.winding'), false, 'the drag did not wind');
  await dragMoves('LIGHT', '[data-widget="light"]', 'window.app.ui.widgets.light.x', 110, 0, 8);
  assert.equal(await page.evaluate('window.app.sim.lightHeld'), false, 'the drag did not flash');
  await dragMoves('CAM 07', '.camb[data-cam="7"]', 'window.app.ui.map["7"].x', -30, 0, 10);
  console.log(`  screenshot: ${await page.screenshot('calibration.png')}`);
});

test('the layout save validates', async () => {
  await page.evaluate('document.getElementById("btn-quit").click(); true');
  await page.evaluate('document.querySelector(\'[data-ui="settings"]\').click(); true');
  await page.waitFor('the settings panel', shown('settings'), is(true), 2_000);
  // Dry run: exercises validation and the whole client path without rewriting
  // canonical core config, which earlier versions of this test silently destroyed.
  const saved = await page.evaluate(`(async () => {
    const r = await fetch('/save-layout', {method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ map: window.app.ui.map, widgets: window.app.ui.widgets, dry: true })});
    const body = await r.json();
    return { status: r.status, ok: body?.ok === true, dry: body?.dry === true };
  })()`);
  assert.deepEqual(saved, { status: 200, ok: true, dry: true });
});

test('game input works again outside calibration', async () => {
  await page.evaluate('document.querySelector("[data-close]").click(); true');
  await page.evaluate('document.querySelector(\'[data-mode="cycle"]\').click(); true');
  await page.waitFor('the brief', shown('brief'), is(true), 2_000);
  await page.evaluate('document.getElementById("btn-brief-go").click(); true');
  await page.waitFor('the cycle running', 'window.app.running && window.app.modeKey', is('cycle'), 3_000);
  assert.equal(await page.evaluate('window.app.ui.calibrating'), false, 'calibration is off');
  await page.evaluate(`(() => { document.querySelector('[data-act="light"]').dispatchEvent(
    new PointerEvent('pointerdown', { bubbles: true, pointerId: 9 })); return true; })()`);
  await page.waitFor('the light held', 'window.app.sim.lightHeld', is(true), 1_000);
});

test('no console error or uncaught exception', () => {
  assert.deepEqual(page.problems, []);
});
