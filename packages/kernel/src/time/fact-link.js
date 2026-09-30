// Bounded host-to-actuator fact link for Plan 20 package 6.
//
// This is the transport contract, not an MCU driver.  It deliberately leaves
// the physical framing, baud rate, USB descriptor, and GPIO/HID mapping to a
// bench adapter.  The data that crosses that boundary is small, versioned,
// timestamped, and safe to reject when its clock or sequence is suspect.

export const FACT_MESSAGE_SCHEMA = 'fact-message-v1';
export const MAX_FACT_MESSAGE_BYTES = 1024;
export const MAX_FACT_TYPE_LENGTH = 64;
export const MAX_FACT_SOURCE_LENGTH = 64;
export const MAX_CALIBRATION_PROFILE_LENGTH = 96;
export const MAX_CYCLE_ACTIONS = 16;
export const MAX_CYCLE_HORIZON_MS = 15000;

const UINT32_MAX = 0xffffffff;
const clone = value => structuredClone(value);
const finite = value => Number.isFinite(value);

function invalid(message) { throw new TypeError(`fact link: ${message}`); }

function boundedString(name, value, max) {
  if (typeof value !== 'string' || value.length === 0 || value.length > max)
    invalid(`${name} must be a non-empty string of at most ${max} characters`);
  return value;
}

function optionalString(name, value, max) {
  if (value === null || value === undefined) return null;
  return boundedString(name, value, max);
}

function timestamp(name, value, { optional = false } = {}) {
  if (value === undefined && optional) return undefined;
  if (!finite(value) || value < 0) invalid(`${name} must be a finite non-negative number`);
  return value;
}

function primitiveValue(name, value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number' && finite(value)) return value;
  invalid(`${name} must be a JSON primitive`);
}

function sequence(value) {
  if (!Number.isInteger(value) || value < 0 || value > UINT32_MAX)
    invalid('seq must be an unsigned 32-bit integer');
  return value;
}

function validateMessage(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    invalid('message must be an object');
  if (input.schema !== FACT_MESSAGE_SCHEMA)
    invalid(`schema must be ${FACT_MESSAGE_SCHEMA}`);
  sequence(input.seq);
  boundedString('type', input.type, MAX_FACT_TYPE_LENGTH);
  const state = input.state ?? 'OBSERVED';
  if (state !== 'OBSERVED' && state !== 'UNKNOWN')
    invalid('state must be OBSERVED or UNKNOWN');
  if (state === 'OBSERVED') {
    if (!Object.hasOwn(input, 'value')) invalid('OBSERVED message needs value');
    primitiveValue('value', input.value);
  } else {
    if (Object.hasOwn(input, 'value')) invalid('UNKNOWN message cannot carry value');
    boundedString('reason', input.reason, 128);
  }
  boundedString('source', input.source, MAX_FACT_SOURCE_LENGTH);
  optionalString('calibrationProfile', input.calibrationProfile,
    MAX_CALIBRATION_PROFILE_LENGTH);
  const observed = timestamp('t_observed', input.t_observed, { optional: true });
  const received = timestamp('t_received', input.t_received);
  if (observed !== undefined && observed > received)
    invalid('t_observed cannot be later than t_received');
  const latencyMin = timestamp('latencyMin', input.latencyMin);
  const latencyMax = timestamp('latencyMax', input.latencyMax);
  if (latencyMin > latencyMax) invalid('latencyMin cannot exceed latencyMax');
  if (!finite(input.confidence) || input.confidence < 0 || input.confidence > 1)
    invalid('confidence must be between 0 and 1');
  return {
    schema: FACT_MESSAGE_SCHEMA,
    seq: input.seq,
    type: input.type,
    state,
    ...(state === 'OBSERVED' ? { value: input.value } : { reason: input.reason }),
    confidence: input.confidence,
    source: input.source,
    calibrationProfile: input.calibrationProfile ?? null,
    ...(observed === undefined ? {} : { t_observed: observed }),
    t_received: received,
    latencyMin,
    latencyMax,
  };
}

/** Encode one newline-delimited, bounded fact message. */
export function encodeFactMessage(input) {
  const message = validateMessage({
    ...input,
    schema: input?.schema ?? FACT_MESSAGE_SCHEMA,
  });
  const line = JSON.stringify(message);
  const bytes = new TextEncoder().encode(line + '\n').byteLength;
  if (bytes > MAX_FACT_MESSAGE_BYTES)
    throw new RangeError(`fact message is ${bytes} bytes; maximum is ${MAX_FACT_MESSAGE_BYTES}`);
  return line + '\n';
}

/** Decode one complete newline-delimited fact message. */
export function decodeFactMessage(line) {
  if (typeof line !== 'string') invalid('wire message must be a string');
  const bytes = new TextEncoder().encode(line).byteLength;
  if (bytes > MAX_FACT_MESSAGE_BYTES) throw new RangeError('fact message exceeds byte limit');
  if (!line.endsWith('\n')) invalid('wire message must end with newline');
  if (line.slice(0, -1).includes('\n')) invalid('wire message must contain one line');
  let parsed;
  try { parsed = JSON.parse(line.slice(0, -1)); }
  catch (error) { throw new TypeError(`fact link: invalid JSON (${error.message})`); }
  return validateMessage(parsed);
}

/** Convert a valid wire message to the estimator's fact-envelope shape. */
export function messageToFact(message, receivedAtMs) {
  const valid = /** @type {any} */ (validateMessage(message));
  const received = timestamp('link receipt time', receivedAtMs);
  const fact = valid.state === 'OBSERVED'
    ? { state: 'OBSERVED', value: valid.value }
    : { state: 'UNKNOWN', reason: valid.reason };
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

function serialDistance(next, previous) {
  return (next - previous + 0x100000000) % 0x100000000;
}

/**
 * Ordered receiver state for a newline-delimited fact stream.  A gap is
 * surfaced while the current message remains available; callers can then
 * choose UNKNOWN/recovery instead of silently treating the line as complete.
 */
export class FactLinkReceiver {
  constructor({ staleAfterMs = 1000, initialSeq = null } = {}) {
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

  /** @param {any} options */
  receive(line, options = {}) {
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

  status(nowMs = this.lastLinkReceiptMs ?? 0) {
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

function actionId(action, index) {
  const id = action?.id ?? `action-${index + 1}`;
  return boundedString('cycle action id', id, 64);
}

function validateCycleApproval({ cycleId, validFromMs, validUntilMs, actions }) {
  boundedString('cycleId', cycleId, 96);
  const from = timestamp('validFromMs', validFromMs);
  const until = timestamp('validUntilMs', validUntilMs);
  if (until < from) invalid('cycle validity cannot run backwards');
  if (until - from > MAX_CYCLE_HORIZON_MS)
    throw new RangeError(`cycle horizon exceeds ${MAX_CYCLE_HORIZON_MS} ms`);
  if (!Array.isArray(actions) || actions.length > MAX_CYCLE_ACTIONS)
    throw new RangeError(`cycle must contain 0-${MAX_CYCLE_ACTIONS} actions`);
  let previousAt = from;
  const safeActions = actions.map((action, index) => {
    if (!action || typeof action !== 'object' || Array.isArray(action))
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
  return { cycleId, validFromMs: from, validUntilMs: until, actions: safeActions };
}

/**
 * Local actuator-side drain for a cycle already approved by the host.  It
 * never creates a new action after link loss; it only releases due actions
 * from the bounded approval until its validity window expires.
 */
export class SafeCycleHandoff {
  constructor({ linkTimeoutMs = 500, maxActions = MAX_CYCLE_ACTIONS } = {}) {
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

  noteLink(receivedAtMs) {
    const now = timestamp('link activity time', receivedAtMs);
    if (this.lastLinkMs !== null && now < this.lastLinkMs)
      throw new RangeError('link activity time moved backwards');
    this.lastLinkMs = now;
    return this.status(now);
  }

  approve(approval) {
    const checked = validateCycleApproval(approval);
    if (checked.actions.length > this.maxActions)
      throw new RangeError(`cycle exceeds local action limit ${this.maxActions}`);
    if (this.approval && checked.validFromMs < this.approval.validFromMs)
      throw new RangeError('replacement cycle starts before the current approval');
    this.approval = checked;
    this.emitted = new Set();
    return this.status(this.lastLinkMs ?? checked.validFromMs);
  }

  due(nowMs) {
    const now = timestamp('cycle poll time', nowMs);
    if (!this.approval || now > this.approval.validUntilMs) return [];
    const out = [];
    for (const action of this.approval.actions) {
      if (action.atMs > now || this.emitted.has(action.id)) continue;
      this.emitted.add(action.id);
      out.push({ ...clone(action), cycleId: this.approval.cycleId,
        linkState: this.linkState(now) });
    }
    return out;
  }

  linkState(nowMs) {
    const now = timestamp('link state time', nowMs);
    if (this.lastLinkMs === null) return 'UNSEEN';
    return now - this.lastLinkMs > this.linkTimeoutMs ? 'STALE' : 'HEALTHY';
  }

  status(nowMs = this.lastLinkMs ?? 0) {
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
