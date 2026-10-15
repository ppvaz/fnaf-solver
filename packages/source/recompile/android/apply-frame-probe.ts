#!/usr/bin/env node
// Add bounded frame replay to an external Chowdren runtime copy. No device I/O.
//   apply-frame-probe.ts --chowdren DIR
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { refuseRepo } from './apply-calib-mod.ts';

const MARKER = 'FNAF2_FRAME_PROBE_V1';
const INCLUDE = `#include "frame-probe.h" // ${MARKER}\n`;
const INIT = `#ifdef CHOWDREN_IS_ANDROID
    frame_probe_init(SDL_AndroidGetInternalStoragePath()); // ${MARKER}
#endif
`;
const REJECT = `                r.consumed = true; // ${MARKER}: no touch was created
                continue;
`;
const APPLIED = `        if (h_trace) fprintf(h_trace, "# applied frame %d requested %d applied %d op %d pointer %d\\n",
                             frame_index, r.tick, h_tick, int(r.op), r.pointer); // ${MARKER}
`;

function replaceOnce(text: string, anchor: string, replacement: string): string {
  const count = text.split(anchor).length - 1;
  if (count !== 1) throw new Error(`frame probe: expected one anchor, found ${count}: ${anchor.trim()}`);
  return text.replace(anchor, replacement);
}

export function applyFrameProbe(chowdren: string): { readonly changed: boolean } {
  const base = join(chowdren, 'base');
  const path = join(base, 'harness.cpp');
  const headerPath = join(base, 'frame-probe.h');
  for (const target of [chowdren, path, headerPath]) refuseRepo(target);
  const header = readFileSync(new URL('./frame-probe.h', import.meta.url), 'utf8');
  const original = readFileSync(path, 'utf8');
  if (original.includes(MARKER)) {
    if (![INCLUDE, INIT, REJECT, APPLIED].every(hook => original.split(hook).length === 2) ||
        !existsSync(headerPath) || readFileSync(headerPath, 'utf8') !== header)
      throw new Error('frame probe: partial or changed installation; use a fresh runtime copy');
    return { changed: false };
  }
  if (original.includes('# applied frame ') || original.includes('frame-probe.enabled'))
    throw new Error('frame probe: pre-existing experimental hook; use a fresh runtime copy');
  let text = replaceOnce(original, '#include "harness.h"\n', '#include "harness.h"\n' + INCLUDE);
  const init = '    h_active = env_int("CHOWDREN_HARNESS", 0) != 0;';
  text = replaceOnce(text, init, INIT + init);
  const miss = '                if (h_trace) fprintf(h_trace, "# miss %d %d %s\\n", frame_index, h_tick, r.object.c_str());\n';
  text = replaceOnce(text, miss, miss + REJECT);
  const consumed = '\n        r.consumed = true;\n';
  text = replaceOnce(text, consumed, '\n' + APPLIED + consumed.slice(1));
  writeFileSync(headerPath, header);
  writeFileSync(path, text);
  return { changed: true };
}

function main(argv: readonly string[]): number {
  if (argv.length === 1 && argv[0] === '--help') {
    console.log('Usage: apply-frame-probe.ts --chowdren DIR (external copy; build with --frame-probe)');
    return 0;
  }
  if (argv.length !== 2 || argv[0] !== '--chowdren' || !argv[1]) {
    console.error('Usage: apply-frame-probe.ts --chowdren DIR');
    return 2;
  }
  try {
    const result = applyFrameProbe(argv[1]);
    console.log(`frame probe ${result.changed ? 'installed' : 'already installed'}: ${resolve(argv[1])}`);
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 2;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  process.exitCode = main(process.argv.slice(2));
