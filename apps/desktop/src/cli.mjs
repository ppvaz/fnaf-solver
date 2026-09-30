#!/usr/bin/env node
// `npm run lab -- <verb>`: the operator verbs from a shell (apps/desktop/src/lab.mjs).
//
//   npm run lab -- status                                   where everything stands
//   npm run lab -- next                                     the next step or action, ranked
//   npm run lab -- start --step S<n> --artifact "<what>"    open a session; print the mistakes that apply
//   npm run lab -- commit --dry [-m MESSAGE | -F FILE]      would the commit-msg hook accept the stage? which class?
//   npm run lab -- end [--since SHA]                        the session's consequential:bookkeeping ratio, and what is open
//   npm run lab -- morning [--since ISO]                    the overnight window's results since the last evening
//   npm run lab -- doctor [--no-catalog]                    what is broken here, each with its remedy
//
// Every verb prints text, or with --json the claim-envelope-v1 the MCP server returns. Exit 0 for
// a claim, 1 for a refusal (and for `commit --dry` when the hook would refuse), 2 on a usage error.
// The lab never commits, never touches the phone and never runs a remedy it prints.
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isUnknown } from '@sixam/kernel';
import { LAB_VERBS, createLab } from './lab.mjs';

const ROOT = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const USAGE = `usage: npm run lab -- <verb> [--json]
  status                                  where everything stands
  next                                    the next step or action
  start --step S<n> --artifact "<what>"   open a session bound to a step and an artifact
  commit --dry [-m MESSAGE | -F FILE]     would the hook accept the staged set; its consequence class
  end [--since SHA]                       the session's consequential:bookkeeping ratio; what is open
  morning [--since ISO]                   the overnight window's results since the last evening
  doctor [--no-catalog]                   what is broken here, each with the command that fixes it`;

const said = value => (isUnknown(value) ? `UNKNOWN (${value.reason})` : value);
const yes = ok => (isUnknown(ok) ? 'UNKNOWN' : ok ? 'ok  ' : 'FAIL');

/** Text for each verb's claim. @type {Record<string, (claim: any) => string[]>} */
const RENDER = {
  status(claim) {
    const out = [];
    const { head, pushGate, sync, session, steps, promotions, phone, decisions, doctor } = claim;
    out.push(`lab status · ${head ? `${head.branch} ${head.short} ${head.subject}` : 'no HEAD'} · host ${claim.host} · ${claim.at}`);
    if (head) {
      out.push(`HEAD      ${head.uncommitted} uncommitted paths`);
      out.push(`push-gate ${pushGate.ran ? `${pushGate.verdict} on ${head.short} at ${pushGate.at}${pushGate.full ? ' (--full)' : ''}` +
        `${pushGate.failed.length ? `: ${pushGate.failed.join(', ')}` : ''}${pushGate.unverified.length ? ` · unverified: ${pushGate.unverified.join(', ')}` : ''}`
        : `not run on ${head.short} -> ${pushGate.command}`}`);
    }
    if (sync) {
      const count = row => (row ? `${row.ahead} ahead, ${row.behind} behind ${row.ref}` : null);
      out.push(`sync      ${[sync.upstream ? count(sync.vsUpstream) : 'no upstream', count(sync.vsOrigin) ?? 'no origin remote-tracking branch']
        .filter(Boolean).join(' · ')}${sync.lastFetch ? ` (as of the fetch at ${sync.lastFetch})` : ''}`);
    }
    out.push(`session   ${session ? `${session.id}: ${session.step} -> ${session.artifact} (base ${String(session.base).slice(0, 7)})`
      : 'none open -> npm run lab -- start --step S<n> --artifact "<what>"'}`);
    out.push('steps');
    for (const row of steps) {
      const state = isUnknown(row.state) ? `UNKNOWN: ${row.state.reason}` : row.state;
      out.push(`  ${row.id} ${row.title}: ${state}`);
      for (const item of row.unmet) out.push(`       unmet: ${item}`);
      for (const item of row.alsoOpen ?? []) out.push(`       also open: ${item}`);
    }
    out.push(`review    ${isUnknown(promotions) ? said(promotions) : `${promotions.packs} packs · ${promotions.edges} of ${promotions.graphEdges} ` +
      `PROMOTED_BY edges re-derive${promotions.consistent ? '' : ' (INCONSISTENT)'} · MODEL_ONLY winners ${promotions.modelOnlyWinners.length} · ` +
      `UNTRACKED_WINNER_DEBT ${promotions.untrackedWinnerDebt} -> ${promotions.reproducer}`}`);
    const queue = phone.queue;
    out.push(`phone     lease ${phone.lease.held ? `HELD (${phone.lease.leases.filter(row => row.held).map(row => `pid ${row.pid}`).join(', ')})` : 'free'}` +
      ` · queue ${isUnknown(queue) ? said(queue) : `${queue.pending.length} PENDING${queue.pending.some(job => job.stale) ? ` (${queue.pending.filter(job => job.stale).length} stale)` : ''}` +
        `, ${queue.running.length} RUNNING, ${queue.jobs} jobs`}` +
      ` · window ${phone.window.last ? `${phone.window.last.outcome} ${phone.window.last.openedAt}` : `no record in ${phone.window.dir}`}` +
      `${phone.window.pendingRestores.length ? ` · ${phone.window.pendingRestores.length} PENDING RESTORE` : ''}`);
    for (const job of isUnknown(queue) ? [] : queue.pending) out.push(`            ${job.id} ${job.kind} ${job.ageHours} h${job.stale ? ' STALE' : ''}`);
    out.push(`decide    ${decisions.pending.length ? decisions.pending.map(row => `${row.file} (${row.status})`).join('; ') : 'none discoverable'}`);
    out.push(`doctor    ${doctor.findings} findings${doctor.findings ? ` (${doctor.ids.join(', ')})` : ''} -> ${doctor.reproducer}`);
    return out;
  },
  next(claim) {
    const out = claim.actions.map(item => `${String(item.rank).padStart(2)} ${item.step ?? item.kind}${item.state ? ` ${item.state}` : ''} [${item.where}] ` +
      `${item.action}${(item.items ?? []).map(entry => `\n      - ${entry}`).join('')}${item.command ? `\n      -> ${item.command}` : ''}` +
      `\n      because ${item.because}`);
    if (!out.length) out.push('nothing ranked: every step is closed or blocked');
    for (const row of claim.blocked) out.push(`blocked ${row.step} (${row.state}): needs ${row.needs.join(', ')} -- ${row.because}`);
    return out;
  },
  start(claim) {
    const { session, mistakes } = claim;
    const out = [`session   ${session.id} · base ${session.base.slice(0, 7)} · host ${session.host}`,
      `step      ${session.step} (${claim.step.title}) -> artifact: ${session.artifact}`,
      `written   ${claim.file}`, `read now  ${mistakes.read.length} of ${mistakes.of} entries of ${mistakes.source ?? 'no register'}`];
    for (const entry of mistakes.read) {
      const why = entry.because.untagged ? 'untagged' : [...entry.because.areas, ...entry.because.words.map(word => `"${word}"`)].join(', ');
      out.push(`  ${entry.n}. ${entry.text}\n     (matched: ${why})`);
    }
    out.push(claim.rule);
    return out;
  },
  commit(claim) {
    const { hook, consequence } = claim;
    const out = [`staged    ${claim.staged.length ? claim.staged.join(', ') : 'nothing'}`];
    if (isUnknown(hook)) out.push(`hook      ${said(hook)}`);
    else {
      out.push(`hook      ${hook.verdict === 'ACCEPT' ? 'WOULD ACCEPT' : 'WOULD REFUSE'} (message: ${hook.message})`);
      for (const line of hook.output) out.push(`          ${line}`);
      if (hook.note) out.push(`          ${hook.note}`);
    }
    out.push(`class     ${isUnknown(consequence.consequence) ? `UNKNOWN: ${consequence.consequence.reason}` : `${consequence.consequence.toUpperCase()}: ${consequence.because}`}`);
    out.push('the lab never commits');
    return out;
  },
  end(claim) {
    const out = [`${claim.session ? `session ${claim.session.id} (${claim.session.step})` : 'since'} · ${claim.base}..${claim.head} · ` +
      `${claim.commits.length} commits · consequential ${claim.ratio.consequential} : bookkeeping ${claim.ratio.bookkeeping}` +
      `${claim.ratio.unknown ? ` · UNKNOWN ${claim.ratio.unknown}` : ''}`];
    for (const item of claim.commits) out.push(`  ${item.class.padEnd(13)} ${item.sha} ${item.subject}\n                ${item.because}`);
    out.push(`records   ${claim.records.length ? claim.records.join(', ') : 'none committed'}`);
    for (const row of claim.open) {
      out.push(`open      ${row.step} ${row.state}${row.reason ? `: ${row.reason}` : ''}`);
      for (const item of [...row.unmet, ...row.alsoOpen]) out.push(`            ${item}`);
    }
    out.push(`uncommitted ${claim.uncommitted} paths`);
    if (claim.pushGate) out.push(`push-gate ${claim.pushGate.ran ? claim.pushGate.verdict : `not run on ${claim.head} -> ${claim.pushGate.command}`}`);
    if (claim.closed) out.push(`closed    ${claim.closed}`);
    out.push(`ratio     ${claim.ratioText} (consequential:bookkeeping)`);
    return out;
  },
  morning(claim) {
    if (claim.summary) return [`morning since ${claim.since}: ${claim.summary}`];
    const out = [`morning since ${claim.since}`];
    for (const row of claim.windows) out.push(`window    ${row.id} ${row.outcome} (${row.reason})${row.summary ? `\n          ${row.summary}` : ''}`);
    if (!claim.windows.length) out.push(`window    no record in ${claim.windowDir}`);
    for (const job of isUnknown(claim.queue) ? [] : claim.queue) out.push(`job       ${job.id} ${job.kind}${job.night ? ` N${job.night}` : ''} ${job.state}${job.result ? `: ${job.result}` : ''}`);
    for (const pack of claim.packs) out.push(`pack      ${pack.id} ${pack.outcome ?? '?'} ${pack.tracked ? 'committed' : 'UNCOMMITTED'}${pack.attested ? ' attested' : ''} (${pack.where})`);
    for (const item of claim.todo) out.push(`do        ${item.action}\n          -> ${item.command}`);
    return out;
  },
  doctor(claim) {
    const out = claim.checks.map(item => `${yes(item.ok)} ${item.id.padEnd(20)} ${item.what}${isUnknown(item.ok) ? `: ${item.ok.reason}` : ''}`);
    out.push(`${claim.findings.length} findings`);
    for (const item of claim.findings) out.push(`  ${item.id}: ${item.finding}\n    -> ${item.remedy}`);
    out.push(claim.rule);
    return out;
  },
};

/** @param {string[]} argv */
export function parse(argv) {
  const [verb, ...rest] = argv;
  if (!LAB_VERBS.some(row => row.verb === verb)) return { error: verb ? `unknown verb ${verb}` : 'no verb' };
  const options = { verb, json: false, args: {} };
  const value = (index, flag) => {
    if (index + 1 >= rest.length) throw new Error(`${flag} needs a value`);
    return rest[index + 1];
  };
  const allowed = { status: [], next: [], start: ['--step', '--artifact'], commit: ['--dry', '-m', '--message', '-F', '--file'],
    end: ['--since'], morning: ['--since'], doctor: ['--no-catalog'] }[verb];
  try {
    for (let index = 0; index < rest.length; index += 1) {
      const flag = rest[index];
      if (flag === '--json') { options.json = true; continue; }
      if (!allowed.includes(flag)) return { error: `${verb} takes no ${flag}` };
      if (flag === '--dry') continue;
      if (flag === '--no-catalog') { options.args.catalog = false; continue; }
      const key = { '--step': 'step', '--artifact': 'artifact', '-m': 'message', '--message': 'message', '-F': 'messageFile', '--file': 'messageFile',
        '--since': 'since' }[flag];
      options.args[key] = value(index, flag);
      index += 1;
    }
  } catch (error) { return { error: error.message }; }
  return options;
}

/** @param {string[]} argv @param {{root?: string, lab?: ReturnType<typeof createLab>, write?: (text: string) => void}} [context] */
export function main(argv, { root = ROOT, lab = createLab({ root }), write = text => process.stdout.write(text) } = {}) {
  const options = parse(argv);
  if (options.error) { process.stderr.write(`lab: ${options.error}\n${USAGE}\n`); return 2; }
  const envelope = lab[options.verb](options.args);
  if (options.json) write(`${JSON.stringify(envelope, null, 2)}\n`);
  else if (envelope.refused) write(`REFUSED ${envelope.rule}: ${envelope.because}\n  -> ${envelope.remedy}\n`);
  else write(`${RENDER[options.verb](envelope.claim).join('\n')}\n`);
  if (envelope.refused) return 1;
  if (options.verb === 'commit' && !isUnknown(envelope.claim.hook) && envelope.claim.hook.verdict === 'REFUSE') return 1;
  return 0;
}

const invoked = process.argv[1] && realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url));
if (invoked) process.exitCode = main(process.argv.slice(2));
