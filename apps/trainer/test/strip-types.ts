#!/usr/bin/env node
// TypeScript modules as the browser can load them: their types erased by
// Node's own stripper (the one `node file.ts` runs), nothing else changed.
// The repository runs its .ts sources directly under Node's type stripping
// (Pedro, 2026-09-30: "runtime .ts"); a browser cannot, so the trainer's
// bundler (build.py) and dev server (serve.py) pass every .ts module they
// serve through this first. Mode `strip` replaces each type with blanks, so
// line and column numbers stay the source's. A module that needs more than
// erasure (an enum, a namespace, a parameter property) is refused here, as
// tsconfig's `erasableSyntaxOnly` refuses it at typecheck.
//
//   node apps/trainer/test/strip-types.ts FILE...   prints {"FILE": "code", ...} as JSON
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';

const out = {};
for (const file of process.argv.slice(2)) {
  try {
    out[file] = stripTypeScriptTypes(readFileSync(file, 'utf8'), { mode: 'strip' });
  } catch (error) {
    console.error(`strip-types: ${file}: ${error.message}`);
    process.exit(1);
  }
}
process.stdout.write(JSON.stringify(out));
