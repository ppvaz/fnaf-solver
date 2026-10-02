// Run packs (packages/review/src/evidence-pack.ts) carry a night's text evidence into the repository and
// leave its frames behind. This builds a campaign and its night-run directory in a throwaway
// tree, packs them, and checks what may and may not cross: no media file, no pixel array, no
// machine path; every frame still named by hash; tampering refused; the gate reading the pack.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stableHash } from '@sixam/kernel/contracts';
import { CAMPAIGN_RESULT_SCHEMA } from '../src/evidence-campaign.ts';
import { ATTESTATION_FILE, ATTESTATION_SCHEMA, ATTESTATION_SCHEMA_V1, buildFnaf1Pack, buildPack, packCustody, packDigest, packEntry,
  packPromotionChecks, readPack, recoverFromRunLog, recoveryCheck, refuseFrames, resolvePackTargets, trackedWinners,
  writePack, WINNER_HASHES } from '../src/evidence-pack.ts';

type CampaignTarget = Extract<ReturnType<typeof resolvePackTargets>[number], { campaignDir: string }>;
type ErrorEntry = Extract<ReturnType<typeof packEntry>, { error: unknown }>;
interface RegisterRow { file: string, sha256: string, compiledWinnerHash: string | null }

const sha256 = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
const root = mkdtempSync(join(tmpdir(), 'evidence-pack-test-'));
const home = '/home/pack-tester'; // only ever a string to scrub; the root is usually beneath it
const put = (path: string, content: string | Buffer) => { mkdirSync(join(root, path, '..'), { recursive: true }); writeFileSync(join(root, path), content); };
try {
  const winner = { schema: 'winner-v1', strategy: 'minus-toys', knobs: { hallOffsetMs: 7400 } };
  put('packages/propose/bindings/fnaf2/campaign-night5-test-winner.json', JSON.stringify(winner));
  // The generated register trackedWinners reads (tools/generate-catalog.ts): this synthetic
  // winner does not compile, so only its file hash identifies it.
  const registerRows: (RegisterRow | undefined)[] = [{ file: 'packages/propose/bindings/fnaf2/campaign-night5-test-winner.json', sha256: sha256(JSON.stringify(winner)), compiledWinnerHash: null }];
  const writeRegister = () => put(WINNER_HASHES, JSON.stringify({ schema: 'winner-hashes-v1', winners: registerRows }));
  writeRegister();
  put('artifacts/b1/manifest.json', JSON.stringify({ schema: 'device-bundle-v1', winnerHash: stableHash(winner) }));

  const campaign = 'campaign-2026-09-20T00-41-12.166Z';
  const grid = Array.from({ length: 180 }, (_, index) => index * 4099);
  const frame = Buffer.from('not really a png, but bytes all the same');
  put(`artifacts/${campaign}/00001-title-observe.py.png`, frame);
  put(`artifacts/${campaign}/result.json`, JSON.stringify({ mode: 'live', status: 'COMPLETE', result: {
    schema: CAMPAIGN_RESULT_SCHEMA, version: 1, state: 'COMPLETE', specHash: 'fnv1a-spec', completedNights: [5],
    attempts: [{ attempt: 1, mode: 'live', night: 5, status: 'WIN', proofHash: 'fnv1a-7990063c',
      terminal: { night: 5, outcome: 'sixam', sixAm: true } }], events: [] } }));
  put(`artifacts/${campaign}/events.jsonl`, [
    { type: 'evidence.started', evidenceDirectory: `${root}/artifacts/${campaign}` },
    { type: 'observation', label: 'items=continue,newGame', frame: '00001-title-observe.py.png' },
    { type: 'control.effect.sample', sample: { maskOn: false, maskCells: grid } },
  ].map(line => JSON.stringify(line)).join('\n') + '\n');
  put(`artifacts/${campaign}/request.json`, JSON.stringify({ bundle: { specHash: 'fnv1a-spec' } }));
  put(`artifacts/${campaign}/observations.jsonl`,
    `${JSON.stringify({ script: 'title-observe.py', label: 'items=continue,newGame', frame: '00001-title-observe.py.png' })}\n`);

  const label = 'night5-test-20260920T004056Z';
  const video = 'a'.repeat(64);
  put(`artifacts/runs/${label}/verdict.txt`, `run          ${label}\nbundle       artifacts/b1\ncampaign dir ${root}/artifacts/${campaign}\ncampaign exit 0\n`);
  put(`artifacts/runs/${label}/video.sha256`, `${video}  captures/${label}.mp4\n`);
  put(`artifacts/runs/${label}/run-report.json`, JSON.stringify({ schema: 'device-run-report-v1', stop: { reason: 'sixam' } }));
  put(`artifacts/runs/${label}/grade.log`, `bt audio ${home}/fnaf-apks/bt-audio-captures/${label}.bt.raw\n`);
  put(`artifacts/runs/${label}/campaign.log`, JSON.stringify({ maskCells: grid }));
  put(`artifacts/runs/${label}/mmfruntime.logcat`, 'I MMFRuntime: seed\n');
  put(`artifacts/runs/${label}/death-frames/f12.png`, Buffer.from([0x89, 0x50, 0x4e, 0x47]));

  // A night-run label and its campaign directory name the same pack.
  const [target] = resolvePackTargets(root, label) as CampaignTarget[]; // its campaign directory is on disk
  assert.equal(target.packId, label);
  assert.deepEqual(resolvePackTargets(root, campaign), [target], 'the campaign id resolves to its night-run label');
  assert.throws(() => resolvePackTargets(root, '../etc'), /safe RUN_ID/);

  const built = buildPack({ root, home, ...target });
  const { pack, texts } = built;
  assert.deepEqual(pack.files.map(file => file.name), ['events.jsonl', 'observations.jsonl', 'request.json', 'result.json',
    'run/grade.log', 'run/run-report.json', 'run/verdict.txt', 'run/video.sha256']);
  assert.ok(pack.files.every(file => !/\.(png|mp4|logcat)$/.test(file.name)), 'no media file is copied');
  assert.ok(!texts.has('run/campaign.log'), 'campaign.log echoes the pixel arrays and stays behind');
  const byName = Object.fromEntries(pack.withheld.map(item => [item.name, item]));
  assert.equal(byName['00001-title-observe.py.png'].sha256, sha256(frame), 'an observer frame is named by hash');
  assert.equal(byName['run/death-frames/f12.png'].kind, 'frame');
  assert.equal(byName['run/mmfruntime.logcat'].kind, 'log', 'raw logcat is hashed, never copied');
  assert.deepEqual(byName[`${label}.mp4`], { name: `${label}.mp4`, sha256: video, bytes: null, kind: 'video' });
  assert.equal(byName['run/campaign.log'].sha256, sha256(JSON.stringify({ maskCells: grid })), 'whatever is not copied is still named by hash');
  assert.equal(pack.withheld.length, 5, 'every file of the run is either packed or withheld');

  const events = texts.get('events.jsonl');
  assert.ok(!events?.includes(String(grid[179])) && events?.includes('"redacted":"pixels"'), 'the 20x9 grid is replaced by its hash');
  assert.ok(events?.includes(sha256(JSON.stringify(grid))));
  assert.ok(!events?.includes(root) && events?.includes(`"evidenceDirectory":"artifacts/${campaign}"`), 'machine paths become repository-relative');
  assert.ok(texts.get('run/grade.log')?.includes('~/fnaf-apks/'), 'the home directory becomes ~');
  const observation = JSON.parse(String(texts.get('observations.jsonl')));
  assert.deepEqual(observation.frame, { file: '00001-title-observe.py.png', sha256: sha256(frame), bytes: frame.length });
  const eventsEntry = pack.files.find(file => file.name === 'events.jsonl');
  assert.deepEqual(eventsEntry?.redactions, { paths: 1, pixelArrays: 1, frameRefs: 1 });
  assert.equal(eventsEntry?.source.sha256, sha256(readFileSync(join(root, 'artifacts', campaign, 'events.jsonl'))),
    'the pack still binds the original bytes');
  assert.equal(pack.bundle?.winnerHash, stableHash(winner));
  assert.equal(pack.outcome, 'WIN');
  assert.equal(pack.claimLevel, 'DEVICE_MEASURED');
  assert.equal(packDigest(buildPack({ root, home, ...target }).pack), packDigest(pack), 'packing is deterministic');

  // The guard refuses pixel-shaped payloads it was not told about.
  assert.throws(() => refuseFrames('x', JSON.stringify({ regionPixels: grid.slice(0, 64) })), /numeric array/);
  assert.doesNotThrow(() => refuseFrames('x', JSON.stringify({ cycles: grid.slice(0, 63) })));
  assert.throws(() => refuseFrames('x', 'f'.repeat(128)), /hex run/);
  assert.doesNotThrow(() => refuseFrames('x', video), 'a sha256 is not pixels');
  assert.throws(() => refuseFrames('x', `"${'QUJD'.repeat(50)}"`), /base64/);
  assert.throws(() => refuseFrames('x', 'a\0b'), /binary/);
  put(`artifacts/${campaign}/request.json`, JSON.stringify({ regionPixels: grid }));
  assert.throws(() => buildPack({ root, home, ...target }), /request\.json: a numeric array/, 'an unknown pixel field refuses the pack');
  put(`artifacts/${campaign}/request.json`, JSON.stringify({ bundle: { specHash: 'fnv1a-spec' } }));

  // Written, read back, verified; re-packing is a no-op; tampering is refused.
  const dir = join(root, 'docs/evidence/runs', label);
  assert.equal(writePack(dir, built), 'WRITTEN');
  assert.equal(writePack(dir, buildPack({ root, home, ...target })), 'UNCHANGED');
  const loaded = readPack(dir);
  assert.equal(loaded.digest, packDigest(pack));
  const winners = trackedWinners(root);
  assert.deepEqual(packPromotionChecks(loaded, winners), { offlineEvidence: true, terminalPass: true,
    manifestComplete: true, plan12Attestation: false, winnerCommitted: true },
  'a packed live win passes everything but the attestation, which is never inferred from the others');
  // A v1 attestation (a person's name, the schema until 2026-09-27) is still read; v2, which an
  // agent may write under Pedro's delegation, is pinned in evidence-promotion.test.mjs.
  assert.equal(ATTESTATION_SCHEMA, 'plan12-attestation-v2');
  const attest = (packSha256: string) => writeFileSync(join(dir, ATTESTATION_FILE),
    JSON.stringify({ schema: ATTESTATION_SCHEMA_V1, status: 'PASS', packSha256, attestedBy: 'test' }));
  attest(loaded.digest);
  assert.equal(packPromotionChecks(readPack(dir), winners).plan12Attestation, true);
  attest('0'.repeat(64));
  assert.equal(packPromotionChecks(readPack(dir), winners).plan12Attestation, false, 'an attestation binds one exact pack');
  rmSync(join(dir, ATTESTATION_FILE));
  assert.equal(packPromotionChecks(loaded, new Map()).winnerCommitted, false, 'an uncommitted winner cannot be re-run elsewhere');
  // A bundle records the winner as compiled, which compileBundle normalises: the committed
  // Night 6 winner's file hashes to fnv1a-de095950 and compiles to fnv1a-59908edd. A pack from
  // that bundle must still find its winner.
  const night6 = readFileSync(new URL('../../../packages/propose/bindings/fnaf2/campaign-night6-winner.json', import.meta.url), 'utf8');
  put('packages/propose/bindings/fnaf2/campaign-night6-winner.json', night6);
  // Its compiled hash comes from the committed register, which must hold it.
  const committed: { winners: RegisterRow[] } = JSON.parse(readFileSync(new URL(`../../../${WINNER_HASHES}`, import.meta.url), 'utf8'));
  registerRows.push(committed.winners.find(row => row.file === 'packages/propose/bindings/fnaf2/campaign-night6-winner.json'));
  writeRegister();
  const withNight6 = trackedWinners(root);
  assert.equal(withNight6.get(stableHash(JSON.parse(night6))), 'campaign-night6-winner.json');
  assert.equal(withNight6.get('fnv1a-59908edd'), 'campaign-night6-winner.json', 'the compiled hash maps to the file too');

  put(`artifacts/${campaign}/observations.jsonl`, '{"label":"changed"}\n');
  assert.throws(() => writePack(dir, buildPack({ root, home, ...target })), /different pack/, 'evidence is not edited in place');
  writeFileSync(join(dir, 'events.jsonl'), `${readFileSync(join(dir, 'events.jsonl'), 'utf8')} `);
  assert.throws(() => readPack(dir), /integrity mismatch: events\.jsonl/);

  // A FNaF 1 runner's night: no campaign result, its own record and event log,
  // captures already outside the repository and cited by sha256.
  const fnaf1 = 'fnaf1-custom-grid420-420-a-20260925T024452598Z';
  put(`artifacts/runs/${fnaf1}/probe.json`, JSON.stringify({ status: 'COMPLETE',
    claimLevel: 'DEVICE_MEASURED helper native frames', titleAfter: 'items=continue,customNight' }));
  put(`artifacts/runs/${fnaf1}/events.jsonl`, [
    { type: 'capture', path: `${home}/fnaf-apks/runs/0000-wait.png`, sha256: 'b'.repeat(64) },
    { type: 'night-ended', ended: 'STOP_AFTER', atNightMs: 538014 },
  ].map(line => JSON.stringify(line)).join('\n') + '\n');
  put(`artifacts/runs/${fnaf1}/0000-frame.png`, Buffer.from([0x89, 0x50]));
  put(`artifacts/runs/${fnaf1}/replay.json`, JSON.stringify({ schema: 'fnaf1-winner-replay-v1',
    commit: '3aaf02cd0baf2b18d53d8d47af2fc45f39279f6e' }));
  const [fnaf1Target] = resolvePackTargets(root, fnaf1);
  assert.ok(fnaf1Target.fnaf1RunDir, 'a FNaF 1 run directory resolves as its own kind');
  const fnaf1Built = buildFnaf1Pack({ root, home, ...fnaf1Target });
  assert.equal(fnaf1Built.pack.kind, 'fnaf1-run');
  assert.deepEqual(fnaf1Built.pack.outcome, { ended: 'STOP_AFTER', atNightMs: 538014 });
  assert.equal(fnaf1Built.pack.claimLevel, 'DEVICE_MEASURED');
  assert.deepEqual(fnaf1Built.pack.files.map(file => file.name), ['events.jsonl', 'probe.json', 'replay.json'],
    'a winner replay\'s replay.json (the pinned commit it ran) is packed as text');
  assert.deepEqual(fnaf1Built.pack.withheld.map(item => item.name), ['0000-frame.png']);
  assert.ok(fnaf1Built.texts.get('events.jsonl')?.includes('~/fnaf-apks/'), 'machine paths are portable here too');
  const fnaf1Dir = join(root, 'docs/evidence/runs', fnaf1);
  writePack(fnaf1Dir, fnaf1Built);
  const fnaf1Loaded = readPack(fnaf1Dir);
  assert.equal(fnaf1Loaded.wrapper, null, 'a FNaF 1 pack carries no campaign result for the Plan 12 gate');

  // A campaign directory that is gone, recovered from the night-run log that captured the CLI.
  // The log is what night-run.sh tees: event rows as the executor appended them, the preflight
  // the CLI printed first, and the retained result printed with the bytes it wrote.
  const lost = 'campaign-2026-09-18T03-03-11.442Z';
  const lostDir = `${root}/artifacts/${lost}`;
  const retained = { status: 'COMPLETE', mode: 'live', result: {
    schema: CAMPAIGN_RESULT_SCHEMA, version: 1, state: 'COMPLETE', specHash: 'fnv1a-spec', completedNights: [7],
    attempts: [{ attempt: 1, mode: 'live', night: 7, status: 'WIN', proofHash: 'fnv1a-proof',
      terminal: { night: 7, outcome: 'sixam', sixAm: true } }], events: [] } };
  const rows = [{ at: '2026-09-18T03:03:11.444Z', type: 'evidence.started', evidenceDirectory: lostDir },
    { at: 1789872055212, type: 'hid.execute-entered' },
    { at: '2026-09-18T03:04:00.000Z', type: 'control.effect.sample', sample: { maskOn: true, maskCells: grid } }]
    .map(row => JSON.stringify(row));
  const eventsText = `${rows.join('\n')}\n`;
  const resultText = JSON.stringify(retained, null, 2);
  const other = JSON.stringify({ at: '2026-09-18T03:12:17.080Z', type: 'evidence.started', evidenceDirectory: `${root}/artifacts/other` });
  const logText = [rows[0], JSON.stringify({ status: 'READY', mode: 'live', preflight: { status: 'READY' } }, null, 2),
    rows[1], 'python3 stderr: a line that is not an event', rows[2], resultText, other,
    JSON.stringify({ at: 1, type: 'hid.execute-entered' })].join('\n') + '\n';
  const recovered = recoverFromRunLog(logText, lostDir);
  assert.equal(recovered?.events, eventsText, 'the event rows come back byte for byte, numeric stamps included, and stop at the next campaign');
  assert.equal(recovered?.result, resultText, 'the printed result is the one the CLI wrote, not the preflight before it');
  assert.equal(recoverFromRunLog(logText, `${root}/artifacts/never`), null);
  assert.equal(recoverFromRunLog(logText, `artifacts/${lost}`)?.events, eventsText,
    'a verdict that names the directory relative to the repository still finds it');
  const lostRun = 'night7-night7-k3-cohort-r01-20260918T030258Z';
  put(`artifacts/runs/${lostRun}/verdict.txt`, `run          ${lostRun}\nbundle       artifacts/b1\ncampaign dir ${lostDir}\ncampaign exit 0\n`);
  put(`artifacts/runs/${lostRun}/video.sha256`, `${'c'.repeat(64)}  captures/${lostRun}.mp4\n`);
  put(`artifacts/runs/${lostRun}/run-report.json`, JSON.stringify({ night: { reached: true } }));
  put(`artifacts/runs/${lostRun}/campaign.log`, logText);
  const [recoveredTarget] = resolvePackTargets(root, lostRun) as CampaignTarget[]; // a campaign recovered from its night-run log
  assert.equal(recoveredTarget.recoverFromLog, true, 'a campaign that is gone resolves to its night-run log');
  const timeline = join(root, 'artifacts/forensics/r01-timeline.json');
  put('artifacts/forensics/r01-timeline.json', JSON.stringify({ video: `captures/${lostRun}.mp4`,
    terminal: { outcome: 'clear', evidence: 'sixam', at_s: 453.5 } }));
  const rebuilt = buildPack({ root, home, ...recoveredTarget, timeline });
  assert.deepEqual(rebuilt.pack.files.map(file => file.name),
    ['events.jsonl', 'result.json', 'run/run-report.json', 'run/timeline.json', 'run/verdict.txt', 'run/video.sha256']);
  assert.equal(rebuilt.pack.files.find(file => file.name === 'result.json')?.source.sha256, sha256(resultText));
  assert.ok(rebuilt.texts.get('events.jsonl')?.includes(String(grid[179])) === false, 'recovered events are redacted like any other');
  assert.deepEqual(rebuilt.pack.custody, { kind: 'recovered-from-run-log', source: 'run/campaign.log',
    sourceSha256: sha256(logText), recovered: ['events.jsonl', 'result.json'],
    lost: ['observations.jsonl', 'observer frames', 'request.json'], validation: 'docs/evidence/custody-recovery-20260925.json' });
  assert.deepEqual(rebuilt.pack.graded, { 'run/timeline.json': 'artifacts/forensics/r01-timeline.json' });
  assert.equal(rebuilt.pack.outcome, 'WIN');
  const recoveredDir = join(root, 'docs/evidence/runs', lostRun);
  writePack(recoveredDir, rebuilt);
  const recoveredLoaded = readPack(recoveredDir);
  assert.deepEqual(packPromotionChecks(recoveredLoaded, winners), { offlineEvidence: true, terminalPass: true,
    manifestComplete: true, plan12Attestation: false, winnerCommitted: true },
  'Pedro, 2026-09-27: a recovered win is accepted fully, so its manifest is complete');
  assert.deepEqual(packCustody(recoveredLoaded.pack), { kind: 'recovered-from-run-log',
    lost: ['observations.jsonl', 'observer frames', 'request.json'] }, 'and it still names what it lost');
  assert.ok(!recoveredLoaded.files.includes('request.json'), 'nothing lost is reconstructed');
  put('artifacts/forensics/wrong-timeline.json', JSON.stringify({ video: 'captures/another-run.mp4', terminal: { outcome: 'clear' } }));
  assert.throws(() => buildPack({ root, home, ...recoveredTarget, timeline: join(root, 'artifacts/forensics/wrong-timeline.json') }),
    /not this run's/, 'a grade of another recording is refused');

  // A campaign that threw: the CLI wrote its result but never printed it, so the pack says lost.
  const threw = 'night7-night7-k3-cohort-r03-20260918T032107Z';
  const threwDir = `${root}/artifacts/campaign-2026-09-18T03-21-22.194Z`;
  put(`artifacts/runs/${threw}/verdict.txt`, `run          ${threw}\nbundle       artifacts/b1\ncampaign dir ${threwDir}\n`);
  put(`artifacts/runs/${threw}/campaign.log`, [
    JSON.stringify({ at: '2026-09-18T03:21:22.200Z', type: 'evidence.started', evidenceDirectory: threwDir }),
    JSON.stringify({ at: '2026-09-18T03:22:08.286Z', type: 'campaign.abort.restart', reason: 'device: lifecycle left night state (static)' }),
    'error: device: lifecycle left night state (static)'].join('\n') + '\n');
  const threwBuilt = buildPack({ root, home, ...(resolvePackTargets(root, threw) as CampaignTarget[])[0] }); // its verdict names a campaign
  assert.equal(threwBuilt.pack.outcome, 'RESULT_LOST');
  assert.equal(threwBuilt.pack.claimLevel, 'UNKNOWN');
  assert.deepEqual(threwBuilt.pack.custody?.lost, ['observations.jsonl', 'observer frames', 'request.json', 'result.json']);
  const threwDirPack = join(root, 'docs/evidence/runs', threw);
  writePack(threwDirPack, threwBuilt);
  const threwLoaded = readPack(threwDirPack);
  assert.equal(threwLoaded.wrapper, null);
  assert.equal(packEntry(threw, threwLoaded).outcome, 'RESULT_LOST', 'the index reads a result-lost pack without inventing one');
  assert.equal(packPromotionChecks(threwLoaded, winners).terminalPass, false);

  // Unlike the recovered run above, this campaign still has the CLI's ERROR
  // result.json. Keep it byte-for-byte through the normal pack path.
  const errorCampaign = 'campaign-2026-09-27T07-23-27.810Z';
  const errorWrapper = { status: 'ERROR', mode: 'live', error: 'device: lifecycle left night state (static)' };
  put(`artifacts/${errorCampaign}/result.json`, JSON.stringify(errorWrapper));
  put(`artifacts/${errorCampaign}/request.json`, '{}');
  put(`artifacts/${errorCampaign}/events.jsonl`, '{"type":"campaign.abort.restart","reason":"device: lifecycle left night state (static)"}\n');
  const errorBuilt = buildPack({ root, home, ...(resolvePackTargets(root, errorCampaign) as CampaignTarget[])[0] }); // a campaign directory
  assert.equal(errorBuilt.pack.outcome, 'ERROR');
  assert.equal(errorBuilt.pack.claimLevel, 'UNKNOWN');
  const errorPack = join(root, 'docs/evidence/runs', errorCampaign);
  writePack(errorPack, errorBuilt);
  const errorLoaded = readPack(errorPack);
  assert.deepEqual(errorLoaded.wrapper, errorWrapper);
  assert.equal((packEntry(errorCampaign, errorLoaded) as ErrorEntry).error, errorWrapper.error); // an ERROR wrapper's row
  assert.equal(packPromotionChecks(errorLoaded, winners).terminalPass, false);

  // A signalled campaign still has its native text and frames, but never
  // wrote a terminal result or the runner's final verdict. Do not lose the
  // native request/observations by pretending this is log-only recovery.
  const interrupted = 'campaign-interrupted';
  const interruptedRun = 'night6-interrupted';
  const startRow = JSON.stringify({ at: '2026-09-27T08:14:25Z', type: 'evidence.started', evidenceDirectory: `${root}/artifacts/${interrupted}` });
  put(`artifacts/${interrupted}/events.jsonl`, startRow + '\n');
  put(`artifacts/${interrupted}/request.json`, '{}');
  put(`artifacts/${interrupted}/observations.jsonl`, '{"label":"state=intro"}\n');
  put(`artifacts/${interrupted}/00001.png`, frame);
  put(`artifacts/runs/${interruptedRun}/campaign.log`, 'not JSON\n' + startRow + '\n');
  const interruptedTarget = (resolvePackTargets(root, interrupted) as CampaignTarget[])[0]; // an incomplete campaign directory
  assert.equal(interruptedTarget.packId, interruptedRun, 'the run identity survives without a final verdict');
  const interruptedBuilt = buildPack({ root, home, ...interruptedTarget });
  assert.equal(interruptedBuilt.pack.custody?.kind, 'incomplete-campaign');
  assert.deepEqual(interruptedBuilt.pack.custody?.lost, ['result.json']);
  assert.ok(interruptedBuilt.texts.has('request.json') && interruptedBuilt.texts.has('observations.jsonl'));
  assert.ok(interruptedBuilt.pack.withheld.some(f => f.name === '00001.png' && f.sha256 === sha256(frame)));
  const interruptedDir = join(root, 'docs/evidence/runs', interruptedRun);
  writePack(interruptedDir, interruptedBuilt);
  const interruptedLoaded = readPack(interruptedDir);
  assert.equal(interruptedLoaded.wrapper, null);
  assert.equal(packEntry(interruptedRun, interruptedLoaded).claimLevel, 'UNKNOWN');
  assert.equal(packPromotionChecks(interruptedLoaded, winners).terminalPass, false);
  assert.equal(packPromotionChecks(interruptedLoaded, winners).manifestComplete, false);

  // The check a recovered pack cites: a campaign still on disk, recovered from its own log.
  put(`artifacts/runs/${label}/campaign.log`, [
    readFileSync(join(root, 'artifacts', campaign, 'events.jsonl'), 'utf8').trimEnd()
      .split('\n').map(line => JSON.stringify({ at: '2026-09-20T00:41:12.166Z', ...JSON.parse(line) })).join('\n'),
    readFileSync(join(root, 'artifacts', campaign, 'result.json'), 'utf8')].join('\n') + '\n');
  const kept = 'campaign-2026-09-20T02-40-43.128Z';
  const keptRun = 'night6-kept-20260920T024030Z';
  const keptRows = [{ at: '2026-09-20T02:40:43.130Z', type: 'evidence.started', evidenceDirectory: `${root}/artifacts/${kept}` },
    { at: 1789872062293, type: 'hid.night-go', source: 'intro-handoff' }].map(row => JSON.stringify(row));
  put(`artifacts/${kept}/events.jsonl`, `${keptRows.join('\n')}\n`);
  put(`artifacts/${kept}/result.json`, resultText);
  put(`artifacts/runs/${keptRun}/verdict.txt`, `run          ${keptRun}\ncampaign dir ${root}/artifacts/${kept}\n`);
  put(`artifacts/runs/${keptRun}/campaign.log`, [keptRows[0], 'stderr noise', keptRows[1], resultText].join('\n') + '\n');
  const check = recoveryCheck(root);
  assert.deepEqual(check.campaigns.map(item => [item.campaign, item.events.identical, item.result.identical]), [
    [campaign, false, false],
    [kept, true, true],
  ], 'a campaign the CLI logged comes back identical; one whose log does not carry it verbatim is reported, not passed');
  assert.deepEqual(check.summary, { campaigns: 2, eventsIdentical: 1, resultsPrinted: 1, resultsIdentical: 1,
    resultsNotPrinted: [`${campaign} (COMPLETE)`] }, 'a result logged in another shape is counted as not printed, not as recovered');
} finally {
  rmSync(root, { recursive: true, force: true });
}
// trackedWinners reads the compiled hashes from the generated register (Review never compiles:
// that is Propose's) and refuses a register that no longer matches the committed winner files.
{
  const root = mkdtempSync(join(tmpdir(), 'winner-hashes-'));
  mkdirSync(join(root, 'packages/propose/bindings/fnaf2'), { recursive: true });
  mkdirSync(join(root, 'docs/architecture/generated'), { recursive: true });
  const bytes = JSON.stringify({ schema: 'winner-v1', strategy: 'minus-toys' });
  writeFileSync(join(root, 'packages/propose/bindings/fnaf2/a-winner.json'), bytes);
  const register = (rows: readonly Record<string, unknown>[]) => writeFileSync(join(root, WINNER_HASHES), JSON.stringify({ schema: 'winner-hashes-v1', winners: rows }));
  const digest = createHash('sha256').update(bytes).digest('hex');
  try {
    register([{ file: 'packages/propose/bindings/fnaf2/a-winner.json', sha256: digest, compiledWinnerHash: 'fnv1a-00c0ffee' }]);
    const winners = trackedWinners(root);
    assert.equal(winners.get('fnv1a-00c0ffee'), 'a-winner.json', 'the compiled hash maps to its file');
    assert.equal(winners.get(stableHash(JSON.parse(bytes))), 'a-winner.json', "the file's own stableHash maps too");
    register([{ file: 'packages/propose/bindings/fnaf2/a-winner.json', sha256: digest, compiledWinnerHash: null, notCompiled: 'device bundle: winner schema mismatch' }]);
    assert.equal(trackedWinners(root).size, 1, 'a winner that does not compile keeps only its file hash');
    register([{ file: 'packages/propose/bindings/fnaf2/a-winner.json', sha256: 'e'.repeat(64), compiledWinnerHash: 'fnv1a-00c0ffee' }]);
    assert.throws(() => trackedWinners(root), /stale.*npm run catalog/, 'changed winner bytes make the register stale');
    register([]);
    assert.throws(() => trackedWinners(root), /stale/, 'an unlisted winner makes the register stale');
  } finally { rmSync(root, { recursive: true, force: true }); }
}
console.log('evidence pack: text crosses, frames and pixel grids stay behind by hash, paths are portable, tampering and unknown pixel fields are refused, the gate reads the pack, and a lost campaign recovered from its run log passes custody while saying what is lost');
