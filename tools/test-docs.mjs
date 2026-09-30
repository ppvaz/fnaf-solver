// The indexes must describe what is actually here, and every link must resolve.
//
// This repository is mostly an evidence argument, so the route to a page is
// part of the evidence: a finding nobody can reach is close enough to a
// finding that does not exist. Both indexes had drifted, silently, in the way
// an index always does -- nothing recomputes it, and a missing row looks
// exactly like a subject that has no page.
//
// What that cost, measured 2026-08-26:
//
//   - `tools/TOOLS.md` was missing 47 of 137 tool scripts, including
//     `grade-run.sh` -- the one command CLAUDE.md says to run before quoting
//     any number off a device run -- plus `grade-night.py` ("the only number
//     that is a run length") and `desync-scan.py` ("only desync-scan.py says
//     what the game did"). docs/README.md routes "Find the right command"
//     here. This is CLAUDE.md's "an instrument nobody runs is a comment" one
//     layer up: an instrument nobody can find.
//   - `docs/README.md` was missing 5 of 32 pages, one of them
//     `HID-MULTITOUCH.md` -- 26 inbound references, and the page CLAUDE.md's
//     own read-before-concluding table points at for any device-run claim.
//   - `ONE-PIXEL-VISION.md` linked three files under gitignored `captures/`
//     that existed for no reader and that no script regenerates.
//
// A mention is not an entry. A tool index is checked for a table ROW whose first
// cell names the script, because prose naming a tool is what made the old
// substring check pass while the tool had no entry -- the same trap
// test-grade-run-coverage.mjs documents for grade-run.sh's header.
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let failed = 0;
const complain = (message) => { console.error(message); failed = 1; };

// Include files present in the working tree but not staged yet. During a
// normal patch review, a newly added tool must already have an index row; the
// old tracked-only census made the tool index fail in the exact interval between
// creating a file and committing it.
const tracked = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'],
  { cwd: ROOT, encoding: 'utf8' })
  .split('\n').filter(Boolean);

// --- 1. every relative link in a tracked markdown file resolves.
//
// Anchors are stripped: this checks that the file exists, not that a heading
// does. A link into gitignored output is a failure and not an exemption --
// that is precisely the case that was found, and "it is generated" is only an
// answer if something in the repository generates it.
const markdown = tracked.filter((f) => f.endsWith('.md'));
let links = 0;
for (const file of markdown) {
  const text = readFileSync(join(ROOT, file), 'utf8');
  const here = dirname(join(ROOT, file));
  for (const m of text.matchAll(/\]\(([^)\s]+?)(?:#[^)]*)?\)/g)) {
    const target = m[1];
    if (/^(https?:|mailto:|#)/.test(target)) continue;
    links += 1;
    if (!existsSync(resolve(here, decodeURI(target))))
      complain(`${file} links to ${target}, which does not exist`);
  }
}

// --- 1b. every relative href/src in a tracked HTML page resolves.
//
// The portal (docs/portal/) and the trainer's root index.html are the pages a
// reader reaches from Pages, and the Markdown check never read them: the
// portal linked adapter-registry.json for four days after `903ffab` retired
// the adapter layer and deleted its generated registry
// (docs/ARCHIVED-ROUTES.md, 2026-09-25). Remote, data: and javascript: URLs and in-page anchors are
// skipped; a site-absolute "/path" is a failure, because the project's Pages
// site does not live at the domain root. plans/archive/ is frozen byte for
// byte and holds no HTML (ADR 0002, Consequences).
const pages = tracked.filter((f) => /\.html?$/i.test(f) && !f.startsWith('plans/archive/'));
let htmlLinks = 0;
const entity = (s) => s.replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"');
for (const file of pages) {
  const text = readFileSync(join(ROOT, file), 'utf8');
  const here = dirname(join(ROOT, file));
  for (const m of text.matchAll(/\s(?:href|src)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) {
    const raw = entity(m[1] ?? m[2]).trim();
    if (!raw || /^([a-z][a-z0-9+.-]*:|#|\/\/)/i.test(raw)) continue;
    const target = raw.replace(/[?#].*$/, '');
    if (!target) continue;
    htmlLinks += 1;
    if (target.startsWith('/')) {
      complain(`${file} links to ${raw}, a site-absolute path: the Pages site is not at the domain root, so link relative to the page`);
      continue;
    }
    if (!existsSync(resolve(here, decodeURI(target))))
      complain(`${file} links to ${raw}, which does not exist. If a generator writes this page ` +
        '(tools/chronicle.mjs writes docs/portal/chronicle.html), fix the generator and regenerate; otherwise fix the page');
  }
}

// --- 2. docs/README.md lists every page under docs/.
const docsIndex = readFileSync(join(ROOT, 'docs', 'README.md'), 'utf8');
const docPages = markdown.filter((f) => f.startsWith('docs/') && f !== 'docs/README.md'
  && basename(f) !== 'README.md');
for (const page of docPages)
  if (!docsIndex.includes(basename(page)))
    complain(`${page} is not listed in docs/README.md -- the index is how a ` +
      'cold session finds it, and an unlisted page reads as a subject with no page');

// --- 3. every tool script has an ENTRY in the index of its own directory.
//
// The tool index is one README per directory (tools/README.md, tools/device/,
// tools/cue/, tools/dump/), split from a single TOOLS.md on 2026-09-25. A script
// is held to the README nearest to it -- its own directory's, or the closest
// parent's -- so a reader in tools/device/ finds tools/device/'s scripts there.
const indexes = tracked.filter((f) => /^tools\/(?:[^/]+\/)?README\.md$/.test(f)).sort();
const entriesOf = new Map();
for (const index of indexes) {
  const entries = new Set();
  for (const line of readFileSync(join(ROOT, index), 'utf8').split('\n')) {
    if (!line.startsWith('|')) continue;
    const cells = line.split('|');
    if (cells.length < 3) continue;
    for (const m of cells[1].matchAll(/`([\w./-]+\.(?:mjs|json|cs|py|sh|c|S))\b/g))
      entries.add(basename(m[1]));
  }
  entriesOf.set(index, entries);
}
const nearestIndex = (file) => {
  for (let dir = dirname(file); dir.startsWith('tools'); dir = dirname(dir))
    if (entriesOf.has(`${dir}/README.md`)) return `${dir}/README.md`;
  return null;
};
if (!entriesOf.has('tools/README.md')) complain('tools/README.md, the root tool index, is missing');
const scripts = tracked.filter((f) => f.startsWith('tools/') && /\.(mjs|py|sh|c|S)$/.test(f));
for (const script of scripts) {
  const index = nearestIndex(script);
  if (index && !entriesOf.get(index).has(basename(script)))
    complain(`${script} has no entry in ${index}. A row naming it, its ` +
      'kind (check/report/module/device action) and its interface -- not a ' +
      'mention in prose, which is what let this drift to 47 missing scripts');
}

// --- 4. an index must not list a script that has been deleted.
for (const [index, entries] of entriesOf) {
  for (const name of entries) {
    if (/\.(cs|json|S)$/.test(name)) continue; // fixtures and plugin sources
    if (!scripts.some((s) => basename(s) === name))
      complain(`${index} has an entry for ${name}, which is not a tracked ` +
        'tool script -- a stale entry sends a reader after a command that is gone');
  }
}

if (failed) process.exit(1);
console.log(`docs: ${links} links resolve, ${htmlLinks} links in ${pages.length} HTML pages resolve, ` +
  `${docPages.length} pages indexed, ` +
  `${scripts.length} tool scripts carry an entry in ${indexes.length} tool indexes`);
