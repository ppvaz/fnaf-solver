// Mock regression for the death-cause chart. No phone, no gate run.
//
// The claim worth pinning is not the picture, it is that the picture cannot
// quietly drop a death. Three ways it could:
//
//   1. The engine grows a seventh `kill()` reason and the chart has no slice
//      for it. A chart that silently omits a cause is worse than no chart --
//      it reads as coverage, the same failure GRADE_RUN=1 produced when it
//      graded a file that did not exist.
//   2. Slices get ordered by count, so Foxy is blue on one night and orange
//      on the next and two panels cannot be compared.
//   3. A long label runs into the count column, which is what the first
//      render did ("...at a 5s check)99").
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { census, chart, clock, median, renderPng, REASON_ORDER } from '../bin/deathchart.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
let failed = 0;
const check = (name: string, cond: unknown, detail = '') => {
  if (!cond) { failed++; console.error(`FAIL ${name}${detail ? ` -- ${detail}` : ''}`); }
};

// ------------------------------------------- every engine death has a slice
// Read off the engine rather than a list kept here: a list kept here is a
// second copy that goes stale the day someone adds a cause. kill() is called
// across the FNaF 2 Source, so every module there is parsed and every kill()
// call read, whatever its receiver or quotes. A reason carried in a field
// (attack-animation.ts's `a.reason`) is read from the `reason:` literals the
// same module assigns; a reason the chart cannot read fails here.
const MODEL = join(HERE, '../../../packages/source/src/games/fnaf2');
/** The string literals an expression can evaluate to, or null when it is not only literals. */
const literals = (node: ts.Expression): string[] | null => {
  if (ts.isStringLiteralLike(node)) return [node.text];
  if (ts.isParenthesizedExpression(node)) return literals(node.expression);
  if (!ts.isConditionalExpression(node)) return null;
  const [yes, no] = [literals(node.whenTrue), literals(node.whenFalse)];
  return yes && no ? [...yes, ...no] : null;
};
const emitted = new Set<string>();
const unread: string[] = [];
const modules = readdirSync(MODEL).filter(name => name.endsWith('.ts'));
for (const name of modules) {
  const source = ts.createSourceFile(name, readFileSync(join(MODEL, name), 'utf8'), ts.ScriptTarget.Latest, true);
  const calls: ts.CallExpression[] = [];
  const fields: ts.Expression[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'kill') calls.push(node);
    if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name) && node.name.text === 'reason') fields.push(node.initializer);
    ts.forEachChild(node, visit);
  };
  visit(source);
  const where = (node: ts.Node) => `${name}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}`;
  for (const call of calls) {
    const [reason] = call.arguments;
    const direct = reason ? literals(reason) : null;
    const viaField = reason && ts.isPropertyAccessExpression(reason) && reason.name.text === 'reason' && fields.length
      ? fields.map(literals) : null;
    if (direct) direct.forEach(item => emitted.add(item));
    else if (viaField && viaField.every(Boolean)) viaField.forEach(items => items?.forEach(item => emitted.add(item)));
    else unread.push(`${where(call)} kill(${reason?.getText() ?? ''})`);
  }
}
check('every engine kill() names a reason the chart can read', unread.length === 0, unread.join('; '));
check('the engine emits death reasons at all', emitted.size >= 6, [...emitted].join());
for (const r of emitted)
  check(`"${r}" has a slice`, REASON_ORDER.includes(r),
    'add it to REASON_ORDER and re-run the palette validator for the new adjacency');

// ------------------------------------------------------- grouping the census
const deaths: [string, number][] = [
  ['inside-office: Toy Bonnie completed the sourced 40-frame marker-123 attack', 65],
  ['foxy: Foxy had locked on and no blackout covered the 10s interval', 120],
  ['inside-office: Toy Chica completed the sourced 40-frame marker-123 attack', 64],
  ['foxy: Flashed the hall after Foxy locked on (D exceeded 3 at a 5s check)', 99],
  ['puppet: The Puppet completed the sourced 40-frame marker-123 attack', 15],
];
const rows = census(deaths);
check('one row per reason, not per detail', rows.length === 3, `${rows.length}`);
check('counts sum per reason', rows.map(r => r.n).join() === '219,129,15', rows.map(r => r.n).join());
// The ordering claim: REASON_ORDER, NOT descending count. inside-office (129)
// stays second because that is its slot; if this ever sorts by size, colour
// follows rank instead of the character and the panels stop being comparable.
check('rows follow REASON_ORDER, not count',
  rows.map(r => r.reason).join() === 'foxy,inside-office,puppet', rows.map(r => r.reason).join());
check('details sort by count inside a reason',
  rows[1].details.map(d => d.n).join() === '65,64', rows[1].details.map(d => d.n).join());

let threw = '';
try { census([['soul-crushed: a new endgame', 1]]); } catch (e) { threw = (e as Error).message; }
check('an unslicecd reason fails loudly', /has no slice/.test(threw), threw || 'no throw');

// ------------------------------------------------- when a run died, not just why
// death-census.py shipped the wrong cause once by reading faces without times.
const times = new Map([
  ['foxy: Foxy had locked on and no blackout covered the 10s interval', [100, 200, 300]],
  ['inside-office: Toy Bonnie completed the sourced 40-frame marker-123 attack', [420, 400]],
]);
const timed = census(deaths, times);
check('a reason carries the median of its runs', timed[0].t === 200, `${timed[0].t}`);
check('a cause nobody died of has no time, not 12 AM', timed[2].t === null, `${timed[2].t}`);
check('seconds map to the in-game clock', clock(70) === '70 s \u00b7 1 AM', clock(70));
// 420 s is the whole night over six hours, so hour 0 is 12 AM and not "0 AM".
check('midnight is 12 AM', clock(10).endsWith('12 AM'), clock(10));
check('an absent time renders as nothing', clock(null) === '' && median([]) === null);

// ------------------------------------------------------------------ the SVG
const gate = { night: 2, survived: 825, runs: 1200, minSurvival: 0.4, ok: true, deaths, deathTimes: times };
const svg = chart([gate], 'testbuild');
const W = 660;
check('names its night', svg.includes('>Night 2<'));
check('names the sample and the bar', svg.includes('825/1200') && svg.includes('bar 40%'));
// CLAUDE.md: the simulator prices nothing, so a figure lifted off this image
// must carry that with it. The caption is the only place it can.
check('the image says it is a model', /simulator census/.test(svg) && /human slack/.test(svg));
check('the image names its build', svg.includes('testbuild'));
check('the image names when runs died',
  /median time of death/.test(svg) && /\d+ s \u00b7 \d+ AM/.test(svg));
for (const r of rows) check(`legend names ${r.reason}`, svg.includes(`>${r.reason}<`));
check('three slices drawn', (svg.match(/<path d="M/g) || []).length === 3);

// No x coordinate inside a panel may reach the next panel's origin, and no
// label may reach its own count column. Both are the first render's bugs.
const xs = [...svg.matchAll(/ x="(-?\d+(?:\.\d+)?)"/g)].map(m => +m[1]);
// Not just "inside W": the rightmost column needs a gutter, or its numbers
// read as the next panel's. 60 px is the eyeballed minimum at this type size.
check('nothing bleeds past the panel', Math.max(...xs) < W - 60, `max x ${Math.max(...xs)}`);
const labels = [...svg.matchAll(/class="m" x="19"[^>]*>(?:<title>[^<]*<\/title>)?([^<]*)</g)].map(m => m[1]);
check('long labels are clipped to the column',
  labels.every(l => l.length <= 72), labels.find(l => l.length > 72));

// A single-reason night is an arc of exactly 360 degrees, which draws nothing.
const solo = chart([{ ...gate, deaths: [deaths[1]] }], 'b');
check('one reason draws a circle, not an empty arc',
  solo.includes('<circle') && !/<path d="M/.test(solo));
// And a night nobody died on must say so where the pie would be.
const clean = chart([{ ...gate, survived: 1200, deaths: [] }], 'b');
check('a clean night says so', /no deaths in 1200 runs/.test(clean));

// ------------------------------------------------------- the PNG, failing loudly
// The rule this closes is grade-run.sh's: a step that cannot produce its
// output must say so, not leave a missing file that reads like success.
{
  const saved = process.env.CHROME;
  process.env.CHROME = join(HERE, 'no-such-chrome-binary');
  const r = renderPng('/dev/null', join(tmpdir(), `dc-${process.pid}.png`), { w: 10, h: 10 });
  check('a missing renderer is reported, not silently skipped',
    r.ok === false && /UNKNOWN\(/.test(r.why as string), JSON.stringify(r)); // a failed render says why
  if (saved === undefined) delete process.env.CHROME; else process.env.CHROME = saved;
}

console.log(failed ? `deathchart: ${failed} FAILED` : 'deathchart: ok');
process.exit(failed ? 1 : 0);
