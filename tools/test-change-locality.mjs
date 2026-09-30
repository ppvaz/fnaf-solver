#!/usr/bin/env node
// Pins tools/change-locality.mjs: which paths are contexts, when a commit needs
// a `Contexts:` line, and that `.githooks/commit-msg` runs it.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { contextOf, localityVerdict } from './change-locality.mjs';

assert.equal(contextOf('packages/play/src/campaign/planted.js'), 'play');
assert.equal(contextOf('apps/trainer/src/planted.js'), 'apps/trainer');
assert.equal(contextOf('android/companion/src/com/ppvaz/fnafcompanion/NightRunner.java'), 'companion');
assert.equal(contextOf('tools/gate-kit.mjs'), 'tools');
for (const registration of ['package.json', 'CLAUDE.md', 'docs/architecture/generated/import-graph.json',
  'plans/ROADMAP.md', 'packages/play/README.md', 'docs/evidence/runs/x/pack.json'])
  assert.equal(contextOf(registration), null, `${registration} is registration, not a context`);

const three = ['packages/source/src/a.js', 'packages/propose/src/b.js', 'packages/play/src/c.js', 'package.json'];
assert.equal(localityVerdict(three.slice(0, 2), 'Subject').ok, true, 'two contexts need no reason');
assert.equal(localityVerdict(three, 'Subject\n\nbody').ok, false, 'three contexts without a reason must be refused');
assert.equal(localityVerdict(three, 'Subject\n\nContexts: too short').ok, false, 'a token reason must be refused');
assert.equal(localityVerdict(three, '# Contexts: a commented line is not the message\nSubject').ok, false);
assert.equal(localityVerdict(three,
  'Subject\n\nContexts: the control id rename is a stored-name change every reader must follow').ok, true);
assert.deepEqual(localityVerdict(three, 'x').contexts, ['play', 'propose', 'source']);

const hook = readFileSync(new URL('../.githooks/commit-msg', import.meta.url), 'utf8');
assert.match(hook, /tools\/change-locality\.mjs/, 'the commit-msg hook must run the change-locality check');
console.log('change-locality: contexts, the three-context limit, the Contexts: line and the hook are pinned');
