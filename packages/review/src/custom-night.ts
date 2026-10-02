// A Custom Night's dial vector, as a pack records it: the executor's own menu readback before
// the night began, and the vector its request asked for. The cohort and the promotion gate both
// name a Custom Night by these, so they read them here, once.
import { isRecord } from '@sixam/kernel';
import { listOrEmpty, objectOrNull } from './records.ts';
import type { JsonObject } from './records.ts';

/**
 * The last PASS readback among the observations before the first `state=night`: an observation
 * whose label is the readback's JSON. A lifecycle label is not one.
 */
export function lastDialReadback(events: readonly JsonObject[]): JsonObject | null {
  let readback: JsonObject | null = null;
  for (const event of events) {
    if (event.type !== 'observation') continue;
    if (event.label === 'state=night') break;
    if (typeof event.label !== 'string') continue;
    let read: unknown;
    try { read = JSON.parse(event.label); } catch { continue; }
    if (isRecord(read) && read.status === 'PASS' && isRecord(read.dials)) readback = read;
  }
  return readback;
}

/** The dials a pack's request.json asked for on `night`, or null. */
export function requestedDials(request: JsonObject | null, night: unknown): JsonObject | null {
  const nights = listOrEmpty(objectOrNull(request?.spec)?.nights).map(objectOrNull);
  return objectOrNull(nights.find(item => item?.night === night)?.dials);
}
