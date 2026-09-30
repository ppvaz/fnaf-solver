/** Clock port; implementations must expose one declared monotonic/logical domain. */
export class ClockPort {
  now() { throw new Error('ClockPort.now must be implemented'); }
}
