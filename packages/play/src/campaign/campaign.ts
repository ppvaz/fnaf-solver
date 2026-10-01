/**
 * Campaign control plane for story Nights 1..6 and Custom Night 7.
 *
 * This module owns the distinction between story-night menu targets and a
 * Custom Night run. It does not choose coordinates or send input; those
 * remain ports supplied by the composition root. A campaign can only become
 * COMPLETE after positive 6 AM and save/menu evidence.
 *
 * An Invalid run (the kernel's Invalid(why): the night was played but tests
 * nothing) does not spend a campaign attempt, and the campaign holds after
 * two consecutive Invalid runs (ADR 0002, decision 3). Attempt numbers stay
 * one per run played; the budget counts the runs that were not Invalid.
 * CONTRACT:device-campaign-v1.
 */
import { AI_10_20, AI_DIALS, PUPPET_AI } from '@sixam/source/fnaf2';
import { CAMPAIGN_STATES, stableHash, validateCampaignResult } from '@sixam/kernel/contracts';
import { makeCustomNightConfig, validateCustomNightConfig } from './custom-night.ts';

const CAMPAIGN_SCHEMA = 'device-campaign-v1';
// The result validator and its state list live in kernel/contracts (core/contracts until 2026-09-30) since
// 2026-09-29, so the evidence index reads a retained result without importing
// this app; the state list is re-exported here unchanged.
export { CAMPAIGN_STATES };

const PACKAGE = 'com.scottgames.fnaf2';
const NIGHT5 = 5;
const NIGHT6 = 6;
const NIGHT7 = 7;
export const DEFAULT_CAMPAIGN_NIGHTS = Object.freeze([1, 2, 3, 4, 5, 6, NIGHT7]);
/** Consecutive Invalid runs after which the campaign holds (ADR 0002, decision 3). */
const INVALID_RUNS_HOLD = 2;
const MENU_TARGETS = new Set(['newGame', 'continue', 'sixthNight', 'customNight']);
const TRANSITIONS = Object.freeze({
  IDLE: ['PREFLIGHT'],
  PREFLIGHT: ['MENU', 'HOLD', 'ABORTED'],
  HOLD: ['PREFLIGHT', 'ABORTED'],
  MENU: ['INTRO_VERIFY', 'CUSTOM_VERIFY', 'ABORTED', 'HOLD'],
  CUSTOM_VERIFY: ['INTRO_VERIFY', 'ABORTED', 'HOLD'],
  INTRO_VERIFY: ['ACTIVE', 'ABORTED', 'HOLD'],
  ACTIVE: ['TERMINAL_VERIFY', 'RETRY_VERIFY', 'ABORTED', 'HOLD'],
  TERMINAL_VERIFY: ['SAVE_VERIFY', 'ABORTED', 'HOLD'],
  RETRY_VERIFY: ['MENU', 'ABORTED', 'HOLD'],
  SAVE_VERIFY: ['MENU', 'COMPLETE', 'ABORTED', 'HOLD'],
  ABORTED: [],
  COMPLETE: [],
});

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fail = message => { throw new TypeError(`campaign: ${message}`); };
const text = (value, label) => {
  if (typeof value !== 'string' || value.length === 0) fail(`${label} must be a non-empty string`);
  return value;
};
const integer = (value, label, { min = 0, max = Infinity } = {}) => {
  if (!Number.isInteger(value) || value < min || value > max) fail(`${label} must be an integer in ${min}..${max}`);
  return value;
};

function validateNight(entry, index) {
  if (!isRecord(entry)) fail(`nights[${index}] must be an object`);
  integer(entry.night, `nights[${index}].night`, { min: 1, max: 7 });
  if (entry.night === NIGHT7) {
    if (entry.mode !== 'custom' || entry.menuTarget !== 'customNight')
      fail('Night 7 must use mode=custom and menuTarget=customNight');
    if (!isRecord(entry.dials)) fail('Night 7 dials are required');
    for (const dial of AI_DIALS) integer(entry.dials[dial], `nights[${index}].dials.${dial}`, { max: AI_10_20 });
    if (entry.puppet !== PUPPET_AI) fail(`Night 7 puppet must be ${PUPPET_AI}`);
    if (entry.custom !== undefined) {
      try { validateCustomNightConfig(entry.custom); }
      catch (error) { fail(`Night 7 custom configuration is invalid: ${error.message}`); }
    }
    const extras = Object.keys(entry.dials).filter(dial => !AI_DIALS.includes(dial));
    if (extras.length) fail(`Night 7 has unknown dials: ${extras.join(',')}`);
  } else {
    // Story nights 1..6. Night identity comes from the selection chain: a
    // fresh-save newGame start, a chained continue after the previous
    // night's observed 6 AM, or the measured sixthNight item for Night 6.
    const allowedTargets = entry.night === 1 ? ['newGame', 'continue']
      : entry.night === NIGHT6 ? ['continue', 'sixthNight'] : ['continue'];
    if (entry.mode !== 'story' || !allowedTargets.includes(entry.menuTarget))
      fail(`Night ${entry.night} must use mode=story and menuTarget=${allowedTargets.join(' or ')}`);
    if (entry.menuTarget === 'continue' && entry.saveCursorObserved !== undefined &&
        entry.saveCursorObserved !== null && entry.saveCursorObserved !== entry.night)
      fail(`Night ${entry.night} saveCursorObserved must be ${entry.night} when supplied`);
  }
  if (entry.timing !== undefined) {
    if (!isRecord(entry.timing)) fail(`nights[${index}].timing must be an object`);
    for (const key of ['periodMs', 'loopStartMs', 'stopAtMs', 'observeUntilMs', 'idleUntilMs'])
      integer(entry.timing[key], `nights[${index}].timing.${key}`);
    if (entry.timing.phaseOffsetMs !== undefined)
      integer(entry.timing.phaseOffsetMs, `nights[${index}].timing.phaseOffsetMs`, { max: 2000 });
    if (entry.timing.periodMs < 1 || entry.timing.stopAtMs <= entry.timing.loopStartMs ||
        entry.timing.observeUntilMs < entry.timing.stopAtMs || entry.timing.idleUntilMs > entry.timing.loopStartMs)
      fail(`nights[${index}].timing bounds are invalid`);
  }
  if (!MENU_TARGETS.has(entry.menuTarget)) fail(`nights[${index}].menuTarget is unsupported`);
  if (entry.policy !== undefined) text(entry.policy, `nights[${index}].policy`);
  return entry;
}

/** Validate the complete, serializable campaign specification. */
export function validateCampaignSpec(value) {
  if (!isRecord(value) || value.schema !== CAMPAIGN_SCHEMA || value.version !== 1)
    fail('schema/version mismatch');
  if (!isRecord(value.target)) fail('target is required');
  if (value.target.package !== PACKAGE) fail(`target.package must be ${PACKAGE}`);
  text(value.target.build, 'target.build');
  text(value.profile, 'profile');
  if (!Array.isArray(value.nights) || value.nights.length < 1 || value.nights.length > 7)
    fail('nights must contain one to seven targets');
  const seen = new Set();
  for (const [index, entry] of value.nights.entries()) {
    validateNight(entry, index);
    if (seen.has(entry.night)) fail(`night ${entry.night} is duplicated`);
    seen.add(entry.night);
    if (index > 0 && entry.night !== value.nights[index - 1].night + 1)
      fail('story nights must form one ascending consecutive chain');
  }
  if (!isRecord(value.retry) || !Number.isInteger(value.retry.maxAttempts) ||
      value.retry.maxAttempts < 1 || value.retry.maxAttempts > 5)
    fail('retry.maxAttempts must be an integer in 1..5');
  if (value.proof?.requireSixAm !== true || value.proof?.requireSaveOrMenu !== true)
    fail('proof must require positive six-AM and save/menu evidence');
  if (value.mechanics !== undefined) validateMechanics(value.mechanics);
  return value;
}

/**
 * The mechanics a run carries from its bundle (Pedro, 2026-09-30: a RunSpec's
 * constraints travel with the bundle): what the strategy requires and what
 * the build and the run forbid, never both.
 */
function validateMechanics(mechanics: any) {
  const ids = (value, label) => {
    if (!Array.isArray(value) || value.some(id => typeof id !== 'string' || id.trim() === ''))
      fail(`mechanics.${label} must list mechanic ids`);
    return value;
  };
  if (!isRecord(mechanics) || Object.keys(mechanics).some(key => key !== 'requires' && key !== 'forbidden'))
    fail('mechanics is {requires, forbidden}');
  const forbidden = ids(mechanics.forbidden, 'forbidden');
  const clash = ids(mechanics.requires, 'requires').filter(id => forbidden.includes(id));
  if (clash.length) fail(`the run forbids ${clash.join(', ')}, which its strategy requires`);
}

/** Construct a reviewed campaign over any consecutive story-night chain. */
export function makeCampaignSpec({ profile, targetBuild, maxAttempts = 3,
  night6MenuTarget = 'sixthNight', timingByNight = {}, nights = [...DEFAULT_CAMPAIGN_NIGHTS],
  storyStart = undefined, storySaveCursor = undefined, night7Dials = undefined, mechanics = undefined }: {profile?: string, targetBuild?: string, maxAttempts?: number, night6MenuTarget?: string, timingByNight?: Record<string, object>, nights?: number[], storyStart?: string, storySaveCursor?: number, night7Dials?: Record<string, number>, mechanics?: {requires: string[], forbidden: string[]}} = {}) {
  text(profile, 'profile');
  text(targetBuild, 'targetBuild');
  if (!['continue', 'sixthNight'].includes(night6MenuTarget))
    fail('night6MenuTarget must be continue or sixthNight');
  if (night7Dials !== undefined) {
    if (!isRecord(night7Dials)) fail('night7Dials must be an object of dial -> AI');
    for (const dial of AI_DIALS) {
      if (!Number.isInteger(night7Dials[dial]) || night7Dials[dial] < 0 || night7Dials[dial] > AI_10_20)
        fail(`night7Dials.${dial} must be an integer in 0..${AI_10_20}`);
    }
    for (const key of Object.keys(night7Dials)) if (!AI_DIALS.includes(key))
      fail(`night7Dials has unknown dial ${key}`);
  }
  if (!Array.isArray(nights) || nights.length < 1 || nights.length > 7 ||
      nights.some(night => !Number.isInteger(night) || night < 1 || night > 7) ||
      new Set(nights).size !== nights.length)
    fail('nights must be a unique set of nights in 1..7');
  const storyNights = nights.filter(night => night !== NIGHT7);
  if (storyStart !== undefined && !['newGame', 'continue'].includes(storyStart))
    fail('storyStart must be newGame or continue');
  if (storyStart === 'newGame' && storyNights[0] !== 1)
    fail('storyStart=newGame requires the chain to begin at Night 1');
  if (storySaveCursor !== undefined && (!Number.isInteger(storySaveCursor) ||
      storySaveCursor !== storyNights[0]))
    fail('storySaveCursor must equal the first story night of the chain');
  if (!isRecord(timingByNight)) fail('timingByNight must be an object');
  const dials = night7Dials ? { ...night7Dials }
    : Object.fromEntries(AI_DIALS.map(dial => [dial, AI_10_20]));
  const timing = night => timingByNight[String(night)] ??
    { periodMs: 10000, loopStartMs: 0, stopAtMs: 420000, observeUntilMs: 420000, idleUntilMs: 0 };
  const firstStoryNight = storyNights[0];
  const defaultFirstTarget = firstStoryNight === 1 ? 'newGame' : 'continue';
  const entries = nights.map(night => {
    if (night === NIGHT7) return { night, mode: 'custom', menuTarget: 'customNight',
      custom: makeCustomNightConfig(dials), dials, puppet: PUPPET_AI, timing: timing(night) };
    const menuTarget = night === NIGHT6 ? night6MenuTarget
      : night === firstStoryNight ? (storyStart ?? defaultFirstTarget) : 'continue';
    return { night, mode: 'story', menuTarget,
      ...(menuTarget === 'continue' ? {
        saveCursorObserved: night === firstStoryNight ? (storySaveCursor ?? null) : null,
      } : {}),
      timing: timing(night) };
  });
  return validateCampaignSpec({
    schema: CAMPAIGN_SCHEMA, version: 1,
    target: { package: PACKAGE, build: targetBuild }, profile,
    nights: entries,
    retry: { maxAttempts },
    proof: { requireSixAm: true, requireSaveOrMenu: true },
    ...(mechanics === undefined ? {} : { mechanics: { requires: [...mechanics.requires], forbidden: [...mechanics.forbidden] } }),
  });
}

function event(state, type, data, at) {
  return Object.freeze({ schema: 'campaign-event-v1', type, state, at, data: structuredClone(data ?? {}) });
}

/**
 * The venue-check-v1 a campaign result recorded at preflight, or null when
 * its preflight predates venue identity (every result before 2026-09-29).
 * @param result a device-campaign-result-v1
 */
export function campaignVenue(result: any) {
  const preflight = result?.events?.find(item => item?.type === 'campaign.state' &&
    item.data?.previous === 'PREFLIGHT');
  return preflight?.data?.venue ?? null;
}

/**
 * Small deterministic FSM used by both a CLI runner and a future app runner.
 * Ports call the observation methods only after their own transport has
 * returned a bounded, identity-checked result.
 */
export class CampaignStateMachine {
  declare spec: any;
  declare now: () => number;
  declare onEvent: (record: any) => void;
  declare state: string;
  declare targetIndex: number;
  declare attempt: number;
  declare invalidRuns: number;
  declare consecutiveInvalid: number;
  declare events: any[];
  declare attempts: any[];
  declare activeAttempt: { night: any; mode: any; attempt: number; status: string; };
  constructor({ spec, now = () => performance.now(), onEvent = ((() => {}) as (record: any) => void) }: {spec?: any, now?: () => number, onEvent?: (record: any) => void} = {}) {
    this.spec = validateCampaignSpec(spec);
    this.now = now;
    this.onEvent = onEvent;
    this.state = 'IDLE';
    this.targetIndex = 0;
    this.attempt = 0;
    // Runs of the current target that were Invalid, and Invalid runs in a row.
    this.invalidRuns = 0;
    this.consecutiveInvalid = 0;
    this.events = [];
    this.attempts = [];
    this.activeAttempt = null;
  }

  get target() { return this.spec.nights[this.targetIndex] ?? null; }

  /** Attempts of the current target that count against the budget: every run but the Invalid ones. */
  get spentAttempts() { return this.attempt - this.invalidRuns; }

  snapshot() {
    return {
      schema: CAMPAIGN_SCHEMA, version: 1, state: this.state,
      specHash: stableHash(this.spec), targetIndex: this.targetIndex,
      target: this.target, attempt: this.attempt, eventCount: this.events.length,
      attempts: this.attempts.length, invalidRuns: this.invalidRuns, consecutiveInvalid: this.consecutiveInvalid,
    };
  }

  result() {
    return validateCampaignResult(Object.freeze({ schema: 'device-campaign-result-v1', version: 1,
      specHash: stableHash(this.spec), state: this.state, targetIndex: this.targetIndex,
      completedNights: this.attempts.filter(item => item.proof).map(item => item.night),
      attempts: structuredClone(this.attempts), events: structuredClone(this.events) }));
  }

  transition(next, data = {}) {
    if (!CAMPAIGN_STATES.includes(next)) fail(`unknown state ${next}`);
    if (!TRANSITIONS[this.state].includes(next)) fail(`cannot transition ${this.state} -> ${next}`);
    const previous = this.state;
    this.state = next;
    const record = event(next, 'campaign.state', { previous, ...data }, this.now());
    this.events.push(record);
    this.onEvent(record);
    return this.snapshot();
  }

  // The run's mechanics go in the first event, so the result -- and the pack
  // made from it -- names them, as the spec hash covers them.
  startPreflight() {
    return this.transition('PREFLIGHT', this.spec.mechanics ? { mechanics: structuredClone(this.spec.mechanics) } : {});
  }

  acceptPreflight(result: any) {
    // A device-preflight-v2 carries the venue it observed; the transition
    // event keeps it, so the campaign result names the venue it ran on.
    const venue = result?.venue ? { venue: structuredClone(result.venue) } : {};
    if (result?.status !== 'READY') return this.transition('HOLD', { reason: result?.reason ?? 'device-not-ready', ...venue });
    return this.transition('MENU', { device: result.serial ?? null, ...venue });
  }

  acceptMenu({ target, visible = false, selected = false, rolledThrough = false }: {target?: string, visible?: boolean, selected?: boolean, rolledThrough?: boolean} = {}) {
    // A story night the game rolled straight into after the previous night's
    // observed 6 AM was selected by the roll itself: selected is required,
    // visible is not, because no title screen ever appeared.
    if (target !== this.target?.menuTarget || !(rolledThrough ? selected : visible && selected))
      return this.transition('HOLD', { reason: 'menu-observation-not-confirmed', target, expected: this.target?.menuTarget });
    return this.target?.mode === 'custom'
      ? this.transition('CUSTOM_VERIFY', { target })
      : this.transition('INTRO_VERIFY', { target });
  }

  acceptCustomConfiguration(result: {status?: string, dials?: object, puppet?: number, readback?: object} = {}) {
    const target = this.target;
    const expected = target?.mode === 'custom' ? validateCustomNightConfig(target.custom ?? makeCustomNightConfig(target.dials)) : null;
    const sameDials = expected && AI_DIALS.every(dial => result.dials?.[dial] === expected.dials[dial]);
    const readbackDials = expected && AI_DIALS.every(dial => (result.readback as any)?.dials?.[dial] === expected.dials[dial]);
    if (target?.mode !== 'custom' || result.status !== 'PASS' || result.puppet !== PUPPET_AI ||
        !sameDials || !readbackDials || (result.readback as any)?.puppet !== PUPPET_AI)
      return this.transition('HOLD', { reason: 'custom-night-readback-not-confirmed' });
    return this.transition('INTRO_VERIFY', { target: 'customNight', readback: true });
  }

  acceptIntro({ night, identity, observed = false }: {night?: number, identity?: string, observed?: boolean} = {}) {
    if (!observed || night !== this.target?.night ||
        identity !== this.target.mode)
      return this.transition('HOLD', { reason: 'intro-identity-not-confirmed', night, identity });
    return this.transition('ACTIVE', { night });
  }

  beginAttempt() {
    if (this.state !== 'ACTIVE') fail('beginAttempt requires ACTIVE');
    this.attempt += 1;
    if (this.spentAttempts > this.spec.retry.maxAttempts) {
      this.transition('ABORTED', { reason: 'attempt-budget-exhausted' });
      return this.snapshot();
    }
    const record = { night: this.target.night, mode: this.target.mode, attempt: this.attempt, status: 'ACTIVE' };
    this.attempts.push(record);
    this.activeAttempt = record;
    const attemptEvent = event(this.state, 'campaign.attempt', { night: this.target.night, attempt: this.attempt }, this.now());
    this.events.push(attemptEvent); this.onEvent(attemptEvent);
    return this.snapshot();
  }

  acceptTerminal({ night, outcome, sixAm = false, why }: {night?: number, outcome?: string, sixAm?: boolean, why?: string} = {}) {
    if (this.activeAttempt) (this.activeAttempt as any).terminal = { night, outcome, sixAm, ...(why === undefined ? {} : { why }) };
    if (night !== this.target?.night) return this.transition('HOLD', { reason: 'terminal-night-identity-unknown', night });
    if (outcome === 'invalid') return this.#acceptInvalid(night, why);
    this.consecutiveInvalid = 0;
    if (outcome === 'unknown') return this.transition('HOLD', { reason: 'terminal-outcome-unknown', night });
    if (outcome === 'death') {
      if (this.activeAttempt) this.activeAttempt.status = 'DEATH';
      return this.transition('RETRY_VERIFY', { reason: 'attempt-ended-with-death', night });
    }
    if (outcome !== 'sixam' || sixAm !== true)
      return this.transition('ABORTED', { reason: 'terminal-win-not-proven', night, outcome });
    return this.transition('TERMINAL_VERIFY', { night, outcome });
  }

  /**
   * An Invalid run is refunded: it goes to the same retry as a death but
   * leaves the budget as it was. The second in a row holds instead, so a
   * cause that invalidates every run cannot replay the night without end.
   */
  #acceptInvalid(night: number, why: string | undefined) {
    if (typeof why !== 'string' || why.length === 0)
      return this.transition('HOLD', { reason: 'terminal-invalid-without-reason', night });
    this.invalidRuns += 1;
    this.consecutiveInvalid += 1;
    if (this.activeAttempt) this.activeAttempt.status = 'INVALID';
    if (this.consecutiveInvalid >= INVALID_RUNS_HOLD)
      return this.transition('HOLD', { reason: 'consecutive-invalid-runs', night, why, consecutive: this.consecutiveInvalid });
    return this.transition('RETRY_VERIFY', { reason: 'attempt-invalid', night, why });
  }

  acceptRetry({ menuReady = false }: {menuReady?: boolean} = {}) {
    if (!menuReady) return this.transition('HOLD', { reason: 'retry-menu-not-confirmed' });
    if (this.spentAttempts >= this.spec.retry.maxAttempts)
      return this.transition('ABORTED', { reason: 'attempt-budget-exhausted' });
    return this.transition('MENU', { retry: true, attempt: this.attempt + 1 });
  }

  acceptTerminalVerification({ sixAm = false, positive = false }: {sixAm?: boolean, positive?: boolean} = {}) {
    if (sixAm !== true || positive !== true)
      return this.transition('ABORTED', { reason: 'terminal-verification-failed' });
    if (this.activeAttempt) (this.activeAttempt as any).terminalVerification = { sixAm, positive };
    return this.transition('SAVE_VERIFY', { sixAm: true });
  }

  acceptSave({ cursorNight, menuReturned = false, customCompleted = false, observed = false,
    customNightVisible = false, continueVisible = false, sixthNightVisible = false, nextNightStarted = false,
    dials, puppet, customReadback, proofHash }: {cursorNight?: number, customNightVisible?: boolean, menuReturned?: boolean, customCompleted?: boolean, observed?: boolean, continueVisible?: boolean, sixthNightVisible?: boolean, nextNightStarted?: boolean, dials?: object, puppet?: number, customReadback?: object, proofHash?: string} = {}) {
    const target = this.target;
    // Save advancement is night-specific positive evidence: Night 6 unlocks
    // Custom Night, and Night 5 reveals the measured sixthNight item (or the
    // cursor reads 6). Continue is NOT evidence: it renders on every FNaF 2
    // title frame read, a fresh save included (89 of 89,
    // docs/evidence/fnaf2-title-items-calibration-20261001.json; mistake
    // register item 2), so `continueVisible` below only confirms a title read.
    // Nights 1..4 are the exception: on this build the game rolls a 6 AM
    // straight into the next night's gameplay without any menu — regardless
    // of whether the spec chains another night — so the observed roll into
    // night N+1 is itself the advancement evidence and the Continue-visible
    // proof is deferred to the chain's title return. Night 5 never rolls:
    // its 6 AM ends in the paycheck and the title.
    const rollsIntoNext = target?.night >= 1 && target?.night < NIGHT5;
    const valid = target?.night === NIGHT6
      ? observed === true && (cursorNight === NIGHT7 || customNightVisible === true)
      : target?.night === NIGHT7
        ? menuReturned === true && customCompleted === true && observed === true
        : rollsIntoNext
          ? observed === true && nextNightStarted === true
          : observed === true && menuReturned === true && continueVisible === true &&
            (target.night < NIGHT5 || sixthNightVisible === true || cursorNight === 6);
    if (!valid) return this.transition('ABORTED', { reason: 'save-or-menu-advancement-not-proven', cursorNight });
    const completedNight = target.night;
    if (this.activeAttempt) {
      (this.activeAttempt as any).save = { cursorNight, customNightVisible, continueVisible, sixthNightVisible,
        menuReturned, customCompleted, nextNightStarted, observed };
      if (target.night === NIGHT7) (this.activeAttempt as any).customReadback = { dials, puppet, ...customReadback };
      if (proofHash) (this.activeAttempt as any).proofHash = proofHash;
      this.activeAttempt.status = 'WIN';
      (this.activeAttempt as any).proof = true;
    }
    if (this.targetIndex + 1 < this.spec.nights.length) {
      this.targetIndex += 1;
      this.attempt = 0;
      this.invalidRuns = 0;
      return this.transition('MENU', { completedNight });
    }
    return this.transition('COMPLETE', { completedNight });
  }

  hold(reason = 'operator-hold') {
    if (this.state === 'HOLD') return this.snapshot();
    if (!TRANSITIONS[this.state].includes('HOLD')) fail(`cannot hold from ${this.state}`);
    return this.transition('HOLD', { reason });
  }

  resume() {
    if (this.state !== 'HOLD') fail('resume requires HOLD');
    // Resuming is the operator's decision on whatever held the run, so the
    // Invalid runs are counted afresh; the attempt budget is not.
    this.consecutiveInvalid = 0;
    return this.transition('PREFLIGHT');
  }

  abort(reason = 'operator-abort') {
    if (this.state === 'ABORTED' || this.state === 'COMPLETE') return this.snapshot();
    return this.transition('ABORTED', { reason });
  }
}

