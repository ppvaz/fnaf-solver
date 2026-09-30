#!/usr/bin/env node
// The review CLI (`npm run review`, bin `fnaf2-review`). Its one verb today is a query:
//
//   npm run review -- query promotions [--write FILE --date YYYY-MM-DD]
//
// It prints the query as JSON and exits 0 when the graph and the derivation agree, 1 when they do
// not, and 2 on a usage error. `--write` also retains the output as an evidence record naming the
// command, the commit it ran at, the inputs that were dirty, and a content hash.
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { QUERY_COMMAND, QUERY_INPUTS, promotionsRecord, queryPromotions } from './promotions-query.mjs';

const ROOT = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const USAGE = `Usage: npm run review -- query promotions [--write FILE] [--date YYYY-MM-DD]

  Re-derives every PROMOTED_BY edge in docs/evidence/graph.json from the committed run packs
  (each lifted to a kernel GameRun), their plan12-attestation.json and the committed winners;
  shows the attester and the custody class beside each edge; and derives S1's open items:
  committed MODEL_ONLY winners no pack names, and UNTRACKED_WINNER_DEBT. Prints JSON.
  Exit 0 when graph and derivation agree, 1 when they do not, 2 on a usage error.

  --write FILE  also retain the output as an evidence record (command, commit, dirty inputs,
                evidenceId), e.g. docs/evidence/review-promotions-YYYYMMDD.json
  --date DATE   the record's date (default: today, UTC)`;

const usage = message => {
  if (message) console.error(`review: ${message}`);
  console.error(USAGE);
  process.exit(2);
};

const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  console.log(USAGE);
  process.exit(0);
}
const [verb, what, ...rest] = args;
if (verb !== 'query') usage(verb ? `unknown verb ${verb}` : 'a verb is required');
if (what !== 'promotions') usage(what ? `unknown query ${what}` : 'query needs a name');
let write = null;
let date = new Date().toISOString().slice(0, 10);
for (let index = 0; index < rest.length; index += 1) {
  if (rest[index] === '--write' && rest[index + 1]) write = rest[++index];
  else if (rest[index] === '--date' && /^\d{4}-\d{2}-\d{2}$/.test(rest[index + 1] ?? '')) date = rest[++index];
  else usage(`unknown or incomplete option ${rest[index]}`);
}

const result = queryPromotions(ROOT);
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (write) {
  const file = resolve(write);
  const rel = relative(ROOT, file);
  const git = argv => execFileSync('git', argv, { cwd: ROOT, encoding: 'utf8' });
  const commit = git(['rev-parse', 'HEAD']).trim();
  const dirtyInputs = git(['status', '--porcelain=v1', '--', ...QUERY_INPUTS]).split('\n').filter(Boolean).sort();
  const record = promotionsRecord(result, { date, commit, dirtyInputs,
    command: `${QUERY_COMMAND} --write ${rel} --date ${date}` });
  writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);
  console.error(`review: wrote ${rel} (${record.evidenceId})`);
}
process.exit(result.consistent ? 0 : 1);
