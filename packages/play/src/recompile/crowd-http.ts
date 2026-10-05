import type { CrowdAction } from '@sixam/source';
import { readCrowdObservation, readCrowdStatus } from './crowd-runtime.ts';
import type { CrowdRuntime } from './crowd-runtime.ts';

/** A loopback bridge, local or forwarded from the runtime host. No shell, host discovery or credentials. */
export class HttpCrowdRuntime implements CrowdRuntime {
  private readonly base: URL;
  constructor(address: string) {
    this.base = new URL(address.endsWith('/') ? address : address + '/');
    if (this.base.protocol !== 'http:' || !['127.0.0.1', '[::1]'].includes(this.base.hostname)
      || this.base.username || this.base.password || this.base.search || this.base.hash)
      throw new Error('Runtime URL must use HTTP loopback without credentials, query or fragment');
  }
  private async request(path: string, signal: AbortSignal, body?: unknown) {
    const response = await fetch(new URL(path, this.base), { signal, redirect: 'error',
      method: body === undefined ? 'GET' : 'POST',
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    if (!response.ok) throw new Error(`Runtime ${path}: HTTP ${response.status}`);
    return response;
  }
  private async bytes(response: Response, limit: number) {
    if (!response.body) throw new Error('Empty runtime reply');
    const reader = response.body.getReader(), chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > limit) throw new Error('Runtime reply exceeded size limit');
        chunks.push(value);
      }
    } finally { await reader.cancel(); }
    const result = new Uint8Array(size);
    let at = 0;
    for (const chunk of chunks) { result.set(chunk, at); at += chunk.byteLength; }
    return result;
  }
  private async json(path: string, signal: AbortSignal, body?: unknown): Promise<unknown> {
    return JSON.parse(new TextDecoder().decode(await this.bytes(await this.request(path, signal, body), 65_536)));
  }
  async status(signal: AbortSignal) { return readCrowdStatus(await this.json('status', signal)); }
  async action(action: CrowdAction, signal: AbortSignal) {
    return readCrowdObservation(await this.json('action', signal, action));
  }
  async hold(paused: boolean, signal: AbortSignal) {
    return readCrowdObservation(await this.json('hold', signal, { paused }));
  }
  async frame(signal: AbortSignal) {
    const bytes = await this.bytes(await this.request('frame.jpg', signal), 8 * 1024 * 1024);
    if (bytes[0] !== 255 || bytes[1] !== 216) throw new Error('Runtime frame must be JPEG');
    return bytes;
  }
  async close() {
    await this.json('close', AbortSignal.timeout(3000), {});
  }
}
