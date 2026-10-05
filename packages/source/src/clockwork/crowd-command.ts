/** Local crowd-input grammar. Durations are proposed PoC limits, not measured game timings. */
export const CROWD_GAMES = ['FNAF1', 'FNAF2', 'FNAF3', 'FNAF4'] as const;
export type CrowdGame = typeof CROWD_GAMES[number];
export interface CrowdAction { readonly name: string; readonly args: readonly string[]; readonly durationMs: number }
export interface CrowdCommand {
  readonly target: CrowdGame | 'ALL'; readonly round: number;
  readonly action: CrowdAction;
}

export function isCrowdGame(value: unknown): value is CrowdGame {
  return typeof value === 'string' && CROWD_GAMES.some(game => game === value);
}

/** Parse named actions only; the runtime's own advertised vocabulary decides which are available. */
export function parseCrowdCommand(text: string): CrowdCommand {
  if (text.length > 160) throw new Error('Command too long');
  const parts = text.trim().split(/\s+/);
  const target = parts.shift()?.toUpperCase();
  const name = parts.shift()?.toLowerCase();
  const token = parts.pop();
  if ((!isCrowdGame(target) && target !== 'ALL') || !name || !/^[a-z][a-z0-9-]{0,24}$/.test(name))
    throw new Error('Use a game prefix and a named action');
  if (!token || !/^@[1-9][0-9]{0,8}$/.test(token)) throw new Error('Use the current round token, e.g. @1');
  const control = name === 'pause' || name === 'resume';
  if (target === 'ALL' && !control) throw new Error('ALL accepts only pause or resume');
  if (control && parts.length) throw new Error('Pause and resume take no arguments');
  let durationMs = 1000;
  const duration = parts.at(-1);
  if (duration && /^(?:\d+(?:\.\d+)?)(?:ms|s)$/.test(duration)) {
    durationMs = parseFloat(duration) * (duration.endsWith('ms') ? 1 : 1000);
    parts.pop();
  }
  if (!Number.isInteger(durationMs) || durationMs < 50 || durationMs > 5000)
    throw new Error('Action duration must be 50ms to 5s');
  if (parts.length > 2 || parts.some(arg => !/^[a-z][a-z0-9-]{0,24}$/i.test(arg)))
    throw new Error('Only named action arguments are accepted');
  return { target, round: Number(token.slice(1)), action: { name, args: parts, durationMs: control ? 0 : durationMs } };
}
