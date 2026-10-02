// The operator verbs: status, next, start, commit, end, morning and doctor.
//
// ADR 0002 wants one verb table and one set of query functions for every door. This is that table
// for the operator's questions: `npm run lab -- <verb>` (cli.ts) and the fnaf-solver MCP server
// (`lab.status`, `lab.next`, `lab.doctor`) both call createLab(). It lives in apps/desktop, the
// final layout's composition root, because it composes: git, this host's processes, the Companion
// queue, the push-gate record and the review package's queries. The pure queries are in
// packages/review (consequence.ts, mistakes.ts, roadmap.ts, promotions-query.ts).
//
// Every answer is a claim-envelope-v1, derived from files and git and never written by hand (ADR
// 0002 principle 4). What the lab writes is its own untracked state: `start` writes
// artifacts/lab/session.json, and `end` moves it to artifacts/lab/sessions/<id>.json. It never
// runs `git commit`, never touches the phone, never deletes anything a person left (doctor prints
// each remedy; the only thing it removes is the throwaway worktree it built for the catalog check),
// and never writes the owner's override.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { REPOSITORY_TARGET, type Unknown, claimEnvelope, isUnknown, refusalEnvelope, unknown } from '@sixam/kernel';
import { CONSEQUENCE_CITES, classifyChange, consequenceKey } from '@sixam/review/consequence';
import { trackedWinners, winnerFiles } from '@sixam/review/evidence-pack';
import { matchMistakes, readMistakes, stepFamily } from '@sixam/review/mistakes';
import { queryPromotions } from '@sixam/review/promotions-query';
import { readPacks } from '@sixam/review/registers';
import { ORDER, ORDER_OF, ROADMAP, STEPS, stateKey, stepStatus } from '@sixam/review/roadmap';
import { runRecordPath } from '../../../tools/push-gate.ts';
import { CATALOG_COMMANDS, type Check, runDoctor as doctorChecks } from './lab-doctor.ts';
import { PROC_HOST, QUEUE_TOOL, type QueueJob, iso, labContext, lines, mtime, phoneState, readJson } from './lab-host.ts';

export { PROC_HOST, STALE_PENDING_HOURS, parseWorktrees } from './lab-host.ts';

export const LAB_DOC = 'docs/operations/LAB.md';
export const SESSION_FILE = 'artifacts/lab/session.json';
export const SESSIONS_DIR = 'artifacts/lab/sessions';
export const SESSION_SCHEMA = 'lab-session-v1';
export const HOOK = '.githooks/commit-msg';
/** The evening a morning report starts from: the last 18:00, local time. */
export const EVENING_HOUR = 18;
const OVERRIDE = 'PEDRO-OK';

/** The verb table every door reads. `mcp` names the read-only tool a verb is served as, if any. */
export const LAB_VERBS = Object.freeze([
  { verb: 'status', mcp: 'lab.status', writes: null,
    answers: 'where everything stands: HEAD and push-gate, sync with origin, steps S1-S7, promotions, the phone, decisions, the doctor' },
  { verb: 'next', mcp: 'lab.next', writes: null, answers: 'the next step or action, ranked by the ROADMAP order over what status found' },
  { verb: 'start', mcp: null, writes: SESSION_FILE, answers: 'opens a session bound to a step and an artifact, with the mistakes that apply' },
  { verb: 'commit', mcp: null, writes: null,
    answers: 'whether the commit-msg hook would accept the staged set and message, and the consequence class; it never commits' },
  { verb: 'end', mcp: null, writes: `${SESSION_FILE} -> ${SESSIONS_DIR}/<id>.json`,
    answers: "the session's consequential:bookkeeping ratio, and what remains open" },
  { verb: 'morning', mcp: null, writes: null, answers: "the overnight window's results: the queue and the packs since the last evening" },
  { verb: 'doctor', mcp: 'lab.doctor', writes: null, answers: 'what is broken on this host and checkout, each with the command that fixes it' },
].map(row => Object.freeze(row)));

/** A lab session, as start() writes it. */
interface Session {
  readonly schema: string, readonly id: string, readonly step: string, readonly stepFamily: string, readonly artifact: string,
  readonly base: string, readonly branch: string, readonly startedAt: string, readonly host: string,
}
/** A push-gate run, as tools/push-gate.ts records it. */
interface RunRecord { readonly sha: string, readonly full: boolean, readonly failed: string[], readonly skipped: string[], readonly at: string, readonly host: string }
/** One ranked action of next. */
interface NextAction {
  kind: string, step: string | null, where: string, action: string, command: string | null, because: string,
  state?: string, items?: readonly string[],
}
type StepRow = ReturnType<typeof stepStatus>[number];

const plain = (text: string) => text.replace(/\*\*/g, '');
const shellQuote = (text: string) => (/^[\w@%+=:,./-]+$/.test(text) ? text : `'${String(text).replaceAll("'", "'\\''")}'`);

/** The last evening before `now`: 18:00 local, today if that has passed, else yesterday. */
export function lastEvening(now: Date) {
  const evening = new Date(now);
  evening.setHours(EVENING_HOUR, 0, 0, 0);
  if (evening.getTime() > now.getTime()) evening.setDate(evening.getDate() - 1);
  return evening;
}

/** A run id's stamp (`...-20260914T220233Z`, with or without milliseconds) as a date, or null. */
export function runStamp(id: string) {
  const match = /(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})\d*Z$/.exec(id);
  return match ? new Date(Date.UTC(+match[1], +match[2] - 1, +match[3], +match[4], +match[5], +match[6])) : null;
}

/** Stat fingerprint of the committed winners, to know when a cached compile is stale (as solver.ts keeps it). */
function winnersKey(root: string) {
  return winnerFiles(root)
    .map(file => { const stat = statSync(join(root, file)); return `${file}:${stat.size}:${stat.mtimeMs}`; }).join('|');
}

/**
 * The lab over one checkout.
 * @param options 
 * Tests replace the promotions query, the pack rows, the queue and the host; everything else is read.
 */
export function createLab({ root: rootIn, env = process.env, now = () => new Date(), winners: winnersOverride, promotions: promotionsOverride,
  packs: packsOverride, queue: queueOverride, host = PROC_HOST, catalogCommands = CATALOG_COMMANDS }: {root: string, env?: NodeJS.ProcessEnv, now?: () => Date, winners?: () => Map<string, string>, promotions?: () => ReturnType<typeof queryPromotions>, packs?: () => ReturnType<typeof readPacks>, queue?: () => {jobs: QueueJob[]}, host?: typeof PROC_HOST, catalogCommands?: readonly string[]}) {
  const root = resolve(rootIn);
  const context = labContext({ root, env, now, host });
  const { cleanEnv, git, mainRoot } = context;
  const { queue, leases, windows } = phoneState(context, queueOverride);
  const runDoctor = ({ catalog = true }: { catalog?: boolean } = {}) => doctorChecks(context, queue, { catalog, catalogCommands });

  // --- reading git ------------------------------------------------------------------------------

  const sessionPath = () => join(root, SESSION_FILE);
  const commonDir = () => git(['rev-parse', '--path-format=absolute', '--git-common-dir']).trim();

  function head() {
    const sha = git(['rev-parse', '--verify', '--quiet', 'HEAD'], { allowFail: true })?.trim();
    if (!sha) return null;
    return { sha, short: sha.slice(0, 7), subject: git(['log', '-1', '--format=%s', sha]).trim(),
      branch: git(['rev-parse', '--abbrev-ref', 'HEAD']).trim(), uncommitted: lines(git(['status', '--porcelain'])).length };
  }

  /** The push-gate record for a commit: the last run of tools/push-gate.ts on it, or not run. */
  function pushGate(sha: string) {
    const path = runRecordPath(env, root);
    // Each line as tools/push-gate.ts appended it; one that does not parse is skipped.
    const runs: RunRecord[] = existsSync(path) ? lines(readFileSync(path, 'utf8')).flatMap(line => {
      try { return [JSON.parse(line)]; } catch { return []; }
    }).filter(run => run.sha === sha && Array.isArray(run.failed) && Array.isArray(run.skipped)) : [];
    const last = runs.at(-1);
    if (!last) return { ran: false as const, record: path, command: 'npm run push-gate' };
    const verdict = last.failed.length ? 'FAILED' : 'PASSED';
    return { ran: true as const, record: path, at: last.at, host: last.host, full: last.full, verdict, failed: last.failed, skipped: last.skipped,
      runs: runs.length, command: last.failed.length ? `npm run push-gate -- ${sha.slice(0, 7)}` : null, unverified: last.skipped };
  }

  function sync() {
    const counts = (ref: string) => {
      const out = git(['rev-list', '--left-right', '--count', `HEAD...${ref}`], { allowFail: true });
      if (!out) return null;
      const [ahead, behind] = out.trim().split(/\s+/).map(Number);
      return { ref, ahead, behind };
    };
    const upstream = git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], { allowFail: true })?.trim() || null;
    const originHead = git(['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'], { allowFail: true })?.trim()
      || (git(['rev-parse', '--verify', '--quiet', 'refs/remotes/origin/master'], { allowFail: true }) ? 'origin/master' : null);
    const fetched = mtime(join(commonDir(), 'FETCH_HEAD'));
    return { upstream, vsUpstream: upstream ? counts(upstream) : null, origin: originHead, vsOrigin: originHead ? counts(originHead) : null,
      lastFetch: fetched ? iso(fetched) : null };
  }

  // What start() wrote.
  function readSession() {
    try { return readJson(sessionPath()) as Session | null; } catch { return null; }
  }

  // --- the evidence ------------------------------------------------------------------------------

  let winnersCache = null as { key: string, winners: Map<string, string> } | null;
  const winnersFn = () => {
    if (winnersOverride) return winnersOverride();
    const key = winnersKey(root);
    if (winnersCache?.key !== key) winnersCache = { key, winners: trackedWinners(root) };
    return winnersCache.winners;
  };
  const promotionsResult = () => {
    try { return promotionsOverride ? promotionsOverride() : queryPromotions(root, { winners: winnersFn() }); } catch (error) {
      return unknown(`the promotions query failed: ${(error as Error).message}`);
    }
  };
  const packRows = () => {
    try { return packsOverride ? packsOverride() : readPacks(root); } catch { return []; }
  };
  const steps = (promotions: ReturnType<typeof promotionsResult>): StepRow[] => {
    try { return stepStatus(root, { promotions, packs: packRows() }); } catch (error) {
      return STEPS.map(step => ({ id: step.id, title: step.title, closesWhen: null, needs: [...step.needs], where: step.where,
        records: { count: 0, newest: null }, met: [], unmet: [], state: unknown(`the step query failed: ${(error as Error).message}`) }));
    }
  };
  const promotionsSummary = (promotions: ReturnType<typeof promotionsResult>) => (isUnknown(promotions) ? promotions : {
    consistent: promotions.consistent, packs: promotions.lift.packs, gameRuns: promotions.lift.gameRuns, edges: promotions.edges.matched,
    graphEdges: promotions.edges.graph, byAttester: promotions.edges.byAttester, byCustody: promotions.edges.byCustody,
    modelOnlyWinners: promotions.open.modelOnlyWinners.winners.map(item => item.file),
    untrackedWinnerDebt: promotions.open.untrackedWinnerDebt.summary, reproducer: 'npm run review -- query promotions',
  });

  /** ADRs whose status is proposed, and whether a commit carrying the owner's override has touched them since. */
  function decisions() {
    const dir = join(root, 'docs/decisions');
    const rows: { file: string, status: string, accepted: boolean, by: string | null }[] = [];
    for (const name of existsSync(dir) ? readdirSync(dir).filter(item => item.endsWith('.md')).sort() : []) {
      const file = `docs/decisions/${name}`;
      const status = /\*\*Status:\*\*\s*([^\n]+)/.exec(readFileSync(join(dir, name), 'utf8'))?.[1]?.trim() ?? null;
      if (!status || !/proposed/i.test(status)) continue;
      const log = git(['log', '--format=%H%x1f%B%x1e', '--', file], { allowFail: true }) ?? '';
      const signed = log.split('\x1e').map(entry => entry.trim().split('\x1f')).find(([, body]) => body?.includes(OVERRIDE));
      rows.push({ file, status, accepted: Boolean(signed), by: signed ? signed[0].slice(0, 7) : null });
    }
    return {
      rule: `an ADR under docs/decisions/ whose Status line says proposed is pending until a commit that touches it carries the owner's override`,
      pending: rows.filter(row => !row.accepted), acceptedSinceProposed: rows.filter(row => row.accepted),
    };
  }

  // --- the verbs ---------------------------------------------------------------------------------

  const label = (what: string) => unknown(`${what}: the lab reads git, the committed evidence and this host, and measures nothing about a game`);
  const badArgument = (because: string, remedy: string) => refusalEnvelope({ rule: 'invalid-argument', because, cite: [LAB_DOC], remedy });

  function doctor({ catalog = true }: { catalog?: boolean } = {}) {
    const { checks, findings } = runDoctor({ catalog });
    const notChecked = checks.filter((item): item is Check & { ok: Unknown } => isUnknown(item.ok));
    return claimEnvelope({
      claim: { verb: 'doctor', host: hostname(), at: iso(now()), findings, checks,
        rule: 'doctor prints each remedy and runs none; the only thing it removes is the worktree it built for the catalog check' },
      label: label('a host check'), target: REPOSITORY_TARGET, cite: [LAB_DOC, 'CLAUDE.md', '.github/workflows/ci.yml'],
      status: 'standing', supersededBy: null,
      notMeasured: notChecked.map(item => `${item.id}: ${item.ok.reason}`),
      reproducer: `npm run lab -- doctor${catalog ? '' : ' --no-catalog'}`,
    });
  }

  function gather() {
    const promotions = promotionsResult();
    return { head: head(), session: readSession(), promotions, steps: steps(promotions), decisions: decisions(), doctor: runDoctor({ catalog: false }) };
  }

  function status() {
    const { head: at, session, promotions, steps: rows, decisions: pending, doctor: health } = gather();
    const phone = { lease: leases(), queue: queue(), window: windows() };
    if (!isUnknown(phone.queue)) delete phone.queue.jobsRaw;
    const repoSync = at ? sync() : null;
    const notMeasured = [
      ...rows.flatMap(row => (isUnknown(row.state) ? [`${row.id}: ${row.state.reason}`] : [])),
      'the remote since the last fetch: the lab never fetches',
      'catalog drift: status builds no worktree (npm run lab -- doctor computes it)',
      ...(isUnknown(promotions) ? [promotions.reason] : ['reliability: a promotion is one clear on the phone, not a rate']),
      ...(isUnknown(phone.queue) ? [phone.queue.reason] : []),
      'decisions asked only in conversation or in prose: only ADR status lines are read',
    ];
    return claimEnvelope({
      claim: {
        verb: 'status', host: hostname(), at: iso(now()), head: at, pushGate: at ? pushGate(at.sha) : null, sync: repoSync,
        session: session ?? null, steps: rows, promotions: promotionsSummary(promotions), phone,
        decisions: pending, doctor: { findings: health.findings.length, ids: [...new Set(health.findings.map(item => item.id))],
          reproducer: 'npm run lab -- doctor' },
      },
      label: label('a status joins registers of several labels, each section with its own'), target: REPOSITORY_TARGET,
      cite: [ROADMAP, 'docs/evidence/graph.json', 'docs/evidence/runs', 'docs/decisions', QUEUE_TOOL, LAB_DOC],
      status: 'standing', supersededBy: null, notMeasured, reproducer: 'npm run lab -- status',
    });
  }

  /** The action a step's open conditions call for, derived from its row; never invented. */
  function stepAction(step: (typeof STEPS)[number], row: StepRow) {
    if (step.id === 'S1' && row.promotions) {
      const items: { action: string, command: string | null, items: readonly string[], because: string }[] = row.promotions.modelOnlyWinners.map(file => {
        let nights: unknown = null;
        // A winner file names its nights.
        try { nights = (readJson(join(root, file)) as { nights?: unknown }).nights; } catch { nights = null; }
        const night = Array.isArray(nights) && nights.length === 1 ? nights[0] : null;
        return { action: `a packed phone run of ${file}${night ? ` (Night ${night})` : ''}`,
          command: `${QUEUE_TOOL} enqueue night --game fnaf2 --winner ${file}${night ? ` --night ${night}` : ''}`, items: [],
          because: `S1 closes when every committed winner's run is packed; ${file} stands MODEL_ONLY` +
            (night ? '' : '; its night is UNKNOWN (the winner does not name exactly one)') };
      });
      for (const open of row.alsoOpen ?? []) items.push({ action: open, command: null, items: [], because: 'open for S1 in CLAUDE.md, outside its closing condition' });
      return items;
    }
    if (isUnknown(row.state))
      return [{ action: plain(ORDER[ORDER_OF[step.id]]), command: null, items: [],
        because: `${row.state.reason}${row.records.newest && !row.state.reason.includes(row.records.newest.file)
          ? `; newest record naming ${step.id}: ${row.records.newest.file}` : ''}` }];
    return [{ action: `${step.title}: ${row.unmet.length} unmet`, command: null, items: row.unmet,
      because: `${step.id} closes when ${row.closesWhen ?? 'its ROADMAP condition holds'}` }];
  }

  function next() {
    const { head: at, session, steps: rows, decisions: pending, doctor: health } = gather();
    const byId: Record<string, StepRow> = Object.fromEntries(rows.map(row => [row.id, row]));
    const actions: NextAction[] = [];
    if (session) actions.push({ kind: 'session', step: session.step, where: 'this checkout', action: `continue the open session: ${session.artifact}`,
      command: 'npm run lab -- end', because: `opened ${session.startedAt} at ${String(session.base).slice(0, 7)}` });
    for (const finding of health.findings.filter(item => ['hooks-path', 'node-modules'].includes(item.id)))
      actions.push({ kind: 'fix', step: null, where: 'this checkout', action: finding.finding, command: finding.remedy, because: 'doctor' });
    const blocked: { step: string, state: string, needs: string[], because: string }[] = [];
    for (const step of [...STEPS].sort((a, b) => ORDER_OF[a.id] - ORDER_OF[b.id] || a.id.localeCompare(b.id))) {
      const row = byId[step.id];
      if (stateKey(row) === 'closed') continue;
      const needs = step.needs.filter(id => stateKey(byId[id]) !== 'closed').map(id => `${id} (${stateKey(byId[id])})`);
      const after = (step.after ?? []).filter(id => stateKey(byId[id]) !== 'closed');
      if (needs.length) { blocked.push({ step: step.id, state: stateKey(row), needs, because: plain(ORDER[ORDER_OF[step.id]]) }); continue; }
      if (after.length) { blocked.push({ step: step.id, state: stateKey(row), needs: after.map(id => `${id} (${stateKey(byId[id])})`),
        because: plain(ORDER[ORDER_OF[step.id]]) }); continue; }
      for (const item of stepAction(step, row)) actions.push({ kind: 'step', step: step.id, state: stateKey(row), where: step.where, ...item });
    }
    for (const row of pending.pending)
      actions.push({ kind: 'decide', step: null, where: 'Pedro', action: `${row.file} is proposed (${row.status})`, command: null,
        because: pending.rule });
    const gate = at ? pushGate(at.sha) : null;
    if (at && gate && (!gate.ran || gate.verdict === 'FAILED'))
      actions.push({ kind: 'gate', step: null, where: 'this checkout', action: gate.ran ? `push-gate failed on ${at.short}: ${gate.failed.join(', ')}`
        : `push-gate has not run on ${at.short}`, command: gate.command, because: 'CLAUDE.md: run the push gate before pushing' });
    const ranked = actions.map((item, index) => ({ rank: index + 1, ...item }));
    return claimEnvelope({
      claim: { verb: 'next', at: iso(now()), order: ORDER, actions: ranked, blocked,
        rule: 'an open session first, then doctor findings that stop every commit, then each step in the ROADMAP order that is not closed and ' +
          'whose needs are closed, then pending decisions and the push gate' },
      label: label('a ranking of open work'), target: REPOSITORY_TARGET, cite: [ROADMAP, 'docs/evidence/graph.json', LAB_DOC],
      status: 'standing', supersededBy: null,
      notMeasured: [...rows.flatMap(row => (isUnknown(row.state) ? [`${row.id}: ${row.state.reason}`] : [])),
        'whether the phone is present: an enqueued night waits for the overnight window'],
      reproducer: 'npm run lab -- next',
    });
  }

  function start({ step, artifact }: {step?: string, artifact?: string} = {}) {
    const family = stepFamily(step);
    if (!family) return badArgument(`${JSON.stringify(step ?? null)} is not a ROADMAP step`, 'name one of S1..S7 (S2a and S2b name S2)');
    if (typeof artifact !== 'string' || !artifact.trim())
      return badArgument('a session names the artifact it aims to produce', 'pass --artifact "<what>" (CLAUDE.md: name the step and the artifact)');
    const open = readSession();
    if (open) return refusalEnvelope({ rule: 'session-open', because: `session ${open.id} on ${open.step} is open since ${open.startedAt}`,
      cite: [SESSION_FILE, LAB_DOC], remedy: 'npm run lab -- end closes it and reports its ratio; then start again' });
    const at = head();
    if (!at) return badArgument('this checkout has no HEAD commit', 'commit once before starting a session');
    const startedAt = now();
    const session = { schema: SESSION_SCHEMA, id: `${iso(startedAt).replace(/[-:]/g, '').replace(/\.\d+/, '')}-${step}`, step: String(step).trim(),
      stepFamily: family, artifact: artifact.trim(), base: at.sha, branch: at.branch, startedAt: iso(startedAt), host: hostname() };
    mkdirSync(join(root, 'artifacts/lab'), { recursive: true });
    writeFileSync(sessionPath(), `${JSON.stringify(session, null, 2)}\n`);
    const register = readMistakes(root);
    const read = matchMistakes(register.entries, { step, text: artifact });
    // family is a ROADMAP step, so STEPS holds it.
    const stepRow = STEPS.find(item => item.id === family) as (typeof STEPS)[number];
    return claimEnvelope({
      claim: { verb: 'start', session, file: SESSION_FILE, step: { id: family, title: stepRow.title },
        mistakes: { source: register.source, read, of: register.entries.length },
        rule: 'CLAUDE.md: if that artifact cannot be produced this session, say so and stop; no substitute work that closes no step' },
      label: label('a session record is a plan'), target: REPOSITORY_TARGET,
      cite: [ROADMAP, ...(register.source ? [register.source] : []), CONSEQUENCE_CITES[0]], status: 'standing', supersededBy: null,
      notMeasured: ['whether the artifact is produced: npm run lab -- end reads the commits since the base',
        ...(register.source ? [] : ['the mistake registers: neither source holds entries'])],
      reproducer: `npm run lab -- start --step ${shellQuote(String(step))} --artifact ${shellQuote(artifact.trim())}`,
    });
  }

  function commit({ message, messageFile }: {message?: string, messageFile?: string} = {}) {
    if (message !== undefined && messageFile !== undefined) return badArgument('a message is given once', 'pass -m MESSAGE or -F FILE, not both');
    let text = message;
    if (messageFile !== undefined) {
      try { text = readFileSync(resolve(messageFile), 'utf8'); } catch (error) { return badArgument(`the message file cannot be read: ${(error as Error).message}`, 'pass a readable -F FILE'); }
    }
    const staged = (git(['diff', '--cached', '--name-only', '-z']) ?? '').split('\0').filter(Boolean);
    const consequence = classifyChange(staged);
    const hookPath = join(root, HOOK);
    const hooksPath = git(['config', '--get', 'core.hooksPath'], { allowFail: true })?.trim() || null;
    let hook: Unknown | { verdict: string, exitCode: number | null, output: string[], message: string, runsOnCommit: boolean, note?: string };
    if (!existsSync(hookPath)) hook = unknown(`this checkout has no ${HOOK}`);
    else {
      const dir = mkdtempSync(join(tmpdir(), 'fnaf-lab-commit-'));
      try {
        const file = join(dir, 'COMMIT_EDITMSG');
        writeFileSync(file, text ?? 'Dry run\n');
        const result = spawnSync('sh', [hookPath, file], { cwd: root, encoding: 'utf8', env: cleanEnv });
        hook = { verdict: result.status === 0 ? 'ACCEPT' : 'REFUSE', exitCode: result.status, output: lines(result.stderr),
          message: text === undefined ? 'none given: the verdict is for a message with no EVIDENCE: reference and no override' : 'given',
          runsOnCommit: Boolean(hooksPath), ...(hooksPath ? {} : { note: 'core.hooksPath is unset, so git would not run this hook: git config core.hooksPath .githooks' }) };
      } finally { rmSync(dir, { recursive: true, force: true }); }
    }
    return claimEnvelope({
      claim: { verb: 'commit', dry: true, staged, nothingStaged: staged.length === 0, hook, consequence,
        rule: `the hook's verdict is ${HOOK} itself, run on the staged set and the message; the class is packages/review/src/consequence.ts ` +
          'over the staged paths, which a reference to prior evidence does not change. The lab never commits.' },
      label: label('a prediction of the hook'), target: REPOSITORY_TARGET, cite: [HOOK, ...CONSEQUENCE_CITES],
      status: 'standing', supersededBy: null,
      notMeasured: [...(isUnknown(hook) ? [hook.reason] : []), ...(isUnknown(consequence.consequence) ? [consequence.consequence.reason] : []),
        'whether the change closes or advances a step: paths show what it retains, not what it shows'],
      reproducer: `npm run lab -- commit --dry${text === undefined ? '' : messageFile !== undefined ? ` -F ${shellQuote(messageFile)}` : ' -m <message>'}`,
    });
  }

  function end({ since }: {since?: string} = {}) {
    const session = readSession();
    const base = since ?? session?.base;
    if (!base) return refusalEnvelope({ rule: 'no-session', because: 'no session is open and no --since was given', cite: [SESSION_FILE, LAB_DOC],
      remedy: 'npm run lab -- start --step S<n> --artifact "<what>" at the start of a session, or end --since <sha>' });
    const baseSha = git(['rev-parse', '--verify', '--quiet', `${base}^{commit}`], { allowFail: true })?.trim();
    if (!baseSha) return badArgument(`${base} names no commit here`, 'pass a commit sha or ref');
    const at = head();
    const shas = lines(git(['rev-list', '--reverse', '--first-parent', `${baseSha}..HEAD`]));
    const commits = shas.map(sha => {
      const paths = (git(['diff-tree', '--no-commit-id', '--name-only', '-r', '--root', '-m', '--first-parent', '-z', sha]) ?? '')
        .split('\0').filter(Boolean);
      const result = classifyChange(paths);
      return { sha: sha.slice(0, 7), subject: git(['log', '-1', '--format=%s', sha]).trim(), class: consequenceKey(result),
        because: isUnknown(result.consequence) ? result.consequence.reason : result.because, records: result.records.map(item => item.path) };
    });
    const count = (key: string) => commits.filter(item => item.class === key).length;
    const ratio = { consequential: count('consequential'), bookkeeping: count('bookkeeping'), unknown: count('UNKNOWN') };
    const promotions = promotionsResult();
    const rows = steps(promotions);
    const family = session?.stepFamily ?? null;
    const open = rows.filter(row => stateKey(row) !== 'closed' && (!family || row.id === family))
      .map(row => ({ step: row.id, state: stateKey(row), unmet: row.unmet, alsoOpen: row.alsoOpen ?? [],
        ...(isUnknown(row.state) ? { reason: row.state.reason } : {}) }));
    const gate = at ? pushGate(at.sha) : null;
    const claim: {
      verb: 'end', session: { id: string, step: string, artifact: string } | null, base: string, head: string | null,
      commits: typeof commits, ratio: typeof ratio, ratioText: string, records: string[], open: typeof open, uncommitted: number,
      pushGate: typeof gate, rule: string, closed?: string,
    } = {
      verb: 'end', session: session && !since ? { id: session.id, step: session.step, artifact: session.artifact } : null,
      base: baseSha.slice(0, 7), head: at?.short ?? null, commits, ratio, ratioText: `${ratio.consequential}:${ratio.bookkeeping}`,
      records: [...new Set(commits.flatMap(item => item.records))], open,
      uncommitted: at?.uncommitted ?? 0, pushGate: gate,
      rule: 'each commit on the first-parent line since the base, classed by packages/review/src/consequence.ts; an UNKNOWN is outside the ratio',
    };
    if (session && !since) {
      mkdirSync(join(root, SESSIONS_DIR), { recursive: true });
      writeFileSync(join(root, SESSIONS_DIR, `${session.id}.json`), `${JSON.stringify({ ...session, endedAt: iso(now()), head: at?.sha ?? null,
        ratio, commits: commits.length }, null, 2)}\n`);
      rmSync(sessionPath(), { force: true });
      claim.closed = `${SESSIONS_DIR}/${session.id}.json`;
    }
    return claimEnvelope({
      claim, label: label('a ratio over commit paths'), target: REPOSITORY_TARGET, cite: [...CONSEQUENCE_CITES, ROADMAP, LAB_DOC],
      status: 'standing', supersededBy: null,
      notMeasured: [...(ratio.unknown ? [`${ratio.unknown} commits whose class paths do not tell`] : []),
        ...open.filter(row => row.reason).map(row => `${row.step}: ${row.reason}`),
        'whether the session produced its artifact: the records it committed are listed, the artifact text is not matched'],
      reproducer: since ? `npm run lab -- end --since ${shellQuote(since)}` : 'npm run lab -- end',
    });
  }

  function morning({ since }: {since?: string} = {}) {
    const at = now();
    const from = since ? new Date(since) : lastEvening(at);
    if (Number.isNaN(from.getTime())) return badArgument(`${since} is not a date`, 'pass --since as an ISO date or time');
    const after = (value: string | null | undefined) => value && new Date(value).getTime() >= from.getTime();
    const win = windows();
    const windowRows = win.all.filter(row => after(row.openedAt));
    const jobs = queue();
    // queue() returns the raw jobs; only status drops them.
    const activity = isUnknown(jobs) ? jobs : (jobs.jobsRaw as QueueJob[])
      .filter(job => (['createdAt', 'startedAt', 'finishedAt', 'cancelledAt'] as const).some(key => after(job[key])))
      .map(job => ({ id: job.id, kind: job.kind, state: job.state, night: job.night ?? null, winner: job.winner ?? null,
        finishedAt: job.finishedAt ?? null, result: typeof job.result === 'string' ? job.result.split('\n').filter(Boolean).at(-1) ?? null : null }));
    const tracked = new Set(lines(git(['ls-files', '--', 'docs/evidence/runs'], { allowFail: true }))
      .map(path => path.split('/')[3]).filter(Boolean));
    const packs = new Map<string, { id: string, where: string, stamp: string, outcome: unknown, nights: unknown, attested: boolean, tracked: boolean }>();
    for (const [where, dir] of [['this checkout', root], ['main checkout', mainRoot()]]) {
      const runs = join(dir, 'docs/evidence/runs');
      if (!existsSync(runs)) continue;
      for (const id of readdirSync(runs)) {
        if (packs.has(id)) continue;
        const packFile = join(runs, id, 'pack.json');
        const stamp = runStamp(id) ?? mtime(packFile);
        if (!stamp || stamp.getTime() < from.getTime()) continue;
        let pack: { outcome?: unknown, nights?: unknown } | null = null;
        // A pack's own JSON.
        try { pack = readJson(packFile) as { outcome?: unknown, nights?: unknown } | null; } catch { pack = null; }
        packs.set(id, { id, where, stamp: iso(stamp), outcome: pack?.outcome ?? null, nights: pack?.nights ?? null,
          attested: existsSync(join(runs, id, 'plan12-attestation.json')), tracked: tracked.has(id) });
      }
    }
    const packRows = [...packs.values()].sort((a, b) => a.stamp.localeCompare(b.stamp));
    const todo = [
      ...packRows.filter(row => !row.tracked).map(row => ({ action: `commit the pack ${row.id} (${row.where})`, command: `git add docs/evidence/runs/${row.id}` })),
      ...packRows.filter(row => row.outcome === 'WIN' && !row.attested).map(row => ({ action: `attest and promote ${row.id}`,
        command: `npm run evidence -- attest ${row.id} --by agent --note "<session>" && npm run evidence -- promote ${row.id}` })),
      ...(isUnknown(activity) ? [] : activity.filter(job => job.state === 'FAILED').map(job => ({ action: `read why job ${job.id} failed`, command: `${QUEUE_TOOL} list` }))),
    ];
    const nothing = !windowRows.length && !packRows.length && (isUnknown(activity) || !activity.length);
    return claimEnvelope({
      claim: { verb: 'morning', since: iso(from), at: iso(at), windows: windowRows, windowDir: win.dir, queue: activity, packs: packRows,
        pending: isUnknown(jobs) ? jobs : jobs.pending, todo,
        summary: nothing ? `nothing since ${iso(from)}: no overnight window record, no queue activity and no run pack` : null },
      label: label('a summary of host records and packs'), target: REPOSITORY_TARGET, cite: [QUEUE_TOOL, 'docs/evidence/runs', 'apps/lab/overnight-window.py', LAB_DOC],
      status: 'standing', supersededBy: null,
      notMeasured: [...(isUnknown(jobs) ? [jobs.reason] : []), 'each night\'s cause of death: a pack\'s outcome is the venue\'s report, graded by review',
        ...(win.records ? [] : [`no overnight window has left a record in ${win.dir}`])],
      reproducer: since ? `npm run lab -- morning --since ${shellQuote(since)}` : 'npm run lab -- morning',
    });
  }

  return { status, next, start, commit, end, morning, doctor, verbs: LAB_VERBS };
}

