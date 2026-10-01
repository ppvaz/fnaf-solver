// Plan 21 package 1 contract: finite policy IR round-trip and source mapping.
import { createHash } from 'node:crypto';
import { canonicalPolicy, roundTripPolicy } from '@sixam/propose/policy';
import { minimalPolicy } from './policy-ir.ts';

const check = (condition, message) => { if (!condition) throw new Error(message); };
const program = minimalPolicy();
const canonical = canonicalPolicy(program);
const hash = createHash('sha256').update(canonical).digest('hex');
const again = roundTripPolicy(JSON.parse(canonical));
check(canonicalPolicy(again) === canonical, 'policy IR did not round-trip');
check(program.phases.map(phase => phase.kind).join(',') ===
      'idle,setup,repeat,finish,observe', 'policy phases are not complete');
check(program.phases[2].periodMs === 5000 && program.phases[4].endMs === 420000,
      'minimal plan timing did not enter the IR');
check(program.phases[2].actions.every(action => action.offsetMs >= 0),
      'repeat actions are not relative offsets');
check(hash.length === 64 && program.proof.traceEquivalence,
      'policy hash/proof obligation is missing');
console.log(`policy IR: ${program.metadata.id} round-trips with hash ${hash}`);
