// truth.*: the programmatic surface over each game's own event sheet (Plan 28 step 5).
//
// Plan 28's first boundary is that "the server ships the decoder, not the decoded data". This
// module holds no dump and writes none into the repository: it reads the caller's OWN local
// dump, found through an untracked local vault file (VAULT_FILE, gitignored, or the path in
// $SIXAM_TRUTH_VAULT), and refuses, naming the decode command, when none is configured. Its
// second boundary is no device and no rebuild: `decode` takes a local APK or CCN the caller owns
// and runs the local CTFAK event-text dumper (EventTextDumper.cs, the tool regen-dump.sh runs);
// it never pulls from a phone, and refuses with the remedy when the toolchain is absent.
//
//   createTruth({root, env}).events({game, query})   which event groups read or write a target
//   createTruth({root, env}).object({game, name | handle})
//   createTruth({root, env}).decode({path, game})     decode a local APK or CCN, cache it, bind it
//
// Every answer is a claim-envelope-v1 labelled SOURCED, citing fnaf://truth/<game>/frame/<n>/group/<g>,
// or a refusal. Matches are fields -- frame, group id, each condition and action parsed -- never the
// dump's line text; names in an answer come from the caller's own dump and stay on their host.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { closeSync, existsSync, fstatSync, mkdirSync, openSync, readFileSync, readSync, realpathSync, renameSync, rmSync,
  statSync, writeFileSync, writeSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { claimEnvelope, refusalEnvelope } from '@sixam/kernel';
import { CONTROL_CATALOGS, GAME_PACKAGES } from '../src/index.ts';
import { ACCESS, DEFAULT_LIMIT, DUMPER, HANDLE_SCRAMBLE_LIMIT, QUERY_FIELDS, TRUTH_URI, describeObject, dumpShape,
  estimateHandleScramble, findEvents, handlesNamed, isTabularDump, namesContaining, objectAt, parseDump, qualifierRows,
  unparsedLoaders } from '../src/truth/index.ts';

export const VAULT_FILE = 'packages/source/decompile/local-vault.json';
export const VAULT_ENV = 'SIXAM_TRUTH_VAULT';
export const CACHE_ENV = 'SIXAM_TRUTH_CACHE';
export const VAULT_SCHEMA = 'truth-local-vault-v1';
export const DECODE_SCHEMA = 'truth-decode-v1';
export const TRUTH_OPS = Object.freeze(['decode', 'events', 'object']);
export const NO_LOCAL_DUMP = 'no local dump configured on this host';
export const DECODE_TIMEOUT_MS = 600_000;
const PLAN28 = 'plans/28-solver-interface.md';
const README = 'packages/source/decompile/README.md';
const GUIDE = 'docs/android/SOURCE-DUMP-GUIDE.md';
const ENGINE = 'packages/source/src/truth/engine.ts';
const CLI_IN_CHECKOUT = 'Interface/CTFAK.Cli/bin/Release/net6.0/CTFAK.Cli.dll';
const DUMPER_IN_CHECKOUT = 'Core/CTFAK.Core/Tools/EventTextDumper.cs';
const CCN_ENTRIES = Object.freeze(['res/raw/application.ccn', 'assets/application.ccn']);

/** The registered games, by package and by the short name the catalog title gives (FNaF 2 -> fnaf2). */
export const TRUTH_GAMES = Object.freeze(GAME_PACKAGES.map(pkg => Object.freeze({
  package: pkg, alias: CONTROL_CATALOGS[pkg].title.toLowerCase().replace(/\s+/g, ''), title: CONTROL_CATALOGS[pkg].title })));
const gameOf = name => TRUTH_GAMES.find(game => game.package === name || game.alias === name) ?? null;

const shellQuote = text => `'${String(text).replaceAll("'", "'\\''")}'`;
const sha256 = data => createHash('sha256').update(data).digest('hex');
const expand = path => (typeof path === 'string' && path ? (path.startsWith('~/') ? join(homedir(), path.slice(2)) : path) : null);
const isInt = (value, min, max) => Number.isInteger(value) && value >= min && value <= max;
const tally = (items, key) => items.reduce((counts, item) => { for (const value of key(item)) counts[value] = (counts[value] ?? 0) + 1; return counts; },
  ({} as Record<string, number>));

/** Is `path` the directory `root` or inside it, after resolving links? */
function inside(root, path) {
  const real = p => { try { return realpathSync(p); } catch { return resolve(p); } };
  let probe = resolve(path);
  while (!existsSync(probe) && dirname(probe) !== probe) probe = dirname(probe);
  const rel = relative(real(root), join(real(probe), relative(probe, resolve(path))));
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

/** The file's sha256, read in chunks so a 100 MB CCN is never held whole. */
function fileSha256(path) {
  const hash = createHash('sha256');
  const fd = openSync(path, 'r');
  try {
    const chunk = Buffer.alloc(8 << 20);
    let read;
    while ((read = readSync(fd, chunk, 0, chunk.length, null)) > 0) hash.update(chunk.subarray(0, read));
  } finally { closeSync(fd); }
  return hash.digest('hex');
}

function readAt(fd, position, length) {
  const buffer = Buffer.alloc(length);
  let offset = 0;
  while (offset < length) {
    const read = readSync(fd, buffer, offset, length - offset, position + offset);
    if (!read) break;
    offset += read;
  }
  return buffer.subarray(0, offset);
}

/**
 * The application CCN inside an APK: found by the zip central directory, copied out stored or
 * inflated, never by a shell. Returns null when the APK holds none.
 */
export function extractCcn(apk: string, out: string) {
  const fd = openSync(apk, 'r');
  try {
    const size = fstatSync(fd).size;
    const tailLength = Math.min(size, 65_557);
    const tail = readAt(fd, size - tailLength, tailLength);
    const end = tail.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    if (end < 0) throw new Error('no zip end-of-central-directory record');
    const count = tail.readUInt16LE(end + 10);
    const directorySize = tail.readUInt32LE(end + 12);
    const directoryOffset = tail.readUInt32LE(end + 16);
    if (directoryOffset === 0xffffffff || count === 0xffff) throw new Error('a ZIP64 archive; extract the CCN yourself and pass it');
    const directory = readAt(fd, directoryOffset, directorySize);
    const entries = [];
    for (let at = 0, index = 0; index < count && at + 46 <= directory.length; index += 1) {
      if (directory.readUInt32LE(at) !== 0x02014b50) throw new Error('a malformed zip central directory');
      const nameLength = directory.readUInt16LE(at + 28);
      entries.push({ method: directory.readUInt16LE(at + 10), compressed: directory.readUInt32LE(at + 20), size: directory.readUInt32LE(at + 24),
        local: directory.readUInt32LE(at + 42), name: directory.toString('utf8', at + 46, at + 46 + nameLength) });
      at += 46 + nameLength + directory.readUInt16LE(at + 30) + directory.readUInt16LE(at + 32);
    }
    const entry = CCN_ENTRIES.map(name => entries.find(item => item.name === name)).find(Boolean) ?? null;
    if (!entry) return null;
    const header = readAt(fd, entry.local, 30);
    if (header.readUInt32LE(0) !== 0x04034b50) throw new Error('a malformed zip local header');
    const data = entry.local + 30 + header.readUInt16LE(26) + header.readUInt16LE(28);
    mkdirSync(dirname(out), { recursive: true });
    const target = openSync(out, 'w');
    try {
      if (entry.method === 0) {
        for (let done = 0; done < entry.size;) {
          const chunk = readAt(fd, data + done, Math.min(8 << 20, entry.size - done));
          if (!chunk.length) throw new Error('the CCN entry is truncated');
          writeSync(target, chunk);
          done += chunk.length;
        }
      } else if (entry.method === 8) writeSync(target, inflateRawSync(readAt(fd, data, entry.compressed)));
      else throw new Error(`the CCN entry uses zip method ${entry.method}`);
    } finally { closeSync(target); }
    return { entry: entry.name, method: entry.method, bytes: entry.size };
  } finally { closeSync(fd); }
}

/** What the first bytes say a file is. */
function fileKind(path) {
  const fd = openSync(path, 'r');
  try {
    const head = readAt(fd, 0, 4);
    if (head.length === 4 && head.readUInt32LE(0) === 0x04034b50) return 'apk';
    const magic = head.toString('latin1');
    return magic === 'PAME' || magic === 'PAMU' ? 'ccn' : null;
  } finally { closeSync(fd); }
}

/**
 * The truth surface over the caller's own local dumps.
 */
export function createTruth({ root, env = process.env }: {root: string, env?: Record<string, string | undefined>}) {
  const vaultPath = env[VAULT_ENV] ? resolve(expand(env[VAULT_ENV])) : join(root, VAULT_FILE);
  const loaded = new Map();

  const refusal = (rule, because, remedy, cite = [PLAN28, README]) => refusalEnvelope({ rule, because, cite, remedy });
  const badArgument = (because, remedy) => refusal('invalid-argument', because, remedy);
  const gameRefusal = game => badArgument(`${JSON.stringify(game ?? null)} is not a registered game`,
    `name one of ${TRUTH_GAMES.map(item => `${item.alias} (${item.package})`).join(', ')}`);
  const decodeRemedy = game => `decode your own copy: npm run review -- truth decode /path/to/base.apk --game ${game?.alias ?? '<game>'} ` +
    `(or packages/source/decompile/regen-dump.sh APPLICATION.CCN, then name its dump under games in ${VAULT_FILE} or the file $${VAULT_ENV} names)`;

  /** The local vault: {games: {<package or alias>: {dump, k?}}, cache?, decoder?}, or null when there is none. */
  function readVault() {
    if (!existsSync(vaultPath)) return { config: null };
    try {
      const config = JSON.parse(readFileSync(vaultPath, 'utf8'));
      if (config === null || typeof config !== 'object' || Array.isArray(config)) throw new Error('not a JSON object');
      return { config };
    } catch (error) {
      return { error: refusal('truth-vault', `the local vault ${vaultPath} does not read: ${error.message}`,
        `fix it or remove it; its shape is {"schema": "${VAULT_SCHEMA}", "games": {"<game>": {"dump": "/abs/events.txt"}}}`) };
    }
  }

  const entryFor = (config, game) => config?.games?.[game.package] ?? config?.games?.[game.alias] ?? null;
  const dumpPath = entry => {
    const path = expand(entry?.dump);
    return path ? resolve(dirname(vaultPath), path) : null;
  };

  /** Whether a dump is configured for this game here: what describe reads. */
  function status(name: string) {
    const game = gameOf(name);
    if (!game) return { configured: false, reason: `${JSON.stringify(name)} is not a registered game` };
    const { config, error } = readVault();
    if (error) return { configured: false, reason: error.because };
    const path = dumpPath(entryFor(config, game));
    if (!path) return { configured: false, reason: NO_LOCAL_DUMP };
    if (!existsSync(path)) return { configured: false, reason: `the configured dump for ${game.alias} is not on this host` };
    return { configured: true };
  }

  /** The caller's dump for a game, parsed, with its K; or a refusal. */
  function load(game) {
    const { config, error } = readVault();
    if (error) return { refusal: error };
    const entry = entryFor(config, game);
    const path = dumpPath(entry);
    if (!path) return { refusal: refusal('no-local-dump', `${NO_LOCAL_DUMP} for ${game.alias} (${game.package}): the server ships the decoder, ` +
      'not the decoded data (Plan 28), so truth reads only a dump you made from your own copy of the game', decodeRemedy(game)) };
    if (!existsSync(path)) return { refusal: refusal('no-local-dump', `the dump the local vault names for ${game.alias} is not on this host`, decodeRemedy(game)) };
    const stat = statSync(path);
    const key = `${path}:${stat.size}:${stat.mtimeMs}:${entry.k ?? ''}`;
    if (loaded.get(game.package)?.key === key) return loaded.get(game.package);
    const text = readFileSync(path, 'utf8');
    if (!isTabularDump(text)) return { refusal: refusal('not-a-tabular-dump', `the file the local vault names for ${game.alias} is not the tabular ` +
      `event-text dump ${DUMPER} writes (a GAME header, then OBJECT, FRAME, GROUP and condition/action records)`, decodeRemedy(game), [DUMPER, README]) };
    const dump = parseDump(text);
    const estimate = estimateHandleScramble(dump);
    const pinned = Number.isInteger(entry.k) ? entry.k : null;
    if (pinned !== null && !estimate.ambiguous && estimate.k !== pinned)
      return { refusal: refusal('handle-scramble', `the local vault pins K=${pinned} for ${game.alias}, but object-type agreement picks ` +
        `K=${estimate.k} (${estimate.agreement} of ${estimate.rows} rows; K=${pinned} is not the best): a wrong K names every object after an unrelated one`,
      'remove the pin, or decompile COI.loadHeader and pin the K it reads', [PLAN28, 'packages/source/src/truth/handles.ts']) };
    if (pinned === null && estimate.ambiguous)
      return { refusal: refusal('handle-scramble', `object-type agreement does not single out one K for ${game.alias} ` +
        `(${estimate.rows} rows; best K=${estimate.k} at ${estimate.agreement}, runner-up ${JSON.stringify(estimate.runnerUp)})`,
      `pin k for ${game.alias} in the local vault after reading COI.loadHeader`, [PLAN28, 'packages/source/src/truth/handles.ts']) };
    const result = { key, dump, k: pinned ?? estimate.k, handleScramble: { k: pinned ?? estimate.k, pinned, ...estimate },
      source: { ...dumpShape(dump), sha256: sha256(text) } };
    loaded.set(game.package, result);
    return result;
  }

  /** What every answer over a dump leaves unmeasured. */
  const baseNotes = (dump, handleScramble) => [
    `the handle scramble K=${handleScramble.k}: ${HANDLE_SCRAMBLE_LIMIT}`,
    ...(dump.audit.unclassified.length ? [`${dump.audit.unclassified.length} dump lines no record shape matched (line numbers in the local audit)`] : []),
    ...(dump.audit.countMismatches.length ? [`${dump.audit.countMismatches.length} groups whose rows differ from the counts their GROUP record declares`] : []),
    ...(qualifierRows(dump) ? [`${qualifierRows(dump)} rows address a qualifier (a group of objects); they are not expanded to their members`] : []),
    `what each condition and action does beyond reading or writing: the reader names only the engine numbers in ${ENGINE}; the rest carry their object type and number`,
  ];

  // --- events ------------------------------------------------------------------------------------

  function events({ game: name, query }: {game?: string, query?: Record<string, any>} = {}) {
    const game = gameOf(name);
    if (!game) return gameRefusal(name);
    if (query === null || typeof query !== 'object' || Array.isArray(query))
      return badArgument('events takes a query object', `name fields among ${QUERY_FIELDS.join(', ')}, e.g. {"object": "<name>", "value": 2, "access": "write"}`);
    const extra = Object.keys(query).filter(key => !QUERY_FIELDS.includes(key));
    if (extra.length) return badArgument(`an events query takes no ${extra.join(', ')}`, `name fields among ${QUERY_FIELDS.join(', ')}`);
    const { object, handle, value, flag, global, frame, group, access = 'any', limit = DEFAULT_LIMIT } = query;
    const checks = [
      [object !== undefined && !(typeof object === 'string' && object.length >= 1 && object.length <= 200), 'object is a name of 1 to 200 characters'],
      [handle !== undefined && !isInt(handle, 0, 0xffff), 'handle is an event-space object handle, 0 to 65535'],
      [value !== undefined && !isInt(value, 0, 1023), 'value is an alterable-value index, 0 to 1023'],
      [flag !== undefined && !isInt(flag, 0, 31), 'flag is a flag index, 0 to 31'],
      [global !== undefined && !isInt(global, 0, 1023), 'global is a global-value index, 0 to 1023'],
      [frame !== undefined && !isInt(frame, 0, 10_000), 'frame is a frame index'],
      [group !== undefined && !isInt(group, 0, 100_000), 'group is a group index (g###, as a number)'],
      [!ACCESS.includes(access), `access is one of ${ACCESS.join(', ')}`],
      [!isInt(limit, 1, 500), 'limit is 1 to 500'],
    ].find(([bad]) => bad);
    if (checks) return badArgument(`an events query field is out of range: ${checks[1]}`, 'correct the field against the tool\'s input schema');
    const selectors = [object !== undefined || handle !== undefined, global !== undefined, group !== undefined].filter(Boolean).length;
    if (selectors !== 1 || (object !== undefined && handle !== undefined))
      return badArgument('an events query names exactly one target: an object (by object or handle, optionally with value or flag), a global, or a frame and group',
        'e.g. {"object": "<name>", "value": 2}, {"global": 4, "access": "write"} or {"frame": 3, "group": 413}');
    if ((value !== undefined || flag !== undefined) && !(object !== undefined || handle !== undefined))
      return badArgument('value and flag belong to an object', 'name the object (object or handle) beside value or flag');
    if (value !== undefined && flag !== undefined) return badArgument('a query names a value or a flag, not both', 'ask one at a time');
    if (group !== undefined && frame === undefined) return badArgument('a group id is per frame', 'name the frame beside the group');

    const read = load(game);
    if (read.refusal) return read.refusal;
    const { dump, k, handleScramble, source } = read;
    let handles = null;
    if (object !== undefined) {
      handles = handlesNamed(dump, k, object);
      if (!handles.length) {
        const near = namesContaining(dump, object);
        return badArgument(`no object in the ${game.alias} dump is named ${JSON.stringify(object)} (exact, case-insensitive)` +
          (near.length ? `; names containing it: ${near.join(', ')}` : ''), 'use the exact name, or truth object to look one up');
      }
    } else if (handle !== undefined) {
      if (!(handle & 0x8000) && dump.objects.get(handle ^ k) === undefined) return badArgument(`no item-table row answers event handle ${handle} under K=${k}`, 'name the object, or check the handle');
      handles = [handle];
    }
    const target = global !== undefined ? { kind: 'global' as const, slot: global }
      : group !== undefined ? { kind: 'group' as const }
        : value !== undefined ? { kind: 'value' as const, handles: new Set<number>(handles), slot: value }
          : flag !== undefined ? { kind: 'flag' as const, handles: new Set<number>(handles), index: flag }
            : { kind: 'object' as const, handles: new Set<number>(handles) };
    const matches = findEvents(dump, k, target, { access, frame: frame ?? null, group: group ?? null, alias: game.alias });
    if (target.kind === 'group' && !matches.length)
      return badArgument(`the ${game.alias} dump has no group g${group} in frame ${frame}`, 'truth events over an object lists the groups that exist');
    const shown = matches.slice(0, limit);
    const uncertain = shown.filter(match => !match.certain).length;
    const unparsed = unparsedLoaders(shown);
    const normalized = Object.fromEntries(Object.entries({ object, handle, value, flag, global, frame, group,
      access: access === 'any' ? undefined : access, limit: limit === DEFAULT_LIMIT ? undefined : limit }).filter(([, item]) => item !== undefined));
    return claimEnvelope({
      claim: {
        game: game.package, alias: game.alias, op: 'events', query: normalized,
        target: { kind: target.kind, ...(handles ? { objects: handles.map(item => objectAt(dump, k, item)) } : {}),
          ...(value !== undefined ? { value } : {}), ...(flag !== undefined ? { flag } : {}), ...(global !== undefined ? { global } : {}) },
        matched: matches.length, shown: shown.length,
        byAccess: tally(matches, match => match.access), frames: [...new Set(matches.map(match => match.frame))],
        matches: shown, dump: source, handleScramble,
      },
      label: 'SOURCED', target: game.package,
      cite: [...(shown.length ? shown.map(match => match.cite) : [`fnaf://truth/${game.alias}`]), DUMPER],
      status: 'standing', supersededBy: null,
      notMeasured: [
        ...baseNotes(dump, handleScramble),
        ...(shown.length < matches.length ? [`${matches.length - shown.length} more matching groups beyond the limit`] : []),
        ...(uncertain ? [`${uncertain} of the shown groups touch the target only where the dump does not say which value, flag or global (an indexed read, a flag number computed at run time, a global the dumper renders ambiguously): certain: false`] : []),
        ...(unparsed.length ? [`parameters the dumper printed only as a class name, whose values are not read: ${unparsed.join(', ')}`] : []),
      ],
      reproducer: `npm run review -- truth events ${game.alias} ${shellQuote(JSON.stringify(normalized))}`,
    });
  }

  // --- object ------------------------------------------------------------------------------------

  function object({ game: name, name: objectName, handle }: {game?: string, name?: string, handle?: number} = {}) {
    const game = gameOf(name);
    if (!game) return gameRefusal(name);
    if ((objectName === undefined) === (handle === undefined))
      return badArgument('object takes exactly one of name and handle', 'e.g. {"game": "fnaf2", "name": "<object>"} or {"game": "fnaf2", "handle": 114}');
    if (objectName !== undefined && !(typeof objectName === 'string' && objectName.length >= 1 && objectName.length <= 200))
      return badArgument('name is 1 to 200 characters', 'pass the object\'s name');
    if (handle !== undefined && !isInt(handle, 0, 0x7fff)) return badArgument('handle is an event-space object handle, 0 to 32767', 'pass the handle an event row uses');
    const read = load(game);
    if (read.refusal) return read.refusal;
    const { dump, k, handleScramble, source } = read;
    const handles = objectName !== undefined ? handlesNamed(dump, k, objectName) : [handle];
    if (objectName !== undefined && !handles.length) {
      const near = namesContaining(dump, objectName);
      return badArgument(`no object in the ${game.alias} dump is named ${JSON.stringify(objectName)} (exact, case-insensitive)` +
        (near.length ? `; names containing it: ${near.join(', ')}` : ''), 'use the exact name');
    }
    if (handle !== undefined && dump.objects.get(handle ^ k) === undefined)
      return badArgument(`no item-table row answers event handle ${handle} under K=${k}`, 'check the handle');
    const objects = handles.map(item => describeObject(dump, k, item, game.alias));
    const byName = objects.reduce((sum, item) => sum + item.createdByNameRows, 0);
    const query = objectName !== undefined ? { name: objectName } : { handle };
    return claimEnvelope({
      claim: { game: game.package, alias: game.alias, op: 'object', query, matched: objects.length, objects, dump: source, handleScramble },
      label: 'SOURCED', target: game.package,
      cite: [...new Set(objects.flatMap(item => [...item.createdBy, ...item.destroyedBy].map(where => where.cite)))].slice(0, 100)
        .concat(`fnaf://truth/${game.alias}`, DUMPER),
      status: 'standing', supersededBy: null,
      notMeasured: [
        ...baseNotes(dump, handleScramble),
        'placed: which frames place the object at load, and where: frame instances use a layout scramble this reader does not estimate (readdump.py instances reads it on FNaF 2)',
        ...(byName ? [`${byName} create-by-name actions in the dump name their object by text; they are not matched to an object`] : []),
        'created-by and destroyed-by count create and destroy actions naming the object itself; one addressed through a qualifier is not expanded',
      ],
      reproducer: `npm run review -- truth object ${game.alias} ${objectName !== undefined ? shellQuote(objectName) : `--handle ${handle}`}`,
    });
  }

  // --- decode ------------------------------------------------------------------------------------

  /** The local decoder: dotnet and the CTFAK CLI, from the vault's decoder field or $CTFAK_SRC and $DOTNET_ROOT. */
  function decoder(config) {
    const named = config?.decoder ?? {};
    const ctfakSrc = expand(named.ctfakSrc ?? env.CTFAK_SRC ?? null);
    const cli = expand(named.ctfakCli ?? null) ?? (ctfakSrc ? join(ctfakSrc, CLI_IN_CHECKOUT) : null);
    const onPath = (env.PATH ?? '').split(delimiter).filter(Boolean).map(dir => join(dir, 'dotnet')).find(existsSync) ?? null;
    const dotnet = expand(named.dotnet ?? env.DOTNET ?? null) ?? (env.DOTNET_ROOT ? join(expand(env.DOTNET_ROOT), 'dotnet') : onPath);
    const missing = [...(!cli || !existsSync(cli) ? [`the CTFAK CLI${cli ? ` (${cli})` : ''}`] : []),
      ...(!dotnet || !existsSync(dotnet) ? [`dotnet${dotnet ? ` (${dotnet})` : ''}`] : [])];
    let dumperMatches = null;
    if (ctfakSrc && existsSync(join(ctfakSrc, DUMPER_IN_CHECKOUT)) && existsSync(join(root, DUMPER)))
      dumperMatches = sha256(readFileSync(join(ctfakSrc, DUMPER_IN_CHECKOUT))) === sha256(readFileSync(join(root, DUMPER)));
    return { cli, dotnet, missing, dumperMatches };
  }

  function decode({ path, game: name }: {path?: string, game?: string} = {}) {
    const game = gameOf(name);
    if (!game) return badArgument(`decode binds the dump to the game you name, and ${JSON.stringify(name ?? null)} is not one: it never infers the game from the file`,
      `name one of ${TRUTH_GAMES.map(item => item.alias).join(', ')}`);
    if (typeof path !== 'string' || !isAbsolute(path) || path.length > 4096)
      return badArgument('decode takes the absolute path of an APK or CCN on this host', 'pass /abs/path/to/base.apk or /abs/path/to/application.ccn');
    if (!existsSync(path) || !statSync(path).isFile())
      return badArgument(`${path} is not a file on this host: decode reads a local copy and never pulls from a phone`, 'copy the APK you own to this host first');
    if (inside(root, path))
      return refusal('game-content-in-repository', `${path} is inside the repository: game content stays outside it, one git add from being published`,
        'move the APK or CCN outside the repository', [PLAN28, 'docs/decisions/0002-kernel-contexts-vocabulary.md']);
    const kind = fileKind(path);
    if (!kind) return badArgument(`${path} is neither an APK (a zip) nor a Clickteam CCN (PAME/PAMU)`, 'pass the game\'s base.apk or its res/raw/application.ccn');
    const { config, error } = readVault();
    if (error) return error;
    const tool = decoder(config);
    if (tool.missing.length)
      return refusal('decoder-absent', `the local decoder toolchain is absent: ${tool.missing.join(' and ')}`,
        `install the .NET 6 SDK and build a CTFAK checkout with ${DUMPER} (${GUIDE}), then set CTFAK_SRC and DOTNET_ROOT, ` +
        `or name decoder.ctfakCli and decoder.dotnet in ${VAULT_FILE}; or run packages/source/decompile/regen-dump.sh yourself and name its dump there`,
        [GUIDE, 'packages/source/decompile/regen-dump.sh', DUMPER]);
    const cache = resolve(expand(config?.cache ?? env[CACHE_ENV] ?? join(homedir(), '.cache', 'sixam-truth')));
    if (inside(root, cache))
      return refusal('game-content-in-repository', `the decode cache ${cache} is inside the repository`, `point cache in ${VAULT_FILE} or $${CACHE_ENV} outside it`,
        [PLAN28, 'docs/decisions/0002-kernel-contexts-vocabulary.md']);

    let ccn = path;
    let extracted = null;
    mkdirSync(cache, { recursive: true });
    if (kind === 'apk') {
      const incoming = join(cache, `.incoming-${process.pid}.ccn`);
      try { extracted = extractCcn(path, incoming); } catch (cause) {
        rmSync(incoming, { force: true });
        return badArgument(`${path} does not read as an APK: ${cause.message}`, 'pass the game\'s base.apk, or its CCN');
      }
      if (!extracted) return badArgument(`${path} holds no ${CCN_ENTRIES.join(' or ')}`, 'pass the APK of a Clickteam game, or its CCN');
      if (fileKind(incoming) !== 'ccn') { rmSync(incoming, { force: true }); return badArgument(`the CCN inside ${path} has no PAME/PAMU header`, 'pass the game\'s own APK'); }
      ccn = incoming;
    }
    const ccnSha256 = fileSha256(ccn);
    const dir = join(cache, ccnSha256);
    mkdirSync(dir, { recursive: true });
    if (extracted) { const kept = join(dir, 'application.ccn'); renameSync(ccn, kept); ccn = kept; }
    const out = join(dir, 'events.txt');
    const recordFile = join(dir, 'truth-decode.json');
    const cached = existsSync(out) && existsSync(recordFile);
    if (!cached) {
      try {
        execFileSync(tool.dotnet, [tool.cli, '-path', ccn, '-parameters', '', '-forcetype', 'ccn', '-tool', 'Event Text Dumper', '-closeonfinish'], {
          cwd: dir, timeout: DECODE_TIMEOUT_MS, maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'pipe'],
          env: { ...env, CTFAK_EVENT_DUMP: out, DOTNET_ROOT: dirname(tool.dotnet), DOTNET_CLI_TELEMETRY_OPTOUT: '1' },
        });
      } catch (cause) {
        return refusal('decode-failed', `the local decoder did not finish: ${String(cause.message).split('\n')[0].slice(0, 200)}`,
          `run it by hand to see why: ${tool.dotnet} ${tool.cli} -path ${ccn} -tool 'Event Text Dumper' (with CTFAK_EVENT_DUMP=${out})`, [GUIDE, DUMPER]);
      }
      if (!existsSync(out)) return refusal('decode-failed', 'the local decoder exited without writing the event-text dump',
        `check that the CTFAK build includes ${DUMPER} (${GUIDE})`, [GUIDE, DUMPER]);
    }
    const text = readFileSync(out, 'utf8');
    if (!isTabularDump(text)) return refusal('decode-failed', 'the decoder wrote a file that is not the tabular event-text dump', `rebuild CTFAK with ${DUMPER}`, [DUMPER, GUIDE]);
    const dump = parseDump(text);
    const handleScramble = estimateHandleScramble(dump);
    const record = {
      schema: DECODE_SCHEMA, game: game.package, source: { kind, bytes: statSync(path).size, ...(extracted ? { entry: extracted.entry } : {}) },
      ccn: { sha256: ccnSha256, bytes: statSync(ccn).size }, dump: { file: 'events.txt', sha256: sha256(text), ...dumpShape(dump) },
      handleScramble, decoder: { dumperMatchesRepository: tool.dumperMatches },
      decodedAt: cached ? JSON.parse(readFileSync(recordFile, 'utf8')).decodedAt : new Date().toISOString(),
    };
    writeFileSync(recordFile, `${JSON.stringify(record, null, 2)}\n`);
    const vault = config ?? { schema: VAULT_SCHEMA, games: {} };
    vault.schema ??= VAULT_SCHEMA;
    vault.games = { ...(vault.games ?? {}) };
    delete vault.games[game.alias];
    vault.games[game.package] = { dump: out, ccnSha256, estimatedK: handleScramble.k, decodedAt: record.decodedAt };
    mkdirSync(dirname(vaultPath), { recursive: true });
    writeFileSync(vaultPath, `${JSON.stringify(vault, null, 2)}\n`);
    loaded.delete(game.package);
    return claimEnvelope({
      claim: { game: game.package, alias: game.alias, op: 'decode', cached, record, cacheDir: dir, vault: vaultPath },
      label: 'SOURCED', target: game.package, cite: [`fnaf://truth/${game.alias}`, DUMPER, GUIDE], status: 'standing', supersededBy: null,
      notMeasured: [
        `the handle scramble K=${handleScramble.k}: ${HANDLE_SCRAMBLE_LIMIT}`,
        ...(handleScramble.ambiguous ? ['a single K: object-type agreement ties, so truth events and object refuse until k is pinned in the local vault'] : []),
        ...(tool.dumperMatches === false ? [`whether the decoder's EventTextDumper.cs writes every record ${DUMPER} does: the two files differ`] : []),
        ...(tool.dumperMatches === null ? [`whether the decoder's EventTextDumper.cs is ${DUMPER}: its checkout was not named (CTFAK_SRC or decoder.ctfakSrc)`] : []),
        'which game the file is: decode binds it to the game named, and never infers it',
      ],
      reproducer: `npm run review -- truth decode ${shellQuote(path)} --game ${game.alias}`,
    });
  }

  /** A citable group, read back: fnaf://truth/<game>/frame/<n>/group/<g>. */
  function readUri(uri: string) {
    const match = TRUTH_URI.exec(uri ?? '');
    if (!match) return null;
    return events({ game: match[1], query: { frame: Number(match[2]), group: Number(match[3]) } });
  }

  function call({ op, ...args }: {op?: string, [key: string]: any} = {}) {
    if (op === 'events') return events(args);
    if (op === 'object') return object(args);
    if (op === 'decode') return decode(args);
    return badArgument(`${JSON.stringify(op ?? null)} is not a truth op`, `name one of ${TRUTH_OPS.join(', ')}`);
  }

  return { vaultPath, status, events, object, decode, readUri, call };
}
