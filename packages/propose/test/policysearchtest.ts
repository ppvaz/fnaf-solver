// Plan 21 package 4: reproducible constrained positive/negative campaign.
//
// This campaign's candidates are the Night 1 Minimal family and two deliberate
// mutations of it. They are declared controls, so it runs the duplicate control
// in `record` mode: every candidate still carries its closed-family
// classification, but a known control is not rejected for being one. An
// invention campaign uses the default `reject` mode instead.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { minimalPolicy } from '../bin/policy/policy-ir.ts';
import { classifyPolicy } from '../bin/policy/policy-grammar.ts';
import { runSearch } from '../bin/policy/policy-search.ts';

const check = (condition, message) => { if (!condition) throw new Error(message); };
const base = minimalPolicy();
const temp = mkdtempSync(join(tmpdir(), 'fnaf2-policy-search-'));
const output = join(temp, 'report.json');
const report = runSearch(base, {
  night: 1, seeds: 8, periods: [10000], dropRepeatActions: ['wind'],
  minContactMs: 33, closedFamilyPolicy: 'record', output,
});

const accepted = report.candidates.filter(candidate => candidate.status === 'accepted');
const dropped = report.candidates.find(candidate => candidate.id.endsWith('-drop-wind'));
check(accepted.some(candidate => candidate.id === base.metadata.id),
  'constrained search lost the exact-engine positive control');
check(dropped?.status === 'rejected' && dropped.reasons.some(reason => reason.startsWith('exact-survival:')),
  'constrained search did not retain the known negative control');
check(report.frontier.includes(base.metadata.id), 'positive control was pruned from the frontier');
check(classifyPolicy(base).known, 'base candidate was not classified as a known family');
check(dropped.dependencies.sourceDependencies.length > 0 &&
      dropped.dependencies.calibrationProfile === 'moto-g56-v207-landscape',
  'rejected candidate lost its dependency provenance');
check(JSON.parse(readFileSync(output, 'utf8')).candidates.length === report.candidates.length,
  'persisted search report omitted candidates');
check(report.candidates.every(candidate => candidate.closedFamilies
  .some(match => match.id === 'unconditioned-schedule')),
  'the duplicate control did not classify an unconditioned schedule');
check(report.options.closedFamilyPolicy === 'record',
  'the search report did not record which duplicate-control mode ran');
check(report.language.excluded.some(entry => entry.fact === 'bbVent' &&
  entry.exclusion === 'read-cost-unmeasured'),
  'the search report did not carry the observation budget it searched under');

// The same campaign under the default mode must reject its own controls: that
// is what makes the duplicate control mechanical rather than advisory.
const strict = runSearch(base, { night: 1, seeds: 8, minContactMs: 33 });
check(strict.candidates.every(candidate => candidate.status === 'rejected' &&
  candidate.reasons.some(reason => reason.startsWith('closed-family:'))),
  'the default search mode admitted a family closed by recorded negative');
rmSync(temp, { recursive: true, force: true });
console.log(`policy search: ${accepted.length} accepted control(s), ${report.candidates.length - accepted.length} rejected, frontier persisted`);
