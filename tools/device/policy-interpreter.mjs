// Finite semantic interpreter for policy-v1 (Plan 21 package 2 foundation).
// It expands only the reviewed action modes in the IR; it has no shell or
// callback escape hatch. A later Sim adapter can consume this event stream.
import { validatePolicy } from '@sixam/core/control';
import { Sim } from '@sixam/core/mechanics';
import * as C from '@sixam/core/mechanics';

const control = action => action.startsWith('cam') ? `cam:${action.slice(3)}`
  : action === 'ventl' ? 'light' : action;

function expandAction(action, baseMs, out) {
  const atMs = baseMs + (action.atMs ?? action.offsetMs ?? 0);
  const mode = action.mode ?? 'tap';
  if (mode === 'camdrop') {
    out.push({ atMs, kind: 'press', action: 'light' });
    out.push({ atMs: atMs + action.leadMs, kind: 'press', action: 'monitor' });
    out.push({ atMs: atMs + action.leadMs + action.durationMs + action.tailMs,
      kind: 'release', action: 'light' });
  } else if (mode === 'hold' || mode === 'hall') {
    const name = mode === 'hall' ? 'light' : control(action.action);
    out.push({ atMs, kind: 'press', action: name });
    out.push({ atMs: atMs + action.durationMs, kind: 'release', action: name });
  } else {
    out.push({ atMs, kind: 'press', action: control(action.action) });
  }
}

export function compilePolicy(program, { untilMs = Infinity } = {}) {
  validatePolicy(program);
  // This compiler produces one unconditional event stream. An
  // observation-conditioned branch has no expansion here: flattening it into
  // either arm would replay a DIFFERENT program from the one being searched,
  // and the exact-engine replay built on this stream would report that
  // program's survival under the branch's name. Refuse instead. A branched
  // interpreter -- one that reads facts through the Observer as the night
  // runs -- is the next prerequisite (Plan 21 package 2, unported).
  for (const phase of program.phases) {
    if ((phase.branches ?? []).length)
      throw new TypeError(`policy interpreter: phase ${phase.id} carries observation-conditioned branches; this compiler evaluates unconditional programs only`);
  }
  const events = [];
  for (const phase of program.phases) {
    if (phase.kind === 'repeat') {
      for (let base = phase.startMs; base < Math.min(phase.endMs, untilMs);
           base += phase.periodMs) {
        for (const action of phase.actions ?? []) expandAction(action, base, events);
      }
    } else if (phase.kind !== 'idle' && phase.kind !== 'observe') {
      for (const action of phase.actions ?? []) expandAction(action, 0, events);
    }
  }
  // A release at a phase seam must happen before the next press at that same
  // timestamp. This matches schedule()'s insertion order and prevents a
  // terminal camera visit from racing a still-held wind/light action.
  return events.filter(event => event.atMs <= untilMs)
    .sort((a, b) => a.atMs - b.atMs || (a.kind === 'release' ? -1 : 1));
}

// The first exact-engine adapter. It deliberately consumes the same semantic
// events as the phone compiler; no policy-specific timeline is copied here.
export function replayPolicy(program, {
  night = 1, seed = 1, worst = false, untilMs = Infinity,
} = {}) {
  const sim = new Sim({ night, seed, worst });
  const events = compilePolicy(program, { untilMs });
  let i = 0;
  const endFrame = Number.isFinite(untilMs)
    ? Math.ceil(untilMs * C.FPS / 1000) : C.NIGHT_FRAMES;
  while (sim.alive && !sim.won && sim.frame <= endFrame) {
    while (i < events.length && Math.round(events[i].atMs * C.FPS / 1000) <= sim.frame) {
      const event = events[i++];
      if (event.kind === 'press' || event.kind === 'release') sim[event.kind](event.action);
    }
    sim.tick();
  }
  return { sim, events };
}
