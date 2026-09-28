/**
 * Closed host boundary for replacing the Cue Helper MediaProjection session.
 * The checked-in setup script owns the named UI taps and projection consent;
 * this module only supplies the selected serial and a bounded invocation.
 * CONTRACT:device-adb-preflight-v1.
 */
import { execFile as execFileCallback } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const SETUP = fileURLToPath(new URL('../../../tools/device/cue-helper-setup.sh', import.meta.url));

async function runSetup(file, args, options) {
  try {
    const result = await execFile(file, args, options);
    return { exitCode: 0, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
  } catch (error) {
    return { exitCode: Number.isInteger(error.code) ? error.code : 1,
      stdout: error.stdout ?? '', stderr: error.stderr ?? error.message ?? '' };
  }
}

/** @param {{serial?: string, adb?: string, target?: string, screen?: string, waitSeconds?: number,
 * run?: (file: any, args: any, options: any) => Promise<{exitCode: any, stdout: any, stderr: any}>}} options
 *
 * Stop any current helper projection and drive a fresh named consent flow for
 * the NAMED target (a game key from tools/device/models/companion-targets-v1.json).
 * There is no default game: setup returns to the target it is told, and
 * `screen` is checked there, so callers receive that game focused again with
 * a live control endpoint before they continue.
 */
export async function restartCueHelperCapture({ serial, adb = 'adb', target, screen = 'menu',
  waitSeconds = 30, run = runSetup } = {}) {
  if (typeof serial !== 'string' || serial.length === 0)
    throw new TypeError('Cue Helper capture restart requires an ADB serial');
  if (typeof adb !== 'string' || adb.length === 0)
    throw new TypeError('Cue Helper capture restart requires an ADB executable');
  if (typeof target !== 'string' || !/^fnaf[1-4](?:-rebuild)?$/.test(target))
    throw new TypeError('Cue Helper capture restart needs an explicit target game (fnaf1..fnaf4 or fnafN-rebuild)');
  if (screen !== 'menu' && screen !== 'night')
    throw new TypeError('Cue Helper capture restart screen must be menu or night');
  if (!Number.isInteger(waitSeconds) || waitSeconds < 1 || waitSeconds > 300)
    throw new TypeError('Cue Helper capture restart waitSeconds must be an integer in 1..300');
  if (typeof run !== 'function') throw new TypeError('Cue Helper capture restart needs a runner');

  const result = await run(SETUP,
    ['--restart-capture', '--target', target, '--screen', screen, '--wait', String(waitSeconds)], {
      cwd: ROOT, shell: false,
      env: { ...process.env, ANDROID_SERIAL: serial, ADB_BIN: adb },
      timeout: Math.max(120000, (waitSeconds + 120) * 1000),
      maxBuffer: 4 * 1024 * 1024,
    });
  const exitCode = Number.isInteger(result?.exitCode) ? result.exitCode : 1;
  const output = `${result?.stdout ?? ''}${result?.stderr ?? ''}`.trim();
  const status = exitCode === 0 ? 'READY' : exitCode === 75 ? 'HOLD' : 'FAIL';
  return Object.freeze({ status, serial, exitCode, output: output.slice(-4000) });
}
