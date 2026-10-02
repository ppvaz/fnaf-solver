#!/usr/bin/env node
// Read-only report for a retained Plan 20 bench trace.
// It validates the raw path before calculating any percentile, and never
// upgrades the trace's claim level or supplies missing physical measurements.
import { readFile, writeFile } from 'node:fs/promises';
import { summarizeBenchTrace } from '@sixam/review/measure';

function argument(name: string) {
  const index = process.argv.indexOf(name);
  return index < 0 ? null : process.argv[index + 1];
}

function help() {
  console.log('Usage: node packages/review/bin/report/bench-trace.ts --input TRACE.json [--out SUMMARY.json]');
}

const inputPath = argument('--input');
const helpRequested = process.argv.includes('--help') || process.argv.includes('-h');
if (helpRequested) {
  help();
} else if (!inputPath) {
  help();
  process.exitCode = 2;
} else {
  try {
    const trace = JSON.parse(await readFile(inputPath, 'utf8'));
    const summary = summarizeBenchTrace(trace);
    const text = JSON.stringify(summary, null, 2) + '\n';
    const outputPath = argument('--out');
    if (outputPath) await writeFile(outputPath, text);
    process.stdout.write(text);
  } catch (error) {
    console.error(`bench trace: ${(error as Error).message}`);
    process.exitCode = 2;
  }
}
