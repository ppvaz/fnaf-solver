// truth.* (Plan 28 step 5) over a synthetic dump: the parse, the handle scramble K, the events and
// object queries, the refusals, and decode through a stand-in decoder. Every fixture is synthetic
// (fixtures/truth-dump.ts); no answer carries a line of the dump; and every tracked truth file
// passes tools/dump-text-check.ts, which does catch the text the fixture generates.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isUnknown, validateClaimEnvelope } from '@sixam/kernel';
import type { ClaimEnvelope, RefusalEnvelope } from '@sixam/kernel';
import type { ExpressionItem } from '../src/truth/dump.ts';
import { NO_LOCAL_DUMP, VAULT_ENV, createTruth, extractCcn } from '@sixam/source/truth';
import { estimateHandleScramble, parseDump, parseParameter, truthUri } from '@sixam/source/truth/read';
import type { describeObject } from '@sixam/source/truth/read';
import { STORED, SYNTHETIC_K, eventHandle, renderedSheet, storedZip, syntheticCcn, syntheticDump } from './fixtures/truth-dump.ts';

/** What truth answers, read as either envelope. */
type Envelope = Partial<ClaimEnvelope> & Partial<RefusalEnvelope>;
/** An object truth describes from its item-table row. */
type Described = Extract<ReturnType<typeof describeObject>, { readonly typeName: unknown }>;

const ROOT = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const temp = mkdtempSync(join(tmpdir(), 'truth-test-'));
const write = (name: string, text: string | Buffer) => { const path = join(temp, name); writeFileSync(path, text); return path; };
const dumpText = syntheticDump();
const dumpFile = write('events.txt', dumpText);
const vault = (name: string, config: Record<string, unknown>) => write(name, JSON.stringify({ schema: 'truth-local-vault-v1', ...config }));
const truthWith = (vaultFile: string, extra = {}) => createTruth({ root: ROOT, env: { PATH: '', [VAULT_ENV]: vaultFile, ...extra } });
const claim = <T extends Envelope>(value: T, what: string) => {
  validateClaimEnvelope(value);
  assert.notEqual(value.refused, true, `${what} is a claim: ${JSON.stringify(value).slice(0, 400)}`);
  assert.equal(value.label, 'SOURCED', `${what} is SOURCED`);
  return value as Extract<T, ClaimEnvelope>;   // a refusal fails the first assertion
};
const refused = <T extends Envelope>(value: T, rule: string, what: string) => {
  validateClaimEnvelope(value);
  assert.equal(value.refused, true, `${what} is refused: ${JSON.stringify(value).slice(0, 300)}`);
  assert.equal(value.rule, rule, `${what} is refused by ${rule}, not ${value.rule}`);
  return value as Extract<T, RefusalEnvelope>;   // a claim fails the first assertion
};
const groupsOf = (answer: { readonly claim: { readonly matches: readonly { readonly frame: number | null, readonly group: string }[] } }) => answer.claim.matches.map(match => `${match.frame}/${match.group}`);
let checks = 0;

try {
  // --- the parse -------------------------------------------------------------------------------
  const dump = parseDump(dumpText);
  assert.equal(dump.frames.length, 2);
  assert.equal(dump.objects.size, 10);
  assert.deepEqual(dump.frames.map(frame => frame.groups.length), [1, 7]);
  assert.deepEqual(dump.audit, { unclassified: [], countMismatches: [] }, 'every synthetic line is a known record');
  const withJunk = parseDump(`${dumpText}not a record\n`);
  assert.equal(withJunk.audit.unclassified.length, 1, 'an unknown line is counted, by line number');
  const compare = dump.frames[1].groups[0].conditions[0];
  assert.deepEqual([compare.kind, compare.objectType, compare.num, compare.handle, compare.negated], ['condition', 2, -27, eventHandle('lamp'), false]);
  assert.deepEqual(compare.params.map(param => [param.code, param.loader, param.parsed]), [[50, 'AlterableValue', true], [23, 'ExpressionParameter', true]]);
  assert.equal(compare.params[0].slot, 2);
  assert.equal(compare.params[1].comparison, '==');
  assert.deepEqual((compare.params[1].items as readonly Exclude<ExpressionItem, { readonly parsed: false }>[]).map(item => [item.objectType, item.num, item.loader, item.value]), [[-1, 0, 'LongExp', 1], [0, 0, null, null]]);   // both tokens parse
  const create = dump.frames[1].groups[2].actions[0].params[0];
  assert.deepEqual([create.loader, create.handle, create.position?.parent, create.position?.x], ['Create', eventHandle('crate'), eventHandle('lamp'), 10]);
  // The dumper's global-value rendering: a digit string above 26, the character with that code at or below it, and one space for 9, 10 and 13.
  assert.equal(parseParameter(['49', 'GlobalValue', 'GlobalValue30'].join(':')).slot, 30);
  assert.equal(parseParameter(['49', 'GlobalValue', `GlobalValue${String.fromCharCode(0)}`].join(':')).slot, 0);
  assert.ok(isUnknown(parseParameter(['49', 'GlobalValue', 'GlobalValue '].join(':')).slot), 'a global rendered as a space is UNKNOWN');
  assert.equal(parseParameter(['29', 'IntParam', 'CTFAK.CCN.Chunks.Frame.IntParam'].join(':')).parsed, false);
  assert.deepEqual(parseParameter(['32', 'Click', '0-0'].join(':')), { code: 32, loader: 'Click', parsed: true, button: 0, double: false });
  checks += 1;

  // --- K by object-type agreement ---------------------------------------------------------------
  const k28 = estimateHandleScramble(dump);
  assert.deepEqual([k28.k, k28.agreement, k28.ambiguous], [SYNTHETIC_K, 1, false], 'the synthetic K=28 is recovered at full agreement');
  assert.ok(Number(k28.margin) > 0.3, `a sharp margin over the runner-up (${k28.margin})`);
  const k0 = estimateHandleScramble(parseDump(syntheticDump({ k: 0 })));
  assert.deepEqual([k0.k, k0.agreement], [0, 1], 'an unscrambled dump (a PC build) reads K=0');
  assert.equal(estimateHandleScramble(parseDump(dumpText.split('\n').filter(line => !line.startsWith(' C') && !line.startsWith(' A')).join('\n'))).ambiguous, true,
    'with no object-bound row, no K is singled out');
  checks += 1;

  // --- events over a configured local dump ------------------------------------------------------
  const vaultFile = vault('vault.json', { games: { 'com.scottgames.fnaf2': { dump: dumpFile } } });
  const truth = truthWith(vaultFile);
  assert.deepEqual(truth.status('fnaf2'), { configured: true });
  assert.deepEqual(truth.status('fnaf3'), { configured: false, reason: NO_LOCAL_DUMP });

  const value = claim(truth.events({ game: 'fnaf2', query: { object: 'lamp', value: 2 } }), 'lamp value 2');
  assert.equal(value.target, 'com.scottgames.fnaf2');
  assert.deepEqual(groupsOf(value), ['1/g0', '1/g1']);
  assert.deepEqual(value.claim.byAccess, { read: 2, write: 1 });
  assert.deepEqual(value.cite.slice(0, 2), [truthUri('fnaf2', 1, 0), truthUri('fnaf2', 1, 1)]);
  assert.equal(value.cite[0], 'fnaf://truth/fnaf2/frame/1/group/0');
  assert.equal(value.claim.handleScramble.k, SYNTHETIC_K);
  assert.equal(value.claim.target.objects?.[0]?.name, 'lamp');
  const [g0] = value.claim.matches;
  assert.deepEqual(g0.hits.map(hit => [hit.ace, hit.access, hit.via]), [['condition 0', 'read', 'alterable-value'], ['action 0', 'write', 'alterable-value']]);
  assert.deepEqual(g0.conditions[0].object, { handle: eventHandle('lamp'), stored: STORED.lamp, name: 'lamp', type: 2, typeName: 'active' });
  assert.equal(g0.conditions[0].name, 'compare-alterable-value');
  assert.equal(g0.actions[1].object?.name, 'tally', 'each row names its object through K, not the dumper\'s NAME field');
  assert.equal(value.claim.matches[1].hits[0].via, 'expression', 'an expression token that reads the value is a read');
  assert.ok(value.notMeasured.some(item => item.startsWith(`the handle scramble K=${SYNTHETIC_K}`)), 'the K caveat is named');
  assert.match(value.reproducer, /^npm run review -- truth events fnaf2 '/);
  // No answer carries the dump's line text.
  const answerText = JSON.stringify(value);
  assert.ok(!answerText.includes('\\t'), 'no tab-separated record survives into the answer');
  for (const line of dumpText.split('\n').filter(item => item.length > 12)) assert.ok(!answerText.includes(line), 'a dump line is returned');
  assert.ok(!answerText.includes('wrong name'), 'the dumper\'s NAME field is never read');

  const writes = claim(truth.events({ game: 'fnaf2', query: { object: 'lamp', value: 2, access: 'write' } }), 'lamp value 2 writes');
  assert.deepEqual(groupsOf(writes), ['1/g0']);
  const flag = claim(truth.events({ game: 'com.scottgames.fnaf2', query: { object: 'lamp', flag: 4 } }), 'lamp flag 4');
  assert.deepEqual(flag.claim.matches.map(match => [match.group, match.access, match.certain]),
    [['g1', ['read'], true], ['g4', ['write'], true], ['g6', ['write'], false]]);
  assert.ok(flag.notMeasured.some(item => item.includes('certain: false')), 'an uncertain hit is named');
  const global = claim(truth.events({ game: 'fnaf2', query: { global: 3 } }), 'global 3');
  assert.deepEqual(flag.claim.matches.length, 3);
  assert.deepEqual(global.claim.matches.map(match => [match.frame, match.group, match.access[0]]), [[0, 'g0', 'write'], [1, 'g4', 'read']]);
  const ambiguous = claim(truth.events({ game: 'fnaf2', query: { global: 10 } }), 'global 10');
  assert.deepEqual(ambiguous.claim.matches.map(match => [match.group, match.certain]), [['g5', false]]);
  const crate = claim(truth.events({ game: 'fnaf2', query: { handle: eventHandle('crate') } }), 'crate by handle');
  assert.deepEqual(crate.claim.matches.map(match => [match.group, match.hits.map(hit => hit.via).join('+')]),
    [['g1', 'subject'], ['g2', 'creates'], ['g3', 'subject']]);
  const tally = claim(truth.events({ game: 'fnaf2', query: { object: 'TALLY', frame: 1 } }), 'tally in frame 1');
  assert.deepEqual(groupsOf(tally), ['1/g0', '1/g3', '1/g6'], 'names match case-insensitively; a frame narrows');
  const limited = claim(truth.events({ game: 'fnaf2', query: { object: 'tally', limit: 1 } }), 'a limit');
  assert.equal(limited.claim.shown, 1);
  assert.ok(limited.notMeasured.includes('2 more matching groups beyond the limit'));
  const cited = claim(truth.readUri('fnaf://truth/fnaf2/frame/1/group/4') as NonNullable<ReturnType<typeof truth.readUri>>, 'a cited group, read back');   // a truth URI
  assert.deepEqual(groupsOf(cited), ['1/g4']);
  assert.ok(cited.notMeasured.some(item => item.includes('IntParam')), 'a parameter printed only as a class name is named');
  assert.equal(truth.readUri('fnaf://truth/fnaf2/group/1'), null, 'a URI without its frame is not a truth URI');
  checks += 1;

  // --- object ----------------------------------------------------------------------------------
  const described = claim(truth.object({ game: 'fnaf2', name: 'crate' }), 'object crate');
  const [row] = described.claim.objects as readonly Described[];   // crate is an item-table row
  assert.deepEqual([row.handle, row.type, row.typeName, row.frames], [eventHandle('crate'), 2, 'active', [1]]);
  assert.deepEqual(row.createdBy.map(item => item.group), ['g2']);
  assert.deepEqual(row.destroyedBy.map(item => item.group), ['g3']);
  assert.ok(isUnknown(row.placed), 'where it is placed is UNKNOWN, with its reason');
  assert.ok(described.cite.includes(truthUri('fnaf2', 1, 2)) && described.cite.includes(truthUri('fnaf2', 1, 3)));
  const lamp = claim(truth.object({ game: 'fnaf2', handle: eventHandle('lamp') }), 'object lamp by handle');
  assert.deepEqual([(lamp.claim.objects[0] as Described).name, lamp.claim.objects[0].initialValues], ['lamp', [0, 0, 5]]);   // lamp is an item-table row
  assert.equal(lamp.reproducer, `npm run review -- truth object fnaf2 --handle ${eventHandle('lamp')}`);
  checks += 1;

  // --- refusals --------------------------------------------------------------------------------
  refused(truth.events({ game: 'fnaf9', query: { global: 1 } }), 'invalid-argument', 'an unregistered game');
  refused(truth.events({ game: 'fnaf2' }), 'invalid-argument', 'no query');
  refused(truth.events({ game: 'fnaf2', query: { global: 1, object: 'lamp' } }), 'invalid-argument', 'two targets');
  refused(truth.events({ game: 'fnaf2', query: { value: 1 } }), 'invalid-argument', 'a value without its object');
  refused(truth.events({ game: 'fnaf2', query: { group: 1 } }), 'invalid-argument', 'a group without its frame');
  refused(truth.events({ game: 'fnaf2', query: { global: 1, text: 'x' } }), 'invalid-argument', 'a field the query does not take');
  refused(truth.events({ game: 'fnaf2', query: { frame: 1, group: 99 } }), 'invalid-argument', 'a group that does not exist');
  const near = refused(truth.events({ game: 'fnaf2', query: { object: 'lam' } }), 'invalid-argument', 'a name that does not exist');
  assert.match(near.because, /names containing it: lamp/);
  refused(truth.object({ game: 'fnaf2', name: 'crate', handle: 1 }), 'invalid-argument', 'name and handle together');
  refused(truth.call({ op: 'rebuild' }), 'invalid-argument', 'an op that does not exist');
  const pinned = truthWith(vault('pinned.json', { games: { fnaf2: { dump: dumpFile, k: 0 } } }));
  refused(pinned.events({ game: 'fnaf2', query: { global: 3 } }), 'handle-scramble', 'a pinned K the dump disagrees with');
  const rendered = truthWith(vault('rendered.json', { games: { fnaf2: { dump: write('03-04-Room.txt', renderedSheet()) } } }));
  refused(rendered.events({ game: 'fnaf2', query: { global: 3 } }), 'not-a-tabular-dump', 'the older rendered form');
  const broken = truthWith(write('broken.json', '{ not json'));
  refused(broken.events({ game: 'fnaf2', query: { global: 3 } }), 'truth-vault', 'a vault that does not read');
  checks += 1;

  // --- no dump configured: refuse, naming the decode ----------------------------------------------
  const none = truthWith(join(temp, 'absent-vault.json'));
  assert.deepEqual(none.status('fnaf2'), { configured: false, reason: NO_LOCAL_DUMP });
  const noDump = refused(none.events({ game: 'fnaf2', query: { object: 'lamp' } }), 'no-local-dump', 'no local dump');
  assert.match(noDump.because, /ships the decoder, not the decoded data/);
  assert.match(noDump.remedy, /truth decode/);
  assert.match(noDump.remedy, /regen-dump\.sh/);
  refused(none.object({ game: 'fnaf2', name: 'lamp' }), 'no-local-dump', 'object with no local dump');
  refused(truthWith(vault('other.json', { games: { fnaf2: { dump: join(temp, 'gone.txt') } } })).events({ game: 'fnaf2', query: { global: 1 } }),
    'no-local-dump', 'a vault naming a dump that is not on this host');
  checks += 1;

  // --- decode: local files only, the toolchain or a refusal ---------------------------------------
  const ccn = write('application.ccn', syntheticCcn());
  refused(none.decode({ path: 'relative/base.apk', game: 'fnaf2' }), 'invalid-argument', 'a relative path');
  refused(none.decode({ path: join(temp, 'missing.apk'), game: 'fnaf2' }), 'invalid-argument', 'a file that is not on this host');
  refused(none.decode({ path: ccn }), 'invalid-argument', 'a decode that names no game');
  refused(none.decode({ path: join(ROOT, 'package.json'), game: 'fnaf2' }), 'game-content-in-repository', 'a file inside the repository');
  refused(none.decode({ path: write('notes.txt', 'plain text'), game: 'fnaf2' }), 'invalid-argument', 'neither an APK nor a CCN');
  const absent = refused(none.decode({ path: ccn, game: 'fnaf2' }), 'decoder-absent', 'no toolchain');
  assert.match(absent.remedy, /CTFAK_SRC/);
  const cache = join(temp, 'cache');
  const stub = join(ROOT, 'packages/source/test/fixtures/truth-decoder-stub.ts');
  const decodeVault = vault('decode.json', { games: {}, cache, decoder: { dotnet: process.execPath, ctfakCli: stub } });
  const decoding = truthWith(decodeVault);
  refused(truthWith(vault('cache-in-repo.json', { cache: join(ROOT, 'artifacts', 'truth-cache'), decoder: { dotnet: process.execPath, ctfakCli: stub } }))
    .decode({ path: ccn, game: 'fnaf2' }), 'game-content-in-repository', 'a decode cache inside the repository');
  const decoded = claim(decoding.decode({ path: ccn, game: 'fnaf2' }), 'decode a CCN');
  assert.equal(decoded.claim.cached, false);
  assert.deepEqual([decoded.claim.record.handleScramble.k, decoded.claim.record.handleScramble.agreement], [SYNTHETIC_K, 1]);
  assert.equal(decoded.claim.record.dump.groups, 8);
  const bound = JSON.parse(readFileSync(decodeVault, 'utf8'));
  assert.equal(bound.games['com.scottgames.fnaf2'].estimatedK, SYNTHETIC_K, 'decode binds the dump to the game named, in the local vault');
  assert.ok(existsSync(bound.games['com.scottgames.fnaf2'].dump) && bound.games['com.scottgames.fnaf2'].dump.startsWith(cache));
  assert.deepEqual(groupsOf(claim(decoding.events({ game: 'fnaf2', query: { global: 3 } }), 'events over a decoded dump')), ['0/g0', '1/g4']);
  assert.equal(claim(decoding.decode({ path: ccn, game: 'fnaf2' }), 'decode again').claim.cached, true, 'a second decode reads the cache');
  const apk = write('base.apk', storedZip('res/raw/application.ccn', syntheticCcn()));
  const fromApk = claim(decoding.decode({ path: apk, game: 'fnaf2' }), 'decode an APK');
  assert.deepEqual([fromApk.claim.record.source.kind, fromApk.claim.record.source.entry], ['apk', 'res/raw/application.ccn']);
  assert.equal(fromApk.claim.record.ccn.sha256, decoded.claim.record.ccn.sha256, 'the CCN inside the APK is the same bytes');
  assert.equal(extractCcn(write('other.apk', storedZip('assets/readme.txt', Buffer.from('x'))), join(temp, 'none.ccn')), null, 'an APK with no CCN');
  refused(decoding.decode({ path: write('empty.apk', storedZip('lib/x.so', Buffer.from('x'))), game: 'fnaf2' }), 'invalid-argument', 'an APK with no CCN');
  checks += 1;

  // --- the dump-text check: tracked files pass it, the generated text does not --------------------
  const check = (file: string) => spawnSync(process.execPath, [join(ROOT, 'tools/dump-text-check.ts'), file], { encoding: 'utf8' });
  const tracked = ['packages/source/src/truth/dump.ts', 'packages/source/src/truth/engine.ts', 'packages/source/src/truth/handles.ts',
    'packages/source/src/truth/query.ts', 'packages/source/src/truth/index.ts', 'packages/source/decompile/truth.ts',
    'packages/source/test/truth.test.ts', 'packages/source/test/fixtures/truth-dump.ts', 'packages/source/test/fixtures/truth-decoder-stub.ts'];
  for (const file of tracked) {
    const result = check(join(ROOT, file));
    assert.equal(result.status, 0, `${file} carries dump-shaped text:\n${result.stderr}`);
  }
  assert.equal(check(dumpFile).status, 1, 'the checker catches the synthetic dump the fixture generates');
  assert.equal(check(write('answer.json', JSON.stringify(value, null, 2))).status, 0, 'an answer is fields, not dump text');
  checks += 1;
} finally {
  rmSync(temp, { recursive: true, force: true });
}

console.log(`truth: ${checks} check groups pass -- the synthetic dump parsed, K=${SYNTHETIC_K} and K=0 recovered by object-type agreement, ` +
  'events and object answered as SOURCED fields citing fnaf://truth URIs, the refusals, decode through a stand-in decoder, and no dump text tracked');
