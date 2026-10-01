/**
 * Keep a live campaign's external HID process inside the shutdown path.
 * Node removes its default SIGINT/SIGTERM exit behavior when a listener is
 * installed, so the handler must own both cleanup and the final exit.
 */
const signalExitCode = (signal: string) => signal === 'SIGINT' ? 130 : 143;

/** The process surface the handlers need: signal listeners, and an exit code. */
interface SignalProcess {
  on(signal: string, handler: () => void): unknown;
  removeListener(signal: string, handler: () => void): unknown;
  exit(code: number): unknown;
  exitCode?: number | string | null;
}

export function installCampaignSignalHandlers({ cleanup, processObject = process,
  exit = (code: number) => processObject.exit(code),
  report = (error: unknown) => console.error(`device: signal cleanup: ${(error as Error).message}`) }: {
  cleanup?: (error: Error) => unknown, processObject?: SignalProcess, exit?: (code: number) => unknown,
  report?: (error: unknown) => unknown} = {}) {
  if (typeof cleanup !== 'function') throw new TypeError('campaign signal cleanup must be a function');
  if (!processObject || typeof processObject.on !== 'function' ||
      typeof processObject.removeListener !== 'function')
    throw new TypeError('campaign signal process must expose on/removeListener');
  if (typeof exit !== 'function') throw new TypeError('campaign signal exit must be a function');
  if (typeof report !== 'function') throw new TypeError('campaign signal report must be a function');

  let task: Promise<void> | null = null;
  const handlers = new Map<string, () => void>();
  const receive = (signal: string) => {
    if (task) return task;
    const code = signalExitCode(signal);
    processObject.exitCode = code;
    task = (async () => {
      try {
        await cleanup(new Error(`campaign interrupted by ${signal}`));
      } catch (error) {
        report(error);
      } finally {
        // Cleanup has released the HID and, for the modern composition,
        // verified the game is back at the title before this exit occurs.
        exit(code);
      }
    })();
    // A signal callback must never create an unhandled rejection if a test
    // or an injected cleanup implementation fails before the catch above.
    task.catch(() => {});
    return task;
  };
  for (const signal of ['SIGINT', 'SIGTERM']) {
    const handler = () => { void receive(signal); };
    handlers.set(signal, handler);
    // Keep the handler installed during cleanup so a second Ctrl-C cannot
    // bypass the release by restoring Node's default immediate termination.
    processObject.on(signal, handler);
  }
  return Object.freeze({
    receive,
    done: () => task ?? Promise.resolve(),
    dispose: () => {
      for (const [signal, handler] of handlers) processObject.removeListener(signal, handler);
    },
  });
}
