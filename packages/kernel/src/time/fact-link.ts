// Bounded host-to-actuator fact link for Plan 20 package 6.
//
// This is the transport contract, not an MCU driver.  It deliberately leaves
// the physical framing, baud rate, USB descriptor, and GPIO/HID mapping to a
// bench adapter.  The data that crosses that boundary is small, versioned,
// timestamped, and safe to reject when its clock or sequence is suspect.
import { isList, isRecord } from '../labels.ts';

export const FACT_MESSAGE_SCHEMA = 'fact-message-v1';
export const MAX_FACT_MESSAGE_BYTES = 1024;
const MAX_FACT_TYPE_LENGTH = 64;
const MAX_FACT_SOURCE_LENGTH = 64;
const MAX_CALIBRATION_PROFILE_LENGTH = 96;
export const MAX_CYCLE_ACTIONS = 16;
const MAX_CYCLE_HORIZON_MS = 15000;

const UINT32_MAX = 0xffffffff;
const clone = <T>(value: T): T => structuredClone(value);
const finite = (value: unknown): value is number => Number.isFinite(value);

/** A fact's value on the wire: a JSON primitive. */
type FactValue = string | number | boolean | null;

interface FactMessageBase {
  readonly schema: typeof FACT_MESSAGE_SCHEMA;
  readonly seq: number;
  readonly type: string;
  readonly confidence: number;
  readonly source: string;
  readonly calibrationProfile: string | null;
  /** When the source saw it, on the sender's clock; absent when the source cannot say. */
  readonly t_observed?: number;
  /** When the sender received it, on the sender's clock. */
  readonly t_received: number;
  readonly latencyMin: number;
  readonly latencyMax: number;
}
/** fact-message-v1: one observation, or one UNKNOWN with its reason. */
type FactMessage = FactMessageBase &
  ({ readonly state: 'OBSERVED'; readonly value: FactValue } | { readonly state: 'UNKNOWN'; readonly reason: string });

/** A cycle action the host approved: any fields the actuator reads, with its id and when it is due. */
type CycleAction = Readonly<Record<string, unknown>> & { readonly id: string; readonly atMs: number };

/** What a host sends to approve a cycle; every field is checked. */
interface CycleApprovalInput {
  readonly cycleId?: unknown;
  readonly validFromMs?: unknown;
  readonly validUntilMs?: unknown;
  readonly actions?: unknown;
}

interface CycleApproval {
  readonly cycleId: string;
  readonly validFromMs: number;
  readonly validUntilMs: number;
  readonly actions: readonly CycleAction[];
}

function invalid(message: string): never { throw new TypeError(`fact link: ${message}`); }

function boundedString(name: string, value: unknown, max: number): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > max)
    invalid(`${name} must be a non-empty string of at most ${max} characters`);
  return value;
}

function optionalString(name: string, value: unknown, max: number): string | null {
  if (value === null || value === undefined) return null;
  return boundedString(name, value, max);
}

function timestamp(name: string, value: unknown): number {
  if (!finite(value) || value < 0) invalid(`${name} must be a finite non-negative number`);
  return value;
}

function primitiveValue(name: string, value: unknown): FactValue {
  if (value === null) return null;
  if (typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number' && finite(value)) return value;
  invalid(`${name} must be a JSON primitive`);
}

function sequence(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > UINT32_MAX)
    invalid('seq must be an unsigned 32-bit integer');
  return value;
}

function validateMessage(input: unknown): FactMessage {
  if (!isRecord(input))
    invalid('message must be an object');
  if (input.schema !== FACT_MESSAGE_SCHEMA)
    invalid(`schema must be ${FACT_MESSAGE_SCHEMA}`);
  const seq = sequence(input.seq);
  const type = boundedString('type', input.type, MAX_FACT_TYPE_LENGTH);
  const state = input.state ?? 'OBSERVED';
  if (state !== 'OBSERVED' && state !== 'UNKNOWN')
    invalid('state must be OBSERVED or UNKNOWN');
  let reading;
  if (state === 'OBSERVED') {
    if (!Object.hasOwn(input, 'value')) invalid('OBSERVED message needs value');
    reading = { state: 'OBSERVED' as const, value: primitiveValue('value', input.value) };
  } else {
    if (Object.hasOwn(input, 'value')) invalid('UNKNOWN message cannot carry value');
    reading = { state: 'UNKNOWN' as const, reason: boundedString('reason', input.reason, 128) };
  }
  const source = boundedString('source', input.source, MAX_FACT_SOURCE_LENGTH);
  const calibrationProfile = optionalString('calibrationProfile', input.calibrationProfile,
    MAX_CALIBRATION_PROFILE_LENGTH);
  const observed = input.t_observed === undefined ? undefined : timestamp('t_observed', input.t_observed);
  const received = timestamp('t_received', input.t_received);
  if (observed !== undefined && observed > received)
    invalid('t_observed cannot be later than t_received');
  const latencyMin = timestamp('latencyMin', input.latencyMin);
  const latencyMax = timestamp('latencyMax', input.latencyMax);
  if (latencyMin > latencyMax) invalid('latencyMin cannot exceed latencyMax');
  const confidence = input.confidence;
  if (!finite(confidence) || confidence < 0 || confidence > 1)
    invalid('confidence must be between 0 and 1');
  return {
    schema: FACT_MESSAGE_SCHEMA,
    seq,
    type,
    ...reading,
    confidence,
    source,
    calibrationProfile,
    ...(observed === undefined ? {} : { t_observed: observed }),
    t_received: received,
    latencyMin,
    latencyMax,
  };
}

/** Encode one newline-delimited, bounded fact message. */
export function encodeFactMessage(input: object) {
  const message = validateMessage({
    ...input,
    schema: ('schema' in input ? input.schema : undefined) ?? FACT_MESSAGE_SCHEMA,
  });
  const line = JSON.stringify(message);
  const bytes = new TextEncoder().encode(line + '\n').byteLength;
  if (bytes > MAX_FACT_MESSAGE_BYTES)
    throw new RangeError(`fact message is ${bytes} bytes; maximum is ${MAX_FACT_MESSAGE_BYTES}`);
  return line + '\n';
}

/** Decode one complete newline-delimited fact message. */
export function decodeFactMessage(line: unknown): FactMessage {
  if (typeof line !== 'string') invalid('wire message must be a string');
  const bytes = new TextEncoder().encode(line).byteLength;
  if (bytes > MAX_FACT_MESSAGE_BYTES) throw new RangeError('fact message exceeds byte limit');
  if (!line.endsWith('\n')) invalid('wire message must end with newline');
  if (line.slice(0, -1).includes('\n')) invalid('wire message must contain one line');
  let parsed: unknown;
  try { parsed = JSON.parse(line.slice(0, -1)); }
  catch (error) { throw new TypeError(`fact link: invalid JSON (${(error as Error).message})`); }
  return validateMessage(parsed);
}

/** Convert a valid wire message to the estimator's fact-envelope shape. */
export function messageToFact(message: unknown, receivedAtMs: unknown) {
  const valid = validateMessage(message);
  const received = timestamp('link receipt time', receivedAtMs);
  const fact = valid.state === 'OBSERVED'
    ? { state: valid.state, value: valid.value }
    : { state: valid.state, reason: valid.reason };
  return {
    type: valid.type,
    ...fact,
    confidence: valid.confidence,
    source: valid.source,
    calibrationProfile: valid.calibrationProfile,
    observedAtMs: valid.t_observed ?? valid.t_received,
    receivedAtMs: received,
    transportReceivedAtMs: valid.t_received,
    latencyMinMs: valid.latencyMin,
    latencyMaxMs: valid.latencyMax,
  };
}

function serialDistance(next: number, previous: number) {
  return (next - previous + 0x100000000) % 0x100000000;
}

/**
 * Ordered receiver state for a newline-delimited fact stream.  A gap is
 * surfaced while the current message remains available; callers can then
 * choose UNKNOWN/recovery instead of silently treating the line as complete.
 */
export class FactLinkReceiver {
  declare staleAfterMs: number;
  declare lastSeq: number | null;
  declare lastSenderReceivedMs: number | null;
  declare lastLinkReceiptMs: number | null;
  declare gapCount: number;
  declare lastGap: { after: number; before: number; missing: number; } | null;
  declare accepted: number;
  declare rejected: number;
  constructor({ staleAfterMs = 1000, initialSeq = null }: { staleAfterMs?: number, initialSeq?: number | null } = {}) {
    if (!finite(staleAfterMs) || staleAfterMs <= 0)
      throw new RangeError('staleAfterMs must be positive');
    if (initialSeq !== null) sequence(initialSeq);
    this.staleAfterMs = staleAfterMs;
    this.lastSeq = initialSeq;
    this.lastSenderReceivedMs = null;
    this.lastLinkReceiptMs = null;
    this.gapCount = 0;
    this.lastGap = null;
    this.accepted = 0;
    this.rejected = 0;
  }

  receive(line: unknown, options: { receivedAtMs?: unknown } = {}) {
    const { receivedAtMs } = options;
    const receipt = timestamp('link receipt time', receivedAtMs);
    let message;
    try { message = decodeFactMessage(line); }
    catch (error) {
      this.rejected++;
      throw error;
    }
    if (this.lastLinkReceiptMs !== null && receipt < this.lastLinkReceiptMs) {
      this.rejected++;
      throw new RangeError('link receipt time moved backwards');
    }
    if (this.lastSenderReceivedMs !== null && message.t_received < this.lastSenderReceivedMs) {
      this.rejected++;
      throw new RangeError('sender receipt time moved backwards');
    }

    let missingBefore = 0;
    if (this.lastSeq !== null) {
      const distance = serialDistance(message.seq, this.lastSeq);
      if (distance === 0 || distance > 0x80000000) {
        this.rejected++;
        throw new RangeError(`out-of-order fact sequence ${message.seq} after ${this.lastSeq}`);
      }
      missingBefore = distance - 1;
      if (missingBefore) {
        this.gapCount += missingBefore;
        this.lastGap = { after: this.lastSeq, before: message.seq, missing: missingBefore };
      }
    }
    this.lastSeq = message.seq;
    this.lastSenderReceivedMs = message.t_received;
    this.lastLinkReceiptMs = receipt;
    this.accepted++;
    return {
      schema: 'fact-link-receipt-v1',
      message: clone(message),
      fact: messageToFact(message, receipt),
      missingBefore,
      linkState: missingBefore ? 'DEGRADED' : 'HEALTHY',
      status: this.status(receipt),
    };
  }

  status(nowMs: unknown = this.lastLinkReceiptMs ?? 0) {
    const now = timestamp('status time', nowMs);
    const ageMs = this.lastLinkReceiptMs === null ? Infinity : now - this.lastLinkReceiptMs;
    return {
      schema: 'fact-link-status-v1',
      state: this.lastLinkReceiptMs === null ? 'UNSEEN'
        : ageMs > this.staleAfterMs ? 'STALE' : 'HEALTHY',
      ageMs,
      lastSeq: this.lastSeq,
      lastSenderReceivedMs: this.lastSenderReceivedMs,
      lastLinkReceiptMs: this.lastLinkReceiptMs,
      gapCount: this.gapCount,
      lastGap: clone(this.lastGap),
      accepted: this.accepted,
      rejected: this.rejected,
    };
  }
}

function actionId(action: Record<string, unknown>, index: number) {
  const id = action.id ?? `action-${index + 1}`;
  return boundedString('cycle action id', id, 64);
}

function validateCycleApproval({ cycleId, validFromMs, validUntilMs, actions }: CycleApprovalInput): CycleApproval {
  const id = boundedString('cycleId', cycleId, 96);
  const from = timestamp('validFromMs', validFromMs);
  const until = timestamp('validUntilMs', validUntilMs);
  if (until < from) invalid('cycle validity cannot run backwards');
  if (until - from > MAX_CYCLE_HORIZON_MS)
    throw new RangeError(`cycle horizon exceeds ${MAX_CYCLE_HORIZON_MS} ms`);
  if (!isList(actions) || actions.length > MAX_CYCLE_ACTIONS)
    throw new RangeError(`cycle must contain 0-${MAX_CYCLE_ACTIONS} actions`);
  let previousAt = from;
  const safeActions = actions.map((action, index): CycleAction => {
    if (!isRecord(action))
      invalid(`cycle action ${index} must be an object`);
    const atMs = timestamp(`cycle action ${index} atMs`, action.atMs);
    if (atMs < from || atMs > until) invalid(`cycle action ${index} is outside validity`);
    if (atMs < previousAt) invalid('cycle actions must be ordered by atMs');
    previousAt = atMs;
    boundedString(`cycle action ${index} kind`, action.kind, 32);
    boundedString(`cycle action ${index} action`, action.action, 48);
    return {
      ...clone(action), id: actionId(action, index), atMs,
    };
  });
  return { cycleId: id, validFromMs: from, validUntilMs: until, actions: safeActions };
}

/**
 * Local actuator-side drain for a cycle already approved by the host.  It
 * never creates a new action after link loss; it only releases due actions
 * from the bounded approval until its validity window expires.
 */
export class SafeCycleHandoff {
  declare linkTimeoutMs: number;
  declare maxActions: number;
  declare approval: CycleApproval | null;
  declare emitted: Set<string>;
  declare lastLinkMs: number | null;
  constructor({ linkTimeoutMs = 500, maxActions = MAX_CYCLE_ACTIONS }: { linkTimeoutMs?: number, maxActions?: number } = {}) {
    if (!finite(linkTimeoutMs) || linkTimeoutMs <= 0)
      throw new RangeError('linkTimeoutMs must be positive');
    if (!Number.isInteger(maxActions) || maxActions < 1 || maxActions > MAX_CYCLE_ACTIONS)
      throw new RangeError(`maxActions must be between 1 and ${MAX_CYCLE_ACTIONS}`);
    this.linkTimeoutMs = linkTimeoutMs;
    this.maxActions = maxActions;
    this.approval = null;
    this.emitted = new Set();
    this.lastLinkMs = null;
  }

  noteLink(receivedAtMs: unknown) {
    const now = timestamp('link activity time', receivedAtMs);
    if (this.lastLinkMs !== null && now < this.lastLinkMs)
      throw new RangeError('link activity time moved backwards');
    this.lastLinkMs = now;
    return this.status(now);
  }

  approve(approval: CycleApprovalInput) {
    const checked = validateCycleApproval(approval);
    if (checked.actions.length > this.maxActions)
      throw new RangeError(`cycle exceeds local action limit ${this.maxActions}`);
    if (this.approval && checked.validFromMs < this.approval.validFromMs)
      throw new RangeError('replacement cycle starts before the current approval');
    this.approval = checked;
    this.emitted = new Set();
    return this.status(this.lastLinkMs ?? checked.validFromMs);
  }

  due(nowMs: unknown) {
    const now = timestamp('cycle poll time', nowMs);
    if (!this.approval || now > this.approval.validUntilMs) return [];
    const out: (CycleAction & { cycleId: string, linkState: string })[] = [];
    for (const action of this.approval.actions) {
      if (action.atMs > now || this.emitted.has(action.id)) continue;
      this.emitted.add(action.id);
      out.push({ ...clone(action), cycleId: this.approval.cycleId,
        linkState: this.linkState(now) });
    }
    return out;
  }

  linkState(nowMs: unknown) {
    const now = timestamp('link state time', nowMs);
    if (this.lastLinkMs === null) return 'UNSEEN';
    return now - this.lastLinkMs > this.linkTimeoutMs ? 'STALE' : 'HEALTHY';
  }

  status(nowMs: unknown = this.lastLinkMs ?? 0) {
    const now = timestamp('handoff status time', nowMs);
    const approval = this.approval ? {
      cycleId: this.approval.cycleId,
      validFromMs: this.approval.validFromMs,
      validUntilMs: this.approval.validUntilMs,
      actionCount: this.approval.actions.length,
      emitted: this.approval.actions.filter(action => this.emitted.has(action.id)).length,
      expired: now > this.approval.validUntilMs,
    } : null;
    return {
      schema: 'safe-cycle-handoff-v1',
      linkState: this.linkState(now),
      lastLinkMs: this.lastLinkMs,
      approval,
    };
  }
}
