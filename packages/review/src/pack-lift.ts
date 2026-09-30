// A read-only lift from a committed run pack (run-pack-v1) to the kernel's GameRun (ADR 0002).
//
// Stored records keep their v1 names; readers lift them into kernel words. A pack is read through
// readPack, which refuses a pack whose files no longer match their recorded sha256, and nothing is
// ever written. Every value the pack does not hold becomes UNKNOWN with the reason it is unknown,
// never a default (ADR 0002 principle 2): a pack recovered from its night-run log has no
// request.json, so its spec is UNKNOWN and says so; a lost result.json leaves the reported outcome
// UNKNOWN. The outcome is the one the venue REPORTED -- the executor's terminal, or the FNaF 1
// runner's own end -- and a death's character, mechanism, rule and time stay UNKNOWN because the
// executor never reads them: Review decides those from a graded video (principle 3). Custody comes
// across as the kernel's class (`complete` for a pack packed from the campaign directory as the
// campaign wrote it, `recovered` for one rebuilt from its night-run log) with the pack's own `lost`
// list; a custody the kernel has no class for (`incomplete-campaign`) is UNKNOWN with its reason.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { aborted, death, invalid, sixAm, timeout, unknown, validateGameRun } from '@sixam/kernel';
import { PACKS_DIR, readPack } from './evidence-pack.ts';

export const LIFT_SOURCE = 'run-pack-v1';

/** @param text a .jsonl file */
const rows = (text: string) => text.split('\n').filter(line => line.trim()).map(line => JSON.parse(line));

/** The events a phase of the run holds, cut at the venue's own reads of the night's start and end. */
function phases(events, { isStart, isEnd, startName, endName }) {
  const start = events.findIndex(isStart);
  if (start < 0) return null;
  const end = events.findIndex((row, index) => index >= start && isEnd(row));
  return {
    before: events.slice(0, start),
    night: end < 0 ? events.slice(start) : events.slice(start, end + 1),
    after: end < 0 ? unknown(`events.jsonl holds no ${endName} row after the ${startName} read, so where the night ended is not logged`)
      : events.slice(end + 1),
  };
}

const allUnknown = reason => ({ before: unknown(reason), night: unknown(reason), after: unknown(reason) });

/** What the pack names by hash: every packed text file and every withheld recording or frame. */
const witnessesOf = pack => [
  ...pack.files.map(file => ({ name: file.name, sha256: file.sha256, kind: 'text' })),
  ...(pack.withheld ?? []).filter(item => /^[0-9a-f]{64}$/.test(item.sha256 ?? ''))
    .map(item => ({ name: item.name, sha256: item.sha256, kind: item.kind ?? 'other' })),
];

function custodyOf(pack) {
  const kind = pack.custody?.kind;
  if (!kind) return { class: 'complete', lost: [] };
  if (kind === 'recovered-from-run-log') return { class: 'recovered', lost: [...pack.custody.lost] };
  return { class: unknown(`run-pack-v1 custody ${kind}${pack.custody.reason ? `: ${pack.custody.reason}` : ''}; ` +
    'the kernel classes are complete and recovered'), lost: [...(pack.custody.lost ?? [])] };
}

const CLOCKS = unknown('run-pack-v1 retains no clock trace: its event rows carry host wall-clock stamps and ' +
  'unlabelled numeric times, and no per-update frame times');

/**
 * The executor's terminal for one attempt, as the kernel's reported outcome. An `invalid`
 * terminal (ADR 0002, decision 3: it spent no campaign attempt) is Invalid with its own why.
 */
export function reportedFromTerminal(terminal: any) {
  if (terminal?.outcome === 'sixam') return sixAm();
  if (terminal?.outcome === 'invalid') return typeof terminal.why === 'string' && terminal.why
    ? invalid(terminal.why) : unknown('the executor terminal reads invalid and names no reason');
  if (terminal?.outcome === 'death') return death({
    by: unknown('the executor terminal names no character; a graded video or death-cause read decides it'),
    how: unknown('the executor terminal records no mechanism'),
    rule: unknown('the executor terminal cites no event group'),
    at: unknown('the executor terminal records no night time; it read the terminal screen, not the death'),
  });
  return unknown(`the executor terminal reads ${JSON.stringify(terminal?.outcome ?? null)}, which the kernel does not name`);
}

const RUN_MODE = { live: 'live', 'dry-run': 'dry' };

/** One campaign pack: one GameRun per attempt, or one for a campaign that never reported one. */
function liftCampaign(dir, loaded) {
  const { pack, wrapper } = loaded;
  const packed = name => pack.files.some(file => file.name === name);
  const events = packed('events.jsonl') ? rows(readFileSync(join(dir, 'events.jsonl'), 'utf8')) : null;
  const request = packed('request.json') ? JSON.parse(readFileSync(join(dir, 'request.json'), 'utf8')) : null;
  const custody = custodyOf(pack);
  const lostWhy = name => `${name} is not in the pack (custody ${pack.custody?.kind ?? 'original'}` +
    `${pack.custody?.lost?.includes(name) ? `, which lists it as lost` : ''})`;
  const result = wrapper?.result ?? null;
  const preflight = result?.events?.find(item => item?.type === 'campaign.state' && item.data?.previous === 'PREFLIGHT');
  const base = {
    spec: {
      campaign: request?.spec ?? unknown(lostWhy('request.json')),
      specHash: result?.specHash ?? unknown(wrapper ? 'the campaign threw before it retained a result, so no spec hash was written'
        : lostWhy('result.json')),
      winnerHash: pack.bundle?.winnerHash ?? unknown('the night-run verdict names no bundle, or its manifest was gone when the run was packed'),
    },
    venue: preflight?.data?.venue ?? unknown(!wrapper ? lostWhy('result.json')
      : 'the campaign preflight recorded no venue: venue identity (venue-check-v1) begins on 2026-09-29, after this run'),
    runMode: RUN_MODE[wrapper?.mode] ?? unknown(wrapper ? `the campaign mode ${JSON.stringify(wrapper.mode)} is not a kernel runMode`
      : lostWhy('result.json')),
    clocks: CLOCKS,
    witnesses: witnessesOf(pack),
    custody,
  };
  const night = { isStart: row => row.type === 'observation' && row.label === 'state=night',
    isEnd: row => row.type === 'campaign.terminal.from-executor' || row.type === 'campaign.terminal.actuator-stopped',
    startName: 'state=night', endName: 'campaign.terminal' };
  const cut = () => (events ? phases(events, night) : null)
    ?? allUnknown(events ? 'events.jsonl holds no state=night read, so where the night began is not logged' : lostWhy('events.jsonl'));
  const attempts = result?.attempts ?? [];
  if (!result) {
    const reportedOutcome = wrapper
      ? unknown(`the campaign threw before it reported an outcome: ${wrapper.error ?? wrapper.status}`)
      : unknown(pack.custody?.kind === 'incomplete-campaign'
        ? 'the campaign never wrote result.json (incomplete-campaign), and no terminal is inferred'
        : `result.json is lost (custody ${pack.custody?.kind ?? 'original'}): the venue's report did not reach the repository`);
    return [{ id: pack.id, ...base, ...cut(), reportedOutcome }];
  }
  if (!attempts.length) {
    const trail = result.events.filter(item => item?.type === 'campaign.state').map(item => item.state);
    const began = trail.includes('ACTIVE');
    return [{ id: pack.id, ...base,
      ...(began ? allUnknown('the campaign reached ACTIVE yet retained no attempt') : { before: events ?? unknown(lostWhy('events.jsonl')), night: [], after: [] }),
      reportedOutcome: began ? unknown('the campaign reached ACTIVE yet retained no attempt')
        : aborted(`the campaign ended ${result.state} before any night began (${trail.join('>')})`) }];
  }
  const shared = attempts.length > 1
    ? allUnknown(`the pack holds ${attempts.length} attempts in one event log, which is not cut per attempt`) : null;
  return attempts.map(attempt => ({
    id: attempts.length > 1 ? `${pack.id}#attempt${attempt.attempt}` : pack.id,
    ...base,
    spec: { ...base.spec, night: attempt.night ?? unknown('the attempt names no night'), mode: attempt.mode ?? unknown('the attempt names no mode') },
    ...(shared ?? cut()),
    reportedOutcome: reportedFromTerminal(attempt.terminal),
  }));
}

/** A FNaF 1 runner's pack: its probe.json or run.json record and its own events. */
function liftFnaf1(dir, loaded) {
  const { pack } = loaded;
  const packed = name => pack.files.some(file => file.name === name);
  const recordName = ['probe.json', 'run.json'].find(packed);
  const record = recordName ? JSON.parse(readFileSync(join(dir, recordName), 'utf8')) : null;
  const events = packed('events.jsonl') ? rows(readFileSync(join(dir, 'events.jsonl'), 'utf8')) : null;
  const options = record?.options;
  const ended = pack.outcome?.ended;
  const reportedOutcome = ended === 'STOP_AFTER' ? timeout()
    : ended === 'LEFT_OFFICE' ? unknown('the runner saw the office leave the screen (a jumpscare, a blackout or 6 AM) and does not say which')
      : ended ? unknown(`the runner ended the night as ${ended}, which the kernel does not name`)
        : unknown('the runner logged no night-ended event');
  const cut = (events ? phases(events, { isStart: row => row.type === 'night-origin', isEnd: row => row.type === 'night-ended',
    startName: 'night-origin', endName: 'night-ended' }) : null)
    ?? allUnknown(events ? 'events.jsonl holds no night-origin row' : 'the pack holds no events.jsonl');
  return [{
    id: pack.id,
    spec: record ? { schema: record.schema ?? unknown(`${recordName} names no schema`), target: record.target ?? unknown(`${recordName} names no target`),
      options: options ?? unknown(`${recordName} records no options`) } : unknown('the pack holds neither probe.json nor run.json'),
    venue: unknown('the FNaF 1 runner records no venue identity (venue-check-v1)'),
    runMode: options?.dryRun === true ? 'dry' : options?.live === true && options?.confirmLive === true ? 'live'
      : unknown('the run record says neither --dry-run nor --live --confirm-live'),
    clocks: CLOCKS,
    ...cut,
    reportedOutcome,
    witnesses: witnessesOf(pack),
    custody: custodyOf(pack),
  }];
}

/**
 * Lift one committed pack. Throws when the pack fails its own integrity check (readPack).
 * @param root repository root
 * @param id pack directory under docs/evidence/runs
 * @returns runs are kernel GameRuns
 *   (packages/kernel/src/types.ts), each checked by validateGameRun
 */
export function liftPack(root: string, id: string): { id: string; loaded: { pack: any; digest: string; wrapper: any; files: any; attestation: any; }; runs: any[]; } {
  const dir = join(root, PACKS_DIR, id);
  const loaded = readPack(dir);
  const runs = loaded.pack.kind === 'fnaf1-run' ? liftFnaf1(dir, loaded) : liftCampaign(dir, loaded);
  runs.forEach(validateGameRun);
  return { id, loaded, runs };
}

/** Every committed pack, in directory order. */
export const packIds = (root: string) => readdirSync(join(root, PACKS_DIR)).sort();
