#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { compileBundle } from './bundle.mjs';

function arg(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index < 0 ? undefined : process.argv[index + 1];
}

const winnerPath = arg('winner');
const outPath = arg('out');
if (!winnerPath || !outPath || process.argv.includes('--help')) {
  console.error('usage: npm run device:emit -- --winner winner.json --out artifacts/run-001');
  process.exit(process.argv.includes('--help') ? 0 : 2);
}
if (process.argv.some((value, index) => value.startsWith('--') &&
    !['--winner', '--out', '--help'].includes(value) &&
    process.argv[index - 1] !== '--winner' && process.argv[index - 1] !== '--out')) {
  console.error('device:emit: unknown option');
  process.exit(2);
}

try {
  const winner = JSON.parse(readFileSync(winnerPath, 'utf8'));
  const result = compileBundle(winner, outPath);
  console.log(`device bundle READY: ${outPath}`);
  console.log(`  strategy=${result.manifest.strategy} nights=${result.manifest.nights.join(',')} ` +
    `plans=${result.plans.length} replay=${result.replay.hash}`);
} catch (error) {
  console.error(`device:emit: ${error.message}`);
  process.exit(1);
}
