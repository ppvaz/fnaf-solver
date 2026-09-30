// The Pages entry, as a visitor's phone gets it: the repository root's
// index.html, unbundled, its import map resolving @sixam/source and
// @sixam/kernel to files, from a server that only answers GET -- which is all
// GitHub Pages is. The other browser checks load the dist/ bundle from the dev
// server, which has no import map and accepts POSTs, so from d3b5fc93 until
// 155abe07 (2026-09-30) the published trainer failed on load ("Failed to
// resolve module specifier @sixam/source/fnaf2") while every one of them
// passed. This starts its own static server over the repository and fails on
// any console error, uncaught exception, failed or 4xx request, or page wider
// than a phone's screen, sideways or upright.
//
//   node apps/trainer/test/pages.test.mjs [url]   # default: its own static server
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromeBinary, chromeArgs } from '../../../tools/chrome.mjs';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png' };

// GET files under the repository, 404 otherwise, 405 for any other method.
function staticServer() {
  return new Promise(resolve => {
    const server = createServer(async (req, res) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return; }
      const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname));
      let file = join(ROOT, path);
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

const PORT = 9346;
// Phone viewports in CSS pixels: an iPhone upright, then a common Android and
// an iPhone held sideways, the way the trainer is played.
const VIEWPORTS = [[390, 844], [640, 360], [844, 390]];
const sleep = ms => new Promise(r => setTimeout(r, ms));
let id = 0;
const rpc = (ws, method, params = {}) => new Promise((res, rej) => {
  const mid = ++id;
  const on = e => { const m = JSON.parse(e.data); if (m.id !== mid) return;
    ws.removeEventListener('message', on); m.error ? rej(new Error(`${method}: ${m.error.message}`)) : res(m.result); };
  ws.addEventListener('message', on); ws.send(JSON.stringify({ id: mid, method, params }));
});

const problems = [], fails = [];
async function main(url, chrome) {
  let target;
  for (let i = 0; i < 60 && !target; i++) {
    try { target = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).find(x => x.type === 'page'); }
    catch { await sleep(200); }
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener('open', r));
  ws.addEventListener('message', e => {
    const m = JSON.parse(e.data);
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error')
      problems.push(`console.error: ${m.params.args.map(a => a.value ?? a.description).join(' ')}`);
    if (m.method === 'Runtime.exceptionThrown')
      problems.push(`exception: ${m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text}`);
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error')
      problems.push(`log: ${m.params.entry.text} ${m.params.entry.url || ''}`);
    if (m.method === 'Network.loadingFailed' && !m.params.canceled) problems.push(`request failed: ${m.params.errorText}`);
    if (m.method === 'Network.responseReceived' && m.params.response.status >= 400)
      problems.push(`HTTP ${m.params.response.status}: ${m.params.response.url}`);
  });
  for (const domain of ['Runtime', 'Page', 'Log', 'Network']) await rpc(ws, `${domain}.enable`);
  const ev = async expr => {
    const r = await rpc(ws, 'Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) problems.push(`evaluate: ${r.exceptionDetails.exception?.description || r.exceptionDetails.text}`);
    return r.result?.value;
  };
  // A tap the page counts as a person's (user activation), dispatched as
  // input rather than a scripted click, which Chrome does not count.
  const tap = async selector => {
    const box = await ev(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    for (const type of ['mousePressed', 'mouseReleased'])
      await rpc(ws, 'Input.dispatchMouseEvent', { type, x: box.x, y: box.y, button: 'left', clickCount: 1 });
  };
  const expect = async (label, expr, test) => {
    const v = await ev(expr);
    const ok = test(v);
    console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}: ${JSON.stringify(v)}`);
    if (!ok) fails.push(label);
  };

  for (const [width, height] of VIEWPORTS) {
    console.log(`\n— ${url} at ${width}x${height} —`);
    await rpc(ws, 'Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile: true });
    await rpc(ws, 'Page.navigate', { url });
    await sleep(2000);
    await expect('the app started', '!!window.app', v => v === true);
    await expect('the menu is shown', 'document.getElementById("menu").classList.contains("shown")', v => v === true);
    await expect('lessons listed', 'document.querySelectorAll("#mode-list .mode").length', v => v > 0);
    await expect('no sideways scroll', 'document.documentElement.scrollWidth - innerWidth', v => v <= 0);
  }
  // No dev server here, so nothing offers to write one.
  await expect('no layout save offered', 'getComputedStyle(document.getElementById("row-savemap")).display', v => v === 'none');

  // A lesson runs on the unbundled Sim, and ending it -- which saves the run's
  // trace where a dev server is there to take it -- must not reach for one
  // that is not.
  await tap('#mode-list .mode');
  await sleep(300);
  await tap('#btn-brief-go');
  await sleep(3500);
  await expect('a lesson runs on the Sim', 'window.app.sim.frame', v => v > 120);
  await expect('the coach graded a step', 'window.app.coach.trace.length', v => v > 0);
  await tap('#btn-quit');
  await sleep(800);
  await expect('back on the menu', 'document.getElementById("menu").classList.contains("shown")', v => v === true);

  console.log(`\nproblems: ${problems.length}`);
  for (const p of problems) console.log(`  ! ${p.split('\n')[0]}`);
  console.log(fails.length ? `FAILURES: ${fails.join(', ')}` : 'all assertions passed');
  ws.close();
}

const given = process.argv.find(arg => /^https?:\/\//.test(arg));
const server = given ? null : await staticServer();
const url = given || `http://127.0.0.1:${server.address().port}/index.html`;
const chrome = spawn(chromeBinary(), chromeArgs(PORT, mkdtempSync(join(tmpdir(), 'm7p-'))), { stdio: 'ignore' });
let code = 0;
try {
  await main(url, chrome);
  code = fails.length || problems.length ? 1 : 0;
} catch (e) {
  console.error(e);
  code = 2;
} finally {
  chrome.kill();
  server?.close();
}
process.exit(code);
