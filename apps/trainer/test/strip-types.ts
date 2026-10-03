#!/usr/bin/env node
// TypeScript modules as the browser can load them: their types erased by
// Node's own stripper (the one `node file.ts` runs), nothing else changed.
// The repository runs its .ts sources directly under Node's type stripping
// (Pedro, 2026-09-30: "runtime .ts"); a browser cannot, so the trainer's dev
// server (serve.py) passes every .ts module it serves through this first, and
// its bundler (build.ts) calls the same stripper in-process. Mode `strip`
// replaces each type with blanks, so line and column numbers stay the
// source's. A module that needs more than erasure (an enum, a namespace, a
// parameter property) is refused here, as tsconfig's `erasableSyntaxOnly`
// refuses it at typecheck.
//
//   node apps/trainer/test/strip-types.ts FILE...   prints {"FILE": "code", ...} as JSON
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';

// Node 22.13 added it; the @types/node this repository pins (22.10) does not declare it yet.
declare module 'node:module' {
  export function stripTypeScriptTypes(code: string, options?: { mode?: 'strip' | 'transform', sourceMap?: boolean, sourceUrl?: string }): string;
}

const out: Record<string, string> = {};
for (const file of process.argv.slice(2)) {
  try {
    out[file] = stripTypeScriptTypes(readFileSync(file, 'utf8'), { mode: 'strip' });
  } catch (error) {
    console.error(`strip-types: ${file}: ${(error as Error).message}`);
    process.exit(1);
  }
}
process.stdout.write(JSON.stringify(out));
