import { isList, isRecord } from '@sixam/kernel';
import type { CrowdAction } from '@sixam/source';

/** A presented runtime observation. The sequence orders overlapping action, hold and polling replies. */
export interface CrowdObservation {
  readonly sequence: number; readonly tick: number; readonly paused: boolean;
  readonly terminal: '6AM' | 'DEATH' | null;
  readonly night: number | null; readonly hour: string | null;
  readonly imageRevision: number | null;
}
export interface CrowdRuntimeStatus extends CrowdObservation {
  readonly label: 'MODEL_ONLY' | 'FIXTURE'; readonly commands: readonly string[];
  readonly capabilities: {
    readonly renderedPause: true; readonly audioPause: true; readonly disconnectStopsGame: true;
  };
}
/** The presentation bridge is host-only; it is not a phone transport or a second game model. */
export interface CrowdRuntime {
  status(signal: AbortSignal): Promise<CrowdRuntimeStatus>;
  action(action: CrowdAction, signal: AbortSignal): Promise<CrowdObservation>;
  hold(paused: boolean, signal: AbortSignal): Promise<CrowdObservation>;
  frame(signal: AbortSignal): Promise<Uint8Array>;
  close(): Promise<void>;
}

export function readCrowdObservation(value: unknown): CrowdObservation {
  if (!isRecord(value)) throw new Error('Runtime observation must be an object');
  for (const key of ['sequence', 'tick'])
    if (!Number.isSafeInteger(value[key]) || Number(value[key]) < 0) throw new Error(`Invalid runtime ${key}`);
  if (typeof value.paused !== 'boolean' || (value.terminal !== null && value.terminal !== '6AM' && value.terminal !== 'DEATH'))
    throw new Error('Invalid runtime pause/terminal state');
  if (value.night !== null && (!Number.isInteger(value.night) || Number(value.night) < 1 || Number(value.night) > 8))
    throw new Error('Invalid runtime night');
  if (value.hour !== null && (typeof value.hour !== 'string' || !/^(?:12|[1-6]) AM$/.test(value.hour)))
    throw new Error('Invalid runtime hour');
  if (value.imageRevision !== null && (!Number.isSafeInteger(value.imageRevision) || Number(value.imageRevision) < 0))
    throw new Error('Invalid image revision');
  return value as unknown as CrowdObservation;
}

export function readCrowdStatus(value: unknown): CrowdRuntimeStatus {
  readCrowdObservation(value);
  if (!isRecord(value) || (value.label !== 'MODEL_ONLY' && value.label !== 'FIXTURE')
    || !isList(value.commands) || !value.commands.length
    || !value.commands.every(name => typeof name === 'string' && /^[a-z][a-z0-9-]{0,24}$/.test(name)))
    throw new Error('Runtime must declare its label and command vocabulary');
  const caps = value.capabilities;
  if (!isRecord(caps) || caps.renderedPause !== true || caps.audioPause !== true || caps.disconnectStopsGame !== true)
    throw new Error('Runtime lacks rendered/audio pause or disconnect-stop capability');
  return value as unknown as CrowdRuntimeStatus;
}
