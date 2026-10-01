/**
 * GameRun and custody (ADR 0002 kernel, frozen): one night played once, with
 * its spec, venue, runMode, clocks, before/night/after events, reported
 * outcome, witnesses and custody. `spec` and `clocks` carry the source
 * record's own fields, or UNKNOWN(reason), until RunSpec and ClockTrace enter
 * the kernel; `venue` carries the preflight's venue-check-v1, whose `observed`
 * is a VenueIdentity, or UNKNOWN(reason).
 */
import { fail, isRecord, isText, isUnknown } from './labels.ts';
import { validateOutcome } from './outcome.ts';
import type { GameRun } from './types.ts';

export const RUN_MODES = Object.freeze(['dry', 'shadow', 'replay', 'live']);
export const CUSTODY_CLASSES = Object.freeze(['complete', 'recovered']);
export const GAME_RUN_FIELDS = Object.freeze(['id', 'spec', 'venue', 'runMode', 'clocks', 'before', 'night', 'after',
  'reportedOutcome', 'witnesses', 'custody']);

const knownOr = (value: unknown, label: string, known: (value: any) => boolean) => {
  if (!known(value) && !isUnknown(value)) fail(`GameRun.${label} is neither known nor UNKNOWN(reason)`);
};

export function validateGameRun(value: any): GameRun {
  if (!isRecord(value)) fail('a GameRun is an object');
  const keys = Object.keys(value);
  const missing = GAME_RUN_FIELDS.filter(field => !keys.includes(field));
  const extra = keys.filter(key => !GAME_RUN_FIELDS.includes(key));
  if (missing.length || extra.length)
    fail(`a GameRun has exactly ${GAME_RUN_FIELDS.join(', ')}${missing.length ? `; missing ${missing.join(', ')}` : ''}` +
      `${extra.length ? `; unexpected ${extra.join(', ')}` : ''}`);
  if (!isText(value.id)) fail('GameRun.id must be text');
  knownOr(value.spec, 'spec', isRecord);
  knownOr(value.venue, 'venue', isRecord);
  knownOr(value.runMode, 'runMode', mode => RUN_MODES.includes(mode));
  knownOr(value.clocks, 'clocks', clocks => Array.isArray(clocks) && clocks.every(isRecord));
  for (const phase of ['before', 'night', 'after']) knownOr(value[phase], phase, Array.isArray);
  validateOutcome(value.reportedOutcome);
  if (!Array.isArray(value.witnesses) || !value.witnesses.every((item: any) => isRecord(item) && isText(item.name) &&
      /^[0-9a-f]{64}$/.test(item.sha256) && isText(item.kind)))
    fail('GameRun.witnesses must be {name, sha256, kind} with a sha256 hex digest');
  const custody = value.custody;
  if (!isRecord(custody) || Object.keys(custody).some(key => key !== 'class' && key !== 'lost')) fail('GameRun.custody is {class, lost}');
  if (!CUSTODY_CLASSES.includes(custody.class) && !isUnknown(custody.class))
    fail(`GameRun.custody.class must be ${CUSTODY_CLASSES.join(' or ')}, or UNKNOWN(reason)`);
  if (!Array.isArray(custody.lost) || !custody.lost.every(isText)) fail('GameRun.custody.lost must list what is lost');
  if (custody.class === 'complete' && custody.lost.length) fail('complete custody has lost nothing');
  return value;
}
