#!/usr/bin/env node
// Phone-free contract check for FNaF 1's noninteractive teaching overlay. Ported from test-fnaf1-teach-overlay.py.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { isList, isRecord } from '@sixam/kernel';
import { pyIntValue, pyRegExp } from '@sixam/kernel/py';

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const PROFILE = 'packages/play/profiles/fnaf1/moto-g56';
const COMPANION = 'android/companion/src/com/ppvaz/fnafcompanion';
const CONTRACT = `${COMPANION}/Fnaf1Strip.java`;
const read = (path: string) => readFileSync(`${ROOT}${path}`, 'utf8');
const load = (path: string): unknown => JSON.parse(read(path));
const at = (value: unknown, ...keys: (string | number)[]) => keys.reduce<unknown>((node, key) => {
  if (typeof key === 'number' && isList(node) && key < node.length) return node[key];
  if (typeof key === 'string' && isRecord(node) && key in node) return node[key];
  return assert.fail(`no ${key} in ${JSON.stringify(node)}`);
}, value);
const num = (value: unknown) => (typeof value === 'number' ? value : assert.fail(`not a number: ${JSON.stringify(value)}`));
const list = (value: unknown) => (isList(value) ? value : assert.fail(`not a list: ${JSON.stringify(value)}`));
/** The part of `text` after the first `separator`, as Python's text.split(separator)[1]. */
const after = (text: string, separator: string) => text.split(separator)[1] ?? assert.fail(`no ${separator}`);

type Rect = readonly [number, number, number, number];
/** How far a point lies outside a rectangle whose right and bottom edges are exclusive, in the larger axis. */
function gap([left, top, right, bottom]: Rect, [x, y]: readonly [number, number]) {
  const dx = left <= x && x < right ? 0 : Math.max(left - x, x - (right - 1), 0);
  const dy = top <= y && y < bottom ? 0 : Math.max(top - y, y - (bottom - 1), 0);
  return Math.max(dx, dy);
}

test("the Companion's FNaF 1-only passive strip clears reader, title and control contracts", () => {
  const model = load(`${PROFILE}/teach-panel-fnaf1-moto-g56-v207.json`);
  const controls = load(`${PROFILE}/controls-fnaf1-moto-g56-v207.json`);
  const title = load(`${PROFILE}/title-fnaf1-moto-g56-v207.json`);
  const rect: Rect = [num(at(model, 'rect', 'left')), num(at(model, 'rect', 'top')), num(at(model, 'rect', 'right')), num(at(model, 'rect', 'bottom'))];
  const guard = num(at(model, 'guardPx'));
  const schema = at(model, 'schema');
  const stages = list(at(model, 'stages'));
  assert.equal(schema, 'fnaf1-teach-overlay-v2');
  assert.equal(at(model, 'target', 'package'), 'com.scottgames.fivenightsatfreddys');
  assert.deepEqual(at(model, 'geometry'), { width: 2400, height: 1080 });
  assert.ok(rect[0] >= 0 && rect[0] < rect[2] && rect[2] <= 2400 && rect[1] >= 0 && rect[1] < rect[3] && rect[3] <= 1080);
  assert.ok(rect[3] + guard <= 60, "must clear fnaf1-door-light.py's y=60 reader floor");
  const sensor = read('packages/play/games/fnaf1/fnaf1-door-light.py');
  assert.ok(sensor.includes('(0, 60, 1200, 900)') && sensor.includes('(1200, 60, 2400, 900)'));
  assert.ok(rect[3] <= num(at(title, 'title_gate', 'box', 1)), 'must not touch FNaF 1 title logo gate');
  const controlMap = at(controls, 'controlMap');
  for (const [name, point] of Object.entries(isRecord(controlMap) ? controlMap : {}))
    assert.ok(gap(rect, [num(at(point, 'x')), num(at(point, 'y'))]) >= guard, `${name} ${JSON.stringify(point)}`);
  assert.deepEqual(new Set(stages), new Set(['hands-off', 'left-calibration', 'left-watch', 'right-monitor-calibration', 'full-loop', 'night2-calibration']));

  // The Companion draws what this model describes: the same rectangle, guard and
  // stages, in the shared non-touchable panel window, on debug builds only.
  const contract = read(CONTRACT);
  assert.ok(at(model, 'presenter', 'package') === 'com.ppvaz.fnafcompanion' && at(model, 'presenter', 'lesson') === 'f1strip');
  assert.equal(at(model, 'presenter', 'contract'), CONTRACT);
  const constants = new Map([...contract.matchAll(pyRegExp('public static final int (\\w+) = (\\d+);', 'g'))].map(([, name, value]) => [name, Number(pyIntValue(value))]));
  assert.deepEqual(['LEFT', 'TOP', 'RIGHT', 'BOTTOM'].map(name => constants.get(name)), rect);
  assert.equal(constants.get('GUARD_PX'), guard);
  assert.deepEqual([...after(contract, 'STAGES = {').split('}')[0].matchAll(/"([a-z0-9-]+)"/g)].map(([, stage]) => stage), stages);
  assert.ok(contract.includes(`SCHEMA = "${String(schema)}"`));
  assert.ok(!contract.includes('FNAF2') && !contract.includes('fnaf2'));
  const overlay = read(`${COMPANION}/OverlayController.java`);
  assert.ok(['FLAG_NOT_TOUCHABLE', 'FLAG_NOT_FOCUSABLE', 'TYPE_APPLICATION_OVERLAY'].every(flag => overlay.includes(flag)));
  const stripCommand = after(overlay, 'public String f1StripCommand').split('\n    }\n')[0];
  assert.ok(stripCommand.includes('if (!debuggable()) return "ERROR teach-release-build";'));
  const tool = read('packages/play/games/fnaf1/fnaf1-teach-overlay.ts');
  assert.ok(tool.includes('f1strip') && tool.includes(`SCHEMA = '${String(schema)}'`));
  assert.ok(!tool.includes('com.scottgames.fnaf2'));
  assert.ok(tool.includes('fnaf1-teach-overlay.ts --status|--preflight|--clear'));
});
