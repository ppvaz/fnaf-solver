#!/usr/bin/env node
/**
 * Run the Companion's playback-capture probe and print its derived numbers.
 *
 *   audio-probe.ts --seconds N [--scope all|target|GAME|PACKAGE] [--label NAME] [--out FILE.jsonl]
 *
 * The Companion records its projection's playback (AudioPlaybackCapture) for
 * N seconds and keeps only derived numbers -- sample rate, channels, duration,
 * RMS and peak dBFS, the fraction of 10 ms hops with sound, and the onset
 * count and times (AudioProbeAnalysis.java). No audio leaves the phone or is
 * written anywhere. It answers one question: does this capture path contain a
 * game's discrete SFX at all? Retail FNaF on this phone plays through the FAST
 * output, which playback capture does not expose; the FNaF 2 rebuild can move
 * its audio to DEEP_BUFFER (`setprop debug.rebuild.audio_capture 1`, then
 * relaunch). A silent result is reported as silent (onsets=0, activeFraction
 * near 0), never as "no event happened".
 *
 * Needs a running capture, RECORD_AUDIO granted to the Companion, and the
 * serial lease (run under packages/play/src/safety/device-lock-exec.py or a night wrapper).
 * `--out` appends one JSON row per probe for a retained comparison.
 */
import { appendFileSync } from 'node:fs';
import { AdbCompanionPort } from '../../src/campaign/physical-ports.ts';
import { resolveSerial } from '../phone/local-profile.ts';

function fail(message: string): never { console.error(`audio-probe: ${message}`); process.exit(2); }

export function parseArgs(argv: string[]) {
  const options = { seconds: null as number | null, scope: 'target', label: null as string | null, out: null as string | null };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === '--seconds') options.seconds = Number(argv[++i]);
    else if (flag === '--scope') options.scope = argv[++i];
    else if (flag === '--label') options.label = argv[++i];
    else if (flag === '--out') options.out = argv[++i];
    else throw new Error(`unknown flag ${flag}`);
  }
  if (!Number.isInteger(options.seconds) || (options.seconds as number) < 1 || (options.seconds as number) > 30)
    throw new Error('--seconds must be a whole number 1..30');
  if (typeof options.scope !== 'string' || !/^[a-z0-9._-]{1,64}$/.test(options.scope))
    throw new Error('--scope must be all, target, a game key or a package');
  if (options.label !== null && !/^[A-Za-z0-9._-]{1,48}$/.test(options.label))
    throw new Error('--label must be 1..48 of [A-Za-z0-9._-]');
  return options as typeof options & { seconds: number };   // an integer, checked above
}

/** The probe reply's derived numbers as a typed row; refuses anything that looks like audio. */
export function probeRow(fields: Readonly<Record<string, string | undefined>>,
  { label = null, scope = null }: { label?: string | null, scope?: string | null } = {}) {
  const number = (key: string) => (fields[key] === undefined ? null : Number(fields[key]));
  const onsetMs = fields.onsetMs === undefined || fields.onsetMs === 'NONE' ? []
    : fields.onsetMs.split(',').map(Number);
  if (onsetMs.some(value => !Number.isInteger(value) || value < 0)) throw new Error('audio probe onset times are malformed');
  return {
    schema: 'companion-audio-probe-v1', label, scope: fields.scope ?? scope, state: fields.audioProbe ?? null,
    reason: fields.reason ?? null, rateHz: number('rateHz'), channels: number('channels'),
    seconds: number('seconds'), frames: number('frames'), rmsDbfs: number('rmsDbfs'), peakDbfs: number('peakDbfs'),
    activeFraction: number('activeFraction'), onsets: number('onsets'), onsetMs,
    stopped: fields.stopped === '1',
  };
}

async function main(argv: string[]) {
  let options: ReturnType<typeof parseArgs>;
  try { options = parseArgs(argv); } catch (error) { fail((error as Error).message); }
  if (process.env.FNAF_LEASE_HELD !== '1' && process.env.FNAF1_LEASE_HELD !== '1' && process.env.CUE_HELPER_LEASE_OWNER_PID === undefined)
    fail('run under the serial lease (packages/play/src/safety/device-lock-exec.py SERIAL -- ...)');
  let serial: string;
  try { ({ serial } = resolveSerial({ names: ['FNAF_SERIAL', 'ANDROID_SERIAL'] })); } catch (error) { fail((error as Error).message); }
  const port = new AdbCompanionPort({ serial });
  const fields = await port.audioProbe({ seconds: options.seconds, scope: options.scope });
  const row = { at: new Date().toISOString(), ...probeRow(fields, options) };
  if (options.out) appendFileSync(options.out, `${JSON.stringify(row)}\n`);
  console.log(JSON.stringify(row));
  if (row.state !== 'DONE') process.exitCode = 3;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2)).catch((error: Error) => fail(error.message));
}
