// Device-free checks on the seed pin (packages/play/bin/probe/seedpin/): the phone-side controller and the
// Java pinner that hold the phone's wall clock through the office seed read. Neither can run here,
// so this pins the properties that already failed once or would fail silently on the phone:
//   - the controller parses as sh;
//   - no epoch value passes through the phone shell's 32-bit $(( )) (on 2026-09-18 the first bench
//     computed a pin value of -1304041761 from a 1.79e12 ms epoch);
//   - the congruence that picks the pinned value is exact: congruent to the target seed, nearest
//     to the natural seed moment;
//   - the pinner keeps its hard duration cap, its stop file, and a restore that runs on exit and on
//     a signal.
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const check: (condition: unknown, message: string) => asserts condition = (condition, message) => { if (!condition) throw new Error(`seedpin: ${message}`); };
const DIR = 'packages/play/bin/probe/seedpin';
const script = readFileSync(`${DIR}/seedpin.sh`, 'utf8');

execFileSync('sh', ['-n', `${DIR}/seedpin.sh`]);

// Only loop counters and the watchdog seconds may use shell arithmetic.
const ALLOWED = new Set(['n', 'i', 'k', 'WAIT_S']);
for (const [lineNo, line] of script.split('\n').entries()) {
  if (line.trimStart().startsWith('#')) continue;
  for (const [, body] of line.matchAll(/\$\(\((.*?)\)\)/g)) {
    for (const name of body.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? [])
      check(ALLOWED.has(name), `line ${lineNo + 1} does shell arithmetic on ${name}: epoch values must go through awk`);
  }
}

// The congruence, run with the controller's own awk program against exact BigInt arithmetic.
const awkProgram = script.match(/congruent_near\(\)[^\n]*\n\s*awk -v x="\$1" -v t="\$2" '([^']+)'/)?.[1];
check(awkProgram, 'could not find the congruent_near awk program');
const cases = [[1789698138464n, 24850n], [1789697772449n, 0n], [1789697772449n, 65535n], [1789609271570n, 24850n], [1789699999999n, 32768n]];
for (const [x, t] of cases) {
  const got = BigInt(execFileSync('awk', ['-v', `x=${x}`, '-v', `t=${t}`, awkProgram]).toString().trim());
  check(got % 65536n === t, `congruent_near(${x}, ${t}) = ${got} has low16 ${got % 65536n}`);
  const d = got > x ? got - x : x - got;
  check(d <= 32768n, `congruent_near(${x}, ${t}) = ${got} is ${d} ms from x, not the nearest`);
}

const pinner = readFileSync(`${DIR}/Pinner.java`, 'utf8');
check(/Math\.min\([^;]*,\s*3000\)/.test(pinner), 'the pinner lost its 3 s hard cap');
check(pinner.includes('stop.exists()'), 'the pinner no longer watches its stop file');
check(pinner.includes('addShutdownHook'), 'the pinner no longer restores on a signal');
check(/finally\s*\{[\s\S]*restore\.run\(\)/.test(pinner), 'the pinner no longer restores in finally');

console.log('seed pin: controller parses, epoch arithmetic stays in awk, congruence exact on 5 cases, pinner caps and restores intact');
