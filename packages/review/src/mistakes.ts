// The mistake registers, read where they are written, and matched to a task.
//
// CLAUDE.md holds three registers of numbered entries (`N. **lead** body`). A pending move may put
// them in docs/operations/MISTAKE-REGISTER.md, so the reader takes the first of
// MISTAKE_REGISTER_SOURCES that holds entries, and never keeps a copy of the text: an entry that is
// edited, added or moved is read as it now stands.
//
// What the lab adds is a tag table keyed by entry number (MISTAKE_TAGS): the areas an entry
// belongs to, and the words in a task that should bring it up. `lab start --step S<n> --artifact
// "<what>"` prints the entries whose area the step works in (STEP_AREAS) or whose words the
// artifact names, so each entry arrives when it applies rather than in a preamble. An entry with no
// tag row is always printed, so a new entry is never dropped by a table that has not caught up;
// the lab's test refuses a register entry without a row, and a row without an entry.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Where the registers may be written, in the order they are read. */
export const MISTAKE_REGISTER_SOURCES = Object.freeze(['docs/operations/MISTAKE-REGISTER.md', 'CLAUDE.md']);

/** The areas a task can work in. */
export const MISTAKE_AREAS = Object.freeze(['live-device', 'analysis', 'gates', 'observation', 'tooling']);

/**
 * Each entry's areas and the words that bring it up, by entry number. Words match case-insensitively
 * at a word start in the artifact text.
 */
export const MISTAKE_TAGS = Object.freeze({
  1: { areas: ['tooling', 'live-device'], words: ['usage', 'cli', 'stdin', 'script', 'title-observe', 'intro_card', 'observer'] },
  2: { areas: ['observation'], words: ['calibration', 'observation', 'refusal', 'title', 'save', 'continue'] },
  3: { areas: ['live-device', 'observation'], words: ['operator', 'fresh install', 'save', 'cursor', 'menu'] },
  4: { areas: ['live-device'], words: ['deadline', 'timeout', 'executor', 'port', 'lane', 'wait'] },
  5: { areas: ['gates'], words: ['test', 'pass', 'green', 'gate'] },
  6: { areas: ['live-device'], words: ['abort', 'kill', 'live', 'phone', 'device', 'night'] },
  7: { areas: ['gates'], words: ['floor', 'margin', 'seam', 'slack', 'constant', 'timing'] },
  8: { areas: ['live-device'], words: ['instrument', 'capabilities', 'trace', 'atrace', 'inputtrace', 'dispatch'] },
  9: { areas: ['gates'], words: ['measurement', 'comment', 'constant', 'frame trace', 'floor'] },
  10: { areas: ['analysis'], words: ['direction', 'order', 'reverse', 'seam', 'mask', 'monitor'] },
  11: { areas: ['analysis'], words: ['census', 'band', 'margin', 'phase', 'model', 'cliff'] },
  12: { areas: ['analysis', 'observation'], words: ['missing', 'absent', 'detector', 'miss', 'grade', 'rule'] },
  13: { areas: ['gates'], words: ['gate', 'ci', 'lane', 'test:unit', 'register'] },
  14: { areas: ['tooling', 'gates'], words: ['move', 'migration', 'path', 'rename', 'layout', 'adr 0002'] },
  15: { areas: ['tooling', 'live-device'], words: ['winner', 'pinned', 'replay', 'sources', 'move', 'sha256'] },
});

/** The areas each ROADMAP step works in. S2a and S2b read as S2. */
export const STEP_AREAS = Object.freeze({
  S1: Object.freeze(['gates']),
  S2: Object.freeze(['analysis', 'observation']),
  S3: Object.freeze(['analysis']),
  S4: Object.freeze(['live-device', 'gates']),
  S5: Object.freeze(['live-device']),
  S6: Object.freeze(['live-device', 'gates', 'tooling']),
  S7: Object.freeze(['gates', 'analysis']),
});

const ENTRY = /^(\d{1,3})\.\s+(\*\*.*)$/;
const LEAD = /^\*\*(.+?)\*\*\s*/s;

/**
 * The numbered entries of a register's text: each entry's number, bold lead (which may wrap) and
 * whole text, up to the next entry, heading, or unindented paragraph.
 */
export function parseMistakes(text: string): {n: number, lead: string, text: string}[] {
  const blocks = [];
  let current = null;
  for (const line of text.split('\n')) {
    const start = ENTRY.exec(line);
    if (start) {
      current = { n: Number(start[1]), lines: [start[2].trim()] };
      blocks.push(current);
      continue;
    }
    if (!current || !line.trim()) continue;
    if (/^\s+\S/.test(line)) { current.lines.push(line.trim()); continue; }
    current = null;
  }
  return blocks.flatMap(({ n, lines }) => {
    const whole = lines.join(' ');
    const lead = LEAD.exec(whole);
    return lead ? [{ n, lead: lead[1].trim(), text: `${lead[1].trim()} ${whole.slice(lead[0].length)}`.trim() }] : [];
  });
}

/**
 * The register as it stands: the first source that holds entries.
 */
export function readMistakes(root: string): {source: string | null, entries: {n: number, lead: string, text: string}[]} {
  for (const source of MISTAKE_REGISTER_SOURCES) {
    const path = join(root, source);
    if (!existsSync(path)) continue;
    const entries = parseMistakes(readFileSync(path, 'utf8'));
    if (entries.length) return { source, entries };
  }
  return { source: null, entries: [] };
}

/** S1..S7, and S2a/S2b as S2; anything else is null. */
export function stepFamily(step: unknown) {
  const match = /^S([1-7])([ab])?$/i.exec(String(step ?? '').trim());
  if (!match) return null;
  if (match[2] && match[1] !== '2') return null;
  return `S${match[1]}`;
}

const escape = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const mentions = (text, word) => new RegExp(`(?:^|[^a-z0-9])${escape(word.toLowerCase())}`, 'i').test(text);

/**
 * The entries a task should read before it acts, each with why it matched.
 */
export function matchMistakes(entries: {n: number, lead: string, text: string}[], { step, text = '' }: {step?: string, text?: string} = {}) {
  const family = stepFamily(step);
  const stepAreas = family ? STEP_AREAS[family] : [];
  const matched = [];
  for (const entry of entries) {
    const tags = MISTAKE_TAGS[entry.n];
    if (!tags) { matched.push({ ...entry, because: { untagged: true, areas: [], words: [] } }); continue; }
    const areas = tags.areas.filter(area => stepAreas.includes(area));
    const words = tags.words.filter(word => mentions(text, word));
    if (areas.length || words.length) matched.push({ ...entry, because: { untagged: false, areas, words } });
  }
  return matched;
}
