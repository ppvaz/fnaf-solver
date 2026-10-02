// The Pages entry, as a visitor's phone gets it, from a server that only
// answers GET -- which is all GitHub Pages is. Until 2026-09-30 Pages served
// master's tree as committed, so the entry was the root index.html, unbundled,
// its import map resolving @sixam/source and @sixam/kernel to files; from
// d3b5fc93 until 155abe07 (2026-09-30) that published trainer failed on load
// ("Failed to resolve module specifier @sixam/source/fnaf2") while every other
// browser check passed. Since the sources became TypeScript that a browser
// cannot run (Pedro, 2026-09-30: "runtime .ts", with an Actions Pages build),
// .github/workflows/pages.yml publishes the tree as the branch build did with
// index.html replaced by build.py's bundle, types stripped. This builds that
// bundle, serves it at / over the repository's other files, and fails on any
// console error, uncaught exception, failed or 4xx request, or page wider than
// a phone's screen, sideways or upright.
//
//   node apps/trainer/test/pages.test.ts [url]   # default: its own static server
import { spawn, spawnSync } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromeBinary, chromeArgs } from '../../../tools/chrome.ts';

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
      // Set on every request a server receives.
      const path = normalize(decodeURIComponent(new URL(req.url as string, 'http://x').pathname));
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

const PORT = 9346;
// Phone viewports in CSS pixels: an iPhone upright, then a common Android and
// an iPhone held sideways, the way the trainer is played.
const VIEWPORTS = [[390, 844], [640, 360], [844, 390]];
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
/** An entry of Chrome's /json target list. */
interface Target { readonly type: string, readonly webSocketDebuggerUrl: string }
interface ExceptionDetails { readonly text: string, readonly exception?: { readonly description?: string } }
/** What this test reads of each DevTools method's reply; any other reply it ignores. */
interface Replies { 'Runtime.evaluate': { readonly result?: { readonly value?: unknown }, readonly exceptionDetails?: ExceptionDetails } }
type Reply<M extends string> = M extends keyof Replies ? Replies[M] : unknown;
/** A DevTools message: the reply to a request carries its id, and its result or an error. */
interface Message<R> { readonly id?: number, readonly result: R, readonly error?: { readonly message: string } }
/** The events this test reads; it passes over every other message. */
type CdpEvent =
  | { readonly method: 'Runtime.consoleAPICalled', readonly params: { readonly type: string, readonly args: readonly { readonly value?: unknown, readonly description?: string }[] } }
  | { readonly method: 'Runtime.exceptionThrown', readonly params: { readonly exceptionDetails: ExceptionDetails } }
  | { readonly method: 'Log.entryAdded', readonly params: { readonly entry: { readonly level: string, readonly text: string, readonly url?: string } } }
  | { readonly method: 'Network.loadingFailed', readonly params: { readonly canceled?: boolean, readonly errorText: string } }
  | { readonly method: 'Network.responseReceived', readonly params: { readonly response: { readonly status: number, readonly url: string } } };
let id = 0;
const rpc = <M extends string>(ws: WebSocket, method: M, params = {}) => new Promise<Reply<M>>((res, rej) => {
  const mid = ++id;
  const on = (e: MessageEvent) => { const m: Message<Reply<M>> = JSON.parse(e.data); if (m.id !== mid) return;
    ws.removeEventListener('message', on); m.error ? rej(new Error(`${method}: ${m.error.message}`)) : res(m.result); };
  ws.addEventListener('message', on); ws.send(JSON.stringify({ id: mid, method, params }));
});

const problems: string[] = [], fails: string[] = [];
async function main(url: string, chrome: ChildProcess) {
  let target: Target | undefined;
  for (let i = 0; i < 60 && !target; i++) {
    try { target = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).find((x: Target) => x.type === 'page'); }
    catch { await sleep(200); }
  }
  // Found above: a fresh Chrome opens about:blank (chromeArgs), a page target.
  const ws = new WebSocket((target as Target).webSocketDebuggerUrl);
  await new Promise<Event>(r => ws.addEventListener('open', r));
  ws.addEventListener('message', e => {
    const m: CdpEvent = JSON.parse(e.data);
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
  const ev = async (expr: string) => {
    const r = await rpc(ws, 'Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) problems.push(`evaluate: ${r.exceptionDetails.exception?.description || r.exceptionDetails.text}`);
    return r.result?.value;
  };
  // A tap the page counts as a person's (user activation), dispatched as
  // input rather than a scripted click, which Chrome does not count.
  const tap = async (selector: string) => {
    // The page function returns the element's centre.
    const box = await ev(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`) as { readonly x: number, readonly y: number };
    for (const type of ['mousePressed', 'mouseReleased'])
      await rpc(ws, 'Input.dispatchMouseEvent', { type, x: box.x, y: box.y, button: 'left', clickCount: 1 });
  };
  // Each test names the type its expression evaluates to in the page.
  const expect = async <T>(label: string, expr: string, test: (v: T) => boolean) => {
    const v = await ev(expr);
    const ok = test(v as T);
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
    await expect('lessons listed', 'document.querySelectorAll("#mode-list .mode").length', (v: number) => v > 0);
    await expect('no sideways scroll', 'document.documentElement.scrollWidth - innerWidth', (v: number) => v <= 0);
  }
  // Sideways, the first screen says what the trainer teaches and why the bot
  // plays another route, and every statement about a route wears its label.
  await expect('it names what it teaches', 'document.getElementById("teaches").textContent',
    (v: string) => /Niko Frost/.test(v) && /Minus.7/.test(v));
  await expect('it names the bot\'s route', 'document.getElementById("route-note").textContent',
    (v: string) => /Minus.Toys/.test(v) && /Zach_Scream/.test(v));
  await expect('the route note is on the first screen',
    'document.getElementById("route-note").getBoundingClientRect().top < innerHeight', v => v === true);
  await expect('every route statement carries a claim level',
    '[...document.querySelectorAll(".fact")].map(li => li.querySelector(".label")?.textContent)',
    (v: string[]) => v.length >= 7 && v.every(label => ['MODEL_ONLY', 'FIXTURE', 'DEVICE_MEASURED'].includes(label)));
  await expect('a full night says its model status is UNKNOWN',
    '(window.app.brief("night"), document.getElementById("brief-status").textContent)', (v: string) => /UNKNOWN/.test(v));
  await ev('document.getElementById("btn-brief-back").click()');
  await sleep(200);
  // No dev server here, so nothing offers to write one.
  await expect('no layout save offered', 'getComputedStyle(document.getElementById("row-savemap")).display', v => v === 'none');

  // A lesson runs on the Sim the build bundled, and ending it -- which saves the run's
  // trace where a dev server is there to take it -- must not reach for one
  // that is not.
  await tap('#mode-list .mode');
  await sleep(300);
  await tap('#btn-brief-go');
  await sleep(3500);
  await expect('a lesson runs on the Sim', 'window.app.sim.frame', (v: number) => v > 120);
  await expect('the coach graded a step', 'window.app.coach.trace.length', (v: number) => v > 0);
  await tap('#btn-quit');
  await sleep(800);
  await expect('back on the menu', 'document.getElementById("menu").classList.contains("shown")', v => v === true);

  console.log(`\nproblems: ${problems.length}`);
  for (const p of problems) console.log(`  ! ${p.split('\n')[0]}`);
  console.log(fails.length ? `FAILURES: ${fails.join(', ')}` : 'all assertions passed');
  ws.close();
}

const given = process.argv.find(arg => /^https?:\/\//.test(arg));
if (!given) {
  const build = spawnSync('python3', [join(ROOT, 'apps/trainer/test/build.py')], { cwd: ROOT, encoding: 'utf8' });
  if (build.status !== 0) { console.error(build.stderr || build.stdout); process.exit(2); }
}
const server = given ? null : await staticServer();
// Without a given url, staticServer() is listening on a TCP port.
const url = given || `http://127.0.0.1:${((server as Server).address() as AddressInfo).port}/index.html`;
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
