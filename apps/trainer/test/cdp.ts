// One headless Chrome and its first page, driven over the DevTools protocol:
// the harness every trainer browser check shares. Until 2026-10-02 each of the
// six checks carried its own copy of this, and the copies had drifted (three
// read console.error, four read a failed evaluation, three ways to find the
// page target, a fixed debugging port and fixed /tmp screenshots each).
//
// Chrome is started on debugging port 0 and publishes the port it took in its
// profile's DevToolsActivePort, so two checks never contend for one. Every
// wait has a deadline and names what it waited for. A DevTools reply is read
// as `unknown` and checked before use. The page's console errors, uncaught
// exceptions and (when those domains are enabled) error log entries and failed
// requests are collected in `problems`, which each check asserts is empty.
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isList, isRecord } from '@sixam/kernel';
import { chromeArgs, chromeBinary } from '../../../tools/chrome.ts';

const sleep = (ms: number) => new Promise<void>(done => setTimeout(done, ms));
const STARTUP_MS = 20_000;
const REPLY_MS = 30_000;

/** The page a check drives. */
export interface Page {
  /** A DevTools method's result; a protocol error or no reply within 30 s rejects. */
  send(method: string, params?: Record<string, unknown>): Promise<Record<string, unknown>>;
  /** Load `url` and wait until the document has finished loading. */
  open(url: string): Promise<void>;
  /** An expression's value in the page, awaited; an expression that throws rejects with its exception. */
  evaluate(expression: string): Promise<unknown>;
  /** Poll `expression` until `accept` takes its value, and return it; reject with the last value after `timeoutMs`. */
  waitFor(label: string, expression: string, accept: (value: unknown) => boolean, timeoutMs: number): Promise<unknown>;
  /** Save a PNG of the viewport under this run's directory, and return its path. */
  screenshot(name: string): Promise<string>;
  /** Console errors, uncaught exceptions, error log entries and failed requests, as they arrived. */
  readonly problems: readonly string[];
  /** A directory of this run's own, for screenshots. */
  readonly dir: string;
  close(): Promise<void>;
}

/** The page under test: the first http(s) argument, else the dev server's default. */
export function pageUrl(fallback = 'http://localhost:8731/dist/index.html') {
  return process.argv.find(arg => /^https?:\/\//.test(arg)) ?? fallback;
}

/** Call `read` until it returns a value, at most `timeoutMs`; throw naming `what` otherwise. */
async function until<T>(what: string, timeoutMs: number, read: () => Promise<T | undefined> | T | undefined): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (value !== undefined) return value;
    if (Date.now() >= deadline) throw new Error(`no ${what} within ${timeoutMs} ms`);
    await sleep(50);
  }
}

/** The port Chrome wrote to its profile, once it has. */
function publishedPort(profile: string) {
  try {
    const port = Number(readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]);
    return Number.isInteger(port) && port > 0 ? port : undefined;
  } catch { return undefined; }
}

/** The first page target's socket address, once Chrome lists one. */
async function pageSocket(port: number) {
  try {
    const listed: unknown = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    if (!isList(listed)) return undefined;
    for (const target of listed)
      if (isRecord(target) && target.type === 'page' && typeof target.webSocketDebuggerUrl === 'string')
        return target.webSocketDebuggerUrl;
  } catch { /* not answering yet */ }
  return undefined;
}

/** Text of one console argument or exception, as DevTools describes it. */
const describe = (value: unknown) => isRecord(value)
  ? String(value.value ?? value.description ?? value.type ?? '') : String(value);

/** What an event says went wrong in the page, or null when it is not a problem. */
function problemOf(method: unknown, params: unknown): string | null {
  if (!isRecord(params)) return null;
  if (method === 'Runtime.consoleAPICalled' && params.type === 'error')
    return `console.error: ${(isList(params.args) ? params.args : []).map(describe).join(' ')}`;
  if (method === 'Runtime.exceptionThrown' && isRecord(params.exceptionDetails)) {
    const details = params.exceptionDetails;
    return `exception: ${isRecord(details.exception) && typeof details.exception.description === 'string'
      ? details.exception.description : String(details.text)}`;
  }
  if (method === 'Log.entryAdded' && isRecord(params.entry) && params.entry.level === 'error')
    return `log: ${String(params.entry.text)} ${String(params.entry.url ?? '')}`.trim();
  if (method === 'Network.loadingFailed' && params.canceled !== true) return `request failed: ${String(params.errorText)}`;
  if (method === 'Network.responseReceived' && isRecord(params.response) && typeof params.response.status === 'number'
    && params.response.status >= 400) return `HTTP ${params.response.status}: ${String(params.response.url)}`;
  return null;
}

/**
 * Start Chrome, attach to its page and enable `domains` (Runtime and Page at
 * least; add Log and Network to collect their errors too).
 */
export async function launch({ domains = ['Runtime', 'Page'] }: { domains?: readonly string[] } = {}): Promise<Page> {
  const profile = mkdtempSync(join(tmpdir(), 'trainer-cdp-'));
  const dir = mkdtempSync(join(tmpdir(), 'trainer-shots-'));
  const chrome = spawn(chromeBinary(), chromeArgs(0, profile), { stdio: 'ignore' });
  let exited: string | null = null;
  chrome.on('error', error => { exited = error.message; });
  chrome.on('exit', code => { exited ??= `Chrome exited with ${code}`; });
  // A check that crashes must not leave its browser running.
  const reap = () => { chrome.kill('SIGKILL'); };
  process.once('exit', reap);

  const port = await until('DevTools port from Chrome', STARTUP_MS, () => {
    if (exited) throw new Error(`Chrome did not start: ${exited}`);
    return publishedPort(profile);
  });
  const socket = new WebSocket(await until('page target', STARTUP_MS, () => pageSocket(port)));
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener('open', () => resolve());
    socket.addEventListener('error', () => reject(new Error('the DevTools socket did not open')));
  });

  const problems: string[] = [];
  const pending = new Map<number, { resolve: (result: Record<string, unknown>) => void, reject: (error: Error) => void }>();
  socket.addEventListener('message', event => {
    const message: unknown = JSON.parse(String(event.data));
    if (!isRecord(message)) return;
    if (typeof message.id === 'number') {
      const waiting = pending.get(message.id);
      if (!waiting) return;
      pending.delete(message.id);
      if (isRecord(message.error)) waiting.reject(new Error(String(message.error.message)));
      else waiting.resolve(isRecord(message.result) ? message.result : {});
      return;
    }
    const problem = problemOf(message.method, message.params);
    if (problem) problems.push(problem);
  });

  let next = 0;
  const send = (method: string, params: Record<string, unknown> = {}) => new Promise<Record<string, unknown>>((resolve, reject) => {
    const id = ++next;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`${method}: no reply within ${REPLY_MS} ms`));
    }, REPLY_MS);
    pending.set(id, {
      resolve: result => { clearTimeout(timer); resolve(result); },
      reject: error => { clearTimeout(timer); reject(new Error(`${method}: ${error.message}`)); },
    });
    socket.send(JSON.stringify({ id, method, params }));
  });

  const evaluate = async (expression: string) => {
    const reply = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (isRecord(reply.exceptionDetails)) {
      const details = reply.exceptionDetails;
      throw new Error(`${expression.split('\n')[0]} threw: ${isRecord(details.exception)
        ? describe(details.exception) : String(details.text)}`);
    }
    return isRecord(reply.result) ? reply.result.value : undefined;
  };

  for (const domain of domains) await send(`${domain}.enable`);

  return {
    send,
    evaluate,
    problems,
    dir,
    async open(url) {
      await send('Page.navigate', { url });
      await until(`load of ${url}`, STARTUP_MS, async () =>
        await evaluate('location.href !== "about:blank" && document.readyState === "complete"') === true ? true : undefined);
    },
    async waitFor(label, expression, accept, timeoutMs) {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const value = await evaluate(expression);
        if (accept(value)) return value;
        if (Date.now() >= deadline) throw new Error(`${label}: still ${JSON.stringify(value)} after ${timeoutMs} ms`);
        await sleep(50);
      }
    },
    async screenshot(name) {
      const shot = await send('Page.captureScreenshot', { format: 'png' });
      if (typeof shot.data !== 'string') throw new Error('Page.captureScreenshot returned no image');
      const path = join(dir, name);
      writeFileSync(path, Buffer.from(shot.data, 'base64'));
      return path;
    },
    async close() {
      socket.close();
      process.removeListener('exit', reap);
      if (chrome.exitCode === null && chrome.signalCode === null) {
        const gone = new Promise<boolean>(resolve => chrome.once('exit', () => resolve(true)));
        chrome.kill();
        if (!await Promise.race([gone, sleep(5_000).then(() => false)])) chrome.kill('SIGKILL');
      }
      rmSync(profile, { recursive: true, force: true });
    },
  };
}
