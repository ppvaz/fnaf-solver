// Source-correct Balloon Boy cue interpreter for canonical Minus 7.
//
// Audio reports observations; it never grants permission by itself. This
// tracker keeps every route position still possible after silent moves and
// missed cue components. Callers may act only on the returned directive, and
// a bang is attributable to BB only while all seven stalls and the Puppet box
// invariant are current.

export const BB_POSITION = Object.freeze({
  CAM10: 'cam10',
  CAM7: 'cam7',
  CAM3: 'cam3',
  CAM1: 'cam1',
  CAM5: 'cam5',
  CAM5_PENDING: 'cam5-pending',
  OPENING: 'opening',
});

const ROUTE_MOVE = new Map([
  [BB_POSITION.CAM10, { to: BB_POSITION.CAM7, emits: [] }],
  [BB_POSITION.CAM7, { to: BB_POSITION.CAM3, emits: ['bb_voice'] }],
  [BB_POSITION.CAM3, { to: BB_POSITION.CAM1, emits: ['bb_voice'] }],
  [BB_POSITION.CAM1, { to: BB_POSITION.CAM5, emits: ['bb_voice', 'bang'] }],
]);

function keys(events) {
  const accepted = new Set();
  let ambiguousVoice = false;
  for (const event of events ?? []) {
    if (event.cue === 'bb_voice') {
      // The same samples can play loudly when BB is on the selected feed.
      // Only the separately level/context-qualified route class advances him.
      if (event.role === 'route') accepted.add('bb_voice');
      else ambiguousVoice = true;
    } else if (event.cue === 'bang') {
      accepted.add('bang');
    }
  }
  return { accepted, ambiguousVoice };
}

function compatible(observed, emitted) {
  const available = new Set(emitted);
  for (const cue of observed) if (!available.has(cue)) return false;
  return true;
}

function sorted(states) {
  const order = Object.values(BB_POSITION);
  return [...states].sort((a, b) => order.indexOf(a) - order.indexOf(b));
}

export class BbCueState {
  constructor() {
    this.positions = new Set([BB_POSITION.CAM10]);
    this.masked = false;
    this.maskTicks = 0;
    this.fault = null;
  }

  snapshot() {
    return Object.freeze({
      positions: sorted(this.positions),
      masked: this.masked,
      maskTicks: this.maskTicks,
      fault: this.fault,
      directive: this.directive(),
    });
  }

  directive() {
    if (this.fault) return 'abort';
    if (this.masked) return 'hold-mask';
    if (this.positions.size === 1 && this.positions.has(BB_POSITION.OPENING))
      return 'mask-now';
    if (this.positions.has(BB_POSITION.OPENING)) return 'opening-ambiguous';
    if (this.positions.has(BB_POSITION.CAM5_PENDING)) return 'await-opening';
    if (this.positions.has(BB_POSITION.CAM5)) return 'prepare-cam5';
    return 'continue';
  }

  fail(reason) {
    this.fault ??= reason;
    return this.snapshot();
  }

  validate(events, invariants) {
    const observed = keys(events);
    if (observed.accepted.has('bang') &&
        (!invariants?.stunsCurrent || !invariants?.boxWound)) {
      this.fail('bang-attribution-invalid');
    }
    return observed;
  }

  // One sourced five-second movement opportunity. A missing cue never proves
  // no move: both the stay and every legal move remain in the set.
  movementOpportunity({ monitorUp, events = [], invariants } = {}) {
    if (this.fault || this.masked) return this.fail(this.fault ?? 'movement-while-masked');
    const { accepted, ambiguousVoice } = this.validate(events, invariants);
    if (this.fault) return this.snapshot();
    const candidates = [];
    for (const from of this.positions) {
      candidates.push({ to: from, emits: [] });
      const route = ROUTE_MOVE.get(from);
      if (route) candidates.push(route);
      if (from === BB_POSITION.CAM5) {
        candidates.push(monitorUp
          ? { to: BB_POSITION.OPENING, emits: ['bang', 'bb_voice'] }
          : { to: BB_POSITION.CAM5_PENDING, emits: [] });
      }
      if (from === BB_POSITION.CAM5_PENDING && monitorUp)
        candidates.push({ to: BB_POSITION.OPENING, emits: ['bang', 'bb_voice'] });
    }
    const next = new Set(candidates
      .filter(candidate => compatible(accepted, candidate.emits))
      .map(candidate => candidate.to));
    if (!next.size) return this.fail('cue-route-contradiction');
    this.positions = next;
    if (ambiguousVoice && this.directive() === 'continue')
      return { ...this.snapshot(), note: 'view-or-route-voice-ignored' };
    return this.snapshot();
  }

  // A successful final roll made with cams down is latched and is spent when
  // the next monitor raise completes. This is distinct from a 5 s opportunity.
  monitorRaised({ events = [], invariants } = {}) {
    if (this.fault || this.masked) return this.fail(this.fault ?? 'raise-while-masked');
    const { accepted } = this.validate(events, invariants);
    if (this.fault) return this.snapshot();
    const candidates = [];
    for (const from of this.positions) {
      candidates.push({ to: from, emits: [] });
      if (from === BB_POSITION.CAM5_PENDING)
        candidates.push({ to: BB_POSITION.OPENING, emits: ['bang', 'bb_voice'] });
    }
    const next = new Set(candidates
      .filter(candidate => compatible(accepted, candidate.emits))
      .map(candidate => candidate.to));
    if (!next.size) return this.fail('raise-cue-contradiction');
    this.positions = next;
    return this.snapshot();
  }

  beginMask() {
    if (this.fault) return this.snapshot();
    if (this.positions.size !== 1 || !this.positions.has(BB_POSITION.OPENING))
      return this.fail('mask-without-confirmed-opening');
    this.masked = true;
    this.maskTicks = 0;
    return this.snapshot();
  }

  // Call for each bounded masked observation window. The departure bang can
  // arrive early. At five sourced ticks departure is guaranteed, but without
  // its timestamp the full-duration recovery deadline is unknowable; fail
  // closed instead of inventing an unmask time.
  maskedWindow({ events = [], elapsedTick = false, invariants } = {}) {
    if (this.fault || !this.masked) return this.fail(this.fault ?? 'masked-window-outside-mask');
    const { accepted } = this.validate(events, invariants);
    if (this.fault) return this.snapshot();
    if (accepted.has('bb_voice')) return this.fail('voice-while-awaiting-departure');
    if (accepted.has('bang')) {
      this.positions = new Set([BB_POSITION.CAM10]);
      this.masked = false;
      const early = this.maskTicks < 4;
      this.maskTicks = 0;
      return { ...this.snapshot(), directive: early ? 'recover-early' : 'recover-full' };
    }
    if (elapsedTick) this.maskTicks++;
    if (this.maskTicks >= 5) return this.fail('departure-cue-missed');
    return this.snapshot();
  }
}

