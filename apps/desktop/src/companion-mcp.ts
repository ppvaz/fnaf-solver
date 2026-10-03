#!/usr/bin/env node
/**
 * The fnaf-solver stdio MCP server: the safe Companion setup/queue boundary,
 * the solver interface's verbs and resources (Plan 28 steps 1-5), and the
 * operator's read-only verbs `lab.status`, `lab.next` and `lab.doctor`.
 *
 * The server deliberately exposes no actuator, shell, coordinate, HID, rebuild
 * or game-control tool. The Companion tools keep their names and their
 * answers byte for byte (CLAUDE.md tells agents to use cue.queue.enqueue);
 * `jobs` (op enqueue | list | run) is the same queue answering in
 * claim-envelope-v1. The verbs `describe`, `query`, `review`, `promote`,
 * `check` and `truth` and the fnaf:// resources are
 * packages/review/src/solver.ts, the one verb table every door shares; every
 * answer they give is a claim-envelope-v1, and `promote` only ever proposes or
 * refuses. `truth` (op decode | events | object) reads the caller's own local
 * dump and decodes only a local APK or CCN: it ships the decoder, never the
 * decoded data, and never touches a phone. `lab.*` are
 * apps/desktop/src/lab.ts, the same functions `npm run lab` calls, over this
 * checkout; `lab.doctor` leaves out the catalog-drift check, which builds a
 * temporary worktree. Messages use MCP's
 * newline-delimited JSON-RPC transport.
 */
import { fileURLToPath } from 'node:url';
import { BINDINGS_DIR, REPOSITORY_TARGET, WINNER_FILE, claimEnvelope, isRecord, isRefusal, refusalEnvelope, unknown } from '@sixam/kernel';
import { CHECKS } from '@sixam/review/refusals';
import { GAMES, resolveGame } from '@sixam/review/registers';
import { INSTRUMENTS, QUERIES, SOLVER_SERVER_NAME, SURFACE_DOC, createSolver } from '@sixam/review/solver';
import { KINDS } from '@sixam/review/chronicle-schema';
import { createCompanionMcp } from './mcp.ts';
import { createLab } from './lab.ts';

/** A tool's arguments, as the MCP client sent them. */
type Args = Readonly<Record<string, unknown>>;
/** A parsed request line: each field is unchecked until handle() reads it. */
interface RpcRequest { readonly jsonrpc?: unknown, readonly id?: unknown, readonly method?: unknown, readonly params?: Args }

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const cue = createCompanionMcp();
const solver = createSolver({ root: ROOT });
const lab = createLab({ root: ROOT, winners: solver.winners });
const SERVER = Object.freeze({ name: SOLVER_SERVER_NAME, version: '0.2.0' });
const NO_ARGS = Object.freeze({ type: 'object', additionalProperties: false, properties: {} });
const SAFE = Object.freeze({ readOnlyHint: false, destructiveHint: false, openWorldHint: false });
const READ_ONLY = Object.freeze({ readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });

const GAME_NAMES = Object.freeze(GAMES.flatMap(game => [game.alias, game.package]));
const GAME = Object.freeze({ type: 'string', enum: GAME_NAMES, description: 'A game, by short name (fnaf2) or Android package.' });
const PACK = Object.freeze({ type: 'string', pattern: '^[A-Za-z0-9_][A-Za-z0-9_.-]{0,199}$', description: 'A committed run pack: a directory under docs/evidence/runs.' });
const DIRECTION = Object.freeze({ type: 'object', additionalProperties: false, required: ['first', 'then'],
  properties: { first: { type: 'string', minLength: 1, maxLength: 64 }, then: { type: 'string', minLength: 1, maxLength: 64 } } });

const CUE_ENQUEUE_SCHEMA = { type: 'object', additionalProperties: false, required: ['kind'], properties: {
  kind: { type: 'string', enum: ['setup', 'menu-check', 'night-check', 'night'] },
  screen: { type: 'string', enum: ['menu', 'night'] },
  install: { type: 'boolean', description: 'For setup only: install the checked-in helper APK.' },
  probe: { type: 'boolean', description: 'For setup only: start the debug-only sensor probe.' },
  game: { type: 'string', enum: ['fnaf2', 'fnaf1', 'fnaf4'], description: 'For night only: the winner\'s game.' },
  winner: { type: 'string', pattern: WINNER_FILE.source,
    description: 'For night only: the committed winner file.' },
  night: { type: 'integer', minimum: 1, maximum: 8, description: 'For night only: the one night (7 = Custom Night).' },
  label: { type: 'string', pattern: '^[a-z0-9][a-z0-9-]{0,24}$', description: 'For night only: the run label.' },
  audio: { type: 'boolean', description: 'For a FNaF 2 night only: retain the phone\'s A2DP mix.' },
  idempotencyKey: { type: 'string', minLength: 1, maxLength: 128, description: 'Optional stable key: retries return the existing job.' },
} };
const CUE_RUN_SCHEMA = { type: 'object', additionalProperties: false, properties: {
  waitSeconds: { type: 'number', minimum: 0, maximum: 86400, default: 0, description: 'Keep polling for a ready phone for this many seconds.' },
  intervalSeconds: { type: 'number', minimum: 0.1, maximum: 300, default: 5 },
} };
/** jobs: one tool, the queue operation named by op; each op takes only its cue.queue.* arguments. */
const JOB_OPS = Object.freeze({ enqueue: 'cue.queue.enqueue', list: 'cue.queue.list', run: 'cue.queue.run' });
const JOB_ARGUMENTS = Object.freeze({ enqueue: Object.keys(CUE_ENQUEUE_SCHEMA.properties), list: [], run: Object.keys(CUE_RUN_SCHEMA.properties) });
const JOBS_SCHEMA = { type: 'object', additionalProperties: false, required: ['op'], properties: {
  op: { type: 'string', enum: Object.keys(JOB_OPS), description: 'enqueue (cue.queue.enqueue), list (cue.queue.list) or run (cue.queue.run).' },
  ...CUE_ENQUEUE_SCHEMA.properties, ...CUE_RUN_SCHEMA.properties,
} };
/** truth: the game's own event sheet, from the caller's local dump; each op takes only its own arguments. */
const TRUTH_ARGUMENTS = Object.freeze({ decode: ['path', 'game'], events: ['game', 'query'], object: ['game', 'name', 'handle'] });
const TRUTH_SCHEMA = { type: 'object', additionalProperties: false, required: ['op'], properties: {
  op: { type: 'string', enum: Object.keys(TRUTH_ARGUMENTS),
    description: 'events: which event groups read or write a target; object: one object\'s type, frames, created-by and destroyed-by; '
      + 'decode: make the local dump from an APK or CCN on this host.' },
  game: GAME,
  path: { type: 'string', minLength: 1, maxLength: 4096, description: 'decode only: the absolute path of an APK or CCN you own, on this host.' },
  query: { type: 'object', additionalProperties: false, description: 'events only: exactly one target -- object (or handle), optionally '
    + 'with value or flag; global; or frame with group -- and optionally frame, access and limit.', properties: {
    object: { type: 'string', minLength: 1, maxLength: 200, description: 'An object\'s name in your dump (exact, case-insensitive).' },
    handle: { type: 'integer', minimum: 0, maximum: 65535, description: 'An event-space object handle.' },
    value: { type: 'integer', minimum: 0, maximum: 1023, description: 'An alterable-value index of the object.' },
    flag: { type: 'integer', minimum: 0, maximum: 31, description: 'A flag index of the object.' },
    global: { type: 'integer', minimum: 0, maximum: 1023, description: 'A global-value index.' },
    frame: { type: 'integer', minimum: 0, description: 'Only this frame.' },
    group: { type: 'integer', minimum: 0, description: 'With frame: this one group (g###, as a number).' },
    access: { type: 'string', enum: ['read', 'write', 'any'], default: 'any' },
    limit: { type: 'integer', minimum: 1, maximum: 500, default: 50 },
  } },
  name: { type: 'string', minLength: 1, maxLength: 200, description: 'object only: the object\'s name in your dump.' },
  handle: { type: 'integer', minimum: 0, maximum: 32767, description: 'object only: an event-space object handle.' },
} };

const TOOL_DEFINITIONS = Object.freeze([
  {
    name: 'cue.setup',
    description: 'Run the image-free Companion setup and screen check. Uses only named helper/system controls; never taps the game or writes qualification evidence.',
    inputSchema: { type: 'object', additionalProperties: false, properties: {
      install: { type: 'boolean', description: 'Install the checked-in helper APK first.' },
      probe: { type: 'boolean', description: 'Start the debug-only sensor probe; does not qualify the overlay.' },
      stop: { type: 'boolean', description: 'Stop helper capture and leave the target game unchanged.' },
      screen: { type: 'string', enum: ['menu', 'night'], default: 'menu' },
      waitSeconds: { type: 'number', minimum: 1, maximum: 300, default: 20 },
    }},
    annotations: SAFE,
  },
  {
    name: 'cue.queue.enqueue',
    description: 'Persist one safe setup or screen-check job, or one night job: a single night of a COMMITTED '
      + `${BINDINGS_DIR}/<game>/*-winner.json, played only inside Pedro's overnight window (never by cue.queue.run), after `
      + 'the title is observed to offer that night. Enqueuing works while the phone is absent or locked and sends no input.',
    inputSchema: CUE_ENQUEUE_SCHEMA,
    annotations: SAFE,
  },
  {
    name: 'cue.queue.list',
    description: 'List persisted Companion jobs and their PENDING/RUNNING/DONE/FAILED state.',
    inputSchema: NO_ARGS,
    annotations: { ...SAFE, readOnlyHint: true },
  },
  {
    name: 'cue.queue.run',
    description: 'Run pending setup and screen-check jobs only when exactly one ADB device is awake and unlocked. Otherwise returns HOLD and leaves jobs pending; it never auto-unlocks or taps the game, and never plays a night job (those wait for the overnight window).',
    inputSchema: CUE_RUN_SCHEMA,
    annotations: SAFE,
  },
  {
    name: 'describe',
    description: 'Start here. The coverage map of one game, joined from the registers the repository holds (chronicle, '
      + 'contract register, run packs and promotions, control catalog, refuted routes): what is known and at what label, '
      + 'what the phone has confirmed, what is UNKNOWN and why, and which of Plan 28\'s gaps still hold. Read-only; '
      + 'answers in claim-envelope-v1.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['game'], properties: { game: GAME } },
    annotations: READ_ONLY,
  },
  {
    name: 'query',
    description: 'Query one register: promotions (every PROMOTED_BY edge re-derived from its pack), packs (the committed '
      + 'run packs), chronicle (dated findings; negative: true for refutations, retractions, negatives and superseded '
      + 'entries), or contracts (the contract register). Read-only; answers in claim-envelope-v1.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['what'], properties: {
      what: { type: 'string', enum: QUERIES },
      game: GAME,
      text: { type: 'string', minLength: 1, maxLength: 200, description: 'Case-insensitive substring filter.' },
      kind: { type: 'string', enum: KINDS, description: 'chronicle only: the entry kind.' },
      negative: { type: 'boolean', description: 'chronicle only: negative results only.' },
      limit: { type: 'integer', minimum: 1, maximum: 500 },
    } },
    annotations: READ_ONLY,
  },
  {
    name: 'review',
    description: 'A read-only instrument over one committed run pack: custody (what reached the repository and what is '
      + 'lost), outcome (the venue\'s reported outcome beside any video grade), promotion-checks (Plan 12\'s checks '
      + 're-derived), or death-time (refused while the death time is UNKNOWN). Answers in claim-envelope-v1.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['pack', 'instrument'], properties: {
      pack: PACK, instrument: { type: 'string', enum: INSTRUMENTS },
    } },
    annotations: READ_ONLY,
  },
  {
    name: 'promote',
    description: 'Propose a Plan 12 PROMOTED_BY edge for one committed run pack, or refuse with the failing checks. '
      + 'It never writes an attestation or an edge: a proposal is only a proposal. Answers in claim-envelope-v1.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['pack'], properties: { pack: PACK } },
    annotations: READ_ONLY,
  },
  {
    name: 'check',
    description: 'Before stating or proposing something, run one of the refusals: seed-floor (a win rate: seeds, wins, '
      + 'heldOut), directional-reuse (a measured constant reused: constant, use {first, then}, measured), '
      + 'capabilities-first (an instrument: instrument, capabilities = the device-capabilities-v1 report), '
      + 'unknown-as-number (arithmetic: operands {name: value}, operation). Refuses with rule, because, cite and remedy.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['rule'], properties: {
      rule: { type: 'string', enum: Object.keys(CHECKS) },
      game: GAME,
      seeds: { description: 'seed-floor: the census seed count (a number, or UNKNOWN).' },
      wins: { description: 'seed-floor: the census win count.' },
      heldOut: { description: 'seed-floor: the held-out block, if one was run.' },
      constant: { type: 'string', minLength: 1, maxLength: 120, description: 'directional-reuse: the constant.' },
      use: { ...DIRECTION, description: 'directional-reuse: the order it is about to govern.' },
      measured: { ...DIRECTION, description: 'directional-reuse: the order it was measured in, for an unregistered constant.' },
      instrument: { type: 'string', minLength: 1, maxLength: 200, description: 'capabilities-first: the instrument (tool path).' },
      capabilities: { type: 'object', description: 'capabilities-first: the device-capabilities-v1 report.' },
      operands: { type: 'object', description: 'unknown-as-number: name -> value.' },
      operation: { type: 'string', maxLength: 200, description: 'unknown-as-number: what the numbers are for.' },
    } },
    annotations: READ_ONLY,
  },
  {
    name: 'jobs',
    description: 'The Companion queue answering in claim-envelope-v1: op enqueue (cue.queue.enqueue\'s arguments), list, or run '
      + '(waitSeconds, intervalSeconds: runs setup and check jobs only on exactly one awake, unlocked phone; never a night).',
    inputSchema: JOBS_SCHEMA,
    annotations: SAFE,
  },
  {
    name: 'truth',
    description: 'The game\'s own event sheet, read from YOUR local dump (Plan 28 step 5): op events ({game, query}: the event groups '
      + 'that read or write an object, one of its alterable values or flags, or a global -- frame, group id and every condition and '
      + 'action as parsed fields, never the dump\'s text), op object ({game, name | handle}: type, frames, created-by, destroyed-by), or '
      + 'op decode ({path, game}: make that dump from an APK or CCN on this host with the local CTFAK dumper; never from a phone). '
      + 'Refuses, naming the decode, when no dump is configured. Answers in claim-envelope-v1, labelled SOURCED, citing '
      + 'fnaf://truth/<game>/frame/<n>/group/<g>.',
    inputSchema: TRUTH_SCHEMA,
    annotations: SAFE,
  },
  {
    name: 'lab.status',
    description: 'Where everything stands, derived from the repository, the committed evidence and this host: HEAD and whether '
      + 'push-gate ran on it, sync with origin, each ROADMAP step S1-S7 open, closed or UNKNOWN with its reason, the promotions '
      + 'summary, the phone lease and queue, pending decisions and the doctor\'s finding count. Read-only; answers in claim-envelope-v1.',
    inputSchema: NO_ARGS,
    annotations: READ_ONLY,
  },
  {
    name: 'lab.next',
    description: 'The next step or action, ranked by the ROADMAP order over what lab.status finds: an open session, doctor findings '
      + 'that stop every commit, each open step whose needs are closed, pending decisions, the push gate. Read-only; claim-envelope-v1.',
    inputSchema: NO_ARGS,
    annotations: READ_ONLY,
  },
  {
    name: 'lab.doctor',
    description: 'What is broken on this host and checkout, each finding with the command that fixes it; it runs none of them. '
      + 'The catalog-drift check, which builds a temporary worktree, is left to `npm run lab -- doctor`. Read-only; claim-envelope-v1.',
    inputSchema: NO_ARGS,
    annotations: READ_ONLY,
  },
]);

const SCHEMAS = new Map(TOOL_DEFINITIONS.map(tool => [tool.name, tool.inputSchema]));
const VERB_TOOLS = Object.freeze({ describe: solver.describe, query: solver.query, review: solver.review,
  promote: solver.promote, check: solver.check, truth: solver.truth,
  'lab.status': () => lab.status(), 'lab.next': () => lab.next(), 'lab.doctor': () => lab.doctor({ catalog: false }) });
/** Tools whose op picks the arguments they take. */
const OP_ARGUMENTS: Readonly<Record<string, Readonly<Record<string, readonly string[]>>>> = Object.freeze({ jobs: JOB_ARGUMENTS, truth: TRUTH_ARGUMENTS });
const QUEUE_CITE = Object.freeze(['apps/lab/companion-queue.sh', SURFACE_DOC]);

/** A queue answer as a claim envelope: a queued, listed or held job measures nothing about the game. */
function jobsEnvelope(op: string, args: Args, result: Awaited<ReturnType<typeof cue.call>>) {
  if (result.ok === false)
    return refusalEnvelope({ rule: 'queue', because: `${result.error.code}: ${result.error.message}`, cite: [...QUEUE_CITE],
      remedy: 'correct the arguments against the tool\'s input schema; a HOLD is not a refusal' });
  const { ok, ...claim } = result;
  const game = args.kind === 'night' ? resolveGame(args.game)?.package : null;
  return claimEnvelope({
    claim, label: unknown('a queue record measures nothing about the game: a job queued, listed or held is not a result'),
    target: game ?? REPOSITORY_TARGET, cite: [...QUEUE_CITE], status: 'standing', supersededBy: null,
    notMeasured: op === 'run'
      ? [result.status === 'HOLD' ? 'the pending jobs: the phone was absent, locked, asleep or ambiguous, so none ran'
        : 'what each job found: jobs op list reads its state']
      : ['whether the phone is present, awake and unlocked: only jobs op run reads it'],
    reproducer: op === 'run' ? 'apps/lab/companion-queue.sh run --wait 0' : 'apps/lab/companion-queue.sh list --json',
  });
}

/** Arguments the tool's schema does not name -- or, for an op tool, its op does not take -- are refused before anything runs. */
function unknownArguments(name: string, args: Args) {
  const perOp = OP_ARGUMENTS[name];
  // An index reads any value as a property key.
  const allowed = perOp ? ['op', ...(perOp[args.op as string] ?? [])] : Object.keys(SCHEMAS.get(name)?.properties ?? {});
  return Object.keys(args).filter(key => !allowed.includes(key));
}

async function callTool(name: string, args: unknown) {
  if (!isRecord(args))
    return refusalEnvelope({ rule: 'invalid-argument', because: 'tool arguments are an object', cite: [SURFACE_DOC], remedy: 'pass an object' });
  const perOp = OP_ARGUMENTS[name];
  // hasOwn reads any value as a property key; past it, op names one of perOp's.
  if (perOp && !Object.hasOwn(perOp, args.op as string))
    return refusalEnvelope({ rule: 'invalid-argument', because: `${name} takes op ${Object.keys(perOp).join(' | ')}, not ${JSON.stringify(args.op ?? null)}`,
      cite: [SURFACE_DOC], remedy: `pass op: one of ${Object.keys(perOp).join(', ')}` });
  const extra = unknownArguments(name, args);
  if (extra.length && (Object.hasOwn(VERB_TOOLS, name) || perOp))
    return refusalEnvelope({ rule: 'invalid-argument', because: `${name}${perOp ? ` op ${args.op}` : ''} takes no ${extra.join(', ')}`,
      cite: [SURFACE_DOC], remedy: `pass only ${perOp ? ['op', ...perOp[args.op as string]].join(', ') : Object.keys((SCHEMAS.get(name) as { properties: object }).properties).join(', ')}` });
  // Every tool but jobs and the cue.* tools is a verb, and each verb refuses an argument it cannot read.
  if (Object.hasOwn(VERB_TOOLS, name)) return (VERB_TOOLS[name as keyof typeof VERB_TOOLS] as (args: Args) => ReturnType<typeof refusalEnvelope>)(args);
  if (name === 'jobs') {
    const { op, ...rest } = args as Args & { op: keyof typeof JOB_OPS };
    return jobsEnvelope(op, rest, await cue.call(JOB_OPS[op], rest));
  }
  return cue.call(name, args);
}

function write(message: unknown) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function rpcError(id: unknown, code: number, message: string) {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message } };
}

async function handle(request: RpcRequest | null) {
  if (!request || request.jsonrpc !== '2.0' || typeof request.method !== 'string')
    return rpcError(request?.id, -32600, 'invalid JSON-RPC request');
  if (request.method === 'notifications/initialized' || request.method.startsWith('notifications/')) return null;
  if (request.method === 'ping') return { jsonrpc: '2.0', id: request.id, result: {} };
  if (request.method === 'initialize') {
    const requested = request.params?.protocolVersion;
    return { jsonrpc: '2.0', id: request.id, result: {
      protocolVersion: typeof requested === 'string' ? requested : '2024-11-05',
      capabilities: { tools: { listChanged: false }, resources: { listChanged: false, subscribe: false } },
      serverInfo: SERVER,
      instructions: 'Start with describe({game}); describe, query, review, promote, check, truth, jobs and the fnaf:// resources answer in '
        + 'claim-envelope-v1, and promote only proposes. truth reads your own local dump of the game\'s event sheet and refuses, '
        + 'naming the decode, where none is configured. lab.status, lab.next and lab.doctor say where the work stands and '
        + 'what to do next, read-only. Use cue.queue.enqueue while the device is absent or locked; '
        + 'cue.queue.run holds safely until the device is awake and unlocked.',
    } };
  }
  if (request.method === 'tools/list')
    return { jsonrpc: '2.0', id: request.id, result: { tools: TOOL_DEFINITIONS } };
  if (request.method === 'tools/call') {
    const name = request.params?.name;
    if (typeof name !== 'string') return rpcError(request.id, -32602, 'tools/call requires a tool name');
    const result = await callTool(name, request.params?.arguments ?? {});
    const failed = (result as { ok?: unknown }).ok === false || isRefusal(result);
    return { jsonrpc: '2.0', id: request.id, result: {
      isError: failed,
      content: [{ type: 'text', text: JSON.stringify(result) }],
    } };
  }
  if (request.method === 'resources/list')
    return { jsonrpc: '2.0', id: request.id, result: { resources: solver.listResources()
      .map(item => ({ ...item, mimeType: 'application/json' })) } };
  if (request.method === 'resources/templates/list')
    return { jsonrpc: '2.0', id: request.id, result: { resourceTemplates: solver.resourceTemplates()
      .map(item => ({ ...item, mimeType: 'application/json' })) } };
  if (request.method === 'resources/read') {
    const uri = request.params?.uri;
    if (typeof uri !== 'string') return rpcError(request.id, -32602, 'resources/read requires a uri');
    const envelope = solver.readResource(uri);
    if (!envelope) return rpcError(request.id, -32002, `resource not found: ${uri}`);
    return { jsonrpc: '2.0', id: request.id, result: {
      contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(envelope) }],
    } };
  }
  return rpcError(request.id, -32601, `method not found: ${request.method}`);
}

let buffer = '';
let serial = Promise.resolve();
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  buffer += chunk;
  let newline: number;
  while ((newline = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, newline).trim();
    buffer = buffer.slice(newline + 1);
    if (!line) continue;
    serial = serial.then(async () => {
      let request: RpcRequest | null;
      try { request = JSON.parse(line); }
      catch { write(rpcError(null, -32700, 'parse error')); return; }
      try {
        const response = await handle(request);
        if (response) write(response);
      } catch (cause) {
        // handle() threw, so the request was an object it read.
        const { id } = request as RpcRequest;
        if (id !== undefined) write(rpcError(id, -32603, (cause as Error).message));
      }
    });
  }
});
