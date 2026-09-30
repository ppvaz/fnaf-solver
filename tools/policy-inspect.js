#!/usr/bin/env node
/** Inspect a finite policy artifact without executing it or touching a device. */
import { canonicalPolicy } from '@sixam/propose/policy';
import { minimalPolicy } from './device/policy-ir.mjs';

if (process.argv.includes('--help') || process.argv.length < 3) {
  console.log('Usage: npm run policy -- [--help|--json]\nPrints the reviewed Night 1 Minimal policy and its canonical identity.');
} else {
  const policy = minimalPolicy();
  const output = { schema: 'policy-inspection-v1', id: policy.metadata.id, phases: policy.phases.map(({ id, kind, startMs, endMs }) => ({ id, kind, startMs, endMs })), canonicalBytes: canonicalPolicy(policy).length, claimLevel: 'MODEL_ONLY' };
  console.log(process.argv.includes('--json') ? JSON.stringify({ ...output, policy }, null, 2) : JSON.stringify(output, null, 2));
}
