// Plan 21 package 5: compiler-equivalence regression gates.
import { emitPlan } from '../bin/plans/minus-toys-plan.ts';
import { minimalPolicy } from '../bin/policy/policy-ir.ts';
import {
  compileDevicePlan, comparePolicyToDevice,
} from '../bin/policy/policy-equivalence.ts';

const check = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };
const program = minimalPolicy();
const compiled = compileDevicePlan(program);
const comparison = comparePolicyToDevice(program, compiled);
check(comparison.equal, `compiled policy diverged: ${JSON.stringify(comparison.mismatches.slice(0, 3))}`);
// 185 since `3efc923` (2026-09-11), which gave the opening its first safe Toy
// stun -- `openStunLeadMs`/`openStunHoldMs`, one camera-feed hold in `open` and
// one in `opening`. That commit updated the emitter's own expected row and not
// this number, so the gate has read 183 against a 185-event plan ever since.
// It went unnoticed for nine days because this file was registered only in
// `tools/test.ts`'s ENGINE group, which CI does not run and whose reds
// CLAUDE.md excuses as intentional scientific controls. It is a
// compiler-equivalence regression gate, not a control, so it is now in
// `npm run test:unit` as well -- mistake register entry 13.
check(comparison.simulatorCount === 185 && comparison.phoneCount === 185,
  'equivalence fixture changed event count without a deliberate update');

function rejects(text: string, message: string) {
  const result = comparePolicyToDevice(program, text);
  check(!result.equal, message);
}

// A plan that arms early must not be allowed to masquerade as the IR opening.
rejects(compiled.replace('115000 tap monitor', '114900 tap monitor'),
  'early-arm timing defect was not caught');
// A hard-coded 10-second cadence must not replace the IR repeat period.
rejects(compiled.replace('#period 5000', '#period 10000'),
  'hard-coded cadence defect was not caught');
// The arming verifier is part of the policy projection: a valid schedule with
// the wrong double-camera pair must not silently verify a different strategy.
rejects(compiled.replace('#arm-verify-cameras cam:9,cam:11', '#arm-verify-cameras cam:8,cam:11'),
  'wrong double-camera arm pair was not caught');
// Removing the terminal proof and observation header must be a compile failure,
// not a shorter plan that happens to have a matching prefix.
rejects(compiled.replace(/#cycle finish[\s\S]*$/, '#cycle toys\n'),
  'missing terminal/observe tail was not caught');

// The real emitter is accepted as the external artifact for the same IR. This
// keeps the test tied to the shipped plan writer, not only our own compiler.
const emitted = emitPlan(1, { minimal: true });
const emittedComparison = comparePolicyToDevice(program, emitted);
check(emittedComparison.equal, `shipped emitter diverged: ${JSON.stringify(emittedComparison.mismatches.slice(0, 3))}`);
console.log(`policy equivalence: ${comparison.simulatorCount} semantic events match the mocked phone and shipped emitter`);
