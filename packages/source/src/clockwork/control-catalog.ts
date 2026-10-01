/**
 * The shape of a per-game control catalog, and what is generated from it.
 *
 * A catalog is plain data: one descriptor per semantic control, the game's
 * cameras, the simulator names its contract still accepts, the profile points
 * that are not controls, and -- for a game that runs through
 * `device-executor-v1` -- its artifact action table. Nothing here knows any
 * game. The validators `semantic-control-v1`, the profile resolver and the
 * artifact executor apply are generated from a catalog by the functions below,
 * so adding a game is one data module and one registration (LEG-007).
 *
 * UNKNOWN is a value with a reason (ADR 0002, principle 2): a fact nobody
 * measured is written `UNKNOWN(reason)`, never left out and never defaulted.
 * CONTRACT:semantic-control-v1.
 */

import { isList, isOneOf, isRecord } from '@sixam/kernel';
import type { ControlCatalog, GamePackage, Unknown } from '@sixam/kernel/contracts';

export const CONTROL_CATALOG_SCHEMA = 'control-catalog-v1';
export const ARTIFACT_ACTION_TABLE_SCHEMA = 'artifact-action-table-v1';

/** `binding.anchor`, in the adapter's words (`control-anchor.js` ANCHOR_KINDS). */
export const BINDING_ANCHORS = Object.freeze(['screen', 'world'] as const);
/** `binding.contact`: how one activation reaches the game. */
export const BINDING_CONTACTS = Object.freeze(['tap', 'hold', 'double'] as const);
/** The state a control may require before it is pressed. */
export const PRECONDITION_VALUES: Readonly<Record<string, readonly string[]>> = Object.freeze({
  monitor: Object.freeze(['up', 'down']),
  mask: Object.freeze(['off']),
});

const UNKNOWN_PATTERN = /^UNKNOWN\([a-z0-9][a-z0-9 ,.:;'/_-]*\)$/;
const CAMERA_PATTERN = /^cam:(0|[1-9][0-9]*)$/;
const NAME_PATTERN = /^[a-z][A-Za-z0-9]*$/;

type CameraRange = ControlCatalog['cameras']['range'];
type CameraOf = (control: unknown) => number | null;
/** An action kind's rule, as the table states it, with `*` expanded to the table's controls. */
type KindRule = Readonly<Record<string, unknown>> & { readonly controls: readonly string[] };
/** An artifact action table, checked: its kinds with their controls expanded. */
type CheckedActionTable = Readonly<Record<string, unknown>> & { readonly kinds: Readonly<Record<string, KindRule>> };

/** True for an `UNKNOWN(reason)` value. */
export const isUnknown = (value: unknown): value is Unknown => typeof value === 'string' && UNKNOWN_PATTERN.test(value);

function fail(game: string, message: string): never { throw new TypeError(`control catalog ${game}: ${message}`); }
const isName = (item: unknown): item is string => typeof item === 'string' && item.length > 0;
const isInteger = (item: unknown): item is number => Number.isInteger(item);

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    const children: unknown[] = Object.values(value);
    for (const child of children) deepFreeze(child);
  }
  return value;
}

function names(game: string, value: unknown, label: string, { allowEmpty = true } = {}): readonly string[] {
  if (!isList(value) || (!allowEmpty && value.length === 0) || !value.every(isName))
    fail(game, `${label} must be an array of names`);
  if (new Set(value).size !== value.length) fail(game, `${label} repeats a name`);
  return value;
}

function checkBinding(game: string, binding: unknown, label: string) {
  if (!isRecord(binding) || binding.adapter !== 'touch')
    fail(game, `${label}.binding must name the touch adapter`);
  if (!isOneOf(BINDING_CONTACTS, binding.contact) && !isUnknown(binding.contact))
    fail(game, `${label}.binding.contact must be ${BINDING_CONTACTS.join('|')} or UNKNOWN(reason)`);
  if (!isOneOf(BINDING_ANCHORS, binding.anchor) && !isUnknown(binding.anchor))
    fail(game, `${label}.binding.anchor must be ${BINDING_ANCHORS.join('|')} or UNKNOWN(reason)`);
}

function checkRequires(game: string, requires: unknown, label: string, cameraOf: CameraOf) {
  if (isUnknown(requires)) return;
  if (!isRecord(requires)) fail(game, `${label}.requires must be a state object or UNKNOWN(reason)`);
  for (const [key, value] of Object.entries(requires)) {
    if (key === 'viewing') {
      if (!cameraOf(value)) fail(game, `${label}.requires.viewing must be one of the game's cameras`);
    } else if (!Object.hasOwn(PRECONDITION_VALUES, key) || !isOneOf(PRECONDITION_VALUES[key], value)) {
      fail(game, `${label}.requires.${key} is not a known precondition`);
    }
  }
}

function checkObserves(game: string, observes: unknown, label: string) {
  if (!isUnknown(observes) && !(typeof observes === 'string' && NAME_PATTERN.test(observes)))
    fail(game, `${label}.observes must name a fact or be UNKNOWN(reason)`);
}

/** A camera id `cam:N` inside a stated `[lo, hi]` range, or null. */
function cameraIndex(range: CameraRange, control: unknown) {
  if (!isList(range) || typeof control !== 'string') return null;
  const match = CAMERA_PATTERN.exec(control);
  if (!match) return null;
  const index = Number(match[1]);
  return index >= range[0] && index <= range[1] ? index : null;
}

/** The catalog's camera range, checked: `[lo, hi]`, null or UNKNOWN(reason). */
function cameraRangeOf(game: string, range: unknown): CameraRange {
  if (range === null) return null;
  if (isUnknown(range)) return range;
  if (isList(range) && range.length === 2 && range.every(isInteger) && range[0] >= 0 && range[0] <= range[1])
    return [range[0], range[1]];
  fail(game, 'cameras.range must be [lo, hi], null or UNKNOWN(reason)');
}

function defineActionTable(game: string, table: unknown, controlNames: readonly string[], cameraOf: CameraOf): CheckedActionTable | null {
  if (table === null) return null;
  if (!isRecord(table) || table.schema !== ARTIFACT_ACTION_TABLE_SCHEMA || table.game !== game)
    fail(game, `artifactActions must be an ${ARTIFACT_ACTION_TABLE_SCHEMA} for this game, or null`);
  const listed = names(game, table.controls, 'artifactActions.controls', { allowEmpty: false });
  for (const control of listed)
    if (!controlNames.includes(control) && cameraOf(control) === null)
      fail(game, `artifactActions.controls names ${control}, which the catalog does not`);
  if (!isRecord(table.kinds) || !isRecord(table.kinds.compound))
    fail(game, 'artifactActions.kinds must include compound');
  const kinds: Record<string, KindRule> = {};
  for (const [kind, spec] of Object.entries(table.kinds)) {
    if (!isRecord(spec)) fail(game, `artifactActions.kinds.${kind} must be an object`);
    // '*' is shorthand for every control the table lists; it is expanded here
    // so the generated catalog documents the actual set.
    const controls = spec.controls === '*' ? [...listed]
      : names(game, spec.controls, `artifactActions.kinds.${kind}.controls`, { allowEmpty: false });
    for (const control of controls)
      if (!listed.includes(control)) fail(game, `artifactActions.kinds.${kind} names unlisted ${control}`);
    kinds[kind] = { ...spec, controls };
  }
  if (!isRecord(table.compounds) || Object.keys(table.compounds).length === 0)
    fail(game, 'artifactActions.compounds must name at least one compound');
  for (const [compound, pins] of Object.entries(table.compounds)) {
    if (!isRecord(pins)) fail(game, `artifactActions.compounds.${compound} must be an object of pinned fields`);
    for (const [field, control] of Object.entries(pins))
      if (!isOneOf(listed, control))
        fail(game, `artifactActions.compounds.${compound}.${field} pins unlisted ${control}`);
  }
  const arm = table.armVerification;
  if (arm !== null) {
    if (!isRecord(arm) || !isList(arm.cameras) || arm.cameras.length !== 2 ||
        !arm.cameras.every(isInteger) || arm.cameras[0] > arm.cameras[1])
      fail(game, 'artifactActions.armVerification.cameras must be an integer [lo, hi] range');
    if (!isOneOf(listed, arm.firstAction))
      fail(game, 'artifactActions.armVerification.firstAction must be a listed control');
  }
  return { ...table, kinds };
}

/**
 * Check a game's catalog, derive what is derived, and freeze it.
 */
export function defineControlCatalog<G extends GamePackage>(input: { readonly game: G, readonly [field: string]: unknown }): ControlCatalog<G> {
  const game = input?.game;
  if (!isRecord(input) || input.schema !== CONTROL_CATALOG_SCHEMA || typeof game !== 'string' ||
      !/^com\.scottgames\.[a-z0-9]+$/.test(game))
    fail(String(game), `must be a ${CONTROL_CATALOG_SCHEMA} naming its Android package`);
  if (typeof input.title !== 'string' || input.title.length === 0) fail(game, 'title is required');
  const cameras = input.cameras;
  if (!isRecord(cameras) || !('range' in cameras))
    fail(game, 'cameras must state a range: [lo, hi], null (none exist) or UNKNOWN(reason)');
  const range = cameraRangeOf(game, cameras.range);
  const cameraOf = (control: unknown) => cameraIndex(range, control);
  if (isList(range)) {
    checkBinding(game, cameras.binding, 'cameras');
    checkRequires(game, cameras.requires, 'cameras', cameraOf);
    checkObserves(game, cameras.observes, 'cameras');
  }
  if (!isList(input.controls) || input.controls.length === 0) fail(game, 'controls must be non-empty');
  const ids: string[] = [];
  const declared: { control: Record<string, unknown>, id: string }[] = [];
  for (const [index, control] of input.controls.entries()) {
    const label = `controls[${index}]`;
    if (!isRecord(control) || typeof control.id !== 'string' || !NAME_PATTERN.test(control.id))
      fail(game, `${label}.id must be a camelCase semantic name`);
    if (ids.includes(control.id)) fail(game, `${control.id} is declared twice`);
    ids.push(control.id);
    names(game, control.aliases, `${control.id}.aliases`);
    checkBinding(game, control.binding, control.id);
    checkRequires(game, control.requires, control.id, cameraOf);
    checkObserves(game, control.observes, control.id);
    if (control.model !== undefined && control.model !== null && typeof control.model !== 'string')
      fail(game, `${control.id}.model must be a simulator action name or null`);
    declared.push({ control, id: control.id });
  }
  names(game, input.modelControls, 'modelControls');
  for (const point of names(game, input.auxiliaryPoints, 'auxiliaryPoints'))
    if (ids.includes(point) || cameraOf(point) !== null) fail(game, `auxiliary point ${point} is a control`);
  names(game, input.sources, 'sources', { allowEmpty: false });
  const artifactActions = defineActionTable(game, input.artifactActions ?? null, ids, cameraOf);
  // Each descriptor's action kinds are generated from the table, so the
  // documented set and the set the executor enforces cannot drift apart.
  const controls = declared.map(({ control, id }) => ({
    ...control,
    actions: artifactActions
      ? Object.entries(artifactActions.kinds).filter(([, spec]) => spec.controls.includes(id)).map(([kind]) => kind)
      : 'UNKNOWN(no-artifact-action-table)',
  }));
  return deepFreeze({ ...input, controls, artifactActions }) as unknown as ControlCatalog<G>;
}

/** The canonical control ids, in catalog order. */
export const controlIds = (catalog: ControlCatalog) => catalog.controls.map(control => control.id);

/** The `cam:N` index when `control` is one of this game's cameras, else null. */
export const catalogCamera = (catalog: ControlCatalog, control: unknown) => cameraIndex(catalog.cameras.range, control);

/**
 * Generated `semantic-control-v1` membership for one game: a canonical id, one
 * of the simulator names the contract keeps accepting, or a stated camera.
 */
export function catalogAcceptsControl(catalog: ControlCatalog, control: unknown) {
  if (typeof control !== 'string') return false;
  return catalog.controls.some(item => item.id === control) ||
    catalog.modelControls.includes(control) || catalogCamera(catalog, control) !== null;
}

/**
 * Generated profile check: every `controlMap` key must be a control, a camera
 * or an auxiliary point of the profile's game. Returns the keys it refuses.
 */
export function unknownProfilePoints(catalog: ControlCatalog, controlMap: Readonly<Record<string, unknown>> | null | undefined) {
  return Object.keys(controlMap ?? {}).filter(key =>
    !catalog.controls.some(item => item.id === key) && catalogCamera(catalog, key) === null &&
    !catalog.auxiliaryPoints.includes(key));
}
