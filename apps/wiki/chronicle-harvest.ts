#!/usr/bin/env node
/** Propose chronicle entries from new commits and dated source comments. */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(join(fileURLToPath(new URL('.', import.meta.url)), '../..'));
const WORDS = ['refut', 'retract', 'wrong', 'fail', 'measur', 'calibrat', 'source', 'decomp', 'device', 'clear', 'victory', 'prove', 'evidence', 'gate', 'stale', 'correct', 'drift', 'desync', 'latency', 'timing', 'night', 'strategy', 'route', 'model', 'record', 'truth', 'negative', 'blocker', 'accept', 'reject', 'unsafe', 'unverified'];
const DATE = /\b20\d{2}-\d{2}-\d{2}\b/;

function arg(name) {
  const index = process.argv.indexOf(name);
  return index < 0 ? null : process.argv[index + 1];
}

function usage() {
  console.error('Usage: node apps/wiki/chronicle-harvest.ts --since COMMIT [--until COMMIT] [--json]');
}

function countWords(text) {
  return WORDS.reduce((count, word) => count + (text.match(new RegExp(word, 'ig'))?.length ?? 0), 0);
}

function titleCaseGuess(subject) {
  return subject.replace(/^\s+/, '').replace(/\s+/g, ' ').trim().replace(/[.!?]+$/, '');
}

function classify(text) {
  if (/retract|withdraw|wrong|correction/i.test(text)) return 'retraction';
  if (/refut|rule out|reject|blocker|unsafe|unverified|negative|fail/i.test(text)) return 'refutation';
  if (/clear|victory|prove|milestone|ship|first/i.test(text)) return 'milestone';
  if (/source|measure|calibrat|record|catalog/i.test(text)) return 'fact';
  if (/trivia|history/i.test(text)) return 'trivia';
  return 'lesson';
}

function label(text) {
  if (/decomp|source|sourced|event sheet/i.test(text)) return 'SOURCED';
  if (/calibrat|measure|timing|latency|gate/i.test(text)) return 'CALIBRATED';
  if (/device|phone|victory|clear|hid|six.?am/i.test(text)) return 'DEVICE_MEASURED';
  if (/model|simulat/i.test(text)) return 'MODEL';
  return 'INFERRED';
}

function tags(text) {
  const rules = [['source', /source|decomp|event sheet/i], ['device', /device|phone|hid|android/i], ['strategy', /strategy|route|minus|vent camp|cam/i], ['timing', /timing|latency|delay|clock|phase/i], ['evidence', /evidence|grade|gate|proof|clear|victory/i], ['model', /model|simulat|seed/i], ['tooling', /tool|catalog|index|generator/i], ['retraction', /retract|wrong|correction|refut/i]];
  return rules.filter(([, pattern]) => (pattern as any).test(text)).map(([tag]) => tag);
}

function measured(text) {
  if (!/[0-9]/.test(text) || !/(measure|calibrat|clear|victory|refut|prove|surviv|latency|delay|timing|gate|count|price)/i.test(text)) return null;
  const values = [...text.matchAll(/\b\d+(?:\.\d+)?(?:\s*(?:ms|s|fps|Hz|frames?|%|\/\d+|MB|GB))?\b/gi)].map((match) => match[0]).slice(0, 4);
  return values.length ? values.join(' · ') : null;
}

function makeEntry({ sha, date, subject, body, source }) {
  const text = `${subject}\n${body}`;
  const suffix = sha.startsWith('comment-') ? sha : sha.slice(0, 7);
  return {
    id: `${date}-${suffix}`,
    date,
    kind: classify(text),
    title: titleCaseGuess(subject) || `Finding from ${date}`,
    body: body.trim() || subject.trim(),
    measured: measured(text),
    label: label(text),
    rung: null,
    plan: null,
    night: null,
    route: null,
    tags: tags(text),
    sources: [source],
    status: 'standing',
    supersededBy: null,
  };
}

function gitRows(since, until) {
  const range = `${since}..${until || 'HEAD'}`;
  const raw = execFileSync('git', ['log', '--reverse', '--format=%H%x00%ad%x00%s%x00%b%x01', '--date=short', range], { cwd: ROOT, encoding: 'utf8' });
  return raw.split('\x01').filter(Boolean).map((row) => {
    const fields = row.split('\x00');
    return { sha: (fields[0] ?? '').trim(), date: (fields[1] ?? '').trim(), subject: (fields[2] ?? '').trim(), body: fields.slice(3).join('\x00').trim() };
  }).filter((row) => row.sha && row.date);
}

function trackedFiles() {
  return execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);
}

function datedComments() {
  const candidates = [];
  let commentIndex = 0;
  for (const file of trackedFiles()) {
    if (!/\.(?:md|txt|js|mjs|ts|py|sh|c|S|json)$/.test(file)) continue;
    let lines;
    try { lines = readFileSync(join(ROOT, file), 'utf8').split('\n'); } catch { continue; }
    lines.forEach((line, index) => {
      const match = line.match(DATE);
      if (!match) return;
      const text = line.replace(/^\s*(?:\/\/|#|<!--|\/\*|\*|-->)\s?/, '').trim();
      if (text.length < 24 || !/^(?:\/\/|#|<!--|\/\*|\*|-->|\s*[-*])/.test(line)) return;
      candidates.push(makeEntry({ date: match[0], subject: text.slice(0, 100), body: text, source: `${file}:${index + 1}`, sha: `comment-${++commentIndex}` }));
    });
  }
  return candidates;
}

const since = arg('--since');
if (process.argv.includes('--help') || process.argv.includes('-h') || !since) {
  usage();
  process.exitCode = since ? 0 : 2;
} else {
  try {
    const commits = gitRows(since, arg('--until'));
    const candidates = commits.filter((row) => countWords(`${row.subject}\n${row.body}`) >= 2)
      .map((row) => makeEntry({ ...row, source: `commit:${row.sha}` }));
    candidates.push(...datedComments());
    candidates.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
    if (process.argv.includes('--json')) console.log(JSON.stringify(candidates, null, 2));
    else {
      for (const candidate of candidates) console.log(JSON.stringify(candidate));
      console.error(`chronicle-harvest: ${candidates.length} candidates from ${commits.length} commits and dated comments`);
    }
  } catch (error) {
    console.error(`chronicle-harvest: ${error.message}`);
    process.exitCode = 1;
  }
}
