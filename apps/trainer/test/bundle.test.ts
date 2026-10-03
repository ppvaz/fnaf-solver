// The trainer ships as one script that build.ts assembles from the TypeScript sources. A construct the
// bundler leaves untransformed is a SyntaxError only a browser shows: on 2026-10-03 a kernel re-export
// written `fail as failContract` reached the page verbatim and no lane noticed. Build it and parse it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Script } from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

test('the built page carries one script, and it parses', () => {
  execFileSync(process.execPath, [join(ROOT, 'apps/trainer/test/build.ts')], { cwd: ROOT, stdio: 'pipe' });
  const html = readFileSync(join(ROOT, 'dist/index.html'), 'utf8');
  const scripts = [...html.matchAll(/<script>\n([\s\S]*?)\n<\/script>/g)].map(match => match[1]);
  assert.equal(scripts.length, 1, 'the page inlines exactly one bundle');
  assert.doesNotThrow(() => new Script(scripts[0], { filename: 'dist/index.html' }));
});
