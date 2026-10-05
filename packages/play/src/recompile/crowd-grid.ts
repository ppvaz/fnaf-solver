import { CROWD_GAMES, parseCrowdCommand } from '@sixam/source';
import type { CrowdCommand, CrowdGame } from '@sixam/source';
import type { CrowdObservation, CrowdRuntime } from './crowd-runtime.ts';
import { readCrowdStatus } from './crowd-runtime.ts';

type Phase = 'OFFLINE' | 'AWAITING_INPUT' | 'EXECUTING' | 'PAUSING' | 'PAUSED' | 'TERMINAL' | 'FAULT';
interface Tile {
  game: CrowdGame; round: number; phase: Phase; manual: boolean; global: boolean;
  label: 'UNKNOWN' | 'MODEL_ONLY' | 'FIXTURE'; commands: readonly string[];
  observation: CrowdObservation | null; lastAction: string | null; fault: string | null;
  busy: boolean; changingHold: boolean; abort: AbortController;
}
interface CrowdEvent { readonly sequence: number; readonly wallMs: number; readonly kind: string; readonly game: string; readonly detail: string }

async function bounded<T>(signal: AbortSignal, invoke: () => Promise<T>): Promise<T> {
  signal.throwIfAborted();
  let cancel = () => {};
  const stopped = new Promise<never>((_, reject) => {
    cancel = () => reject(signal.reason);
    signal.addEventListener('abort', cancel, { once: true });
  });
  try { return await Promise.race([invoke(), stopped]); }
  finally { signal.removeEventListener('abort', cancel); }
}
const closeRuntime = (runtime: CrowdRuntime) => bounded(AbortSignal.timeout(3000), () => runtime.close());

/** Independent await-input tiles. A requested hold is never displayed as an acknowledged pause. */
export class CrowdGrid {
  private readonly tiles = new Map<CrowdGame, Tile>();
  private readonly events: CrowdEvent[] = [];
  private sequence = 0;
  private globalRound = 1;
  private closed = false;
  private readonly runtimes: Partial<Record<CrowdGame, CrowdRuntime>>;
  private readonly now: () => number;
  private readonly record: (event: CrowdEvent) => void;
  constructor(runtimes: Partial<Record<CrowdGame, CrowdRuntime>>,
    now: () => number, record: (event: CrowdEvent) => void = () => {}) {
    this.runtimes = runtimes; this.now = now; this.record = record;
    for (const game of CROWD_GAMES) this.tiles.set(game, { game, round: 1, phase: 'OFFLINE', manual: false,
      global: false, label: 'UNKNOWN', commands: [], observation: null, lastAction: null,
      fault: null, busy: false, changingHold: false, abort: new AbortController() });
  }
  private tile(game: CrowdGame) {
    const tile = this.tiles.get(game);
    if (!tile) throw new Error('Unknown game');
    return tile;
  }
  private log(kind: string, game: string, detail: string) {
    const event = { sequence: ++this.sequence, wallMs: this.now(), kind, game, detail };
    this.events.push(event);
    if (this.events.length > 80) this.events.shift();
    this.record(event);
  }
  private fault(tile: Tile, error: unknown) {
    if (tile.phase === 'FAULT' || this.closed) return;
    tile.phase = 'FAULT'; tile.fault = error instanceof Error ? error.message : String(error);
    tile.abort.abort(new Error(tile.fault));
    this.log('fault', tile.game, tile.fault);
    const runtime = this.runtimes[tile.game];
    if (runtime) void closeRuntime(runtime).catch(() => {});
  }
  private observe(tile: Tile, observation: CrowdObservation) {
    if (this.closed || tile.phase === 'FAULT') throw new Error('Runtime session ended');
    if (!tile.observation || observation.sequence >= tile.observation.sequence) {
      if (tile.observation && observation.tick < tile.observation.tick) throw new Error('Runtime tick moved backwards');
      tile.observation = observation;
    }
    observation = tile.observation;
    tile.phase = observation.terminal ? 'TERMINAL' : tile.changingHold ? 'PAUSING'
      : observation.paused && (tile.manual || tile.global) ? 'PAUSED'
      : tile.busy || !observation.paused ? 'EXECUTING' : 'AWAITING_INPUT';
  }
  /** Bound even a port that forgets to honour its abort signal. Late replies cannot revive a fault. */
  private async call<T>(tile: Tile, ms: number, invoke: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const signal = AbortSignal.any([tile.abort.signal, AbortSignal.timeout(ms)]);
    return bounded(signal, () => invoke(signal));
  }
  async connect() {
    await Promise.all(CROWD_GAMES.map(async game => {
      const runtime = this.runtimes[game];
      if (!runtime) return;
      const tile = this.tile(game);
      try {
        const status = readCrowdStatus(await this.call(tile, 10_000, signal => runtime.status(signal)));
        if (!status.paused || status.imageRevision === null) throw new Error('Runtime must start on a presented paused frame');
        tile.label = status.label; tile.commands = status.commands;
        this.observe(tile, status); this.log('connected', game, status.label);
      } catch (error) { this.fault(tile, error); }
    }));
  }
  async refresh() {
    if (this.closed) return;
    await Promise.all(CROWD_GAMES.map(async game => {
      const tile = this.tile(game), runtime = this.runtimes[game];
      if (!runtime || ['OFFLINE', 'FAULT', 'TERMINAL'].includes(tile.phase) || tile.changingHold) return;
      try { this.observe(tile, await this.call(tile, 3000, signal => runtime.status(signal))); }
      catch (error) { this.fault(tile, error); }
    }));
  }
  snapshot() {
    return { globalRound: this.globalRound, closed: this.closed, events: [...this.events], tiles: CROWD_GAMES.map(game => {
      const tile = this.tile(game);
      return { game, round: tile.round, phase: tile.phase, label: tile.label, commands: tile.commands,
        manual: tile.manual, global: tile.global, lastAction: tile.lastAction, fault: tile.fault,
        observation: tile.observation };
    }) };
  }
  async frame(game: CrowdGame) {
    const runtime = this.runtimes[game];
    const tile = this.tile(game);
    if (!runtime || ['OFFLINE', 'FAULT'].includes(tile.phase) || this.closed) throw new Error('No runtime image');
    return this.call(tile, 3000, signal => runtime.frame(signal));
  }
  private async hold(tile: Tile, kind: 'manual' | 'global', pause: boolean) {
    const runtime = this.runtimes[tile.game];
    if (!runtime || ['OFFLINE', 'FAULT', 'TERMINAL'].includes(tile.phase)) return;
    if (tile.changingHold) throw new Error('A pause transition is already in progress');
    const previous = tile.manual || tile.global;
    tile[kind] = pause;
    const desired = tile.manual || tile.global;
    if (previous === desired) {
      if (tile.observation) this.observe(tile, tile.observation);
      return;
    }
    tile.changingHold = true; tile.phase = 'PAUSING';
    try {
      const observation = await this.call(tile, 10_000, signal => runtime.hold(desired, signal));
      if (desired && !observation.paused && !observation.terminal) throw new Error('Runtime did not acknowledge pause');
      tile.changingHold = false;
      this.observe(tile, observation); this.log(pause ? 'pause' : 'resume', tile.game, kind);
    } catch (error) { tile.changingHold = false; this.fault(tile, error); throw error; }
  }
  private async control(command: CrowdCommand) {
    if (command.target === 'ALL') {
      if (command.round !== this.globalRound) throw new Error('Stale global token');
      if (![...this.tiles.values()].some(tile => !['OFFLINE', 'FAULT', 'TERMINAL'].includes(tile.phase)))
        throw new Error('No available game');
      if ([...this.tiles.values()].some(tile => tile.changingHold)) throw new Error('A pause transition is in progress');
      this.globalRound++;
      // Attempt every hold even if one runtime fails; a failure cannot prevent holding the others.
      const results = await Promise.allSettled(CROWD_GAMES.map(game => this.hold(this.tile(game), 'global', command.action.name === 'pause')));
      for (const result of results) if (result.status === 'rejected') throw result.reason;
    } else {
      const tile = this.tile(command.target);
      if (command.round !== tile.round) throw new Error('Stale game token');
      if (['OFFLINE', 'FAULT', 'TERMINAL'].includes(tile.phase)) throw new Error('Game is unavailable');
      if (tile.changingHold) throw new Error('A pause transition is in progress');
      tile.round++;
      await this.hold(tile, 'manual', command.action.name === 'pause');
    }
  }
  async command(text: string) {
    if (this.closed) throw new Error('Session ended');
    const command = parseCrowdCommand(text);
    if (['pause', 'resume'].includes(command.action.name)) { await this.control(command); return; }
    if (command.target === 'ALL') throw new Error('No global game action');
    const tile = this.tile(command.target), runtime = this.runtimes[command.target];
    if (command.round !== tile.round) throw new Error('Stale game token');
    if (!runtime || tile.phase !== 'AWAITING_INPUT' || tile.busy || tile.manual || tile.global)
      throw new Error('Game is not awaiting an action');
    if (!tile.commands.includes(command.action.name)) throw new Error('Action is unavailable for this game');
    tile.round++; tile.busy = true; tile.phase = 'EXECUTING'; tile.lastAction = text;
    this.log('accepted', tile.game, text);
    try {
      const observation = await this.call(tile, 15_000, signal => runtime.action(command.action, signal));
      if (!observation.paused && !observation.terminal) throw new Error('Bounded action did not end paused');
      tile.busy = false;
      this.observe(tile, observation); this.log('applied', tile.game, text);
    } catch (error) { this.fault(tile, error); throw error; }
    finally { tile.busy = false; }
  }
  async close() {
    if (this.closed) return;
    this.closed = true;
    for (const tile of this.tiles.values()) tile.abort.abort(new Error('Operator ended session'));
    this.log('closed', 'ALL', 'Operator ended session');
    await Promise.allSettled(Object.values(this.runtimes).map(closeRuntime));
  }
}
