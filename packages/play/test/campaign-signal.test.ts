import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { installCampaignSignalHandlers } from '../src/campaign/campaign-signal.ts';

type SignalProcess = NonNullable<NonNullable<Parameters<typeof installCampaignSignalHandlers>[0]>['processObject']>;

const processObject: EventEmitter & { exitCode?: number | string | null } = new EventEmitter();
let cleanupReason = null as Error | null;
const exits: number[] = [];
const reports: unknown[] = [];
const guard = installCampaignSignalHandlers({
  // A fake process without exit(): the exit port below stands in for it.
  processObject: processObject as unknown as SignalProcess,
  cleanup: async reason => { cleanupReason = reason; },
  exit: code => exits.push(code),
  report: error => reports.push(error),
});

processObject.emit('SIGINT');
await guard.done();
assert.equal(processObject.exitCode, 130);
assert.equal(cleanupReason?.message, 'campaign interrupted by SIGINT');
assert.deepEqual(exits, [130]);
assert.deepEqual(reports, []);

// A second signal during or after cleanup must reuse the same task rather than
// restoring an immediate default exit that could strand the HID child.
processObject.emit('SIGINT');
await guard.done();
assert.deepEqual(exits, [130]);

guard.dispose();
assert.equal(processObject.listenerCount('SIGINT'), 0);
assert.equal(processObject.listenerCount('SIGTERM'), 0);
console.log('campaign signal: repeated interrupt cleanup, exit code, and listener disposal pass');
