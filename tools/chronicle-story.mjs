// The Story page: the chronicle told in chapters, generated, never written.
//
// ADR 0002 principle 4: nothing about current state is written as prose. A
// chapter here is a curated list of chronicle entry ids and a title, held in
// docs/chronicle/story.json; everything else on the page -- each chapter's
// dates, what it proved, what it did not, and the records it rests on -- is
// read from those entries' own fields. A chapter's dates run from its earliest
// to its latest standing entry, so a correction moves them (the Nights 1-2
// dates did exactly that on 2026-09-30). tools/chronicle.mjs writes this page
// beside the chronicle, from the same corpus.
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gameTitle } from './chronicle-schema.mjs';
import { currentPath } from './renamed-path.mjs';

const ROOT = resolve(join(fileURLToPath(new URL('.', import.meta.url)), '..'));
export const STORY_SCHEMA = 'chronicle-story-v1';
export const STORY_FILE = 'docs/chronicle/story.json';
export const STORY_OUTPUT = join(ROOT, 'docs/portal/story.html');
/** Entry kinds that record what a step did not prove. */
const NEGATIVE_KINDS = ['refutation', 'retraction', 'negative'];
/** Where the evidence records live, so a chapter can name the records it rests on. */
const RECORD_DIRS = ['docs/evidence/', 'tools/recompile/results/'];

const html = (value) => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');

/**
 * Every fault of a story against the corpus it tells, at once.
 * @param {any} story
 * @param {Map<string, any>} byId the corpus entries by id
 */
export function checkStory(story, byId) {
  const problems = [];
  if (story?.schema !== STORY_SCHEMA) problems.push(`${STORY_FILE}: schema must be ${STORY_SCHEMA}`);
  if (typeof story?.title !== 'string' || !story.title) problems.push(`${STORY_FILE}: title is required`);
  if (!Array.isArray(story?.chapters) || !story.chapters.length) return [...problems, `${STORY_FILE}: chapters must be a non-empty array`];
  const placed = new Map();
  story.chapters.forEach((chapter, index) => {
    const where = `${STORY_FILE} chapter ${index + 1}`;
    if (chapter.number !== index + 1) problems.push(`${where}: number must be ${index + 1}, got ${JSON.stringify(chapter.number)}`);
    if (typeof chapter.title !== 'string' || !chapter.title) problems.push(`${where}: title is required`);
    if (!Array.isArray(chapter.entries) || !chapter.entries.length) {
      problems.push(`${where}: entries must name at least one chronicle entry`);
      return;
    }
    for (const id of chapter.entries) {
      if (!byId.has(id)) problems.push(`${where}: ${JSON.stringify(id)} is not a chronicle entry`);
      else if (placed.has(id)) problems.push(`${where}: ${id} is already in chapter ${placed.get(id)}`);
      else placed.set(id, index + 1);
    }
    if (!chapter.entries.some((id) => byId.get(id)?.status === 'standing'))
      problems.push(`${where}: no standing entry, so the chapter has no dates`);
  });
  return problems;
}

/** The story, checked against the corpus; a story that fails is refused, not rendered. */
export async function loadStory(corpus) {
  const story = JSON.parse(await readFile(join(ROOT, STORY_FILE), 'utf8'));
  const problems = checkStory(story, new Map(corpus.entries.map((entry) => [entry.id, entry])));
  if (problems.length) throw new Error(`story: invalid\n${problems.map((problem) => `  ${problem}`).join('\n')}`);
  return story;
}

/** An evidence record, as against the policy page that sits beside them. */
const isRecord = (source) => RECORD_DIRS.some((dir) => source.startsWith(dir)) && !source.endsWith('README.md');
/** A record's name: a run pack by its run, any other record by its file name. */
const recordName = (source) => source.match(/\/runs\/([^/]+)\//)?.[1] ?? source.split('/').pop().replace(/\.(?:json|md|log)$/, '');

/** One chapter as the entries give it. */
export function chapterView(chapter, byId) {
  const members = chapter.entries.map((id) => byId.get(id));
  const standing = members.filter((entry) => entry.status === 'standing');
  const dates = standing.map((entry) => entry.date).sort();
  const sources = [...new Set(members.flatMap((entry) => entry.sources))];
  const records = [...new Set(sources.filter(isRecord).map(recordName))];
  return {
    number: chapter.number, title: chapter.title, from: dates[0], to: dates.at(-1), members, sources, records,
    games: [...new Set(members.map((entry) => entry.game))],
    proved: standing.filter((entry) => !NEGATIVE_KINDS.includes(entry.kind)),
    notProved: standing.filter((entry) => NEGATIVE_KINDS.includes(entry.kind)),
    superseded: members.filter((entry) => entry.status !== 'standing'),
  };
}

const when = (view) => (view.from === view.to ? view.from.slice(5) : `${view.from.slice(5)}→${view.to.slice(5)}`);

function sourceLink(source) {
  if (source.startsWith('commit:')) return `<span class="src commit">${html(source.slice(0, 14))}</span>`;
  const path = source.replace(/:\d+$/, '');
  // Linked where the file lives now; the recorded words stay (ADR 0002 principle 9).
  return `<a class="src" href="../../${html(currentPath(ROOT, path) ?? path)}">${html(source)}</a>`;
}

function itemMarkup(entry) {
  const measured = entry.measured ? `<span class="measured">${html(entry.measured)}</span>` : '';
  const history = entry.status === 'standing' ? ''
    : `<span class="note ${html(entry.status)}">${html(entry.status)} by <a href="chronicle.html#${html(entry.supersededBy)}">${html(entry.supersededBy)}</a></span>`;
  const corrects = entry.supersedes ? `<span class="note corrects">corrects <a href="chronicle.html#${html(entry.supersedes)}">${html(entry.supersedes)}</a></span>` : '';
  return `<li class="item status-${html(entry.status)}"><div class="meta"><time datetime="${html(entry.date)}">${html(entry.date)}</time><span class="kind">${html(entry.kind)}</span><span class="label">${html(entry.label)}</span><span class="game">${html(gameTitle(entry.game))}</span>${measured}${history}${corrects}</div>` +
    `<a class="title" href="chronicle.html#${html(entry.id)}">${html(entry.title)}</a><p>${html(entry.body)}</p></li>`;
}

const list = (items, empty) => (items.length ? `<ul class="items">${items.map(itemMarkup).join('')}</ul>` : `<p class="empty">${empty}</p>`);

function chapterMarkup(view) {
  return `<section class="chapter" id="chapter-${view.number}"><header><span class="num">${view.number}</span><div><div class="when"><time datetime="${html(view.from)}">${html(view.from)}</time>${view.from === view.to ? '' : ` → <time datetime="${html(view.to)}">${html(view.to)}</time>`} · ${html(view.games.map(gameTitle).join(', '))}</div><h2>${html(view.title)}</h2></div></header>` +
    `<div class="cols"><div class="col proved"><h3>What it proved</h3>${list(view.proved, 'No standing positive entry in this chapter.')}</div>` +
    `<div class="col not-proved"><h3>What it did not prove</h3>${list(view.notProved, 'No refutation, retraction or negative entry is filed in this chapter.')}` +
    `${view.superseded.length ? `<h4>Superseded</h4>${list(view.superseded, '')}` : ''}</div></div>` +
    `<footer class="sources"><span class="eyebrow">Source</span>${view.sources.map(sourceLink).join('')}</footer></section>`;
}

/** The whole page: a summary table in the architecture page's shape, then one section per chapter. */
export function renderStory(corpus, story) {
  const byId = new Map(corpus.entries.map((entry) => [entry.id, entry]));
  const views = story.chapters.map((chapter) => chapterView(chapter, byId));
  const drawn = new Set(views.flatMap((view) => view.members.map((entry) => entry.id)));
  const negatives = views.reduce((sum, view) => sum + view.notProved.length + view.superseded.length, 0);
  const rows = views.map((view) => `<tr><td class="num">${view.number}</td><td class="when">${html(when(view))}</td><td><a href="#chapter-${view.number}">${html(view.title)}</a></td>` +
    `<td class="from">${html(view.records.length ? view.records.join(', ') : view.members.map((entry) => entry.id).join(', '))}</td></tr>`).join('');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="theme-color" content="#0a0c0a"><title>The Story · fnaf-solver</title>
<style>
@font-face{font-family:Chakra;src:url('../../assets/fonts/chakra-petch-400-latin.woff2') format('woff2');font-weight:400;font-display:swap}@font-face{font-family:Chakra;src:url('../../assets/fonts/chakra-petch-600-latin.woff2') format('woff2');font-weight:600;font-display:swap}@font-face{font-family:Mono;src:url('../../assets/fonts/ibm-plex-mono-400-latin.woff2') format('woff2');font-weight:400;font-display:swap}
:root{--bg:#0a0c0a;--panel:#141a13;--line:#293329;--muted:#84907e;--dim:#5a6655;--ink:#eaefe3;--text:#c9d2c3;--amber:#ffb020;--cyan:#4fd2ee;--green:#57dc6e;--red:#ff5449;--violet:#c983f5;--mono:Mono,monospace;--sans:Chakra,sans-serif}
*{box-sizing:border-box}html{background:var(--bg)}body{margin:0;color:var(--ink);font:16px/1.5 var(--sans);background:linear-gradient(#0e130e,#0a0c0a 50rem)}
.wrap{max-width:1180px;margin:auto;padding:0 32px 80px}h1,h2,h3,p{margin:0}a{color:var(--cyan)}.eyebrow{color:var(--dim);font:600 10px var(--mono);letter-spacing:.19em;text-transform:uppercase}
.mast{padding:56px 0 26px;border-bottom:1px solid var(--line)}.mast h1{font-size:clamp(40px,7vw,80px);line-height:.9;letter-spacing:-.05em;margin:12px 0 16px}.mast h1 em{font-style:normal;color:var(--amber)}.lede{max-width:720px;color:var(--text);font-size:17px}.stats{display:flex;gap:22px;flex-wrap:wrap;margin-top:18px;color:var(--muted);font:12px var(--mono)}.stats b{color:var(--amber);font-size:18px;margin-right:6px}
.tablewrap{overflow-x:auto;margin:30px 0 46px;border:1px solid var(--line);background:var(--panel)}table{border-collapse:collapse;width:100%;font-size:14px}th,td{text-align:left;vertical-align:top;padding:9px 12px;border-bottom:1px solid var(--line)}th{color:var(--dim);font:600 10px var(--mono);letter-spacing:.12em;text-transform:uppercase}td.num,td.when{white-space:nowrap;font-family:var(--mono);color:var(--amber)}td.from{color:var(--muted);font:12px var(--mono);word-break:break-word}tr:last-child td{border-bottom:0}
.chapter{margin:0 0 54px;padding-top:18px;border-top:1px solid var(--line);scroll-margin-top:16px}.chapter>header{display:flex;gap:18px;align-items:flex-start;margin-bottom:18px}.chapter .num{font:600 40px/1 var(--mono);color:var(--amber);min-width:52px}.chapter .when{color:var(--muted);font:12px var(--mono);margin-bottom:6px}.chapter h2{font-size:clamp(24px,3.4vw,34px);line-height:1.05;letter-spacing:-.02em}
.cols{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px}.col{padding:16px 18px;border:1px solid var(--line);background:linear-gradient(135deg,#151c14,#10150f)}.col h3{font-size:18px;margin-bottom:10px}.proved h3{color:var(--green)}.not-proved h3{color:var(--red)}.col h4{margin:18px 0 10px;color:var(--amber);font-size:15px}
.items{list-style:none;margin:0;padding:0;display:grid;gap:14px}.item{padding-top:12px;border-top:1px solid var(--line)}.item:first-child{border-top:0;padding-top:0}.item .title{display:block;color:var(--ink);font-weight:600;font-size:17px;line-height:1.2;margin:6px 0;text-decoration:none}.item .title:hover{color:var(--amber)}.item p{color:var(--text);font-size:14px;line-height:1.5}
.meta{display:flex;flex-wrap:wrap;gap:6px;font:10px var(--mono);color:var(--dim)}.meta>*{padding:2px 6px;border:1px solid var(--line)}.meta time{color:var(--amber)}.meta .kind{color:var(--cyan)}.meta .label{color:var(--violet)}.meta .measured{color:var(--green)}.meta .note{color:var(--amber)}.meta .note.retracted{color:var(--red)}.meta .note a{color:inherit}
.empty{color:var(--muted);font-size:14px}.sources{display:flex;flex-wrap:wrap;gap:8px 12px;align-items:baseline;margin-top:14px}.src{font:11px var(--mono);color:var(--cyan);text-decoration:none;word-break:break-all}.src:hover{text-decoration:underline}.src.commit{color:var(--violet)}
.foot{display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap;padding-top:24px;border-top:1px solid var(--line);color:var(--dim);font:11px var(--mono)}
@media(max-width:760px){.wrap{padding:0 16px 60px}.cols{grid-template-columns:1fr}.chapter>header{gap:12px}.chapter .num{font-size:30px;min-width:38px}}
</style></head><body><div class="wrap">
<header class="mast"><span class="eyebrow">fnaf-solver / generated from the chronicle</span><h1>The <em>Story</em></h1><p class="lede">${html(story.title)}. Each chapter names the chronicle entries it draws on; its dates run from the earliest to the latest of those entries that still stand, and what it proved, what it did not, and its sources are those entries' own fields. The chapter titles and the entries each draws on are curated in ${html(STORY_FILE)}; no chapter text is written by hand.</p>
<div class="stats"><span><b>${views.length}</b>chapters</span><span><b>${drawn.size}</b>of ${corpus.entries.length} chronicle entries</span><span><b>${negatives}</b>of them negative or superseded</span><span><b>${html(views[0].from)}</b>to ${html(views.at(-1).to)}</span></div></header>
<div class="tablewrap"><table><thead><tr><th>#</th><th>When</th><th>Chapter</th><th>From</th></tr></thead><tbody>${rows}</tbody></table></div>
<main>${views.map(chapterMarkup).join('')}</main>
<footer class="foot"><span>Generated by tools/chronicle.mjs from <a href="../chronicle/README.md">docs/chronicle/</a> · ${STORY_SCHEMA}</span><span><a href="chronicle.html">the chronicle</a> · <a href="index.html">portal</a></span></footer></div></body></html>
`;
}
