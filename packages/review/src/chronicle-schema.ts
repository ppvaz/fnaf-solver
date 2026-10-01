// The one authority for what a chronicle entry is.
//
// The generator, the harvester and the check all import this, so a vocabulary
// that drifts breaks in one place instead of three. It is a module, not a
// JSON Schema document, for the reason `generate-catalog.ts` throws inline
// rather than validating against a spec: the constraints that matter here are
// cross-entry (unique ids, a `supersededBy` that resolves, a date inside its
// own checkpoint window) and no declarative schema expresses them.
//
// Every facet below is vocabulary this repository already uses. Nothing here
// was invented for the page:
//
//   KINDS   -- the shapes a recorded finding takes in this project's own
//              commit grammar: it refutes, it retracts, it measures, it marks
//              a rung, or it is a fact worth keeping.
//   LABELS  -- docs/README.md's evidence labels, verbatim. "a rule enters the
//              simulator only when it earns one".
//   RUNGS   -- plans/12-end-to-end-evidence-campaign.md's promotion ladder.
//   ROUTES  -- the strategy families.
//   STATUS  -- docs/README.md: "Retractions stay put". An entry is never
//              deleted when it is refuted; it gains a status and a pointer.
//
// Two checkpoint schemas are read. chronicle-entries-v1 is frozen: its files
// are never edited and its rules below never change (ADR 0002 principle 9,
// stored names never change). chronicle-entries-v2 holds chronicle-entry-v2
// entries, which differ from v1 in five ways:
//
//   game       -- fnaf1 | fnaf2 | fnaf3 | fnaf4. A v1 entry has no game field
//                 and is read as fnaf2: its ROUTES and RUNGS are FNaF 2's.
//   night      -- 1..N, where N is the last night the game's Rulebook names
//                 (nightsOf in packages/source/src/clockwork/games.ts:
//                 7, 7, 6, 8). v1 stops at 7.
//   plan       -- any positive integer. v1 stops at 24.
//   label      -- LABELS plus the two claim levels docs/evidence/README.md
//                 defines beside DEVICE_MEASURED: MODEL_ONLY and FIXTURE.
//   supersedes -- null, or the id of the entry this one corrects. The named
//                 entry is read as superseded by this one; a frozen v1 file is
//                 never edited to say so.
//
// route and rung stay FNaF 2's vocabularies, so a v2 entry of another game
// carries neither.
import { nightsOf } from '@sixam/source';
import { isList, isOneOf } from '@sixam/kernel';

type Fields = Readonly<Record<string, unknown>>;
/** A chronicle entry as a checked corpus holds it. */
export interface ChronicleEntry {
  readonly id: string;
  readonly date: string;
  readonly kind: string;
  readonly label: string;
  readonly status: string;
  readonly title: string;
  readonly body: string;
  readonly game?: string;
  readonly rung: number | null;
  readonly plan: number | null;
  readonly night: number | null;
  readonly route: string | null;
  readonly measured: string | null;
  readonly tags: readonly string[];
  readonly sources: readonly string[];
  readonly supersedes?: string | null;
  readonly supersededBy: string | null;
  readonly [field: string]: unknown;
}
/** One checkpoint file of a checked corpus. */
export interface ChronicleCheckpoint {
  readonly file: string;
  readonly schema: string;
  readonly checkpoint: string;
  readonly entries: readonly ChronicleEntry[];
  readonly [field: string]: unknown;
}

export const ENTRIES_SCHEMA = 'chronicle-entries-v1';
/** The v2 checkpoint file, whose entries are chronicle-entry-v2. */
export const ENTRIES_SCHEMA_V2 = 'chronicle-entries-v2';
export const ENTRY_SCHEMA_V2 = 'chronicle-entry-v2';
export const SCHEMAS = [ENTRIES_SCHEMA, ENTRIES_SCHEMA_V2];

export const KINDS = ['milestone', 'lesson', 'refutation', 'retraction', 'negative', 'fact', 'trivia'];

/** docs/README.md:6 -- where a number came from. UNKNOWN is the honest default. */
export const LABELS = ['SOURCED', 'CALIBRATED', 'DEVICE_MEASURED', 'INFERRED', 'MODEL', 'UNKNOWN'];

/** docs/evidence/README.md:4-5 -- the claim ceilings beside DEVICE_MEASURED. v2 only. */
export const LABELS_V2 = [...LABELS, 'MODEL_ONLY', 'FIXTURE'];

/** plans/12-end-to-end-evidence-campaign.md:28-37. The index is the rung. */
export const RUNGS = [
  'Offline',
  'Replay',
  'Shadow',
  'Bounded live branch',
  'Full Night 6 attempt',
  'Night 6 clear',
  'Night 6 reliability',
  '10/20 attempt/clear',
];

export const ROUTES = ['Minus 7', 'Minus 3', 'Minus Toys', 'Minus Two', 'Minus 6', 'Vent Camp', 'Cam 6/7', '10/20'];

export const STATUSES = ['standing', 'superseded', 'retracted'];

/** The games a v2 entry may name: the short names of the four build-296 targets. */
export const GAMES = ['fnaf1', 'fnaf2', 'fnaf3', 'fnaf4'];
/** How a page names each game. */
export const GAME_TITLES = Object.freeze({ fnaf1: 'FNaF 1', fnaf2: 'FNaF 2', fnaf3: 'FNaF 3', fnaf4: 'FNaF 4' });
export const gameTitle = (game: string) => (GAME_TITLES as Readonly<Record<string, string>>)[game] ?? game;
/** The game every v1 entry is read as. */
export const V1_GAME = 'fnaf2';
/** The last night each game's Rulebook names. */
export const NIGHTS = Object.freeze(Object.fromEntries(GAMES.map((game) => [game, nightsOf(game)])));

const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const SOURCE = /^(?:commit:[0-9a-f]{7,40}|[\w./+-]+(?::\d+)?)$/;
// A second checkpoint in one month takes a letter: 2026-09, then 2026-09b.
const CHECKPOINT: Readonly<Record<string, RegExp>> = { [ENTRIES_SCHEMA]: /^\d{4}-\d{2}$/, [ENTRIES_SCHEMA_V2]: /^\d{4}-\d{2}[b-z]?$/ };

const isString = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
const isInt = (value: unknown): value is number => Number.isInteger(value);
const isV2 = (schema: unknown) => schema === ENTRIES_SCHEMA_V2;

/** The game an entry is about: its own field in v2, FNaF 2 for every v1 entry. */
// checkEntry refuses a v2 game outside GAMES; a v1 entry has none.
export const gameOf = (entry: { readonly game?: unknown }) => (entry.game ?? V1_GAME) as string;

/**
 * Field-level validation of one entry. Returns a list of complaints, so a bad
 * corpus reports every fault at once instead of one per run -- the same reason
 * `push-gate.ts` runs every lane rather than stopping at the first failure.
 *
 * @param schema the checkpoint's schema; v1 when omitted
 */
export function checkEntry(entry: Fields, where: string, schema: unknown = ENTRIES_SCHEMA) {
  const at = (message: string) => `${where}: ${message}`;
  const problems: string[] = [];
  const v2 = isV2(schema);
  const labels = v2 ? LABELS_V2 : LABELS;
  if (!isString(entry.id) || !ID.test(entry.id))
    problems.push(at(`id must be kebab-case, got ${JSON.stringify(entry.id)}`));
  if (!isString(entry.date) || !DATE.test(entry.date) || Number.isNaN(Date.parse(entry.date)))
    problems.push(at(`date must be YYYY-MM-DD, got ${JSON.stringify(entry.date)}`));
  if (!isOneOf(KINDS, entry.kind))
    problems.push(at(`kind must be one of ${KINDS.join('|')}, got ${JSON.stringify(entry.kind)}`));
  if (!isOneOf(labels, entry.label))
    problems.push(at(`label must be one of ${labels.join('|')}, got ${JSON.stringify(entry.label)}`));
  if (!isOneOf(STATUSES, entry.status))
    problems.push(at(`status must be one of ${STATUSES.join('|')}, got ${JSON.stringify(entry.status)}`));
  if (!isString(entry.title)) problems.push(at('title is required'));
  if (!isString(entry.body)) problems.push(at('body is required'));

  if (v2 && !isOneOf(GAMES, entry.game))
    problems.push(at(`game must be one of ${GAMES.join('|')}, got ${JSON.stringify(entry.game)}`));
  if (!v2 && entry.game !== undefined)
    problems.push(at('a chronicle-entries-v1 entry has no game field'));
  const game = gameOf(entry);
  const lastNight = v2 ? NIGHTS[game] ?? 0 : 7;

  if (entry.rung !== null && !(isInt(entry.rung) && entry.rung >= 0 && entry.rung < RUNGS.length))
    problems.push(at(`rung must be null or 0..${RUNGS.length - 1}, got ${JSON.stringify(entry.rung)}`));
  if (v2) {
    if (entry.plan !== null && !(isInt(entry.plan) && entry.plan >= 1))
      problems.push(at(`plan must be null or a positive integer, got ${JSON.stringify(entry.plan)}`));
  } else if (entry.plan !== null && !(isInt(entry.plan) && entry.plan >= 1 && entry.plan <= 24)) {
    problems.push(at(`plan must be null or 1..24, got ${JSON.stringify(entry.plan)}`));
  }
  if (entry.night !== null && !(isInt(entry.night) && entry.night >= 1 && entry.night <= lastNight))
    problems.push(at(`night must be null or 1..${lastNight}${v2 ? ` (${game}'s Rulebook)` : ''}, got ${JSON.stringify(entry.night)}`));
  if (entry.route !== null && !isOneOf(ROUTES, entry.route))
    problems.push(at(`route must be null or one of ${ROUTES.join('|')}, got ${JSON.stringify(entry.route)}`));
  if (v2 && game !== V1_GAME && (entry.route !== null || entry.rung !== null))
    problems.push(at(`route and rung are FNaF 2's vocabularies; a ${game} entry carries neither`));
  if (entry.measured !== null && !isString(entry.measured))
    problems.push(at('measured must be null or a non-empty string'));

  if (!isList(entry.tags) || entry.tags.some((tag) => !isString(tag)))
    problems.push(at('tags must be an array of strings'));

  // A citation nobody can follow is the failure this repository already names:
  // "a finding nobody can reach is close enough to a finding that does not
  // exist" (tools/test-docs.ts). Shape is checked here; resolution is checked
  // by test-chronicle.mjs, which is where the filesystem and git live.
  if (!isList(entry.sources) || entry.sources.length === 0)
    problems.push(at('sources must name at least one path, path:line, or commit:<sha>'));
  else
    for (const source of entry.sources)
      if (!isString(source) || !SOURCE.test(source))
        problems.push(at(`source ${JSON.stringify(source)} is not a path, path:line, or commit:<sha>`));

  if (entry.status === 'standing') {
    if (entry.supersededBy !== null)
      problems.push(at('a standing entry must not name supersededBy'));
  } else if (!isString(entry.supersededBy)) {
    problems.push(at(`a ${entry.status} entry must name the id that replaced it`));
  }

  if (v2) {
    if (!('supersedes' in entry)) problems.push(at('supersedes is required (null when the entry corrects nothing)'));
    else if (entry.supersedes !== null && (!isString(entry.supersedes) || !ID.test(entry.supersedes)))
      problems.push(at(`supersedes must be null or an entry id, got ${JSON.stringify(entry.supersedes)}`));
    else if (entry.supersedes === entry.id) problems.push(at('an entry cannot supersede itself'));
  } else if (entry.supersedes !== undefined) {
    problems.push(at('a chronicle-entries-v1 entry has no supersedes field'));
  }
  return problems;
}

/**
 * Whole-corpus validation. Cross-entry rules only make sense once every
 * checkpoint is loaded, so this runs after the last file is read.
 */
export function checkCorpus(checkpoints: readonly Fields[]) {
  const problems: string[] = [];
  const seen = new Map<unknown, { file: unknown, entry: Fields, schema: unknown }>();
  const checkpointIds = new Map<unknown, unknown>();
  // An entry or an item is read field by field whatever it is, as property reads on it always did.
  const fieldsOf = (value: unknown) => value as Fields;
  const listed = (value: unknown) => (value ?? []) as Iterable<unknown>;
  for (const checkpoint of checkpoints) {
    if (!isOneOf(SCHEMAS, checkpoint.schema))
      problems.push(`${checkpoint.file}: schema must be ${SCHEMAS.join(' or ')}, got ${JSON.stringify(checkpoint.schema)}`);
    if (!isString(checkpoint.label)) problems.push(`${checkpoint.file}: label is required`);
    if (checkpoint.outlook) {
      if (typeof checkpoint.outlook !== 'object' || Array.isArray(checkpoint.outlook))
        problems.push(`${checkpoint.file}: outlook must be an object`);
      const outlook = fieldsOf(checkpoint.outlook);
      for (const section of ['next', 'missing']) {
        if (!Array.isArray(outlook[section]))
          problems.push(`${checkpoint.file}: outlook.${section} must be an array`);
        for (const value of listed(outlook[section])) {
          const item = fieldsOf(value);
          if (!isString(item.title) || !isString(item.body))
            problems.push(`${checkpoint.file}: outlook.${section} items need title and body`);
          if (!isList(item.sources) || item.sources.length === 0)
            problems.push(`${checkpoint.file}: outlook.${section} items need sources`);
          else for (const source of item.sources)
            if (!isString(source) || !SOURCE.test(source))
              problems.push(`${checkpoint.file}: outlook source ${JSON.stringify(source)} is invalid`);
        }
      }
    }

    // A key and a tested value are read as text, as indexing and RegExp.test make them.
    const pattern = CHECKPOINT[String(checkpoint.schema)] ?? CHECKPOINT[ENTRIES_SCHEMA];
    if (!pattern.test(String(checkpoint.checkpoint ?? '')))
      problems.push(`${checkpoint.file}: checkpoint must be YYYY-MM${isV2(checkpoint.schema) ? ', or YYYY-MM and a letter for a second checkpoint in one month' : ''}`);
    else if (checkpointIds.has(checkpoint.checkpoint))
      problems.push(`${checkpoint.file}: checkpoint ${checkpoint.checkpoint} is already ${checkpointIds.get(checkpoint.checkpoint)}`);
    else checkpointIds.set(checkpoint.checkpoint, checkpoint.file);
    const month = String(checkpoint.checkpoint ?? '').slice(0, 7);
    if (!Array.isArray(checkpoint.entries))
      problems.push(`${checkpoint.file}: entries must be an array`);

    for (const [day, count] of Object.entries((checkpoint.pulseByDay ?? {}) as Record<string, number>)) {
      if (!DATE.test(day)) problems.push(`${checkpoint.file}: pulseByDay key ${day} is not a date`);
      if (!Number.isInteger(count) || count < 0)
        problems.push(`${checkpoint.file}: pulseByDay[${day}] must be a non-negative integer`);
      if (!day.startsWith(month))
        problems.push(`${checkpoint.file}: pulseByDay[${day}] is outside checkpoint ${checkpoint.checkpoint}`);
    }

    for (const value of listed(checkpoint.entries)) {
      const entry = fieldsOf(value);
      problems.push(...checkEntry(entry, `${checkpoint.file} ${entry.id ?? '(no id)'}`, checkpoint.schema));
      const prior = seen.get(entry.id);
      if (prior)
        problems.push(`${checkpoint.file}: duplicate id ${entry.id}, already in ${prior.file}`);
      else seen.set(entry.id, { file: checkpoint.file, entry, schema: checkpoint.schema });
      // The checkpoint window is what makes "add next month's file" a safe
      // operation: an entry filed in the wrong month would silently reorder the
      // spine and leave its day missing from the ribbon's counts.
      if (typeof entry.date === 'string' && !entry.date.startsWith(month))
        problems.push(`${checkpoint.file}: ${entry.id} is dated ${entry.date}, outside checkpoint ${checkpoint.checkpoint}`);
    }
  }
  const supersededBy = new Map<unknown, unknown>();
  for (const checkpoint of checkpoints)
    for (const value of listed(checkpoint.entries)) {
      const entry = fieldsOf(value);
      if (entry.supersededBy && !seen.has(entry.supersededBy))
        problems.push(`${checkpoint.file}: ${entry.id} is ${entry.status} by ${entry.supersededBy}, which is not an entry`);
      if (!entry.supersedes) continue;
      const target = seen.get(entry.supersedes);
      if (!target) {
        problems.push(`${checkpoint.file}: ${entry.id} supersedes ${entry.supersedes}, which is not an entry`);
        continue;
      }
      if (supersededBy.has(entry.supersedes))
        problems.push(`${checkpoint.file}: ${entry.supersedes} is superseded by both ${supersededBy.get(entry.supersedes)} and ${entry.id}`);
      supersededBy.set(entry.supersedes, entry.id);
      // A frozen v1 entry cannot be edited to point at its correction, so it
      // may still say standing; every v2 entry states both sides of the pair.
      const stored = target.entry;
      if (stored.status !== 'standing' && stored.supersededBy !== entry.id)
        problems.push(`${checkpoint.file}: ${entry.id} supersedes ${stored.id}, which names ${stored.supersededBy} instead`);
      if (isV2(target.schema) && (stored.status === 'standing' || stored.supersededBy !== entry.id))
        problems.push(`${target.file}: ${stored.id} is superseded by ${entry.id} and must say so (status superseded or retracted, supersededBy ${entry.id})`);
    }
  for (const { entry, schema, file } of seen.values())
    if (isV2(schema) && entry.status !== 'standing' && seen.get(entry.supersededBy)?.schema === ENTRIES_SCHEMA_V2 &&
      seen.get(entry.supersededBy)?.entry.supersedes !== entry.id)
      problems.push(`${file}: ${entry.id} names ${entry.supersededBy}, whose supersedes does not name it back`);
  return problems;
}

/**
 * Every entry as the corpus reads it: its checkpoint and file, its game (v1
 * entries read as fnaf2), `supersedes` (null for v1), and the status a later
 * correction gives it. An entry that a v2 entry supersedes reads as superseded
 * by that entry even when its frozen v1 file still says standing;
 * `storedStatus` keeps what the file holds. Call only on a corpus that passes
 * checkCorpus.
 */
export function readEntries(checkpoints: readonly ChronicleCheckpoint[]) {
  const corrections = new Map<string, string>();
  for (const checkpoint of checkpoints)
    for (const entry of checkpoint.entries)
      if (entry.supersedes) corrections.set(entry.supersedes, entry.id);
  return checkpoints.flatMap((checkpoint) => checkpoint.entries.map((entry) => {
    const correctedBy = corrections.get(entry.id);
    const derived = correctedBy && entry.status === 'standing';
    return {
      ...entry,
      game: gameOf(entry),
      supersedes: entry.supersedes ?? null,
      status: derived ? 'superseded' : entry.status,
      supersededBy: derived ? correctedBy : entry.supersededBy,
      storedStatus: entry.status,
      checkpoint: checkpoint.checkpoint,
      schema: checkpoint.schema,
      file: checkpoint.file,
    };
  }));
}
