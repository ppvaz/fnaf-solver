/** Semantic control ports. Implementations return data and perform no I/O. CONTRACT:controller-v1. */
export class Controller {
  step(_reference, _stateEstimate, _time) { throw new Error('Controller.step must be implemented'); }
}

export class Supervisor {
  review(_commands, _stateEstimate, _capabilities) { throw new Error('Supervisor.review must be implemented'); }
}
