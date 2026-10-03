// Locating the headless browser the trainer's browser checks drive
// (apps/trainer/test/cdp.ts).
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
// refuse the browser suite with a reason instead of an ENOENT stack trace per check.
export function chromeAvailable() {
  const bin = chromeBinary();
  return bin.includes('/')
    ? existsSync(bin)
    : spawnSync('command', ['-v', bin], { shell: true }).status === 0;
}

// The flags every check passes. Port 0 has Chrome take a free port and write
// it to the profile's DevToolsActivePort, so checks running at once never
// contend for one. `--enable-automation` sets navigator.webdriver, which is
// how the trainer knows a bot is playing and posts its trace as a dry run:
// without it a check's perfectly timed presses landed in captures/traces as
// a person's.
export const chromeArgs = (port: number, profile: string) => [
  '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--enable-automation',
  '--window-size=880,420', 'about:blank',
];
