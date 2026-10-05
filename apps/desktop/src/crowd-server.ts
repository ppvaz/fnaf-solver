import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { isCrowdGame } from '@sixam/source';
import { isRecord } from '@sixam/kernel';
import type { CrowdGrid } from '@sixam/play/recompile/crowd-grid';

const WEB = new URL('../web/crowd/', import.meta.url);
const ASSETS = new Map([
  ['/', ['index.html', 'text/html']], ['/style.css', ['style.css', 'text/css']], ['/app.js', ['app.js', 'text/javascript']],
]);

/** Check loopback Host and same-origin writes; browser requests cannot choose a runtime or file path. */
function ownRequest(req: IncomingMessage) {
  const host = req.headers.host;
  if (!host || !/^(?:127\.0\.0\.1|localhost|\[::1\]):\d+$/.test(host)) return false;
  const address = req.socket.remoteAddress;
  if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address ?? '')) return false;
  return req.headers.origin === undefined || req.headers.origin === `http://${host}`;
}

async function body(req: IncomingMessage): Promise<unknown> {
  let text = '';
  for await (const chunk of req) {
    text += String(chunk);
    if (Buffer.byteLength(text) > 2048) throw new Error('Request too large');
  }
  return JSON.parse(text);
}
function json(res: ServerResponse, code: number, value: unknown) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(value));
}

export function crowdServer(grid: CrowdGrid) {
  return createServer((req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self'; style-src 'self'; script-src 'self'; frame-ancestors 'none'");
    if (!ownRequest(req)) { json(res, 403, { error: 'This session accepts local, same-origin requests only' }); return; }
    void route(req, res, grid).catch(error => {
      if (!res.headersSent) json(res, 400, { error: error instanceof Error ? error.message : String(error) });
      else res.destroy();
    });
  });
}

async function route(req: IncomingMessage, res: ServerResponse, grid: CrowdGrid) {
  const path = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
  const asset = ASSETS.get(path);
  if (req.method === 'GET' && asset) {
    const [name, mime] = asset;
    const data = await readFile(new URL(name, WEB));
    res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'no-store' }); res.end(data); return;
  }
  if (req.method === 'GET' && path === '/api/status') { json(res, 200, grid.snapshot()); return; }
  const match = /^\/api\/frame\/(FNAF[1-4])$/.exec(path);
  if (req.method === 'GET' && match && isCrowdGame(match[1])) {
    const bytes = await grid.frame(match[1]);
    res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-store' }); res.end(bytes); return;
  }
  if (req.method === 'POST' && path === '/api/command') {
    if (req.headers['content-type'] !== 'application/json') throw new Error('Use application/json');
    const value = await body(req);
    if (!isRecord(value) || typeof value.text !== 'string') throw new Error('Command text is required');
    try { await grid.command(value.text); json(res, 200, { accepted: true, status: grid.snapshot() }); }
    catch (error) { json(res, 409, { error: error instanceof Error ? error.message : String(error), status: grid.snapshot() }); }
    return;
  }
  if (path === '/favicon.ico') { res.writeHead(204); res.end(); return; }
  json(res, 404, { error: 'Unknown endpoint' });
}
