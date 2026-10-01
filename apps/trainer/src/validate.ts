/**
 * Bounded-input validators shared by the trainer's exercise modules.
 *
 * Six modules -- adaptive-coach, arcade-lab, microtrainer, renderers,
 * rhythm-highway and threat-constellation -- each carried their own copy of
 * this kit (three of them, never wired into the UI, were archived 2026-09-25;
 * arcade-lab, microtrainer and renderers use it now). Measured 2026-09-08 by hashing each function body: `freeze`,
 * `object` and `text` were byte-identical in all six, `strings` in both that
 * had it, `isRecord` in all six, `finite` in both that had it. That is 34
 * definitions of nine functions.
 *
 * `fail` differed only in its subject prefix and `text` only in its length cap
 * (160 in adaptive-coach and microtrainer, 128 elsewhere), so both are
 * parameters of `validatorsFor` rather than reasons to copy the kit again.
 *
 * `number` and `integer` are deliberately NOT here. Their copies disagree on
 * more than a default: rhythm-highway and threat-constellation admit negative
 * numbers and bound their integers, the other three do neither, and the two
 * `integer` variants raise different messages. Unifying them would change
 * behaviour, which is a decision for whoever needs it -- not a side effect of
 * removing duplication.
 */

export const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export const finite = value => typeof value === 'number' && Number.isFinite(value);

export function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}

/**
 * The prefix-bound half of the kit. Every message a caller raises is prefixed
 * with `subject`, so a thrown TypeError still names the module it came from.
 */
export function validatorsFor(subject: string, { textMax = 128 }: { textMax?: number } = {}) {
  const fail = message => { throw new TypeError(`${subject}: ${message}`); };

  function object(name, value) {
    if (!isRecord(value)) fail(`${name} must be an object`);
    return value;
  }
  function text(name, value, max = textMax) {
    if (typeof value !== 'string' || value.length === 0 || value.length > max)
      fail(`${name} must be a non-empty bounded string`);
    return value;
  }
  function strings(name, values, { min = 1, max = 32 } = {}) {
    if (!Array.isArray(values) || values.length < min || values.length > max ||
        values.some(value => typeof value !== 'string' || value.length === 0 || value.length > 128))
      fail(`${name} must be a bounded string array`);
    if (new Set(values).size !== values.length) fail(`${name} must be unique`);
    return values;
  }
  return { fail, object, text, strings };
}
