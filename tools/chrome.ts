// Locating the headless browser the five DevTools-Protocol tools drive.
//
// `google-chrome` is the Linux package name. macOS ships Chrome inside an app
// bundle and puts nothing by that name on PATH, so every browser test here was
// unrunnable on a Mac. $CHROME overrides both.
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const BUNDLED = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
];
const ON_PATH = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'];

export function chromeBinary() {
  if (process.env.CHROME) return process.env.CHROME;
  if (process.platform === 'darwin')
    for (const p of BUNDLED) if (existsSync(p)) return p;
  for (const name of ON_PATH)
    if (spawnSync('command', ['-v', name], { shell: true }).status === 0) return name;
  return ON_PATH[0];   // let the spawn fail with the familiar name
}

// Whether the binary chromeBinary() picked actually exists, so a runner can
// skip the browser suite with a reason instead of five ENOENT stack traces.
export function chromeAvailable() {
  const bin = chromeBinary();
  return bin.includes('/')
    ? existsSync(bin)
    : spawnSync('command', ['-v', bin], { shell: true }).status === 0;
}

// The standard flags all five tools pass. `port` and `profile` differ per tool
// so two of them can run at once.
export const chromeArgs = (port, profile) => [
  '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--disable-gpu',
  '--window-size=880,420', 'about:blank',
];
