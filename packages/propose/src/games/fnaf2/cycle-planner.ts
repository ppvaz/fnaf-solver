// Receding-horizon selection over the finite cycle library (Plan 20 P5
// foundation). The selector never averages away a plausible unsafe state:
// every candidate must pass the local/exact gate for every active hypothesis.
import { gateCycle } from './cycle-library.ts';
import type { ContactConstraints, Cycle } from './cycle-library.ts';
import type { ReducedState } from '@sixam/source/games/fnaf2/reduced-model.ts';

/** One plausible world the controller cannot yet rule out, as a reduced state. */
interface Hypothesis {
  readonly id: string;
  readonly state: ReducedState;
  readonly plausible?: boolean;
}
type GateDecision = ReturnType<typeof gateCycle>;
/** The sourced route model's verdict on a gated cycle: its risk and the resources it leaves. */
type Score = (cycle: Cycle, hypothesis: Hypothesis, gate: GateDecision) => unknown;

const clone = <T>(value: T): T => structuredClone(value);
const finite = (value: unknown): value is number => Number.isFinite(value);

function invalid(message: string): never { throw new TypeError(`cycle planner: ${message}`); }

function scoreOne(score: Score, cycle: Cycle, hypothesis: Hypothesis, gate: GateDecision) {
  const result = score(cycle, hypothesis, gate) as { risk?: unknown, resourceMargin?: unknown, detail?: unknown } | null | undefined;
  if (!result || !finite(result.risk) || result.risk < 0 ||
      !finite(result.resourceMargin))
    invalid(`score for ${cycle.id}/${hypothesis.id} is invalid`);
  return { risk: result.risk, resourceMargin: result.resourceMargin,
    detail: result.detail ?? null };
}
/**
 * Evaluate and select one primitive. `score` is supplied by the sourced route
 * model; no hidden simulator state is consulted here. The returned decisions
 * form an auditable record of both rejected and selected candidates.
 */
export function selectCycle(cycles: readonly Cycle[], hypotheses: readonly Hypothesis[], options: {
  constraints?: ContactConstraints | null,
  exactGate?: (cycle: Cycle, hypothesis: Hypothesis) => unknown, score?: Score } = {}) {
  const { constraints, exactGate, score } = options;
  if (!Array.isArray(cycles) || !cycles.length) invalid('cycles are required');
  if (!Array.isArray(hypotheses) || !hypotheses.length) invalid('hypotheses are required');
  if (typeof exactGate !== 'function') invalid('exactGate callback is required');
  if (typeof score !== 'function') invalid('score callback is required');
  const active = hypotheses.filter(hypothesis => hypothesis.plausible !== false);
  if (!active.length) invalid('no plausible hypotheses remain');

  const decisions = cycles.map(cycle => {
    const gates = active.map(hypothesis => {
      const gate = gateCycle(cycle, hypothesis.state, {
        constraints,
        exactGate: candidate => exactGate(candidate, hypothesis),
      });
      return {
        hypothesis: hypothesis.id,
        accepted: gate.accepted,
        reasons: [...gate.reasons],
        score: gate.accepted ? scoreOne(score, cycle, hypothesis, gate) : null,
      };
    });
    const rejected = gates.filter(gate => !gate.accepted);
    if (rejected.length) {
      return {
        cycleId: cycle.id, accepted: false as const, reasons: rejected.flatMap(gate =>
          gate.reasons.map(reason => `${gate.hypothesis}:${reason}`)), gates,
        worstRisk: Infinity, resourceMargin: -Infinity,
      };
    }
    // Every gate accepted, so every gate was scored.
    const scores = gates.flatMap(gate => gate.score ? [gate.score] : []);
    return {
      cycleId: cycle.id, accepted: true as const, reasons: [], gates,
      // Worst case, not weighted average: a low-probability plausible route
      // still gets a hard say in whether a cycle is safe to commit.
      worstRisk: Math.max(...scores.map(item => item.risk)),
      resourceMargin: Math.min(...scores.map(item => item.resourceMargin)),
      presses: cycle.cost?.presses ?? Infinity,
    };
  });
  const accepted = decisions.flatMap(decision => decision.accepted ? [decision] : []);
  accepted.sort((a, b) => a.worstRisk - b.worstRisk ||
    b.resourceMargin - a.resourceMargin || a.presses - b.presses ||
    a.cycleId.localeCompare(b.cycleId));
  const winner = accepted[0] ?? null;
  return {
    schema: 'cycle-plan-decision-v1', selected: winner?.cycleId ?? null,
    decisions: clone(decisions),
    record: winner ? {
      selected: winner.cycleId, worstRisk: winner.worstRisk,
      resourceMargin: winner.resourceMargin,
      hypotheses: winner.gates.map(gate => gate.hypothesis),
    } : { selected: null, reason: 'no-cycle-passed-all-hypotheses' },
  };
}
