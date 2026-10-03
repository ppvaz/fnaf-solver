#!/usr/bin/env node
// Check that serve.ts (the trainer's dev server) writes for this machine only. POST /save-layout rewrites
// packages/source/src/games/fnaf2/config.ts and /save-trace writes under captures/traces/. Until 2026-09-29 the
// server bound 0.0.0.0, so anyone on the network could do either. This pins:
//   - the socket binds 127.0.0.1 by default,
//   - a write from a loopback client with its own Host and Origin is accepted (the trainer's same-origin fetch,
//     and a Node or curl client with no Origin),
//   - a write is refused (403, nothing written) when a page on another origin posts it, when the Host names
//     another machine (DNS rebinding), or when the client is not loopback -- the last through writeRefusal,
//     since a test cannot open a non-loopback connection to a loopback socket,
//   - no write answer carries Access-Control-Allow-Origin,
//   - a .ts module is served as JavaScript with its types erased, and nothing outside the root is.
// Everything runs as dry runs or against a temporary FNAF_TRACE_DIR; the core config is never written.
//
//   node apps/trainer/test/serve.test.ts
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const traceDir = mkdtempSync(join(tmpdir(), 'serve-test-'));
process.env.FNAF_TRACE_DIR = traceDir;
const { DEV_META, HOST, makeServer, writeRefusal } = await import('./serve.ts');

type Answer = { status: number, headers: Record<string, string | string[] | undefined>, body: string };
const call = (port: number, method: string, path: string, headers: Record<string, string> = {}, body?: string) =>
  new Promise<Answer>((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, method, path, headers: { ...headers, ...(body === undefined ? {} : { 'Content-Length': String(Buffer.byteLength(body)) }) } }, res => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { text += chunk; });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: text }));
    });
    req.on('error', reject);
    req.end(body);
  });
const listening = (port: number, root?: string) => new Promise<ReturnType<typeof makeServer>>(resolve => {
  const server = root === undefined ? makeServer(port) : makeServer(port, HOST, root);
  server.on('listening', () => resolve(server));
});
const portOf = (server: ReturnType<typeof makeServer>) => (server.address() as AddressInfo).port;

assert.equal(HOST, '127.0.0.1', 'the default bind is loopback');
// writeRefusal, one refusal per rule, and the accepted shapes.
assert.notEqual(writeRefusal('192.168.1.20', 'localhost:8731', null), null, 'an off-host client is refused');
assert.notEqual(writeRefusal('fe80::1', 'localhost:8731', null), null, 'an IPv6 off-host client is refused');
assert.notEqual(writeRefusal('127.0.0.1', 'evil.example:8731', null), null, 'a rebound Host is refused');
assert.notEqual(writeRefusal('127.0.0.1', null, null), null, 'a missing Host is refused');
assert.notEqual(writeRefusal('127.0.0.1', 'localhost:8731', 'http://evil.example'), null, 'a foreign Origin is refused');
assert.notEqual(writeRefusal('127.0.0.1', 'localhost:8731', 'null'), null, 'an opaque Origin is refused');
assert.notEqual(writeRefusal('127.0.0.1', 'localhost:8731', 'http://localhost:3000'), null, 'another local port is another origin');
for (const [client, host, origin] of [['127.0.0.1', '127.0.0.1:8731', null], ['127.0.0.1', 'localhost:8731', 'http://localhost:8731'],
  ['::1', '[::1]:8731', 'http://[::1]:8731'], ['::ffff:127.0.0.1', 'localhost', null], ['127.0.0.1', 'localhost:9000', 'http://localhost:9000']] as const)
  assert.equal(writeRefusal(client, host, origin), null, `${client} ${host} ${origin} may write`);

const server = await listening(0);
const probeRoot = realpathSync(mkdtempSync(join(tmpdir(), 'serve-root-')));
const probe = await listening(0, probeRoot);
try {
  const port = portOf(server);
  assert.equal((server.address() as AddressInfo).address, '127.0.0.1', 'the socket is bound to 127.0.0.1');
  const page = await call(port, 'GET', '/index.html');
  assert.equal(page.status, 200, 'the trainer is served');
  assert.equal(page.body.split(DEV_META).length - 1, 1, 'the page names what this server writes, once');

  // A .ts module is served as JavaScript with its types erased; a path outside the root and a missing one are not.
  writeFileSync(join(probeRoot, 'probe.ts'), 'export const answer: number = 42;\nexport interface Shape { a: string }\n');
  const module = await call(portOf(probe), 'GET', '/probe.ts');
  assert.equal(module.status, 200, 'a .ts module is served');
  assert.ok(String(module.headers['content-type']).startsWith('text/javascript'), 'as JavaScript');
  assert.ok(module.body.includes('export const answer         = 42;') && !module.body.includes('interface'), 'with its types erased');
  for (const path of ['/../outside.ts', '/missing.ts']) assert.equal((await call(portOf(probe), 'GET', path)).status, 404, `${path} is not served`);

  const trace = { v: 1, lesson: 'cycle', steps: [{ stepId: 'a', grade: 'ok' }], dry: true };
  const own = `127.0.0.1:${port}`;
  const json = (headers: Record<string, string>) => ({ 'Content-Type': 'application/json', ...headers });
  let answer = await call(port, 'POST', '/save-trace', json({ Host: own }), JSON.stringify(trace));
  assert.ok(answer.status === 200 && JSON.parse(answer.body).dry === true, 'a loopback client with no Origin writes');
  assert.equal(answer.headers['access-control-allow-origin'], undefined, 'no write answer allows other origins');
  answer = await call(port, 'POST', '/save-trace', json({ Host: `localhost:${port}`, Origin: `http://localhost:${port}` }), JSON.stringify(trace));
  assert.equal(answer.status, 200, "the page's own origin writes");

  const real = JSON.stringify({ ...trace, dry: false });
  for (const [name, path, headers] of [
    ['a foreign page', '/save-trace', { Host: own, Origin: 'http://evil.example' }],
    ['a rebound Host', '/save-trace', { Host: `evil.example:${port}` }],
    ['a foreign page on save-layout', '/save-layout', { Host: own, Origin: 'https://evil.example' }],
    ['a rebound Host on save-layout', '/save-layout', { Host: `evil.example:${port}` }],
  ] as const) {
    answer = await call(port, 'POST', path, json(headers), real);
    assert.ok(answer.status === 403 && 'error' in JSON.parse(answer.body), `${name} is refused`);
  }
  assert.deepEqual(readdirSync(traceDir), [], 'a refused write wrote nothing');
} finally {
  server.close();
  probe.close();
  rmSync(traceDir, { recursive: true, force: true });
  rmSync(probeRoot, { recursive: true, force: true });
}

console.log('serve: binds 127.0.0.1, writes from this machine\'s own page or a loopback client, refuses a foreign origin, '
  + 'a rebound Host and an off-host client, sends no Access-Control-Allow-Origin, and serves a .ts module as JavaScript '
  + 'with its types erased');
