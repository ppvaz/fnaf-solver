#!/usr/bin/env node
// FNaF 1-only Night 1 and 2 teaching strip, shown by the Companion.
//
//   node fnaf1-teach-overlay.ts --status
//   node fnaf1-teach-overlay.ts --preflight
//   node fnaf1-teach-overlay.ts --show|--update --night 1|2 --stage STAGE --run RUN_ID
//   node fnaf1-teach-overlay.ts --clear
//
// The strip lived in a second APK (android/fnaf1-teach) until 2026-10-01; it is
// now the Companion's `f1strip` lesson (Fnaf1Strip.java), sent over its
// authenticated control socket, so the Companion must be capturing first
// (packages/play/bin/companion/companion-setup.sh --target fnaf1), the way the
// old presenter had to be started from its own app. It never launches a game,
// reads a pixel or sends input, and every change is confirmed by the
// Companion's own status reply. Serial: FNAF_SERIAL, then ANDROID_SERIAL
// (fnaf1-night-run.ts passes it), then the untracked local profile.
// Exit 0 confirmed, 2 usage, 3 refused or not confirmed.
import { pathToFileURL } from 'node:url';
import { AdbCompanionPort } from '../../src/campaign/physical-ports.ts';
import { resolveSerial } from '../../bin/phone/local-profile.ts';

export const SCHEMA = 'fnaf1-teach-overlay-v2';
export const STAGES = ['hands-off', 'left-calibration', 'left-watch', 'right-monitor-calibration', 'full-loop',
  'night2-calibration'];
const RUN_ID = /^[a-z0-9][a-z0-9-]{0,95}$/;
export const LESSON_LINE = new RegExp(`^LESSON [0-9a-f]{32} f1strip (status|clear|show [12] (${STAGES.join('|')}) ` +
  '[a-z0-9][a-z0-9-]{0,95})$');
const USAGE = 'usage: fnaf1-teach-overlay.ts --status|--preflight|--clear|(--show|--update --night 1|2 --stage STAGE --run RUN_ID)';
const POLLS = 20;
const POLL_MS = 100;

type Command = { mode: string, night: number | null, stage: string | null, run: string | null };

/** The command, or the reason it is refused (exit 2). */
export function parseArgs(argv: string[]): Command | string {
  const [mode, ...rest] = argv;
  if (mode === '--status' || mode === '--preflight' || mode === '--clear')
    return rest.length === 0 ? { mode, night: null, stage: null, run: null } : USAGE;
  if (mode !== '--show' && mode !== '--update') return USAGE;
  if (rest.length !== 6 || rest[0] !== '--night' || rest[2] !== '--stage' || rest[4] !== '--run') return USAGE;
  const [, night, , stage, , run] = rest;
  if (night !== '1' && night !== '2') return 'fnaf1-teach: night must be 1 or 2';
  if (!STAGES.includes(stage)) return `fnaf1-teach: unrecognized stage '${stage}'`;
  if (!RUN_ID.test(run)) return 'fnaf1-teach: invalid run id';
  return { mode, night: Number(night), stage, run };
}

/** `OK f1strip=ATTACHED schema=... night=1 ...` as its fields. */
export function fields(reply: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const token of reply.replace(/^OK\s+/, '').split(/\s+/)) {
    const at = token.indexOf('=');
    if (at > 0) out[token.slice(0, at)] = token.slice(at + 1);
  }
  return out;
}

/** The one line a caller records, in the old presenter's field names. */
export function statusLine(f: Record<string, string>): string {
  const attached = f.f1strip === 'ATTACHED';
  return `fnaf1-teach schema=${f.schema ?? 'UNKNOWN'} status=${attached ? 'VISIBLE' : 'CLEAR'} ` +
    `permission=${f.permission ?? 'UNKNOWN'} attached=${attached} interactive=${f.interactive ?? 'UNKNOWN'} ` +
    `rect=${f.rect ?? 'UNKNOWN'} night=${f.night ?? 'UNKNOWN'} stage=${f.stage ?? 'UNKNOWN'} run=${f.run ?? 'UNKNOWN'}`;
}

/** Whether a status reply is the strip a caller asked for (null: cleared). */
export function confirms(f: Record<string, string>, want: Command | null): boolean {
  if (f.schema !== SCHEMA || f.interactive !== 'false') return false;
  if (want === null) return f.f1strip === 'NONE';
  return f.f1strip === 'ATTACHED' && f.permission === 'GRANTED' && f.night === String(want.night)
    && f.stage === want.stage && f.run === want.run;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// The adb forward the lesson channel holds; a refusal exits, so it closes it first.
let release = () => {};

function refuse(reason: string, detail = ''): never {
  release();
  console.error(`fnaf1-teach schema=${SCHEMA} status=UNKNOWN reason=${reason}${detail ? ` detail=${detail}` : ''}`);
  process.exit(3);
}

async function main(argv: string[]) {
  const command = parseArgs(argv);
  if (typeof command === 'string') { console.error(command); process.exit(2); }
  let serial: string;
  try { ({ serial } = resolveSerial({ names: ['FNAF_SERIAL', 'ANDROID_SERIAL'] })); } catch (error) {
    console.error(`fnaf1-teach: ${(error as Error).message}`); process.exit(2);
  }
  const port = new AdbCompanionPort({ serial });
  let channel: ReturnType<AdbCompanionPort['openLesson']>;
  try { channel = port.openLesson({ timeoutMs: 1500, lessonLine: LESSON_LINE }); } catch (error) {
    refuse('companion-not-capturing', `${(error as Error).message.replace(/\s+/g, '_')}:` +
      'start_it_with_packages/play/bin/companion/companion-setup.sh_--target_fnaf1');
  }
  release = () => channel.close();
  const token = port.endpoint?.token ?? refuse('companion-no-token');
  const send = async (words: string) => {
    try { return fields(await channel.send(`LESSON ${token} f1strip ${words}`)); } catch (error) {
      return refuse('companion-refused', (error as Error).message.replace(/\s+/g, '_'));
    }
  };
  const confirmed = async (want: Command | null) => {
    for (let i = 0; i < POLLS; i += 1) {
      const now = await send('status');
      if (confirms(now, want)) return now;
      await sleep(POLL_MS);
    }
    return null;
  };
  try {
    if (command.mode === '--status') {
      console.log(statusLine(await send('status')));
    } else if (command.mode === '--preflight') {
      const now = await send('status');
      if (now.schema !== SCHEMA || now.permission !== 'GRANTED' || now.interactive !== 'false' || now.f1strip !== 'NONE')
        refuse('presenter-not-ready', statusLine(now).replace(/\s+/g, ','));
      console.log(statusLine(now));
    } else if (command.mode === '--clear') {
      await send('clear');
      const now = await confirmed(null);
      if (!now) refuse('clear-not-confirmed');
      console.log(statusLine(now));
    } else {
      await send(`show ${command.night} ${command.stage} ${command.run}`);
      const now = await confirmed(command);
      if (!now) refuse(`${command.mode.slice(2)}-not-confirmed`);
      console.log(statusLine(now));
    }
  } finally {
    channel.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main(process.argv.slice(2));
