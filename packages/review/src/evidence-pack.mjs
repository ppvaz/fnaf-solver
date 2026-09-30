// Run packs: a live night's text evidence, committable, with its media named by hash.
//
// The Plan 12 gate reads a campaign directory, and campaign directories live under gitignored
// artifacts/ on whichever machine played the night. So a win could only be promoted on that
// machine, and only while its directory survived: by 2026-09-25 the ten k3 Night 7 cohort
// campaigns and their videos were gone from the machine that played them, while the committed
// cohort record still cited them. A campaign directory is four text files (~135 KB) beside ~85
// observer PNGs (~87 MB), and the gate reads only the text.
//
// A pack is that text under docs/evidence/runs/<id>/, plus night-run.sh's derived facts for the
// run. Every file it does not copy -- video, observer and death frames, raw logcat, the campaign
// log -- is listed as withheld, by sha256 and size, so custody covers the whole run. Pixel payloads inside the text -- the executor logs the 20x9 grid
// beside each mask read as `maskCells` -- are replaced by their hash. Machine paths become
// repository-relative. The publishing boundary (derived facts yes; frames, recordings and game
// audio never) is enforced by refusal: a pack that still holds a long numeric array, a long
// hex or base64 run, or a NUL byte is not written, so a new pixel field fails loudly here and
// is added to PIXEL_KEYS in the diff that decides it.
//
// Packing is deterministic -- no timestamps, sorted entries -- so re-packing an unchanged run is
// a no-op and the pack's sha256 can carry a Plan 12 attestation: a person's, or since 2026-09-27
// an agent's under Pedro's delegation (evidence-promotion.mjs writes it after re-deriving
// every other check from the pack).
//
// A campaign directory that is gone can still be packed from its night-run log, and the pack
// says so. night-run.sh tees the campaign CLI's stdout and stderr into run/campaign.log; the CLI
// prints the retained result with the same JSON.stringify(retained, null, 2) it writes to
// result.json, and writes every event row to stderr as it appends it to events.jsonl
// (apps/desktop/src/device-cli.js and packages/play/src/campaign/modern-campaign-ports.ts, which were
// apps/device/src/ until ADR 0002's Play move; unchanged from 2026-09-12 on). Checked on
// the campaigns that still have both (RECOVERY_RECORD): every events.jsonl and every printed
// result.json comes back byte-identical. What the log never carried stays lost and is named as
// lost: request.json, observations.jsonl, the observer frames, and the result of a campaign
// that threw, which the CLI writes but does not print. Pedro, 2026-09-27: Plan 12 accepts a
// recovered pack fully, the same as one whose directory survived, so its manifest is complete
// when its result and events came back; `custody.lost` stays in the pack and in every reading.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { canonicalJson, stableHash } from '@sixam/kernel/contracts';
import { BINDINGS_DIR } from '@sixam/kernel';
import { isCampaignResult, campaignEntry, campaignPromotionChecks } from './evidence-campaign.mjs';

export const RUN_PACK_SCHEMA = 'run-pack-v1';
/**
 * The `packer` every pack records. It is a stored value, not this file's path: the pack digest an
 * attestation binds covers it, so it stays the path the module had when the first packs were
 * written (moved to packages/review on 2026-09-29; tools/evidence-pack.mjs re-exports this module).
 */
const PACKER = 'tools/evidence-pack.mjs';
/** v2 names its author and lists what was verified; v1 (a person's name, nothing listed) is still read. */
export const ATTESTATION_SCHEMA = 'plan12-attestation-v2';
export const ATTESTATION_SCHEMA_V1 = 'plan12-attestation-v1';
export const ATTESTATION_FILE = 'plan12-attestation.json';
/** Pedro, 2026-09-27: agents may write Plan 12 attestations. Nothing else is delegated. */
export const AGENT_DELEGATION = 'pedro-2026-09-27';
/** The checks a v2 attestation must list as verified: every promotion check but itself. */
export const ATTESTED_CHECKS = Object.freeze(['offlineEvidence', 'terminalPass', 'manifestComplete', 'winnerCommitted']);
export const PACKS_DIR = 'docs/evidence/runs';
export const RECOVERY_RECORD = 'docs/evidence/custody-recovery-20260925.json';

// What the campaign itself writes; the gate's manifestComplete needs the first three.
const CAMPAIGN_TEXT = ['result.json', 'events.jsonl', 'request.json', 'observations.jsonl'];
const CAMPAIGN_MANIFEST = CAMPAIGN_TEXT.slice(0, 3);
// night-run.sh's derived facts. campaign.log is left out on purpose: it echoes events.jsonl,
// pixel arrays included.
const RUN_TEXT = new RegExp('^(verdict\\.txt|post-run-title\\.txt|video\\.sha256|campaign\\.exit|teardown\\.txt|'
  + 'cycle-ledger\\.txt|bt-audio-(link|start|stop)\\.txt|[\\w-]+\\.err|(run-report|phase|phase-native|cycle-ledger|prediction|timeline|tickphase|'
  + 'audio-census|office-seed-bracket|teach-panel|bt-audio|run|probe|audit-live)(-attempt\\d+)?\\.json|'
  + '(phase|grade)(-attempt\\d+)?\\.log)$');
const IMAGE = /\.(png|jpe?g|webp|gif)$/i;

/** Keys whose value is pixels. `maskCells` is the 20x9 point grid (180 packed-RGB cells). */
export const PIXEL_KEYS = new Set(['maskCells']);

// Refusal thresholds. A sha256 is 64 hex characters and the longest legitimate numeric array
// in a retained run is well under 64 entries; the 20x9 grid is 180.
const NUMERIC_ARRAY = /\[\s*(?:-?\d+(?:\.\d+)?(?:e[+-]?\d+)?\s*,\s*){63,}-?\d/i;
const HEX_RUN = /[0-9a-f]{128,}/i;
const BASE64_RUN = /[A-Za-z0-9+/]{200,}={0,2}/;

const sha256 = data => createHash('sha256').update(data).digest('hex');

/**
 * Throw unless `text` is free of pixel-shaped payloads.
 * @param {string} name file name, for the message
 * @param {string} text
 */
export function refuseFrames(name, text) {
  if (text.includes('\0')) throw new Error(`${name}: binary content is never packed`);
  if (NUMERIC_ARRAY.test(text))
    throw new Error(`${name}: a numeric array of 64+ entries looks like pixels; redact its key (PIXEL_KEYS) or drop the file`);
  if (HEX_RUN.test(text)) throw new Error(`${name}: a 128+ character hex run looks like encoded pixels`);
  if (BASE64_RUN.test(text)) throw new Error(`${name}: a 200+ character base64 run looks like encoded media`);
}

/** Replace this machine's repository root and home directory with portable prefixes. */
function scrubPaths(text, { root, home }) {
  let paths = 0;
  const swap = (from, to) => {
    if (!from) return;
    const parts = text.split(from);
    paths += parts.length - 1;
    text = parts.join(to);
  };
  // The root first: it usually sits under the home directory.
  swap(`${root}/`, '');
  swap(root, '.');
  if (home) { swap(`${home}/`, '~/'); swap(home, '~'); }
  return { text, paths };
}

function redact(value, counts) {
  if (Array.isArray(value)) return value.map(item => redact(item, counts));
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => {
    if (PIXEL_KEYS.has(key) && Array.isArray(item)) {
      counts.pixelArrays += 1;
      return [key, { redacted: 'pixels', cells: item.length, sha256: sha256(JSON.stringify(item)) }];
    }
    return [key, redact(item, counts)];
  }));
}

/**
 * One text file, made portable and frame-free.
 * @param {string} name name inside the pack
 * @param {Buffer} source original bytes
 * @param {{root: string, home?: string, frames?: Map<string, {sha256: string, bytes: number}>}} context
 */
function packText(name, source, context) {
  const scrubbed = scrubPaths(source.toString('utf8'), context);
  const counts = { paths: scrubbed.paths, pixelArrays: 0, frameRefs: 0 };
  let text = scrubbed.text;
  const parse = (json, where) => {
    try { return JSON.parse(json); } catch (error) { throw new Error(`${name}${where}: ${error.message}`); }
  };
  const rewrite = value => {
    const before = counts.pixelArrays + counts.frameRefs;
    const next = redact(value, counts);
    if (context.frames && typeof next?.frame === 'string' && context.frames.has(next.frame)) {
      next.frame = { file: next.frame, ...context.frames.get(next.frame) };
      counts.frameRefs += 1;
    }
    return { next, changed: counts.pixelArrays + counts.frameRefs !== before };
  };
  if (name.endsWith('.jsonl')) {
    text = text.split('\n').map((line, index) => {
      if (!line.trim()) return line;
      const { next, changed } = rewrite(parse(line, ` line ${index + 1}`));
      return changed ? JSON.stringify(next) : line;
    }).join('\n');
  } else if (name.endsWith('.json')) {
    const { next, changed } = rewrite(parse(text, ''));
    if (changed) text = `${JSON.stringify(next, null, 2)}\n`;
  }
  refuseFrames(name, text);
  return {
    entry: { name, sha256: sha256(text), bytes: Buffer.byteLength(text),
      source: { sha256: sha256(source), bytes: source.length }, redactions: counts },
    text,
  };
}

const withheldKind = name => IMAGE.test(name) ? 'frame' : /\.(mp4|mkv)$/i.test(name) ? 'video'
  : /\.(raw|wav|pcm)$/i.test(name) ? 'audio' : /\.(pftrace|perfetto-trace)$/i.test(name) ? 'trace'
  : /\.logcat$/i.test(name) ? 'log' : 'other';
const withheldEntry = (name, file) => {
  const data = readFileSync(file);
  return { name, sha256: sha256(data), bytes: data.length, kind: withheldKind(name) };
};

/** @param {string} file */
const readJson = file => JSON.parse(readFileSync(file, 'utf8'));

/**
 * One campaign's result.json and events.jsonl, recovered from the night-run log that captured
 * the CLI's output. A log may hold several attempts' campaigns; only the rows between this
 * campaign's `evidence.started` and the next one are its own. A campaign is matched by its
 * directory name, a timestamp: verdicts before 2026-09-13 record the directory relative to the
 * repository while the log records it absolute. Null when the log never started this campaign;
 * `result` is null when no result was printed for it.
 * @param {string} log run/campaign.log
 * @param {string} campaignDir the evidence directory as the campaign recorded it
 * @returns {{result: string | null, events: string} | null}
 */
export function recoverFromRunLog(log, campaignDir) {
  const lines = log.split('\n');
  const events = [];
  let inside = false;
  let found = false;
  let result = null;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.startsWith('{"at":')) {
      let row;
      try { row = JSON.parse(line); } catch { continue; }
      if (row?.type === 'evidence.started') {
        inside = typeof row.evidenceDirectory === 'string' && basename(row.evidenceDirectory) === basename(campaignDir);
        found ||= inside;
      }
      if (inside && typeof row?.type === 'string') events.push(line);
      continue;
    }
    // The retained result is a top-level object printed with two-space indentation, so its
    // own closing brace is the first line that is exactly `}`.
    if (!inside || line !== '{') continue;
    let end = index + 1;
    while (end < lines.length && lines[end] !== '}') end += 1;
    if (end === lines.length) break;
    const text = lines.slice(index, end + 1).join('\n');
    try {
      const value = JSON.parse(text);
      if (value?.mode === 'live' && Object.hasOwn(value, 'result')) result = text;
    } catch { /* not a printed object after all */ }
    index = end;
  }
  if (!found) return null;
  return { result, events: events.length ? `${events.join('\n')}\n` : '' };
}

/**
 * Does recovery reproduce the campaigns that are still on disk? For every night-run directory
 * whose log and campaign directory both survive, recover the campaign from the log and compare
 * it with the files the campaign wrote. This is the check a recovered pack's custody cites.
 * @param {string} root repository root
 */
export function recoveryCheck(root) {
  const runsDir = join(root, 'artifacts', 'runs');
  const campaigns = [];
  for (const run of existsSync(runsDir) ? readdirSync(runsDir).sort() : []) {
    const runDir = join(runsDir, run);
    if (!existsSync(join(runDir, 'campaign.log')) || !existsSync(join(runDir, 'verdict.txt'))) continue;
    const verdict = readFileSync(join(runDir, 'verdict.txt'), 'utf8');
    const named = [...verdict.matchAll(/^--- attempt \d+ of \d+: (\S+) ---$/gm)].map(match => match[1]);
    const paths = named.length ? named : [verdict.match(/^campaign dir (\S+)$/m)?.[1]].filter(Boolean);
    const log = readFileSync(join(runDir, 'campaign.log'), 'utf8');
    for (const path of paths) {
      const dir = join(root, 'artifacts', basename(path));
      if (!existsSync(join(dir, 'result.json')) || !existsSync(join(dir, 'events.jsonl'))) continue;
      const got = recoverFromRunLog(log, path);
      const result = readFileSync(join(dir, 'result.json'), 'utf8');
      const events = readFileSync(join(dir, 'events.jsonl'), 'utf8');
      campaigns.push({ run, campaign: basename(path),
        events: { original: sha256(events), recovered: got ? sha256(got.events) : null, identical: got?.events === events },
        result: { original: sha256(result), originalStatus: JSON.parse(result).status ?? null,
          recovered: got?.result ? sha256(got.result) : null, printed: Boolean(got?.result), identical: got?.result === result } });
    }
  }
  const printed = campaigns.filter(item => item.result.printed);
  return {
    schema: 'custody-recovery-check-v1', tool: 'npm run evidence -- recovery-check',
    method: 'recoverFromRunLog (tools/evidence-pack.mjs): events.jsonl = the event rows between the campaign\'s evidence.started and the next; result.json = the retained object the CLI printed',
    campaigns,
    summary: { campaigns: campaigns.length, eventsIdentical: campaigns.filter(item => item.events.identical).length,
      resultsPrinted: printed.length, resultsIdentical: printed.filter(item => item.result.identical).length,
      resultsNotPrinted: campaigns.filter(item => !item.result.printed).map(item => `${item.campaign} (${item.result.originalStatus})`) },
  };
}

/**
 * The run directory night-run.sh wrote for a campaign, and which attempt that campaign was.
 * @param {string} root repository root
 * @param {string} campaign campaign directory name
 * @returns {{runDir: string, attempt: number} | null}
 */
export function findRunDir(root, campaign) {
  const runs = join(root, 'artifacts', 'runs');
  if (!existsSync(runs)) return null;
  for (const label of readdirSync(runs).sort()) {
    const verdict = join(runs, label, 'verdict.txt');
    if (!existsSync(verdict)) {
      const log = join(runs, label, 'campaign.log');
      if (!existsSync(log)) continue;
      const starts = readFileSync(log, 'utf8').split('\n').flatMap(line => {
        try {
          const row = JSON.parse(line);
          return row?.type === 'evidence.started' && typeof row.evidenceDirectory === 'string'
            ? [basename(row.evidenceDirectory)] : [];
        } catch { return []; }
      });
      const attempt = starts.indexOf(campaign);
      if (attempt >= 0) return { runDir: join(runs, label), attempt: attempt + 1 };
      continue;
    }
    const text = readFileSync(verdict, 'utf8');
    const numbered = text.match(new RegExp(`^--- attempt (\\d+) of \\d+: \\S*/${campaign.replace(/\./g, '\\.')}\\s`, 'm'));
    if (numbered) return { runDir: join(runs, label), attempt: Number(numbered[1]) };
    if (new RegExp(`^campaign dir \\S*/${campaign.replace(/\./g, '\\.')}$`, 'm').test(text))
      return { runDir: join(runs, label), attempt: 1 };
  }
  return null;
}

/**
 * Every campaign directory a pack request names: a campaign directory itself, or a night-run
 * label whose verdict lists one campaign per attempt.
 * @param {string} root
 * @param {string} id
 * @returns {{campaignDir: string, runDir: string | null, packId: string}[]}
 */
export function resolvePackTargets(root, id) {
  if (!/^[\w.-]+$/.test(id)) throw new Error('a safe RUN_ID is required');
  const direct = join(root, 'artifacts', id);
  if (existsSync(join(direct, 'result.json')) || incompleteCampaign(direct)) {
    const run = findRunDir(root, id);
    const label = run ? basename(run.runDir) : null;
    return [{ campaignDir: direct, runDir: run?.runDir ?? null,
      packId: !label ? id : run.attempt > 1 ? `${label}-attempt${run.attempt}` : label }];
  }
  const runDir = join(root, 'artifacts', 'runs', id);
  if (!existsSync(join(runDir, 'verdict.txt')) && existsSync(join(runDir, 'events.jsonl')) &&
      (existsSync(join(runDir, 'probe.json')) || existsSync(join(runDir, 'run.json'))))
    return [{ fnaf1RunDir: runDir, packId: id }];
  if (!existsSync(join(runDir, 'verdict.txt'))) throw new Error(`no campaign or night-run directory named ${id}`);
  const text = readFileSync(join(runDir, 'verdict.txt'), 'utf8');
  const named = [...text.matchAll(/^--- attempt (\d+) of \d+: (\S+)$/gm)].map(m => [Number(m[1]), m[2]]);
  const first = text.match(/^campaign dir (\S+)$/m)?.[1];
  const attempts = named.length ? named : first && first !== 'NONE' ? [[1, first]] : [];
  if (!attempts.length) throw new Error(`${id} produced no campaign directory; there is nothing the gate could read`);
  return attempts.map(([attempt, path]) => {
    const campaignDir = join(root, 'artifacts', basename(path));
    const packId = attempt > 1 ? `${id}-attempt${attempt}` : id;
    if (existsSync(join(campaignDir, 'result.json')) || incompleteCampaign(campaignDir)) return { campaignDir, runDir, packId };
    // Gone entirely, not merely incomplete: then the night-run log is the custody left.
    const log = join(runDir, 'campaign.log');
    if (!existsSync(campaignDir) && existsSync(log) && recoverFromRunLog(readFileSync(log, 'utf8'), path))
      return { campaignDir: path, runDir, packId, recoverFromLog: true };
    throw new Error(`${id}: campaign ${basename(path)} is not on this machine; pack it where it was played`);
  });
}

// A signal can end the CLI before it writes result.json. Keep its native
// request/events/observations rather than pretending they were lost with a
// deleted campaign, or inventing a terminal. Both identity files are required.
function incompleteCampaign(dir) {
  return !existsSync(join(dir, 'result.json'))
    && existsSync(join(dir, 'events.jsonl')) && existsSync(join(dir, 'request.json'));
}

/**
 * A FNaF 1 runner's night (tools/device/fnaf1-*-run.mjs): its `probe.json` or `run.json` record
 * and its `events.jsonl`, whose captures already live outside the repository and are cited
 * there by sha256, and the `replay.json` fnaf1-winner.mjs leaves beside a winner's replay.
 * There is no campaign result, so the outcome is the runner's own `night-ended` event and
 * record status; the Plan 12 gate does not read these packs.
 * @param {{root: string, home?: string, fnaf1RunDir: string, packId: string}} options
 */
export function buildFnaf1Pack({ root, home = '', fnaf1RunDir, packId }) {
  const files = [];
  const texts = new Map();
  const withheld = [];
  for (const name of readdirSync(fnaf1RunDir).sort()) {
    const file = join(fnaf1RunDir, name);
    if (!statSync(file).isFile()) continue;
    if (['probe.json', 'run.json', 'events.jsonl', 'replay.json'].includes(name) || /\.(txt|err)$/.test(name)) {
      const { entry, text } = packText(name, readFileSync(file), { root, home });
      files.push(entry);
      texts.set(name, text);
    } else withheld.push(withheldEntry(name, file));
  }
  const record = texts.has('probe.json') ? JSON.parse(texts.get('probe.json'))
    : texts.has('run.json') ? JSON.parse(texts.get('run.json')) : {};
  const ended = (texts.get('events.jsonl') ?? '').split('\n').filter(Boolean).map(line => JSON.parse(line))
    .find(event => event.type === 'night-ended') ?? null;
  const pack = {
    schema: RUN_PACK_SCHEMA, version: 1, kind: 'fnaf1-run', id: packId, campaign: null, run: basename(fnaf1RunDir),
    outcome: ended ? { ended: ended.ended, atNightMs: ended.atNightMs } : null,
    status: record.status ?? null, claimLevel: String(record.claimLevel ?? '').split(' ')[0] || null,
    target: record.target ?? null, titleAfter: record.titleAfter ?? null,
    files: files.sort((a, b) => a.name.localeCompare(b.name)), withheld: withheld.sort((a, b) => a.name.localeCompare(b.name)),
    packer: PACKER,
  };
  return { pack, texts };
}

/**
 * Build a pack in memory. Nothing is written.
 * @param {{root: string, home?: string, campaignDir: string, runDir?: string | null, packId: string}} options
 */
export function buildPack({ root, home = '', campaignDir, runDir = null, packId, recoverFromLog = false, timeline = null }) {
  let recovered = null;
  if (recoverFromLog) {
    if (!runDir) throw new Error('recovering a campaign needs the night-run directory whose log captured it');
    const log = readFileSync(join(runDir, 'campaign.log'));
    recovered = recoverFromRunLog(log.toString('utf8'), campaignDir);
    if (!recovered) throw new Error(`${basename(runDir)}/campaign.log never started ${basename(campaignDir)}`);
    recovered.logSha256 = sha256(log);
  }
  const incomplete = !recovered && incompleteCampaign(campaignDir);
  const wrapper = !recovered ? (incomplete ? null : readJson(join(campaignDir, 'result.json')))
    : recovered.result === null ? null : JSON.parse(recovered.result);
  if (wrapper !== null && !isCampaignResult(wrapper)) throw new Error(`${basename(campaignDir)} is not a device campaign`);
  // A result the CLI never printed is not reconstructed: the pack says it is lost.
  const entry = wrapper ? campaignEntry(packId, wrapper) : { outcome: 'RESULT_LOST', claimLevel: 'UNKNOWN', nights: null };
  const files = [];
  const texts = new Map();
  const withheld = [];
  const frames = new Map();
  const campaignNames = recovered ? [] : readdirSync(campaignDir).sort();
  for (const name of campaignNames) {
    const file = join(campaignDir, name);
    if (CAMPAIGN_TEXT.includes(name) || !statSync(file).isFile()) continue;
    const item = withheldEntry(name, file);
    withheld.push(item);
    if (item.kind === 'frame') frames.set(name, { sha256: item.sha256, bytes: item.bytes });
  }
  const context = { root, home, frames };
  const sources = recovered
    ? [['events.jsonl', recovered.events], ['result.json', recovered.result]]
      .filter(([, text]) => text !== null).map(([name, text]) => [name, Buffer.from(text)])
    : CAMPAIGN_TEXT.filter(item => campaignNames.includes(item)).map(name => [name, readFileSync(join(campaignDir, name))]);
  for (const [name, source] of sources) {
    const { entry: fileEntry, text } = packText(name, source, context);
    files.push(fileEntry);
    texts.set(name, text);
  }
  let bundle = null;
  if (runDir) {
    const walk = (dir, prefix) => {
      for (const name of readdirSync(dir).sort()) {
        const file = join(dir, name);
        const inner = `${prefix}${name}`;
        if (statSync(file).isDirectory()) walk(file, `${inner}/`);
        else if (prefix === 'run/' && RUN_TEXT.test(name)) {
          const { entry: fileEntry, text } = packText(inner, readFileSync(file), { root, home });
          files.push(fileEntry);
          texts.set(inner, text);
        } else withheld.push(withheldEntry(inner, file));
      }
    };
    walk(runDir, 'run/');
    const video = existsSync(join(runDir, 'video.sha256'))
      ? readFileSync(join(runDir, 'video.sha256'), 'utf8').match(/^([0-9a-f]{64})\s+(\S+)/m) : null;
    if (video) {
      const local = join(root, video[2]);
      withheld.push({ name: basename(video[2]), sha256: video[1],
        bytes: existsSync(local) ? statSync(local).size : null, kind: 'video' });
    }
    if (timeline) {
      // A video grade kept outside the run directory (a cohort's forensics), accepted only when
      // it names this run's own recording.
      const source = readFileSync(timeline);
      const graded = JSON.parse(source.toString('utf8')).video;
      if (!video || graded !== video[2]) throw new Error(`${timeline} grades ${graded}, not this run's ${video?.[2] ?? 'recording'}`);
      if (texts.has('run/timeline.json')) throw new Error(`${basename(runDir)} already carries its own timeline.json`);
      const { entry: fileEntry, text } = packText('run/timeline.json', source, { root, home });
      files.push(fileEntry);
      texts.set('run/timeline.json', text);
    }
    const bundlePath = existsSync(join(runDir, 'verdict.txt'))
      ? readFileSync(join(runDir, 'verdict.txt'), 'utf8').match(/^bundle\s+(\S+)$/m)?.[1] : null;
    if (bundlePath) {
      const manifest = join(bundlePath.startsWith('/') ? '' : root, bundlePath, 'manifest.json');
      bundle = { path: scrubPaths(bundlePath, { root, home }).text,
        winnerHash: existsSync(manifest) ? readJson(manifest).winnerHash ?? null : null };
    }
  }
  files.sort((a, b) => a.name.localeCompare(b.name));
  withheld.sort((a, b) => a.name.localeCompare(b.name));
  const pack = {
    schema: RUN_PACK_SCHEMA, version: 1, id: packId, campaign: basename(campaignDir),
    run: runDir ? basename(runDir) : null, outcome: entry.outcome, claimLevel: entry.claimLevel,
    nights: entry.nights, bundle, files, withheld, packer: PACKER,
    ...(recovered ? { custody: {
      kind: 'recovered-from-run-log', source: 'run/campaign.log', sourceSha256: recovered.logSha256,
      recovered: sources.map(([name]) => name).sort(),
      lost: ['observations.jsonl', 'observer frames', 'request.json', ...(wrapper ? [] : ['result.json'])].sort(),
      validation: RECOVERY_RECORD,
    } } : {}),
    ...(incomplete ? { custody: {
      kind: 'incomplete-campaign', retained: sources.map(([name]) => name).sort(),
      lost: ['result.json'], reason: 'Native campaign files survive, but no result.json exists; no terminal is inferred.',
    } } : {}),
    ...(timeline ? { graded: { 'run/timeline.json': scrubPaths(timeline, { root, home }).text } } : {}),
  };
  return { pack, texts };
}

/** The sha256 a Plan 12 attestation binds to. @param {object} pack */
export const packDigest = pack => sha256(canonicalJson(pack));

/**
 * Write a built pack. An identical pack already on disk is left alone; a different one is
 * refused unless `replace`, because evidence is not edited in place.
 * @returns {'WRITTEN' | 'UNCHANGED' | 'REPLACED'}
 */
export function writePack(dir, { pack, texts }, { replace = false } = {}) {
  const existing = join(dir, 'pack.json');
  let status = 'WRITTEN';
  if (existsSync(existing)) {
    if (packDigest(readJson(existing)) === packDigest(pack)) return 'UNCHANGED';
    if (!replace) throw new Error(`${dir} holds a different pack; pass --replace to supersede it`);
    status = 'REPLACED';
  }
  for (const [name, text] of texts) {
    mkdirSync(join(dir, name, '..'), { recursive: true });
    writeFileSync(join(dir, name), text);
  }
  writeFileSync(existing, `${JSON.stringify(pack, null, 2)}\n`);
  return status;
}

/**
 * Read and verify a pack: every file must match its recorded sha256 and size and still be
 * frame-free. The attestation, if one has been written, is returned alongside, unjudged.
 * @param {string} dir
 */
export function readPack(dir) {
  const pack = readJson(join(dir, 'pack.json'));
  if (pack.schema !== RUN_PACK_SCHEMA || pack.version !== 1) throw new Error('not a run-pack-v1');
  for (const file of pack.files) {
    if (file.name.startsWith('/') || file.name.split('/').includes('..')) throw new Error(`unsafe pack path ${file.name}`);
    const data = readFileSync(join(dir, file.name));
    if (sha256(data) !== file.sha256 || data.length !== file.bytes) throw new Error(`pack integrity mismatch: ${file.name}`);
    refuseFrames(file.name, data.toString('utf8'));
  }
  if (pack.kind === 'fnaf1-run')
    return { pack, digest: packDigest(pack), wrapper: null, files: pack.files.map(file => file.name), attestation: null };
  const lost = pack.custody?.lost?.includes('result.json');
  if (!lost && !pack.files.some(file => file.name === 'result.json')) throw new Error('pack has no result.json');
  const wrapper = lost ? null : readJson(join(dir, 'result.json'));
  if (wrapper !== null && !isCampaignResult(wrapper)) throw new Error('pack result.json is not a device campaign');
  const attestationFile = join(dir, ATTESTATION_FILE);
  return { pack, digest: packDigest(pack), wrapper, files: pack.files.map(file => file.name),
    attestation: existsSync(attestationFile) ? readJson(attestationFile) : null };
}

/**
 * The index entry for a campaign pack: the campaign's own reading when its result survived,
 * and the pack's RESULT_LOST record when it did not.
 * @param {string} id
 * @param {{pack: any, wrapper: any}} packed readPack's result
 */
export function packEntry(id, { pack, wrapper }) {
  return wrapper ? campaignEntry(id, wrapper)
    : { id, kind: 'device-campaign', outcome: pack.outcome, claimLevel: pack.claimLevel, nights: pack.nights, attempts: [] };
}

/** The generated register of each committed winner's compiled winnerHash (tools/generate-catalog.js). */
export const WINNER_HASHES = 'docs/architecture/generated/winner-hashes.json';

/**
 * Every committed winner, repository-relative and sorted by file name: `<BINDINGS_DIR>/<game>/*-winner.json`.
 * @param {string} root
 * @returns {string[]}
 */
export function winnerFiles(root) {
  const games = existsSync(join(root, BINDINGS_DIR)) ? readdirSync(join(root, BINDINGS_DIR), { withFileTypes: true })
    .filter(entry => entry.isDirectory()).map(entry => entry.name) : [];
  return games.flatMap(game => readdirSync(join(root, BINDINGS_DIR, game)).filter(file => file.endsWith('-winner.json'))
    .map(file => `${BINDINGS_DIR}/${game}/${file}`)).sort((a, b) => basename(a).localeCompare(basename(b)));
}

/**
 * Committed winners by the hash a bundle compiled from them records as `winnerHash`. That is
 * not always the file's own stableHash: compileBundle normalises a winner (it stamps the gate
 * with the replay hash), so night1-minimal, night1-minus7 and night6 compile to a different
 * hash than the file has. Both are mapped, and a winner that does not compile keeps only its
 * file hash. Compiling is Propose's, and Review never imports Propose (ADR 0002), so the
 * compiled hashes come from the generated register; a winner file whose bytes differ from the
 * register's sha256, or that the register does not list, is refused as a stale register.
 * @param {string} root
 * @returns {Map<string, string>}
 */
export function trackedWinners(root) {
  const register = new Map(readJson(join(root, WINNER_HASHES)).winners.map(row => [basename(row.file), row]));
  const winners = new Map();
  for (const file of winnerFiles(root)) {
    const name = basename(file);
    const bytes = readFileSync(join(root, file));
    const row = register.get(name);
    if (!row || row.sha256 !== sha256(bytes))
      throw new Error(`${WINNER_HASHES} is stale for ${file}: run \`npm run catalog\``);
    winners.set(stableHash(JSON.parse(bytes.toString('utf8'))), name);
    if (row.compiledWinnerHash) winners.set(row.compiledWinnerHash, name);
  }
  return winners;
}

/**
 * Is the pack's custody complete enough to promote? A pack whose campaign directory survived
 * needs the campaign's result, events and request. A pack recovered from its night-run log
 * (Pedro, 2026-09-27: accepted fully) needs its result and events recovered, the log it cites
 * named among the withheld files by the same sha256, the recovery check it cites, and an
 * explicit `lost` list, which stays visible; request.json is on that list. An incomplete
 * campaign never wrote its result and is not complete.
 * @param {any} pack pack.json
 * @param {string[]} files packed file names
 */
export function packManifestComplete(pack, files) {
  const has = name => files.includes(name);
  const custody = pack.custody;
  if (!custody) return CAMPAIGN_MANIFEST.every(has);
  if (custody.kind !== 'recovered-from-run-log') return false;
  const source = (pack.withheld ?? []).find(item => item.name === custody.source);
  return has('result.json') && has('events.jsonl')
    && Array.isArray(custody.lost) && !custody.lost.includes('result.json') && !custody.lost.includes('events.jsonl')
    && custody.validation === RECOVERY_RECORD
    && typeof custody.sourceSha256 === 'string' && /^[0-9a-f]{64}$/.test(custody.sourceSha256)
    && source?.sha256 === custody.sourceSha256;
}

/** The custody a reading must show: how the pack's text reached the repository, and what is lost. */
export const packCustody = pack => ({ kind: pack.custody?.kind ?? 'original', lost: pack.custody?.lost ?? [] });

const named = value => typeof value === 'string' && value.trim().length > 0;

/** Who attested, in one line, whatever the attestation's validity. @param {any} attestation */
export function attestedBy(attestation) {
  const by = attestation?.attestedBy;
  if (attestation?.schema === ATTESTATION_SCHEMA_V1) return named(by) ? `human:${by}` : null;
  if (by?.kind === 'agent') return `agent:${by.delegation ?? 'no-delegation'}`;
  if (by?.kind === 'human') return `human:${by.name ?? 'unnamed'}`;
  return null;
}

/**
 * Does this attestation bind this pack? Schema v2: status PASS, the pack's exact sha256, an
 * author -- a person by name, or an agent under Pedro's 2026-09-27 delegation with a note naming
 * the session -- and every other promotion check listed as verified. Schema v1 (a person's
 * name, as the policy defined it until 2026-09-27) is still read.
 * @param {any} attestation parsed plan12-attestation.json, or null
 * @param {string} digest packDigest of the pack it sits beside
 * @returns {{valid: boolean, reason: string | null, by: string | null}}
 */
export function attestationStatus(attestation, digest) {
  const by = attestedBy(attestation);
  const refuse = reason => ({ valid: false, reason, by });
  if (!attestation) return refuse('no attestation');
  if (![ATTESTATION_SCHEMA, ATTESTATION_SCHEMA_V1].includes(attestation.schema)) return refuse(`unknown schema ${attestation.schema}`);
  if (attestation.status !== 'PASS') return refuse(`status ${attestation.status}, not PASS`);
  if (attestation.packSha256 !== digest) return refuse(`binds pack sha256 ${attestation.packSha256}, not this pack's ${digest}`);
  if (attestation.schema === ATTESTATION_SCHEMA_V1)
    return named(attestation.attestedBy) ? { valid: true, reason: null, by } : refuse('a v1 attestation names no person');
  const author = attestation.attestedBy;
  if (author?.kind === 'agent') {
    if (author.delegation !== AGENT_DELEGATION) return refuse(`an agent attests only under delegation ${AGENT_DELEGATION}`);
    if (!named(author.note)) return refuse('an agent attestation must name its session or agent in a note');
  } else if (author?.kind === 'human') {
    if (!named(author.name)) return refuse('a human attestation must name the person');
  } else return refuse('attestedBy names neither a person nor an agent under delegation');
  if (!Array.isArray(attestation.verified)) return refuse('lists nothing as verified');
  const missing = ATTESTED_CHECKS.filter(check => !attestation.verified.some(item => item?.check === check && item.pass === true));
  if (missing.length) return refuse(`does not list ${missing.join(', ')} as verified`);
  return { valid: true, reason: null, by };
}

/**
 * The campaign gate's four checks for a pack, with the attestation read from the pack's own
 * attestation file and bound to its digest, plus one more: the winner the bundle was compiled
 * from is committed, so the night can be re-run from a clean checkout.
 * @param {ReturnType<typeof readPack>} loaded
 * @param {Map<string, string>} winners
 */
export function packPromotionChecks({ pack, digest, wrapper, files, attestation }, winners) {
  return {
    ...(wrapper ? campaignPromotionChecks(wrapper, files)
      : { offlineEvidence: false, terminalPass: false, manifestComplete: false, plan12Attestation: false }),
    manifestComplete: wrapper !== null && packManifestComplete(pack, files),
    plan12Attestation: attestationStatus(attestation, digest).valid,
    winnerCommitted: Boolean(pack.bundle?.winnerHash && winners.has(pack.bundle.winnerHash)),
  };
}
