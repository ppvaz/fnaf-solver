// The trainer's dev server (serve.ts) on a port of its own, for a check.
//
// serve.ts binds the port it is given; given 0, the system picks a free one and
// serve.ts prints it. Until 2026-10-02 the browser group used whatever already
// answered on :8731, which with two checkouts or sessions open could be the
// other one's build, and trace.test.ts bound a fixed :8747. Both polled the
// port 40 times 25 ms apart; this reads the address serve.ts announces instead.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SERVE = fileURLToPath(new URL('./serve.ts', import.meta.url));
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const ANNOUNCED = /on (http:\/\/127\.0\.0\.1:\d+)\//;

/** A running dev server: its origin, and how to stop it. */
export interface DevServer { readonly origin: string, stop(): void }

/**
 * Start serve.ts on a free port and resolve once it says where it listens.
 * @param env the server's environment (FNAF_TRACE_DIR moves its trace writes)
 * @param timeoutMs how long to wait for the announcement
 */
export function startDevServer({ env = process.env, timeoutMs = 15_000 }: { env?: NodeJS.ProcessEnv, timeoutMs?: number } = {}) {
  const child = spawn(process.execPath, [SERVE, '0'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  const stop = () => { child.kill(); };
  return new Promise<DevServer>((resolve, reject) => {
    let out = '', err = '';
    const timer = setTimeout(() => { stop(); reject(new Error(`serve.ts announced no address within ${timeoutMs} ms: ${err.trim()}`)); }, timeoutMs);
    // Keep draining both pipes for the server's lifetime: a full pipe would stall its writes.
    child.stderr.on('data', (chunk: Buffer) => { err += chunk.toString(); });
    child.stdout.on('data', (chunk: Buffer) => {
      out += chunk.toString();
      const found = ANNOUNCED.exec(out);
      if (!found) return;
      clearTimeout(timer);
      resolve({ origin: found[1], stop });
    });
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('exit', code => { clearTimeout(timer); reject(new Error(`serve.ts exited ${code}: ${err.trim()}`)); });
  });
}
