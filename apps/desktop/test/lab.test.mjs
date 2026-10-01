// The operator verbs against a temporary git repository: status, next, start, commit --dry, end,
// morning and doctor, with planted docs-only, evidence and code commits, and planted doctor
// findings, each then fixed. The repository copies the real hook, register and ROADMAP; the
// promotions query, the queue and the host are stubs. No network, no phone, no adb.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { isUnknown, validateClaimEnvelope } from '@sixam/kernel';
import { recordRun, runRecordPath } from '../../../tools/push-gate.mjs';
import { main, parse } from '../src/cli.ts';
import { LAB_VERBS, SESSION_FILE, STALE_PENDING_HOURS, createLab, lastEvening, parseWorktrees, runStamp } from '../src/lab.ts';

const REPO = resolve(import.meta.dirname, '../../..');
const OVERRIDE = ['PEDRO', 'OK'].join('-');
const HOUR = 3600 * 1000;
// The real path: git reports worktrees by it, and macOS's temporary directory sits under /var -> /private/var.
const base = realpathSync(mkdtempSync(join(tmpdir(), 'lab-test-')));
let checks = 0;

const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_')));
const run = (cwd, command, args) => {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', env: cleanEnv });
  assert.equal(result.status, 0, `${command} ${args.join(' ')}: ${result.stderr}`);
  return result.stdout;
};
const git = (cwd, ...args) => run(cwd, 'git', args);
const write = (root, path, text) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), text); };
const commitAll = (root, message) => { git(root, 'add', '-A'); git(root, 'commit', '-q', '-m', message); return git(root, 'rev-parse', 'HEAD').trim(); };

/** A repository with the real hook, register and ROADMAP, and scripts the doctor's catalog check can run. */
function fixture(name) {
  const root = join(base, name);
  mkdirSync(root, { recursive: true });
  git(root, 'init', '-q', '-b', 'master');
  git(root, 'config', 'user.name', 'Lab Test');
  git(root, 'config', 'user.email', 'lab@example.invalid');
  git(root, 'config', 'commit.gpgsign', 'false');
  for (const path of ['CLAUDE.md', 'plans/ROADMAP.md', '.githooks/commit-msg', 'tools/dump-text-check.mjs', 'tools/change-locality.mjs', 'tools/test-mistake-register.mjs']) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    copyFileSync(join(REPO, path), join(root, path));
  }
  const pkg = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8'));
  pkg.scripts.catalog = 'node gen.mjs';
  pkg.scripts.chronicle = 'node -e ""';
  write(root, 'package.json', `${JSON.stringify(pkg, null, 2)}\n`);
  write(root, 'gen.mjs', "import { writeFileSync } from 'node:fs';\nwriteFileSync('docs/architecture/generated/x.json', '{\"v\": 2}\\n');\n");
  write(root, 'docs/architecture/generated/x.json', '{"v": 1}\n');
  write(root, '.gitignore', 'artifacts/\nnode_modules/\n');
  write(root, 'docs/decisions/0009-lab-test.md', '# ADR 0009: a test\n\n**Status:** proposed 2026-09-30; accepted by the commit that carries the override.\n');
  write(root, 'packages/propose/bindings/fnaf2/campaign-night1-x-winner.json', `${JSON.stringify({ schema: 'winner-v1', nights: [1] })}\n`);
  write(root, 'docs/evidence/prior-record-20260929.json', '{"schema": "evidence-record-v1"}\n');
  commitAll(root, 'Fixture');
  return root;
}

const promotionsStub = modelOnly => () => ({
  consistent: true, lift: { packs: 2, gameRuns: 2 }, edges: { matched: 1, graph: 1, byAttester: { agent: 1 }, byCustody: { complete: 1 } },
  open: { modelOnlyWinners: { count: modelOnly.length, of: 1, winners: modelOnly.map(file => ({ file })) },
    untrackedWinnerDebt: { summary: '0 of 0', untracked: 0, entries: [] } },
});
const NOW = new Date('2026-09-30T09:00:00Z');
const quietHost = { availableMb: () => 4000, processes: () => [{ pid: 1, name: 'init', rssMb: 10 }], cwds: () => [] };

/** A lab over the fixture, every host path inside the test's own temp directory. */
function labFor(root, { jobs = [], host = quietHost, modelOnly = ['packages/propose/bindings/fnaf2/campaign-night1-x-winner.json'] } = {}) {
  const env = { ...cleanEnv, FNAF_LAB_DIR: join(root, '..', `${root.split('/').pop()}-lab`), CUE_HELPER_STATE_DIR: join(root, '..', 'state'),
    FNAF_WINDOW_DIR: join(root, '..', `${root.split('/').pop()}-windows`), FNAF2_PUSH_GATE_TMP: join(root, '..', 'pushgate'),
    FNAF_LOCAL_PROFILE: join(root, '..', `${root.split('/').pop()}-profile.json`) };
  return { env, lab: createLab({ root, env, now: () => NOW, promotions: promotionsStub(modelOnly), packs: () => [], queue: () => ({ jobs }), host }) };
}
const claim = envelope => { validateClaimEnvelope(envelope); assert.notEqual(envelope.refused, true, JSON.stringify(envelope)); return envelope.claim; };
const refusal = (envelope, rule) => { validateClaimEnvelope(envelope); assert.equal(envelope.refused, true); assert.equal(envelope.rule, rule); return envelope; };

try {
  // --- the verb table and the small readers ------------------------------------------------------
  assert.deepEqual(LAB_VERBS.map(row => row.verb), ['status', 'next', 'start', 'commit', 'end', 'morning', 'doctor']);
  assert.deepEqual(LAB_VERBS.filter(row => row.mcp).map(row => row.mcp), ['lab.status', 'lab.next', 'lab.doctor']);
  assert.deepEqual(lastEvening(new Date(2026, 8, 30, 3, 0)), new Date(2026, 8, 29, 18, 0), 'before 18:00, the evening is yesterday');
  assert.deepEqual(lastEvening(new Date(2026, 8, 30, 19, 0)), new Date(2026, 8, 30, 18, 0), 'after 18:00, it is today');
  assert.equal(runStamp('night1-x-20260914T220233Z').toISOString(), '2026-09-14T22:02:33.000Z');
  assert.equal(runStamp('fnaf1-custom-grid420-420-a-20260925T024452598Z').toISOString(), '2026-09-25T02:44:52.000Z');
  assert.equal(runStamp('no-stamp'), null);
  assert.deepEqual(parseWorktrees('worktree /a\nHEAD 1\nbranch refs/heads/m\n\nworktree /b\nHEAD 2\ndetached\nlocked\n'), [
    { path: '/a', head: '1', branch: 'm', locked: false, prunable: false, detached: false },
    { path: '/b', head: '2', branch: null, locked: true, prunable: false, detached: true }]);
  assert.equal(parse(['status', '--json']).json, true);
  assert.match(parse(['status', '--step', 'S1']).error, /takes no --step/);
  assert.match(parse(['start', '--step']).error, /needs a value/);
  assert.match(parse(['deploy']).error, /unknown verb/);
  checks += 1;

  // --- status: push-gate, steps and decisions, all derived ----------------------------------------
  const root = fixture('status');
  const { env, lab } = labFor(root);
  let status = claim(lab.status());
  const headSha = git(root, 'rev-parse', 'HEAD').trim();
  assert.equal(status.head.sha, headSha);
  assert.deepEqual([status.pushGate.ran, status.pushGate.command], [false, 'npm run push-gate'], 'no record: not run, and the command');
  assert.deepEqual(status.steps.map(row => row.id), ['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7']);
  assert.equal(status.steps[0].state, 'open');
  assert.ok(isUnknown(status.steps[1].state));
  assert.equal(status.promotions.edges, 1);
  assert.deepEqual(status.decisions.pending.map(row => row.file), ['docs/decisions/0009-lab-test.md'], 'a proposed ADR is pending');
  assert.equal(status.sync.origin, null, 'no origin here');
  assert.ok(status.doctor.findings >= 1, 'the fixture has doctor findings (no hooks path)');
  recordRun({ sha: headSha, full: false, failed: [], skipped: ['Slow census gates'] }, runRecordPath(env, root));
  write(root, 'docs/decisions/0009-lab-test.md', '# ADR 0009: a test\n\n**Status:** proposed 2026-09-30; accepted by the commit that carries the override.\n\nSigned.\n');
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', `ADR 0009 signed\n\n${OVERRIDE}`);
  status = claim(lab.status());
  assert.equal(status.pushGate.ran, false, 'a record for another commit is not a record for HEAD');
  recordRun({ sha: status.head.sha, full: false, failed: [], skipped: ['Slow census gates'] }, runRecordPath(env, root));
  status = claim(lab.status());
  assert.deepEqual([status.pushGate.ran, status.pushGate.verdict, status.pushGate.unverified], [true, 'PASSED', ['Slow census gates']]);
  assert.deepEqual(status.decisions.pending, [], 'the signed ADR is no longer pending');
  assert.equal(status.decisions.acceptedSinceProposed[0].by, status.head.short);
  checks += 1;

  // --- commit --dry: the hook's own verdict, and the class ----------------------------------------
  const dry = (message) => claim(lab.commit(message === undefined ? {} : { message }));
  write(root, 'docs/notes/LAB-NOTE.md', 'A note.\n');
  git(root, 'add', 'docs/notes/LAB-NOTE.md');
  let verdict = dry();
  assert.equal(verdict.hook.verdict, 'REFUSE', 'a docs-only stage is refused by the hook');
  assert.ok(verdict.hook.output.some(line => /consequence lock: refused/.test(line)));
  assert.equal(verdict.consequence.consequence, 'bookkeeping');
  assert.equal(verdict.hook.runsOnCommit, false, 'core.hooksPath is unset in the fixture, and the answer says so');
  verdict = dry(`Note the lab\n\nEVIDENCE:${'docs/evidence/prior-record-20260929.json'}\n`);
  assert.equal(verdict.hook.verdict, 'ACCEPT', 'a reference to prior evidence lets the hook accept');
  assert.equal(verdict.consequence.consequence, 'bookkeeping', 'and the change is still bookkeeping');
  const lines = [];
  assert.equal(main(['commit', '--dry'], { root, lab, write: text => lines.push(text) }), 1, 'the CLI exits 1 when the hook would refuse');
  assert.match(lines.join(''), /WOULD REFUSE/);
  git(root, 'reset', '-q');
  write(root, 'docs/evidence/new-record-20260930.json', '{"schema": "evidence-record-v1"}\n');
  git(root, 'add', 'docs/evidence/new-record-20260930.json');
  verdict = dry('Retain a record\n');
  assert.deepEqual([verdict.hook.verdict, verdict.consequence.consequence], ['ACCEPT', 'consequential']);
  git(root, 'reset', '-q');
  write(root, 'packages/play/src/y.js', 'export const y = 1;\n');
  git(root, 'add', 'packages/play/src/y.js');
  verdict = dry('Change the controller\n');
  assert.equal(verdict.hook.verdict, 'ACCEPT');
  assert.ok(isUnknown(verdict.consequence.consequence), 'controller code with no gate: UNKNOWN');
  git(root, 'reset', '-q');
  rmSync(join(root, 'packages/play'), { recursive: true, force: true });
  rmSync(join(root, 'docs/notes'), { recursive: true, force: true });
  rmSync(join(root, 'docs/evidence/new-record-20260930.json'));
  verdict = dry();
  assert.equal(verdict.nothingStaged, true);
  checks += 1;

  // --- start and end: a session, three planted commits, the ratio ----------------------------------
  refusal(lab.start({ step: 'S9', artifact: 'x' }), 'invalid-argument');
  refusal(lab.start({ step: 'S4' }), 'invalid-argument');
  refusal(lab.end(), 'no-session');
  const started = claim(lab.start({ step: 'S4', artifact: 'a predeclared Night 7 cohort on the phone' }));
  assert.ok(existsSync(join(root, SESSION_FILE)));
  const read = started.mistakes.read.map(entry => entry.n);
  assert.ok([6, 8].every(n => read.includes(n)), `S4 on the phone reads mistakes 6 and 8 (read ${read})`);
  assert.equal(started.session.base, git(root, 'rev-parse', 'HEAD').trim());
  refusal(lab.start({ step: 'S1', artifact: 'another' }), 'session-open');
  const sessionBase = started.session.base;
  write(root, 'docs/research/FINDING.md', 'Prose.\n');
  commitAll(root, 'Docs only');
  write(root, 'docs/evidence/cohort-result-20260930.json', '{"schema": "cohort-result-v2"}\n');
  commitAll(root, 'Retain the cohort result');
  write(root, 'packages/review/src/lab-x.mjs', 'export const x = 1;\n');
  write(root, 'packages/review/test/lab-x.test.mjs', "import '../src/lab-x.mjs';\n");
  commitAll(root, 'Solver-interface code with its gate');
  const sinceOnly = claim(lab.end({ since: sessionBase }));
  assert.equal(sinceOnly.session, null, 'end --since reads no session');
  assert.ok(existsSync(join(root, SESSION_FILE)), 'and leaves the open session alone');
  const ended = claim(lab.end());
  assert.deepEqual(ended.commits.map(item => item.class), ['bookkeeping', 'consequential', 'consequential']);
  assert.deepEqual(ended.ratio, { consequential: 2, bookkeeping: 1, unknown: 0 });
  assert.equal(ended.ratioText, '2:1');
  assert.deepEqual(ended.ratio, sinceOnly.ratio, 'the same classifier either way');
  assert.deepEqual(ended.records, ['docs/evidence/cohort-result-20260930.json']);
  assert.deepEqual(ended.open.map(row => row.step), ['S4'], 'what remains open is the session step');
  assert.ok(!existsSync(join(root, SESSION_FILE)) && existsSync(join(root, ended.closed)), 'the session is closed into sessions/');
  refusal(lab.end(), 'no-session');
  refusal(lab.end({ since: 'not-a-ref' }), 'invalid-argument');
  checks += 1;

  // --- next: the ROADMAP order over what status finds ---------------------------------------------
  let ranked = claim(lab.next());
  assert.equal(ranked.actions[0].kind, 'fix', 'a hooks path that is unset comes first');
  assert.equal(ranked.actions[0].command, 'git config core.hooksPath .githooks');
  const s1 = ranked.actions.find(item => item.step === 'S1');
  assert.equal(s1.command, 'apps/lab/companion-queue.sh enqueue night --game fnaf2 --winner packages/propose/bindings/fnaf2/campaign-night1-x-winner.json --night 1');
  assert.ok(ranked.blocked.some(row => row.step === 'S3' && row.needs[0].startsWith('S2')), 'S3 waits on S2');
  assert.ok(ranked.actions.findIndex(item => item.step === 'S1') < ranked.actions.findIndex(item => item.step === 'S2'), 'S1 before S2');
  git(root, 'config', 'core.hooksPath', '.githooks');
  claim(lab.start({ step: 'S2b', artifact: 'a trace comparison' }));
  ranked = claim(lab.next());
  assert.equal(ranked.actions[0].kind, 'session', 'an open session comes first');
  assert.ok(!ranked.actions.some(item => item.command === 'git config core.hooksPath .githooks'), 'the fixed hooks path is gone');
  claim(lab.end());
  checks += 1;

  // --- doctor: every planted finding, then every one fixed ----------------------------------------
  const sick = fixture('doctor');
  const pushgate = join(sick, '..', 'pushgate', 'fnaf2-push-gate-orphan');
  mkdirSync(pushgate, { recursive: true });
  const agent = join(sick, '.claude/worktrees/agent-old');
  git(sick, 'worktree', 'add', '-q', '--detach', agent, 'HEAD');
  const old = new Date(NOW.getTime() - 48 * HOUR);
  const admin = resolve(agent, readFileSync(join(agent, '.git'), 'utf8').trim().replace(/^gitdir:\s*/, ''));
  for (const path of [agent, join(admin, 'HEAD'), join(admin, 'index'), join(admin, 'logs/HEAD')])
    if (existsSync(path)) utimesSync(path, old, old);
  write(sick, 'packages/propose/bindings/fnaf2/loose-winner.json', '{}\n');
  write(sick, 'artifacts/runs/k9/campaign-night7-k9-winner.json', '{}\n');
  mkdirSync(join(sick, 'node_modules/@fnaf2-1020'), { recursive: true });
  const staleJob = { id: 'cue-1-stale', kind: 'setup', state: 'PENDING', createdAt: new Date(NOW.getTime() - (STALE_PENDING_HOURS + 28) * HOUR).toISOString() };
  const heavy = { availableMb: () => 1000, processes: () => [{ pid: 4242, name: 'Chowdren', rssMb: 1500 }], cwds: () => [] };
  const sickLab = labFor(sick, { jobs: [staleJob], host: heavy });
  let report = claim(sickLab.lab.doctor());
  const found = id => report.findings.filter(item => item.id === id);
  assert.deepEqual(report.checks.map(item => item.id), ['hooks-path', 'stale-pending', 'push-gate-worktrees', 'agent-worktrees', 'node-modules',
    'local-profile', 'catalog-drift', 'memory', 'untracked-winner']);
  assert.equal(found('hooks-path')[0].remedy, 'git config core.hooksPath .githooks');
  assert.equal(found('stale-pending')[0].remedy, 'apps/lab/companion-queue.sh cancel cue-1-stale --reason stale');
  assert.equal(found('push-gate-worktrees')[0].remedy, `rm -r ${pushgate}`);
  assert.match(found('agent-worktrees')[0].remedy, new RegExp(`^git worktree remove ${agent.replaceAll('.', '\\.')}`));
  assert.deepEqual(found('node-modules').map(item => item.finding).sort(),
    ['node_modules has no @sixam scope, so the workspaces do not resolve', 'node_modules still links the retired @fnaf2-1020 scope']);
  assert.match(found('local-profile')[0].remedy, /^node packages\/play\/bin\/phone\/local-profile\.mjs set <serial>/);
  assert.match(found('catalog-drift')[0].finding, /docs\/architecture\/generated\/x\.json/);
  assert.match(found('memory')[0].finding, /1000 MB available while Chowdren \(pid 4242, 1500 MB\)/);
  assert.deepEqual(found('untracked-winner').map(item => item.finding.split(' ')[0]).sort(),
    ['artifacts/runs/k9/campaign-night7-k9-winner.json', 'packages/propose/bindings/fnaf2/loose-winner.json']);
  assert.equal(report.findings.length, 11, JSON.stringify(report.findings, null, 2));
  assert.ok(existsSync(pushgate) && existsSync(agent), 'doctor deleted nothing');
  assert.equal(parseWorktrees(git(sick, 'worktree', 'list', '--porcelain')).length, 2, 'the catalog worktree is gone again');
  // Fix every one, then nothing is found.
  git(sick, 'config', 'core.hooksPath', '.githooks');
  rmSync(pushgate, { recursive: true });
  git(sick, 'worktree', 'remove', agent);
  rmSync(join(sick, 'node_modules/@fnaf2-1020'), { recursive: true });
  mkdirSync(join(sick, 'node_modules/@sixam'), { recursive: true });
  writeFileSync(sickLab.env.FNAF_LOCAL_PROFILE, '{}\n');
  rmSync(join(sick, 'packages/propose/bindings/fnaf2/loose-winner.json'));
  rmSync(join(sick, 'artifacts'), { recursive: true });
  write(sick, 'docs/architecture/generated/x.json', '{"v": 2}\n');
  // The fixture's hooks now run, so a docs-only commit rides a reference to prior evidence.
  commitAll(sick, `Regenerate the catalog\n\nEVIDENCE:${'docs/evidence/prior-record-20260929.json'}\n`);
  const well = labFor(sick, { jobs: [{ ...staleJob, createdAt: NOW.toISOString() }], host: quietHost });
  report = claim(well.lab.doctor());
  assert.deepEqual(report.findings, [], JSON.stringify(report.findings, null, 2));
  assert.ok(report.checks.every(item => item.ok === true), JSON.stringify(report.checks));
  const fast = claim(well.lab.doctor({ catalog: false }));
  assert.ok(isUnknown(fast.checks.find(item => item.id === 'catalog-drift').ok), 'without the worktree, catalog drift is UNKNOWN');
  checks += 1;

  // --- morning: the queue and the packs since the last evening ------------------------------------
  const night = fixture('morning');
  const jobs = [
    { id: 'cue-2-night', kind: 'night', state: 'FAILED', night: 7, winner: 'packages/propose/bindings/fnaf2/campaign-night7-k3-winner.json',
      createdAt: '2026-09-29T20:00:00Z', startedAt: '2026-09-30T04:31:00Z', finishedAt: '2026-09-30T04:40:00Z', result: 'stopped mid-job: window-end' },
    { id: 'cue-3-old', kind: 'menu-check', state: 'DONE', createdAt: '2026-09-20T01:00:00Z', finishedAt: '2026-09-20T02:00:00Z' },
  ];
  const nightLab = labFor(night, { jobs });
  write(night, 'docs/evidence/runs/night7-q1-20260930T043100Z/pack.json', '{"outcome": "WIN", "nights": [7]}\n');
  write(night, 'docs/evidence/runs/night7-old-20260920T043100Z/pack.json', '{"outcome": "WIN", "nights": [7]}\n');
  write(nightLab.env.FNAF_WINDOW_DIR + '/w1', 'window.json', JSON.stringify({ window: { openedAt: '2026-09-30T04:30:00Z', closedAt: '2026-09-30T10:00:00Z' },
    outcome: 'COMPLETE', reason: 'queue-drained', morning: { summary: '2026-09-30 w1 COMPLETE', nights: [] } }));
  const morning = claim(nightLab.lab.morning({ since: '2026-09-29T21:00:00Z' }));
  assert.deepEqual(morning.windows.map(row => row.id), ['w1']);
  assert.deepEqual(morning.queue.map(job => job.id), ['cue-2-night'], 'only what moved since the evening');
  assert.deepEqual(morning.packs.map(pack => [pack.id, pack.tracked, pack.attested]), [['night7-q1-20260930T043100Z', false, false]]);
  assert.deepEqual(morning.todo.map(item => item.command), ['git add docs/evidence/runs/night7-q1-20260930T043100Z',
    'npm run evidence -- attest night7-q1-20260930T043100Z --by agent --note "<session>" && npm run evidence -- promote night7-q1-20260930T043100Z',
    'apps/lab/companion-queue.sh list']);
  assert.equal(morning.summary, null);
  const quiet = claim(nightLab.lab.morning({ since: '2026-10-01T00:00:00Z' }));
  assert.match(quiet.summary, /^nothing since 2026-10-01T00:00:00\.000Z: no overnight window record, no queue activity and no run pack$/);
  refusal(nightLab.lab.morning({ since: 'yesterday-ish' }), 'invalid-argument');
  checks += 1;

  // --- the CLI prints what the verbs return ---------------------------------------------------------
  const out = [];
  recordRun({ sha: claim(lab.status()).head.sha, full: true, failed: [], skipped: [] }, runRecordPath(env, root));
  assert.equal(main(['status'], { root, lab, write: text => out.push(text) }), 0);
  assert.match(out.join(''), /^lab status · master /);
  assert.match(out.join(''), /push-gate PASSED/);
  out.length = 0;
  assert.equal(main(['doctor', '--no-catalog', '--json'], { root, lab, write: text => out.push(text) }), 0);
  validateClaimEnvelope(JSON.parse(out.join('')));
  out.length = 0;
  assert.equal(main(['start', '--step', 'S0', '--artifact', 'x'], { root, lab, write: text => out.push(text) }), 1, 'a refusal exits 1');
  assert.match(out.join(''), /^REFUSED invalid-argument/);
  checks += 1;
} finally {
  rmSync(base, { recursive: true, force: true });
}

console.log(`lab verbs: ${checks} checks pass (status, next, start, commit --dry, end, morning and doctor over temporary git ` +
  'repositories; planted docs-only, evidence and code commits give 2:1; eleven planted doctor findings found, then none)');
