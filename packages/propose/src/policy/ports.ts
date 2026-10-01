/** Semantic control ports. Implementations return data and perform no I/O. CONTRACT:controller-v1. */
export class Controller {
  step(_reference: unknown, _stateEstimate: unknown, _time: unknown): unknown { throw new Error('Controller.step must be implemented'); }
}

export class Supervisor {
  review(_commands: unknown, _stateEstimate: unknown, _capabilities: unknown): unknown { throw new Error('Supervisor.review must be implemented'); }
}
