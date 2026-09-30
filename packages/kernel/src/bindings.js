// Where a committed winner lives, and the tag a record gives it.
//
// Pedro, 2026-09-30: winners live in Propose, one folder per game, as
// packages/propose/bindings/<game>/<name>-winner.json. Records written before
// that day name a winner tools/device/<name>-winner.json and keep that name (ADR
// 0002 principle 9). A reader follows the file through git's renames, and a
// binding's tag is its file's name, so both spellings give the same tag.

/** The directory every committed winner sits under, one folder per game. */
export const BINDINGS_DIR = 'packages/propose/bindings';

/** A committed winner's repository path. */
export const WINNER_FILE = /^packages\/propose\/bindings\/fnaf[1-4]\/[a-z0-9][a-z0-9.-]{0,80}-winner\.json$/;

/**
 * A binding's short tag: its file's name without `-winner.json`, whichever path a record named it by.
 * @param {string} path
 */
export const winnerTag = (path) => String(path).split('/').pop().replace(/-winner\.json$/, '');
