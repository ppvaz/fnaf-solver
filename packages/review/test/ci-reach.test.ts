// Review's one answer to "does a CI step run this file" (src/ci-reach.ts): a file is reached only
// through what CI executes -- never through a mention, a script CI never calls, a lane CI never runs,
// or a tools/test.ts entry CI names but does not select (BACKLOG) or never judges (REPORTS).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ciReach, simpleCommands } from '../src/ci-reach.ts';
import type { SuiteEntry, WalkContext } from '../src/ci-reach.ts';

const entry = (path: string, over: Partial<SuiteEntry> = {}): SuiteEntry =>
  ({ name: path, group: 'engine', path, args: [], selected: true, backlog: null, extended: false, ...over });

const context: WalkContext = {
  scripts: {
    'test:unit': 'node tools/lanes.ts unit',
    'test:ci-only': 'node tools/test-called.ts',
    'test:never': 'node tools/test-only-in-a-script.ts',
    'test:legacy:engine': 'node tools/test.ts --engine',
  },
  lanes: {
    unit: { node: ['packages/x/test/a.test.ts'], steps: [['python3', 'packages/x/test-step.py'], ['lane', 'nested']] },
    nested: { node: ['packages/x/test/nested.test.ts'], steps: [] },
    orphan: { node: ['packages/x/test/orphan.test.ts'], steps: [] },
  },
  suite: args => (args.includes('--gates')
    ? [entry('packages/x/test-gate.ts'), entry('packages/x/test-red.ts', { selected: false, backlog: 'red on purpose' }),
      entry('packages/x/test-report.ts', { group: 'reports' })]
    : [entry('packages/x/test-engine-only.ts')]),
};

const ciText = [
  'jobs:',
  '  checks:',
  '    steps:',
  '      - name: Lanes',
  '        run: npm run test:unit && npm run test:ci-only',
  '      - name: Gates',
  '        run: node tools/test.ts --gates',
  '      # see tools/test-in-a-comment.ts',
  '      - name: Echo',
  '        run: echo "tools/test-in-a-string.ts"',
].join('\n');

test('CI reaches what it executes, through scripts, lanes, nested lanes and tools/test.ts selection', () => {
  const { reached, backlog } = ciReach('/nonexistent', { context, ciText });
  for (const path of ['packages/x/test/a.test.ts', 'packages/x/test-step.py', 'packages/x/test/nested.test.ts',
    'tools/test-called.ts', 'packages/x/test-gate.ts'])
    assert.ok(reached.has(path), `${path} is run by a CI step`);
  assert.equal(backlog.get('packages/x/test-red.ts'), 'red on purpose', 'a BACKLOG entry CI names keeps its reason');
});

test('a mention, a script CI never calls, a lane CI never runs, a report and a deselected entry are not reached', () => {
  const { reached } = ciReach('/nonexistent', { context, ciText });
  for (const path of ['tools/test-in-a-comment.ts', 'tools/test-in-a-string.ts', 'tools/test-only-in-a-script.ts',
    'packages/x/test/orphan.test.ts', 'packages/x/test-report.ts', 'packages/x/test-red.ts', 'packages/x/test-engine-only.ts'])
    assert.ok(!reached.has(path), `${path} is not run by any CI step`);
});

test('the command reader keeps quoted words and $(...) whole', () => {
  assert.deepEqual(simpleCommands('a "b c" $(d e) && f # g'), [['a', 'b c', '$(d e)'], ['f']]);
});
