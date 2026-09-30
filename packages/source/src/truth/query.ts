/**
 * Queries over a parsed dump (dump.js) read under a handle scramble K (handles.js): which event
 * groups read or write an object, one of its alterable values or flags, or a global value; and
 * what one object is -- its type, the frames that reference it, the groups that create and destroy
 * it. Every match comes back as fields -- frame, group id, and each condition and action parsed --
 * never as the dump's line text.
 *
 * Reads and writes are decided by the engine's own shape, not by a name: a condition reads, an
 * action writes, and a parameter or expression token that names the object reads it -- except a
 * create parameter, which writes it into existence. Where the dump does not say which value or
 * flag a row touches (an indexed read, a flag number computed at run time), the hit is kept and
 * marked `certain: false`, and the answer says so.
 */
import { unknown } from '@sixam/kernel';
import { COMMON_TYPE, CREATE_BY_NAME_ACTION, CREATE_TYPE, DESTROY_ACTION, EXPRESSIONS, FLAG_ACTIONS, FLAG_CONDITIONS,
  QUALIFIER_BIT, SYSTEM_TYPE, aceName, typeName } from './engine.ts';
import type { Dump } from './dump.ts';

export const ACCESS = Object.freeze(['read', 'write', 'any']);
export const QUERY_FIELDS = Object.freeze(['object', 'handle', 'value', 'flag', 'global', 'frame', 'group', 'access', 'limit']);
export const DEFAULT_LIMIT = 50;

/** The citable URI of one event group. */
export const truthUri = (alias: string, frame: number, group: number) => `fnaf://truth/${alias}/frame/${frame}/group/${group}`;
export const TRUTH_URI = /^fnaf:\/\/truth\/([a-z0-9]+)\/frame\/(\d+)\/group\/(\d+)$/;

/**
 * The object an event-space handle names under K, or null for a system row.
 */
export function objectAt(dump: Dump, k: number, handle: number | null) {
  if (handle === null || handle < 0) return null;
  if (handle & QUALIFIER_BIT) return { handle, qualifier: handle & (QUALIFIER_BIT - 1) };
  const row = dump.objects.get(handle ^ k);
  if (!row) return { handle, stored: handle ^ k, name: null, type: null, typeName: null };
  return { handle, stored: row.stored, name: row.name, type: row.type, typeName: typeName(row.type) };
}

/** Event handles of every object named `name` (case-insensitive, exact). */
export function handlesNamed(dump, k, name) {
  const wanted = String(name).toLowerCase();
  return [...dump.objects.values()].filter(row => row.name.toLowerCase() === wanted).map(row => row.stored ^ k).sort((a, b) => a - b);
}

/** Names that contain `name`, for a refusal's hint. */
export const namesContaining = (dump, name, limit = 8) => [...new Set([...dump.objects.values()].map(row => row.name)
  .filter(item => item.toLowerCase().includes(String(name).toLowerCase())))].slice(0, limit);

// --- presenting a row as fields ----------------------------------------------------------------

function presentItem(dump, k, item) {
  if (item.parsed === false) return item;
  const out = { ...item, typeName: typeName(item.objectType) };
  if (item.objectType >= COMMON_TYPE) out.object = objectAt(dump, k, item.handle);
  return out;
}

function presentParameter(dump, k, parameter) {
  if (parameter.loader === 'ExpressionParameter' && parameter.items)
    return { ...parameter, items: parameter.items.map(item => presentItem(dump, k, item)) };
  if ((parameter.loader === 'ParamObject' || parameter.loader === 'Create') && typeof parameter.handle === 'number')
    return { ...parameter, object: objectAt(dump, k, parameter.handle) };
  if (parameter.loader === 'Position' && typeof parameter.parent === 'number')
    return { ...parameter, object: parameter.parent >= 0 ? objectAt(dump, k, parameter.parent) : null };
  return parameter;
}

/** One condition or action as parsed fields: engine numbers, this reader's name for it, the object, the parameters. */
export function presentRow(dump, k, row) {
  const { params, ...fields } = row;
  return { ...fields, typeName: typeName(row.objectType), name: aceName(row.kind, row.objectType, row.num),
    object: row.objectType !== null && row.objectType >= 0 ? objectAt(dump, k, row.handle) : null,
    params: params.map(parameter => presentParameter(dump, k, parameter)) };
}

// --- which rows touch the target ---------------------------------------------------------------

/** The literal a one-token expression parameter holds, or null. */
function literalOf(parameter) {
  if (parameter?.loader !== 'ExpressionParameter' || !parameter.items) return null;
  const tokens = parameter.items.filter(item => item.parsed !== false && !(item.objectType === 0 && item.num === 0));
  return tokens.length === 1 && tokens[0].loader === 'LongExp' && typeof tokens[0].value === 'number' ? tokens[0].value : null;
}

const itemsOf = row => row.params.flatMap((parameter, index) => (parameter.loader === 'ExpressionParameter' && parameter.items
  ? parameter.items.filter(item => item.parsed !== false).map(item => ({ item, param: index })) : []));

/**
 * Every place one row touches the target: [{access, via, certain, param?, item?}].
 */
function rowHits(row: any, target: {kind: string, handles?: Set<number>, slot?: number, index?: number}) {
  const hits = [];
  const add = (access, via, extra = {}) => hits.push({ access, via, certain: true, ...extra });
  const reads = row.kind === 'condition' ? 'read' : 'write';
  const subject = target.handles && row.objectType !== null && row.objectType >= 0 && target.handles.has(row.handle);
  if (target.kind === 'object') {
    if (subject) add(reads, 'subject');
    row.params.forEach((parameter, param) => {
      if (parameter.loader === 'Create' && target.handles.has(parameter.handle)) add('write', 'creates', { param });
      else if (parameter.loader === 'ParamObject' && target.handles.has(parameter.handle)) add('read', 'parameter', { param });
      else if (parameter.loader === 'Position' && target.handles.has(parameter.parent)) add('read', 'position-parent', { param });
    });
    for (const { item, param } of itemsOf(row))
      if (item.objectType >= COMMON_TYPE && target.handles.has(item.handle)) add('read', 'expression', { param, item: item.index });
  } else if (target.kind === 'value') {
    if (subject && row.params.some(parameter => parameter.loader === 'AlterableValue' && parameter.slot === target.slot))
      add(reads, 'alterable-value');
    for (const { item, param } of itemsOf(row)) {
      if (item.objectType < COMMON_TYPE || !target.handles.has(item.handle)) continue;
      if (item.num === EXPRESSIONS.alterableValue && item.value === target.slot) add('read', 'expression', { param, item: item.index });
      else if (item.num === EXPRESSIONS.alterableValueIndexed) hits.push({ access: 'read', via: 'indexed-expression', certain: false, param, item: item.index });
    }
  } else if (target.kind === 'flag') {
    const flagRow = subject && (row.kind === 'condition' ? FLAG_CONDITIONS : FLAG_ACTIONS).includes(row.num) && row.objectType >= COMMON_TYPE;
    if (flagRow) {
      const index = literalOf(row.params[0]);
      if (index === target.index) add(reads, 'flag');
      else if (index === null) hits.push({ access: reads, via: 'flag', certain: false });
    }
    for (const { item, param } of itemsOf(row))
      if (item.objectType >= COMMON_TYPE && target.handles.has(item.handle) && item.num === EXPRESSIONS.getFlag)
        hits.push({ access: 'read', via: 'flag-expression', certain: false, param, item: item.index });
  } else if (target.kind === 'global') {
    row.params.forEach((parameter, param) => {
      if (parameter.loader !== 'GlobalValue') return;
      if (parameter.slot === target.slot) add(reads, 'global-value', { param });
      else if (typeof parameter.slot !== 'number' && [9, 10, 13].includes(target.slot))
        hits.push({ access: reads, via: 'global-value', certain: false, param });
    });
    for (const { item, param } of itemsOf(row)) {
      if (item.objectType !== SYSTEM_TYPE || item.num !== EXPRESSIONS.globalValue || typeof item.value !== 'number') continue;
      if (item.value === target.slot) add('read', 'expression', { param, item: item.index });
      // A value outside 16 bits carries something above the index; its low half matching is kept, uncertain.
      else if ((item.value < 0 || item.value > 0xffff) && (item.value & 0xffff) === target.slot)
        hits.push({ access: 'read', via: 'expression', certain: false, param, item: item.index });
    }
  }
  return hits;
}

/**
 * The event groups that read or write the target.
 */
export function findEvents(dump: Dump, k: number, target: {kind: string, handles?: Set<number>, slot?: number, index?: number}, { access = 'any', frame = null, group = null, alias }: {access?: string, frame?: number | null, group?: number | null, alias: string}) {
  const matches = [];
  for (const each of dump.frames) {
    if (frame !== null && each.index !== frame) continue;
    for (const item of each.groups) {
      if (group !== null && item.index !== group) continue;
      const hits = [];
      for (const row of [...item.conditions, ...item.actions])
        for (const hit of target.kind === 'group' ? [] : rowHits(row, target))
          hits.push({ ace: `${row.kind} ${row.index}`, ...hit });
      const kept = hits.filter(hit => access === 'any' || hit.access === access);
      if (target.kind !== 'group' && !kept.length) continue;
      matches.push({
        frame: each.index, frameName: each.name, group: `g${item.index}`, cite: truthUri(alias, each.index, item.index),
        access: [...new Set(kept.map(hit => hit.access))].sort(), certain: kept.every(hit => hit.certain), hits: kept,
        flags: item.flags, restricted: item.restricted,
        conditions: item.conditions.map(row => presentRow(dump, k, row)), actions: item.actions.map(row => presentRow(dump, k, row)),
      });
    }
  }
  return matches;
}

/** What a set of presented matches leaves unread: parameters the dumper printed as a class name only. */
export function unparsedLoaders(matches) {
  const loaders = new Set();
  for (const match of matches)
    for (const row of [...match.conditions, ...match.actions])
      for (const parameter of row.params) if (parameter.parsed === false) loaders.add(parameter.loader ?? 'unrecognised');
  return [...loaders].sort();
}

/** Rows anywhere in the dump that address a qualifier rather than one object. */
export const qualifierRows = dump => dump.frames.reduce((sum, frame) => sum + frame.groups.reduce((n, group) =>
  n + [...group.conditions, ...group.actions].filter(row => row.objectType >= 0 && row.handle !== null && row.handle & QUALIFIER_BIT).length, 0), 0);

/**
 * One object: its type, the frames whose events reference it, and the groups that create and destroy it.
 */
export function describeObject(dump: Dump, k: number, handle: number, alias: string) {
  const object = objectAt(dump, k, handle);
  const handles = new Set([handle]);
  const frames = new Set<number>();
  const createdBy = [];
  const destroyedBy = [];
  const references = { conditions: 0, actions: 0, parameters: 0, expressions: 0 };
  let createdByName = 0;
  for (const frame of dump.frames)
    for (const group of frame.groups) {
      const where = { frame: frame.index, group: `g${group.index}`, cite: truthUri(alias, frame.index, group.index) };
      let seen = false;
      for (const row of [...group.conditions, ...group.actions]) {
        const hits = rowHits(row, { kind: 'object', handles });
        if (hits.length) seen = true;
        for (const hit of hits) {
          if (hit.via === 'subject') references[row.kind === 'condition' ? 'conditions' : 'actions'] += 1;
          else if (hit.via === 'expression') references.expressions += 1;
          else references.parameters += 1;
          if (hit.via === 'creates') createdBy.push({ ...where, ace: `${row.kind} ${row.index}` });
        }
        if (row.kind === 'action' && row.objectType >= COMMON_TYPE && row.handle === handle && row.num === DESTROY_ACTION)
          destroyedBy.push({ ...where, ace: `action ${row.index}` });
        if (row.kind === 'action' && row.objectType === CREATE_TYPE && row.num === CREATE_BY_NAME_ACTION) createdByName += 1;
      }
      if (seen) frames.add(frame.index);
    }
  return {
    ...object, initialValues: object?.stored !== undefined ? dump.objects.get(object.stored)?.values ?? [] : [],
    frames: [...frames].sort((a, b) => a - b), createdBy, destroyedBy, references,
    placed: unknown('placed frame instances carry a second, layout scramble (48 on FNaF 2, readdump.py) that this reader does not estimate per build'),
    createdByNameRows: createdByName,
  };
}
