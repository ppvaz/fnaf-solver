// The media gate: every tracked image, video and audio file is in
// tools/media-manifest.json with a class, and the only game media are the two
// README clips of Pedro's written exception, each 4,000,000 bytes or less
// (ADR 0002 decision 6; plans/ROADMAP.md, gate table, 2026-09-29).
//
// Why a manifest and not a size limit alone: `e6de745` re-added two gameplay
// GIFs (12.4 MB) the day after `701f5ab` dropped committed game frames, and the
// exception lived only in a commit message. A file is admitted by a person
// looking at it and naming what it is, and a game capture has no class to be
// admitted under.
//
// Files present in the working tree but not yet staged count, as in
// tools/test-docs.ts: a new image must have its row before it is committed.
// The frozen set is not exempt; it holds no media, and game media there would
// be refused like anywhere else.
import assert from 'node:assert/strict';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST = 'tools/media-manifest.json';

const MEDIA = /\.(png|jpe?g|gif|webp|avif|bmp|ico|tiff?|svg|mp4|m4v|webm|mov|mkv|avi|wav|ogg|oga|opus|mp3|m4a|flac|aac)$/i;
const CLASSES = ['game-clip', 'diagram', 'icon', 'ui-art', 'font-preview'];
// The written exception, by name: at most these two, each within the limit.
const EXCEPTION = ['docs/img/night7-teach-panel-cycle22.gif', 'docs/img/fnaf1-420-teach-panel-bonnie.gif'];
const MAX_CLIPS = 2;
const MAX_CLIP_BYTES = 4_000_000;

const ADMIT = `Look at it. If it is a diagram, icon, UI art or font preview, add ` +
  `{ "path", "class", "shows" } to ${MANIFEST}. If it shows a game (a capture, frame ` +
  `or clip), it may not be committed: take it out of the tree (\`git rm --cached <path>\` ` +
  `once staged) and keep it in the vault (packages/review/src/vault.ts), because the only game media allowed are the two ` +
  `README clips (ADR 0002 decision 6).`;

// Every violation, as a message saying what to do: [] when the tree is clean.
function mediaProblems({ tracked, manifest, sizeOf }) {
  const problems = [];
  const entries = manifest.files || [];
  const listed = new Map();
  for (const entry of entries) {
    if (listed.has(entry.path)) problems.push(`${entry.path} is listed twice in ${MANIFEST}: keep one entry.`);
    listed.set(entry.path, entry);
  }
  for (const path of tracked.filter((f) => MEDIA.test(f)))
    if (!listed.has(path)) problems.push(`${path} is tracked media with no entry in ${MANIFEST}. ${ADMIT}`);
  const present = new Set(tracked);
  for (const entry of entries) {
    if (!present.has(entry.path))
      problems.push(`${MANIFEST} lists ${entry.path}, which is not in the tree: remove the entry, or restore the file.`);
    if (!CLASSES.includes(entry.class))
      problems.push(`${entry.path} has class ${JSON.stringify(entry.class)}; use one of ${CLASSES.join(', ')}.`);
    if (!entry.shows || !String(entry.shows).trim())
      problems.push(`${entry.path} has no "shows": say what the file shows, as seen by opening it.`);
  }
  const clips = entries.filter((e) => e.class === 'game-clip');
  if (clips.length > MAX_CLIPS)
    problems.push(`${clips.length} game-clip entries (${clips.map((e) => e.path).join(', ')}); at most ` +
      `${MAX_CLIPS} are allowed. Remove the extra clip from the repository, or ask Pedro to change the ` +
      'written exception in ADR 0002 decision 6 and plans/ROADMAP.md.');
  for (const clip of clips) {
    if (!EXCEPTION.includes(clip.path))
      problems.push(`${clip.path} is a game-clip outside the written exception (${EXCEPTION.join(', ')}). ` +
        'Game media is refused: remove it, or ask Pedro to change the exception.');
    if (present.has(clip.path)) {
      const bytes = sizeOf(clip.path);
      if (bytes > MAX_CLIP_BYTES)
        problems.push(`${clip.path} is ${bytes} bytes; a README clip is ${MAX_CLIP_BYTES} bytes or less. ` +
          'Re-encode it shorter, smaller or with fewer colours (as a370950 did), and commit the result.');
    }
  }
  return problems;
}

// --- 1. each check first catches a planted violation.
const good = {
  tracked: ['docs/img/a.png', EXCEPTION[0], EXCEPTION[1], 'tools/x.mjs'],
  manifest: { files: [
    { path: 'docs/img/a.png', class: 'diagram', shows: 'a plot' },
    { path: EXCEPTION[0], class: 'game-clip', shows: 'clip' },
    { path: EXCEPTION[1], class: 'game-clip', shows: 'clip' },
  ] },
  sizeOf: () => 1000,
};
assert.deepEqual(mediaProblems(good), [], 'the planted clean tree must pass');
const planted = [
  ['unlisted media', { ...good, tracked: [...good.tracked, 'docs/img/new.webp'] }, /new\.webp is tracked media with no entry/],
  ['stale entry', { ...good, tracked: good.tracked.filter((f) => f !== 'docs/img/a.png') }, /lists docs\/img\/a\.png, which is not in the tree/],
  ['third clip', { ...good, tracked: [...good.tracked, 'docs/img/c.gif'],
    manifest: { files: [...good.manifest.files, { path: 'docs/img/c.gif', class: 'game-clip', shows: 'clip' }] } }, /3 game-clip entries/],
  ['clip outside the exception', { ...good, tracked: ['docs/img/c.gif', EXCEPTION[1]],
    manifest: { files: [{ path: 'docs/img/c.gif', class: 'game-clip', shows: 'clip' }, good.manifest.files[2]] } }, /outside the written exception/],
  ['oversize clip', { ...good, sizeOf: (p) => (p === EXCEPTION[1] ? MAX_CLIP_BYTES + 1 : 10) }, /is 4000001 bytes/],
  ['unknown class', { ...good, manifest: { files: [{ ...good.manifest.files[0], class: 'screenshot' }, ...good.manifest.files.slice(1)] } }, /class "screenshot"/],
  ['no description', { ...good, manifest: { files: [{ ...good.manifest.files[0], shows: '' }, ...good.manifest.files.slice(1)] } }, /has no "shows"/],
];
for (const [what, input, expect] of planted) {
  const found = mediaProblems(input);
  assert.ok(found.some((m) => (expect as any).test(m)), `planted ${what} was not caught: ${JSON.stringify(found)}`);
}
assert.equal(mediaProblems(good).length, 0);
assert.ok(MAX_CLIP_BYTES === 4_000_000 && MAX_CLIPS === 2, 'the limits are the decision, not a knob');

// --- 2. the tree.
const tracked = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'],
  { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean).filter((f) => existsSync(join(ROOT, f)));
const manifest = JSON.parse(readFileSync(join(ROOT, MANIFEST), 'utf8'));
const problems = mediaProblems({ tracked, manifest, sizeOf: (p) => statSync(join(ROOT, p)).size });
if (problems.length) {
  for (const problem of problems) console.error(`media: ${problem}`);
  process.exit(1);
}
const count = (c) => manifest.files.filter((e) => e.class === c).length;
console.log(`media: ${planted.length} planted violations caught; ${manifest.files.length} tracked media files ` +
  `listed (${CLASSES.map((c) => `${c} ${count(c)}`).join(', ')}), game clips within ` +
  `${MAX_CLIPS} x ${MAX_CLIP_BYTES} bytes`);
