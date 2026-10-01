// Phone-free Plan 20 package 6 contract gate.
//
// This tests the bounded data contract and the local drain semantics only.
// It does not claim USB-CDC timing, MCU firmware behavior, or external-HID
// acceptance; those remain bench obligations.
import { FACT_MESSAGE_SCHEMA, MAX_FACT_MESSAGE_BYTES, MAX_CYCLE_ACTIONS, encodeFactMessage, decodeFactMessage, messageToFact, FactLinkReceiver, SafeCycleHandoff } from '@sixam/kernel/time';

const check = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };
const expectThrow = (fn: () => unknown, message: string) => {
  let threw = false;
  try { fn(); } catch { threw = true; }
  check(threw, message);
};

const observedLine = encodeFactMessage({
  seq: 7, type: 'blackout', value: true, confidence: 0.95,
  source: 'pixel-watch', calibrationProfile: 'g56-native-v1',
  t_observed: 1200, t_received: 1260, latencyMin: 40, latencyMax: 90,
});
const observed = decodeFactMessage(observedLine);
check(observed.schema === FACT_MESSAGE_SCHEMA && observed.state === 'OBSERVED' &&
      observed.value === true && observedLine.endsWith('\n'),
  'observed fact did not round-trip as a newline-delimited message');
const fact = messageToFact(observed, 1300);
check(fact.observedAtMs === 1200 && fact.receivedAtMs === 1300 &&
      fact.transportReceivedAtMs === 1260 && fact.value === true,
  'wire timestamps were collapsed at the link boundary');

const unknownLine = encodeFactMessage({
  seq: 8, type: 'maskOn', state: 'UNKNOWN', reason: 'read-dropped',
  confidence: 0, source: 'pixel-watch', calibrationProfile: null,
  t_received: 1400, latencyMin: 0, latencyMax: 0,
});
const unknown = decodeFactMessage(unknownLine);
check(unknown.state === 'UNKNOWN' && unknown.reason === 'read-dropped' &&
      !Object.hasOwn(unknown, 'value'), 'UNKNOWN fact carried a false value');

expectThrow(() => encodeFactMessage({ seq: 0, type: 'bad', value: true,
  confidence: 1, source: 'x', t_received: 2, latencyMin: 4, latencyMax: 3 }),
  'reversed latency bounds were accepted');
expectThrow(() => encodeFactMessage({ seq: 0, type: 'bad', value: {}, confidence: 1,
  source: 'x', t_received: 2, latencyMin: 0, latencyMax: 0 }),
  'an unbounded object fact was accepted');
expectThrow(() => decodeFactMessage(observedLine.trimEnd()),
  'an unterminated wire frame was accepted');
const oversized = 'x'.repeat(MAX_FACT_MESSAGE_BYTES);
expectThrow(() => decodeFactMessage(oversized), 'an oversized wire frame was accepted');

const link = new FactLinkReceiver({ staleAfterMs: 200 });
let receipt = link.receive(observedLine, { receivedAtMs: 1300 });
check(receipt.missingBefore === 0 && receipt.linkState === 'HEALTHY' &&
      link.status(1400).state === 'HEALTHY', 'first link message was not healthy');
receipt = link.receive(encodeFactMessage({
  seq: 9, type: 'blackout', value: false, confidence: 1, source: 'pixel-watch',
  t_received: 1500, latencyMin: 40, latencyMax: 90,
}), { receivedAtMs: 1510 });
check(receipt.missingBefore === 1 && receipt.linkState === 'DEGRADED' &&
      link.status(1510).gapCount === 1, 'sequence loss was not surfaced');
check(link.status(1711).state === 'STALE', 'silent link did not become stale');
expectThrow(() => link.receive(observedLine, { receivedAtMs: 1720 }),
  'duplicate/out-of-order sequence was accepted');

const handoff = new SafeCycleHandoff({ linkTimeoutMs: 100, maxActions: 3 });
handoff.noteLink(0);
handoff.approve({
  cycleId: 'defensive-mask', validFromMs: 0, validUntilMs: 1000,
  actions: [
    { id: 'lower', kind: 'press', action: 'monitorDown', atMs: 0 },
    { id: 'mask', kind: 'press', action: 'mask', atMs: 200 },
  ],
});
const firstDue = handoff.due(0);
check(firstDue.length === 1 && firstDue[0].id === 'lower',
  'due action API did not return one action');
check(handoff.due(50).length === 0, 'an emitted action was repeated');
handoff.noteLink(50);
const secondDue = handoff.due(200);
check(secondDue.length === 1 && secondDue[0].id === 'mask',
  'approved action was not released at its boundary');
check(handoff.due(400).length === 0 && handoff.status(400).approval?.emitted === 2,
  'completed safe cycle did not remain drained');

const droppedLink = new SafeCycleHandoff({ linkTimeoutMs: 100 });
droppedLink.noteLink(0);
droppedLink.approve({ cycleId: 'approved-safe', validFromMs: 0, validUntilMs: 500,
  actions: [{ kind: 'press', action: 'mask', atMs: 300 }] });
const afterDrop = droppedLink.due(300);
check(afterDrop.length === 1 && afterDrop[0].linkState === 'STALE',
  'link loss did not drain the already-approved action locally');
check(droppedLink.due(501).length === 0,
  'expired approval emitted a late action');

expectThrow(() => new SafeCycleHandoff().approve({ cycleId: 'too-many',
  validFromMs: 0, validUntilMs: 1000,
  actions: Array.from({ length: MAX_CYCLE_ACTIONS + 1 }, (_, i) => ({
    kind: 'press', action: 'mask', atMs: i,
  })) }), 'unbounded action count was accepted');
expectThrow(() => new SafeCycleHandoff().approve({ cycleId: 'too-long',
  validFromMs: 0, validUntilMs: 15001, actions: [] }),
  'unbounded cycle horizon was accepted');

console.log('fact link: bounded messages, sequence loss, stale link, and safe-cycle drain pass');
