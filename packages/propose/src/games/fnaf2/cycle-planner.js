// Receding-horizon selection over the finite cycle library (Plan 20 P5
// foundation). The selector never averages away a plausible unsafe state:
// every candidate must pass the local/exact gate for every active hypothesis.
import { gateCycle } from './cycle-library.js';

const clone = value => structuredClone(value);

function invalid(message) { throw new TypeError(`cycle planner: ${message}`); }

function scoreOne(score, cycle, hypothesis, gate) {
  const result = score(cycle, hypothesis, gate);
  if (!result || !Number.isFinite(result.risk) || result.risk < 0 ||
      !Number.isFinite(result.resourceMargin))
    invalid(`score for ${cycle.id}/${hypothesis.id} is invalid`);
  return { risk: result.risk, resourceMargin: result.resourceMargin,
    detail: result.detail ?? null };
}
/**
 * Evaluate and select one primitive. `score` is supplied by the sourced route
 * model; no hidden simulator state is consulted here. The returned decisions
 * form an auditable record of both rejected and selected candidates.
 */
/** @param {any} options */
export function selectCycle(cycles, hypotheses, options = {}) {
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
        cycleId: cycle.id, accepted: false, reasons: rejected.flatMap(gate =>
          gate.reasons.map(reason => `${gate.hypothesis}:${reason}`)), gates,
        worstRisk: Infinity, resourceMargin: -Infinity,
      };
    }
    return {
      cycleId: cycle.id, accepted: true, reasons: [], gates,
      // Worst case, not weighted average: a low-probability plausible route
      // still gets a hard say in whether a cycle is safe to commit.
      worstRisk: Math.max(...gates.map(gate => gate.score.risk)),
      resourceMargin: Math.min(...gates.map(gate => gate.score.resourceMargin)),
      presses: cycle.cost?.presses ?? Infinity,
    };
  });
  const accepted = decisions.filter(decision => decision.accepted);
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
