// The Pages entry, as a visitor's phone gets it, from a server that only
// answers GET -- which is all GitHub Pages is. Until 2026-09-30 Pages served
// master's tree as committed, so the entry was the root index.html, unbundled,
// its import map resolving @sixam/source and @sixam/kernel to files; from
// d3b5fc93 until 155abe07 (2026-09-30) that published trainer failed on load
// ("Failed to resolve module specifier @sixam/source/fnaf2") while every other
// browser check passed. Since the sources became TypeScript that a browser
// cannot run (Pedro, 2026-09-30: "runtime .ts", with an Actions Pages build),
// .github/workflows/pages.yml publishes the tree as the branch build did with
// index.html replaced by build.ts's bundle, types stripped. This builds that
// bundle, serves it at / over the repository's other files, and fails on any
// console error, uncaught exception, failed or 4xx request, or page wider than
// a phone's screen, sideways or upright.
//
//   node apps/trainer/test/pages.test.ts [url]   # default: its own static server
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { isList } from '@sixam/kernel';
import { launch } from './cdp.ts';
import type { Page } from './cdp.ts';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const TYPES: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png' };

// The published site: / and /index.html are the built bundle, every other
// path a file under the repository; 404 otherwise, 405 for any other method.
const ENTRY = new Set(['/', '/index.html']);
function staticServer() {
  return new Promise<Server>(resolve => {
    const server = createServer(async (req, res) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return; }
      const path = normalize(decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname));
      let file = ENTRY.has(path) ? join(ROOT, 'dist/index.html') : join(ROOT, path);
      try {
        if (!file.startsWith(ROOT)) throw new Error('outside the repository');
        if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
        const body = await readFile(file);
        res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream' });
        res.end(req.method === 'HEAD' ? undefined : body);
      } catch { res.writeHead(404); res.end(); }
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

// Phone viewports in CSS pixels: an iPhone upright, then a common Android and
// an iPhone held sideways, the way the trainer is played.
const VIEWPORTS = [[390, 844], [640, 360], [844, 390]];

const given = process.argv.find(arg => /^https?:\/\//.test(arg));
if (!given) {
  const build = spawnSync(process.execPath, [join(ROOT, 'apps/trainer/test/build.ts')], { cwd: ROOT, encoding: 'utf8' });
  if (build.status !== 0) { console.error(build.stderr || build.stdout); process.exit(2); }
}
const server = given ? null : await staticServer();
const address = server?.address();
const url = given ?? `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}/index.html`;

let page: Page;
before(async () => { page = await launch({ domains: ['Runtime', 'Page', 'Log', 'Network'] }); });
after(async () => { await page?.close(); server?.close(); });

const is = (want: unknown) => (value: unknown) => value === want;
const text = async (expression: string) => String(await page.evaluate(expression));
/**
 * A tap the page counts as a person's (user activation), dispatched as input
 * rather than a scripted click, which Chrome does not count.
 */
async function tap(selector: string) {
  const box = await page.evaluate(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
    return [r.left + r.width / 2, r.top + r.height / 2]; })()`);
  assert.ok(isList(box) && box.length === 2 && box.every(n => typeof n === 'number'), `${selector} has a box`);
  const [x, y] = box;
  for (const type of ['mousePressed', 'mouseReleased'])
    await page.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
}

for (const [width, height] of VIEWPORTS) {
  test(`the entry loads at ${width}x${height}`, async () => {
    await page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile: true });
    await page.open(url);
    await page.waitFor('the app started', '!!window.app', is(true), 10_000);
    assert.equal(await page.evaluate('document.getElementById("menu").classList.contains("shown")'), true, 'the menu is shown');
    const lessons = await page.evaluate('document.querySelectorAll("#mode-list .mode").length');
    assert.ok(typeof lessons === 'number' && lessons > 0, 'lessons listed');
    const overflow = await page.evaluate('document.documentElement.scrollWidth - innerWidth');
    assert.ok(typeof overflow === 'number' && overflow <= 0, `no sideways scroll (${String(overflow)} px over)`);
  });
}

// Sideways, the first screen says what the trainer teaches and why the bot
// plays another route, and every statement about a route wears its label.
test('the first screen names what it teaches and labels every route statement', async () => {
  const teaches = await text('document.getElementById("teaches").textContent');
  assert.match(teaches, /Niko Frost/); assert.match(teaches, /Minus.7/);
  const route = await text('document.getElementById("route-note").textContent');
  assert.match(route, /Minus.Toys/); assert.match(route, /Zach_Scream/);
  assert.equal(await page.evaluate('document.getElementById("route-note").getBoundingClientRect().top < innerHeight'), true,
    'the route note is on the first screen');
  const labels = await page.evaluate('[...document.querySelectorAll(".fact")].map(li => li.querySelector(".label")?.textContent ?? null)');
  assert.ok(isList(labels) && labels.length >= 7, 'at least seven route statements');
  for (const label of labels) assert.ok(['MODEL_ONLY', 'FIXTURE', 'DEVICE_MEASURED'].includes(String(label)), `claim level ${String(label)}`);
  assert.match(await text('(window.app.brief("night"), document.getElementById("brief-status").textContent)'), /UNKNOWN/,
    'a full night says its model status is UNKNOWN');
  await page.evaluate('document.getElementById("btn-brief-back").click(); true');
  await page.waitFor('the menu again', 'document.getElementById("menu").classList.contains("shown")', is(true), 2_000);
  // No dev server here, so nothing offers to write one.
  assert.equal(await page.evaluate('getComputedStyle(document.getElementById("row-savemap")).display'), 'none',
    'no layout save offered');
});

// A lesson runs on the Sim the build bundled, and ending it -- which saves the run's
// trace where a dev server is there to take it -- must not reach for one
// that is not.
test('a lesson runs on the bundled Sim and quits cleanly', async () => {
  await tap('#mode-list .mode');
  await page.waitFor('the brief', 'document.getElementById("brief").classList.contains("shown")', is(true), 2_000);
  await tap('#btn-brief-go');
  // start() loads the sounds before it builds the Sim, so there is none at first.
  await page.waitFor('a lesson running on the Sim', '(window.app.sim?.frame ?? 0) > 120', is(true), 10_000);
  await page.waitFor('the coach grading a step', '(window.app.coach?.trace.length ?? 0) > 0', is(true), 10_000);
  await tap('#btn-quit');
  await page.waitFor('back on the menu', 'document.getElementById("menu").classList.contains("shown")', is(true), 3_000);
});

test('no console error, exception, failed or 4xx request', () => {
  assert.deepEqual(page.problems, []);
});
