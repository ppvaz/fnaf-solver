#!/usr/bin/env node
// The review CLI (`npm run review`, bin `fnaf2-review`): the solver interface's verbs from a shell,
// the same functions the MCP server calls (solver.mjs), and the promotions query.
//
//   npm run review -- query promotions [--envelope] [--write FILE --date YYYY-MM-DD]
//   npm run review -- query packs|chronicle|contracts [--game G] [--text T] [--kind K] [--negative] [--limit N]
//   npm run review -- describe GAME
//   npm run review -- review PACK_ID INSTRUMENT
//   npm run review -- promote PACK_ID
//   npm run review -- check RULE 'JSON'
//   npm run review -- resource URI
//   npm run review -- truth events GAME 'JSON' | truth object GAME NAME|--handle N | truth decode /abs/APK|CCN --game G
//
// `query promotions` prints the query as JSON, unchanged, and exits 0 when the graph and the
// derivation agree, 1 when they do not; `--envelope` prints it as a claim-envelope-v1 instead
// (a refusal when they disagree), and `--write` also retains the output as an evidence record
// naming the command, the commit it ran at, the inputs that were dirty, and a content hash.
// Every other verb prints a claim-envelope-v1 and exits 0 for a claim, 1 for a refusal. A usage
// error exits 2. Nothing here writes, except `--write`'s record; `promote` only proposes.
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promotionsQueryEnvelope } from './envelopes.mjs';
import { QUERY_COMMAND, QUERY_INPUTS, promotionsRecord, queryPromotions } from './promotions-query.mjs';

const ROOT = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const USAGE = `Usage: npm run review -- query promotions [--envelope] [--write FILE] [--date YYYY-MM-DD]
       npm run review -- query packs|chronicle|contracts [--game G] [--text T] [--kind K] [--negative] [--limit N]
       npm run review -- describe GAME
       npm run review -- review PACK_ID custody|outcome|promotion-checks|death-time
       npm run review -- promote PACK_ID
       npm run review -- check seed-floor|directional-reuse|capabilities-first|unknown-as-number 'JSON'
       npm run review -- resource URI
       npm run review -- truth events GAME '{"object": NAME, "value": N, "access": "write"}'
       npm run review -- truth object GAME NAME | truth object GAME --handle N
       npm run review -- truth decode /abs/path/base.apk|application.ccn --game GAME

  query promotions re-derives every PROMOTED_BY edge in docs/evidence/graph.json from the
  committed run packs (each lifted to a kernel GameRun), their plan12-attestation.json and the
  committed winners; shows the attester and the custody class beside each edge; and derives S1's
  open items: committed MODEL_ONLY winners no pack names, and UNTRACKED_WINNER_DEBT. Prints JSON.
  Exit 0 when graph and derivation agree, 1 when they do not, 2 on a usage error.

  --envelope    print it as a claim-envelope-v1 (a refusal when graph and derivation disagree)
  --write FILE  also retain the output as an evidence record (command, commit, dirty inputs,
                evidenceId), e.g. docs/evidence/review-promotions-YYYYMMDD.json
  --date DATE   the record's date (default: today, UTC)

  The other verbs are the solver interface's (packages/review/src/solver.mjs, the functions the
  fnaf-solver MCP server calls). Each prints a claim-envelope-v1: exit 0 for a claim, 1 for a
  refusal. promote never writes an attestation or an edge; it proposes one or refuses.

  truth reads your own local dump of the game's event sheet (packages/source/decompile/truth.mjs):
  it is found through packages/source/decompile/local-vault.json (untracked) or $SIXAM_TRUTH_VAULT,
  and truth decode makes one from an APK or CCN on this host with the local CTFAK dumper. The
  repository ships the decoder, never the decoded data.`;

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
// Resolves once the write is handed to the OS: stdout to a pipe is asynchronous on macOS, so a
// process.exit() straight after a large write cut the promotions query off mid-string there.
const print = value => new Promise(done => process.stdout.write(`${JSON.stringify(value, null, 2)}\n`, done));
const answer = async envelope => { await print(envelope); process.exit(envelope.refused ? 1 : 0); };

if (verb === 'query' && what === 'promotions') {
  let write = null;
  let envelope = false;
  let date = new Date().toISOString().slice(0, 10);
  for (let index = 0; index < rest.length; index += 1) {
    if (rest[index] === '--write' && rest[index + 1]) write = rest[++index];
    else if (rest[index] === '--date' && /^\d{4}-\d{2}-\d{2}$/.test(rest[index + 1] ?? '')) date = rest[++index];
    else if (rest[index] === '--envelope') envelope = true;
    else usage(`unknown or incomplete option ${rest[index]}`);
  }
  const result = queryPromotions(ROOT);
  await print(envelope ? promotionsQueryEnvelope(result) : result);
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
}

const VERBS = ['query', 'describe', 'review', 'promote', 'check', 'resource', 'truth'];
if (!VERBS.includes(verb)) usage(verb ? `unknown verb ${verb}` : 'a verb is required');
// The solver is loaded only for its verbs, so `query promotions` runs exactly as it always has.
const { createSolver } = await import('./solver.mjs');
const solver = createSolver({ root: ROOT });

if (verb === 'query') {
  if (!what) usage('query needs a name');
  const options = { what };
  for (let index = 0; index < rest.length; index += 1) {
    const flag = rest[index];
    if (flag === '--negative') options.negative = true;
    else if (['--game', '--text', '--kind', '--limit'].includes(flag) && rest[index + 1] !== undefined) {
      const value = rest[++index];
      options[flag.slice(2)] = flag === '--limit' ? Number(value) : value;
    } else usage(`unknown or incomplete option ${flag}`);
  }
  await answer(solver.query(options));
}
if (verb === 'describe') {
  if (!what || rest.length) usage('describe takes one game');
  await answer(solver.describe({ game: what }));
}
if (verb === 'review') {
  if (!what || rest.length !== 1) usage('review takes a pack id and an instrument');
  await answer(solver.review({ pack: what, instrument: rest[0] }));
}
if (verb === 'promote') {
  if (!what || rest.length) usage('promote takes one pack id');
  await answer(solver.promote({ pack: what }));
}
if (verb === 'check') {
  if (!what || rest.length > 1) usage('check takes a rule and one JSON object');
  let input = {};
  try { input = rest.length ? JSON.parse(rest[0]) : {}; } catch (error) { usage(`the check input is not JSON: ${error.message}`); }
  if (input === null || typeof input !== 'object' || Array.isArray(input)) usage('the check input is a JSON object');
  await answer(solver.check({ ...input, rule: what }));
}
if (verb === 'truth') {
  const [first, second, ...more] = rest;
  if (what === 'events') {
    if (!first || second === undefined || more.length) usage('truth events takes a game and one JSON query');
    let query;
    try { query = JSON.parse(second); } catch (error) { usage(`the truth query is not JSON: ${error.message}`); }
    await answer(solver.truth({ op: 'events', game: first, query }));
  }
  if (what === 'object') {
    if (!first || second === undefined) usage('truth object takes a game and a name, or --handle N');
    if (second === '--handle') {
      if (more.length !== 1 || !/^\d+$/.test(more[0])) usage('--handle takes one integer');
      await answer(solver.truth({ op: 'object', game: first, handle: Number(more[0]) }));
    }
    if (more.length) usage('truth object takes one name (quote it)');
    await answer(solver.truth({ op: 'object', game: first, name: second }));
  }
  if (what === 'decode') {
    if (!first || second !== '--game' || more.length !== 1) usage('truth decode takes an absolute path and --game G');
    await answer(solver.truth({ op: 'decode', path: first, game: more[0] }));
  }
  usage(`truth takes events, object or decode, not ${what ?? 'nothing'}`);
}
if (verb === 'resource') {
  if (!what || rest.length) usage('resource takes one URI');
  const envelope = solver.readResource(what);
  if (!envelope) usage(`no resource ${what}; resources: ${solver.listResources().map(item => item.uri).join(', ')}`);
  await answer(envelope);
}
