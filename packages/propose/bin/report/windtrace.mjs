// Was the plan's winding actually CREDITED, or only sent?
//
// A `hold wind` row does nothing unless the engine's isWinding holds -- the
// button down AND the monitor up AND the camera on CAM 11 (engine.js:205,
// sourced to g633/634 for the button existing and g638/643 for the climb).
// The plan cannot see that. It emits a wind and assumes it landed.
//
// This exists because a night died with every wind row emitted and almost none
// of them credited. On night 1 seed 136 the model gate scored 62 cam:11
// presses of which FOUR took effect: each landed while the monitor was still
// MON_RAISING, the camera stayed where the sweep had left it, and the pilot
// wound CAM 07 for six minutes. The box drained from full to empty in a
// straight line and the Puppet walked in. Nothing in the plan, the trace or
// the survival number said "wind"; only the box level did.
//
//   windtrace.mjs --night=1 [--seeds=1..1200] [--png=FILE]
//
// Reports, per seed, the fraction of wind frames that were credited and the
// minimum box level reached. A seed whose winds are sent but not credited is
// the failure above, and it is invisible to every other instrument here.
import { replay } from '../plans/recipe.mjs';
import { jitterPlan, parsePlanText } from '../plans/human-gate.mjs';
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import * as E from '@sixam/source/fnaf2';
import * as C from '@sixam/source/fnaf2';

const arg = (name, def) => {
  const v = (process.argv.find(a => a.startsWith(`--${name}=`)) || '').split('=')[1];
  return v === undefined ? def : v;
};
const night = +arg('night', 1);
const png = arg('png', null);
const [lo, hi] = String(arg('seeds', '1..200')).split('..').map(Number);

const text = execSync(`node ${new URL('../plans/recipe.mjs', import.meta.url).pathname} --device-plan --night=${night}`).toString();
const { plan, idleUntilMs } = parsePlanText(text);

// Wrap tick from outside rather than teaching the engine to record: the engine
// must not grow a debugging surface for one instrument's sake.
const origTick = E.Sim.prototype.tick;
let trace = [];
E.Sim.prototype.tick = function () {
  origTick.call(this);
  trace.push([this.box, this.isWinding ? 1 : 0, this.winding ? 1 : 0]);
};

const rows = [];
for (let seed = lo; seed <= hi; seed++) {
  trace = [];
  const { sim } = replay(jitterPlan(plan, seed), { night, seed, idleUntilMs });
  const held = trace.filter(r => r[2]).length;      // button down
  const credited = trace.filter(r => r[1]).length;  // ...and it counted
  const minBox = trace.reduce((m, r) => Math.min(m, r[0]), 1);
  rows.push({ seed, won: sim.won, held, credited, minBox,
              frames: trace.length, box: png ? trace.map(r => r[0]) : null,
              wind: png ? trace.map(r => r[1]) : null });
}
E.Sim.prototype.tick = origTick;

const bad = rows.filter(r => r.held > 0 && r.credited / r.held < 0.5);
const died = rows.filter(r => !r.won);
console.log(`night ${night}, seeds ${lo}..${hi}: ${rows.length - died.length}/${rows.length} won`);
console.log(`  wind frames credited: median ${median(rows.map(r => pct(r)))}%  ` +
            `worst ${Math.min(...rows.map(r => pct(r)))}%`);
console.log(`  seeds winding on the wrong camera (<50% credited): ${bad.length}` +
            (bad.length ? ` -- ${bad.slice(0, 8).map(r => r.seed).join(', ')}` : ''));
for (const r of died.slice(0, 8))
  console.log(`  seed ${r.seed}: DIED, ${pct(r)}% of ${r.held} wind frames credited, ` +
              `box reached ${r.minBox.toFixed(3)}`);

function pct(r) { return r.held ? Math.round(100 * r.credited / r.held) : 100; }
function median(a) { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; }

if (png) {
  const pick = died.length ? [died[0], rows.find(r => r.won)] : rows.slice(0, 2);
  writeFileSync(png.replace(/\.png$/, '.json'),
    JSON.stringify(pick.filter(Boolean).map(r =>
      ({ seed: r.seed, won: r.won, box: r.box, wind: r.wind }))));
  console.log(`  wrote ${png.replace(/\.png$/, '.json')} for rendering`);
}

// A plan whose winds are mostly uncredited is broken however well it survives:
// it is one unlucky draw from the failure above on every night it is played.
process.exit(bad.length ? 1 : 0);
