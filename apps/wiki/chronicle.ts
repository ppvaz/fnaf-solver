#!/usr/bin/env node
/** Generate the checked-in, interactive project-knowledge chronicle. */
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GAMES, KINDS, LABELS_V2, NIGHTS, ROUTES, RUNGS, SCHEMAS, STATUSES, checkCorpus, gameTitle, readEntries } from '@sixam/review/chronicle-schema';
import type { ChronicleCheckpoint } from '@sixam/review/chronicle-schema';
import { STORY_OUTPUT, loadStory, renderStory } from './chronicle-story.ts';
import { currentPath } from '@sixam/review/renamed-path';

/** The next work a checkpoint names; checkCorpus refuses an outlook without these fields. */
interface OutlookItem { readonly title: string, readonly body: string, readonly sources: readonly string[] }
interface Outlook { readonly next?: readonly OutlookItem[], readonly missing?: readonly OutlookItem[] }
type Entry = ReturnType<typeof readEntries>[number];
type Corpus = Awaited<ReturnType<typeof loadCorpus>>;

export const ROOT = resolve(join(fileURLToPath(new URL('.', import.meta.url)), '../..'));
export const ENTRY_DIR = join(ROOT, 'docs/chronicle/entries');
export const OUTPUT = join(ROOT, 'docs/portal/chronicle.html');

const pad = (value: number) => String(value).padStart(2, '0');
const html = (value: unknown) => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
const jsonScript = (value: unknown) => JSON.stringify(value).replaceAll('<', '\\u003c').replaceAll('>', '\\u003e').replaceAll('&', '\\u0026');

function sourceMarkup(source: string) {
  if (source.startsWith('commit:')) return `<span class="source commit">commit:${html(source.slice(7, 14))}</span>`;
  const match = source.match(/^(.*?)(?::(\d+))?$/);
  // The entry's words stay as written; the link follows a file that moved since
  // (ADR 0002 principle 9), and one that is gone keeps its recorded path.
  const href = match ? `../../${currentPath(ROOT, match[1]) ?? match[1]}${match[2] ? `#L${match[2]}` : ''}` : null;
  return href ? `<a class="source" href="${html(href)}">${html(source)}</a>` : `<span class="source">${html(source)}</span>`;
}

function entryMarkup(entry: Entry, index: number) {
  const game = `<span class="pill game">${html(gameTitle(entry.game))}</span>`;
  const route = entry.route ? `<span class="pill route">${html(entry.route)}</span>` : '';
  const rung = entry.rung === null ? '' : `<span class="pill rung">R${entry.rung} · ${html(RUNGS[entry.rung])}</span>`;
  const plan = entry.plan === null ? '' : `<span class="pill minor">P${entry.plan}</span>`;
  const night = entry.night === null ? '' : `<span class="pill minor">N${entry.night}</span>`;
  const measured = entry.measured ? `<div class="measured"><span>MEASURED</span><code>${html(entry.measured)}</code></div>` : '';
  const history = entry.status === 'standing' ? '' : `<div class="history ${html(entry.status)}"><b>${html(entry.status)}</b><a href="#${html(entry.supersededBy)}">replaced by ${html(entry.supersededBy)}</a></div>`;
  const corrects = entry.supersedes ? `<div class="history corrects"><b>corrects</b><a href="#${html(entry.supersedes)}">${html(entry.supersedes)}</a></div>` : '';
  return `<article class="entry kind-${html(entry.kind)} status-${html(entry.status)}" id="${html(entry.id)}" data-index="${index}" data-date="${html(entry.date)}" data-kind="${html(entry.kind)}" data-label="${html(entry.label)}" data-status="${html(entry.status)}" data-game="${html(entry.game)}" data-rung="${entry.rung ?? ''}" data-plan="${entry.plan ?? ''}" data-night="${entry.night ?? ''}" data-route="${html(entry.route ?? '')}" data-tags="${html(entry.tags.join('|'))}">
    <div class="pin" aria-hidden="true"></div><div class="card"><div class="topline"><time datetime="${html(entry.date)}">${html(entry.date)}</time><span>${pad(index + 1)}</span></div>
    <div class="pills"><span class="kind">${html(entry.kind)}</span><span class="label label-${html(entry.label.toLowerCase())}">${html(entry.label)}</span>${game}${route}${rung}${plan}${night}</div>
    <h3>${html(entry.title)}</h3><p>${html(entry.body)}</p>${measured}${history}${corrects}
    <div class="bottom"><div class="tags">${entry.tags.map((tag) => `<span>#${html(tag)}</span>`).join('')}</div><div class="sources"><span class="eyebrow">TRACE</span>${entry.sources.map(sourceMarkup).join('')}</div></div></div></article>`;
}

function dayPulse(entries: readonly Entry[]) {
  const result: Record<string, number> = {};
  for (const entry of entries) result[entry.date] = (result[entry.date] ?? 0) + 1;
  return result;
}

function pulseMarkup(pulse: Readonly<Record<string, number>>, entries: readonly Entry[]) {
  const dates = Object.keys(pulse).sort();
  if (!dates.length) return '';
  const first = new Date(`${dates[0]}T00:00:00Z`);
  const last = new Date(`${dates.at(-1)}T00:00:00Z`);
  const max = Math.max(...Object.values(pulse), 1);
  const cells: string[] = [];
  for (const cursor = first; cursor <= last; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    const date = `${cursor.getUTCFullYear()}-${pad(cursor.getUTCMonth() + 1)}-${pad(cursor.getUTCDate())}`;
    const count = pulse[date] ?? 0;
    const label = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(cursor);
    const height = count ? Math.max(10, Math.round(count / max * 100)) : 3;
    const kinds = [...new Set(entries.filter((entry) => entry.date === date).map((entry) => entry.kind))].join(' ');
    cells.push(`<button class="pulse-day ${count ? '' : 'quiet'}" data-date="${date}" style="--height:${height}%" title="${date} · ${count} findings" aria-label="${label}, ${count} findings"><span class="pulse-bar ${kinds}"></span><i>${cursor.getUTCDate()}</i></button>`);
  }
  return cells.join('');
}

function outlookMarkup(outlook: Outlook) {
  if (!outlook || (!outlook.next?.length && !outlook.missing?.length)) return '';
  const styles = `<style>.outlook{margin:10px 0 80px;padding:40px 0 0;border-top:1px solid var(--amber);position:relative}.outlook:before{content:'NEXT';position:absolute;top:-10px;left:0;background:var(--bg);padding-right:10px;color:var(--amber);font:10px var(--mono);letter-spacing:.2em}.outlook-heading{max-width:700px;margin-bottom:24px}.outlook-heading h2{font-size:clamp(30px,5vw,56px);line-height:.95;letter-spacing:-.04em;margin:8px 0 12px}.outlook-heading p{color:#c9d2c3;max-width:540px}.outlook-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px}.outlook-column{padding:22px;border:1px solid var(--line);background:linear-gradient(135deg,#151c14,#10150f)}.outlook-column.next{border-color:#554414}.outlook-column.missing{border-color:#5e1e24}.outlook-column>h3{font-size:24px;margin:8px 0 18px;color:var(--amber)}.outlook-column.missing>h3{color:var(--red)}.outlook-items{display:grid;gap:1px}.outlook-items article{padding:15px 0;border-top:1px solid var(--line)}.outlook-items article:first-child{border-top:0;padding-top:0}.outlook-items h4{font-size:18px;line-height:1.1;margin:0 0 6px}.outlook-items p{color:#c9d2c3;font-size:14px;line-height:1.45}.outlook-source{display:flex;gap:8px;margin-top:9px;flex-wrap:wrap}@media(max-width:560px){.outlook-grid{grid-template-columns:1fr}}</style>`;
  const column = (title: string, kicker: string, items: readonly OutlookItem[], className: string) => `<section class="outlook-column ${className}"><span class="eyebrow">${kicker}</span><h3>${title}</h3><div class="outlook-items">${items.map((item) => `<article><h4>${html(item.title)}</h4><p>${html(item.body)}</p><div class="outlook-source">${item.sources.map(sourceMarkup).join('')}</div></article>`).join('')}</div></section>`;
  return `${styles}<section class="outlook"><div class="outlook-heading"><span class="eyebrow">THE WORK CONTINUES</span><h2>The next page is not written yet.</h2><p>The last finding is a boundary, not a conclusion. Here is the honest shape of the work still ahead.</p></div><div class="outlook-grid">${column("WHAT'S NEXT", 'NEXT CHECKPOINT', outlook.next ?? [], 'next')}${column("WHAT'S LEFT / MISSING", 'OPEN GAPS', outlook.missing ?? [], 'missing')}</div></section>`;
}

const options = (values: readonly (string | number)[], labels: readonly (string | number)[] = values) => values.map((value, index) => `<option value="${html(value)}">${html(labels[index] ?? value)}</option>`).join('');

export async function loadCorpus() {
  const names = (await readdir(ENTRY_DIR)).filter((name) => name.endsWith('.json')).sort();
  const checkpoints: Readonly<Record<string, unknown>>[] = [];
  for (const name of names) {
    const file = `docs/chronicle/entries/${name}`;
    checkpoints.push({ ...JSON.parse(await readFile(join(ENTRY_DIR, name), 'utf8')), file });
  }
  const problems = checkCorpus(checkpoints);
  if (problems.length) throw new Error(`chronicle: invalid corpus\n${problems.map((problem) => `  ${problem}`).join('\n')}`);
  // v1 entries read as fnaf2, and an entry a v2 correction supersedes reads as
  // superseded although its frozen file still says standing (packages/review/src/chronicle-schema.ts).
  // checkCorpus passed, so each file is a checkpoint.
  const corpus = checkpoints as unknown as ChronicleCheckpoint[];
  const entries = readEntries(corpus);
  entries.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  const outlook = (corpus.at(-1)?.outlook ?? { next: [], missing: [] }) as Outlook;
  return { checkpoints: corpus, entries, pulseByDay: dayPulse(entries), outlook };
}

export function renderChronicle(corpus: Corpus) {
  const { checkpoints, entries, pulseByDay, outlook } = corpus;
  const tags = [...new Set(entries.flatMap((entry) => entry.tags))].sort();
  const activeRungs = new Set(entries.filter((entry) => entry.rung !== null).map((entry) => entry.rung));
  const periods = checkpoints.map((checkpoint) => {
    const members = entries.filter((entry) => entry.checkpoint === checkpoint.checkpoint);
    return `<section class="checkpoint" data-checkpoint="${html(checkpoint.checkpoint)}"><header><span class="eyebrow">CHECKPOINT ${html(checkpoint.checkpoint)}</span><h2>${html(checkpoint.label)}</h2><span class="count">${members.length} findings</span></header><div class="spine">${members.map((entry) => entryMarkup(entry, entries.indexOf(entry))).join('')}</div></section>`;
  }).join('');
  const rail = RUNGS.map((rung, index) => `<button class="rung-step ${activeRungs.has(index) ? 'used' : ''}" data-rung="${index}"><b>${index}</b><span>${html(rung)}</span></button>`).join('');
  const planValues = [...new Set(entries.flatMap((entry) => (entry.plan === null ? [] : [entry.plan])))].sort((a, b) => a - b);
  const nights = Array.from({ length: Math.max(...Object.values(NIGHTS)) }, (_, index) => String(index + 1));
  const games = GAMES.filter((game) => entries.some((entry) => entry.game === game));
  const data = { entries, checkpoints, rungs: RUNGS, kinds: KINDS, labels: LABELS_V2, routes: ROUTES, statuses: STATUSES, games: GAMES, nights: NIGHTS, tags };
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="theme-color" content="#0a0c0a"><title>The Chronicle · fnaf-solver</title>
<style>
@font-face{font-family:Chakra;src:url('../../apps/trainer/assets/fonts/chakra-petch-400-latin.woff2') format('woff2');font-weight:400;font-display:swap}@font-face{font-family:Chakra;src:url('../../apps/trainer/assets/fonts/chakra-petch-600-latin.woff2') format('woff2');font-weight:600;font-display:swap}@font-face{font-family:Mono;src:url('../../apps/trainer/assets/fonts/ibm-plex-mono-400-latin.woff2') format('woff2');font-weight:400;font-display:swap}@font-face{font-family:Mono;src:url('../../apps/trainer/assets/fonts/ibm-plex-mono-600-latin.woff2') format('woff2');font-weight:600;font-display:swap}
:root{--bg:#0a0c0a;--deep:#0e130e;--panel:#141a13;--panel2:#192118;--line:#293329;--muted:#84907e;--dim:#5a6655;--ink:#eaefe3;--amber:#ffb020;--cyan:#4fd2ee;--green:#57dc6e;--red:#ff5449;--violet:#c983f5;--mono:Mono,monospace;--sans:Chakra,sans-serif}*{box-sizing:border-box}html{background:var(--bg);scroll-behavior:smooth}body{margin:0;color:var(--ink);font:16px/1.5 var(--sans);background:radial-gradient(ellipse at 80% -10%,#34481e44,transparent 45rem),linear-gradient(#0e130e,#0a0c0a 50rem);letter-spacing:.01em}body:before{content:'';position:fixed;inset:0;pointer-events:none;opacity:.08;background:repeating-linear-gradient(0deg,#fff 0 1px,transparent 1px 4px);mix-blend-mode:screen}.wrap{max-width:1450px;margin:auto;padding:0 32px 90px}.mast{padding:60px 0 30px;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;gap:40px;align-items:end}.eyebrow{color:var(--dim);font:600 10px var(--mono);letter-spacing:.19em;text-transform:uppercase}.kicker{color:var(--amber);display:flex;gap:10px;align-items:center;margin-bottom:15px}.lamp{width:8px;height:8px;border-radius:50%;background:var(--amber);box-shadow:0 0 16px var(--amber)}h1,h2,h3,p{margin:0}h1{font-size:clamp(42px,7vw,86px);line-height:.9;letter-spacing:-.06em;font-weight:600}h1 em{font-style:normal;color:var(--amber)}.lede{max-width:450px;color:#c9d2c3;font-size:18px;line-height:1.35}.stats{display:flex;gap:22px;margin-top:26px}.stat strong{display:block;color:var(--amber);font:600 24px var(--mono)}.stat span{color:var(--dim);font:10px var(--mono);letter-spacing:.12em;text-transform:uppercase}.toolbar{position:sticky;z-index:5;top:0;margin-top:22px;padding:12px;display:flex;flex-wrap:wrap;gap:8px;background:#0d120ee8;border:1px solid var(--line);backdrop-filter:blur(15px);box-shadow:0 10px 35px #0008}.search{flex:1 1 260px;position:relative}.search input,.filter,.reset{height:42px;border:1px solid var(--line);background:#0a0e0a;color:var(--ink);padding:0 12px}.search input{width:100%;outline:none;padding-right:34px}.search input:focus,.filter:focus{border-color:var(--amber);outline:none}.search kbd{position:absolute;right:11px;top:11px;color:var(--dim);font:11px var(--mono)}.filter{min-width:115px;padding-right:25px}.reset{color:var(--muted);cursor:pointer}.reset:hover{color:var(--amber);border-color:var(--amber)}.count-result{color:var(--muted);font:11px var(--mono);align-self:center;margin-left:auto;white-space:nowrap}.toggle{color:var(--muted);font:11px var(--mono);display:flex;gap:6px;align-items:center;white-space:nowrap}.toggle input{accent-color:var(--amber)}.pulse-wrap{margin:28px 0 38px;padding:17px 15px 12px;border:1px solid var(--line);background:linear-gradient(#141b13,#0e130e)}.pulse-head{display:flex;justify-content:space-between;margin-bottom:12px}.pulse-hint{color:var(--dim);font:10px var(--mono)}.pulse{height:70px;display:flex;align-items:end;gap:3px;overflow:auto;padding:0 2px 21px}.pulse-day{height:49px;min-width:22px;flex:1 0 22px;padding:0;border:0;background:transparent;display:flex;align-items:end;justify-content:center;position:relative}.pulse-day:focus-visible{outline:1px solid var(--amber)}.pulse-bar{height:var(--height);width:100%;min-height:3px;background:var(--line);border-top:2px solid var(--dim);transition:.15s}.pulse-bar:after{content:'';display:block;height:100%;background:linear-gradient(var(--amber),transparent);opacity:.55}.pulse-day:hover .pulse-bar,.pulse-day.active .pulse-bar{border-color:var(--amber);background:#33270a;box-shadow:0 0 15px #ffb02066}.pulse-day i{position:absolute;bottom:-19px;color:var(--muted);font:9px var(--mono);font-style:normal}.layout{display:grid;grid-template-columns:225px minmax(0,1fr);gap:45px}.rail{position:sticky;top:105px;align-self:start}.rail p{color:var(--muted);font-size:13px;line-height:1.25;margin:8px 0 18px}.rungs{border-left:1px solid var(--line);display:grid;gap:2px}.rung-step{display:flex;gap:11px;padding:10px;border:0;border-left:2px solid transparent;margin-left:-1px;background:transparent;color:var(--dim);text-align:left;cursor:pointer}.rung-step:hover,.rung-step.active{color:var(--amber);border-color:var(--amber);background:#33270a66}.rung-step b{width:15px;color:var(--muted);font:600 12px var(--mono)}.rung-step span{font-size:13px}.rung-step.used b{color:var(--ink)}.rail-note{border-top:1px solid var(--line);margin-top:25px;padding-top:14px;color:var(--dim);font:10px/1.5 var(--mono)}.rail-note b{color:var(--ink);font-weight:400}.checkpoint{margin-bottom:65px}.checkpoint>header{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;border-bottom:1px solid var(--line);padding-bottom:13px;margin-bottom:21px}.checkpoint h2{font-size:26px;letter-spacing:-.02em;font-weight:600}.checkpoint .count{color:var(--dim);font:11px var(--mono);margin-left:auto}.spine{position:relative}.spine:before{content:'';position:absolute;top:0;bottom:0;left:9px;width:1px;background:linear-gradient(var(--amber),var(--line) 80%,transparent)}.entry{display:grid;grid-template-columns:20px minmax(0,1fr);gap:20px;margin-bottom:18px;scroll-margin-top:125px}.pin{width:18px;height:18px;margin-top:20px;z-index:1;border:3px solid var(--bg);background:var(--dim);box-shadow:0 0 0 1px var(--line);transform:rotate(45deg);transition:.18s}.entry:hover .pin,.entry:target .pin{background:var(--amber);box-shadow:0 0 15px #ffb02099;transform:rotate(45deg) scale(1.1)}.card{padding:18px 22px;background:linear-gradient(135deg,#151c14,#10150f);border:1px solid var(--line);box-shadow:0 7px 18px #0005;transition:.18s}.card:hover{border-color:#44563e;transform:translateY(-1px)}.entry:target .card{border-color:var(--amber);box-shadow:0 0 0 1px #ffb02055,0 15px 40px #0008}.topline{display:flex;justify-content:space-between;color:var(--dim);font:10px var(--mono);margin-bottom:11px}.topline time{color:var(--amber);letter-spacing:.08em}.pills{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:11px}.pill,.kind,.label{padding:4px 7px;border:1px solid var(--line);font:10px var(--mono);letter-spacing:.04em}.kind{color:var(--cyan);background:#0c2833;border-color:#2a4c5c}.label-sourced{color:var(--violet);background:#1d1029;border-color:#46285e}.label-calibrated,.label-device_measured{color:var(--green);background:#152019;border-color:#295134}.label-inferred,.label-model{color:var(--amber);background:#33270a;border-color:#554414}.label-unknown{color:var(--muted)}.route{color:#d6e2d1;background:#1b241b}.rung{color:var(--amber);background:#33270a}.minor{color:var(--muted);background:#151b14}h3{font-size:23px;line-height:1.12;letter-spacing:-.02em;font-weight:600;margin-bottom:10px}.card p{color:#c9d2c3;line-height:1.52;white-space:pre-wrap}.measured{display:flex;gap:12px;align-items:baseline;margin-top:16px;padding:10px 12px;border-left:2px solid var(--green);background:#15201988}.measured span{color:var(--dim);font:10px var(--mono)}.measured code{color:var(--green);font:600 13px var(--mono)}.history{display:flex;gap:12px;align-items:center;padding:9px 11px;margin-top:15px;color:var(--amber);background:#33270a;border:1px solid #554414;font:11px var(--mono)}.history.retracted{color:var(--red);background:#331110;border-color:#5e1e24}.history a{color:inherit}.bottom{display:flex;justify-content:space-between;gap:18px;align-items:end;margin-top:17px;padding-top:12px;border-top:1px solid var(--line)}.tags{display:flex;gap:8px;flex-wrap:wrap;color:var(--dim);font:10px var(--mono)}.sources{display:flex;gap:8px;justify-content:end;align-items:center;flex-wrap:wrap}.source{color:var(--cyan);font:10px var(--mono);text-decoration:none}.source:hover{text-decoration:underline}.source.commit{color:var(--violet)}.empty{display:none;padding:45px;text-align:center;border:1px dashed var(--line);color:var(--muted);font:12px var(--mono)}.empty.show{display:block}.foot{display:flex;justify-content:space-between;gap:20px;padding-top:28px;border-top:1px solid var(--line);color:var(--dim);font:10px var(--mono)}.foot a{color:var(--cyan)}dialog{max-width:500px;background:var(--panel2);color:var(--ink);border:1px solid var(--amber);padding:25px;box-shadow:0 20px 70px #000b}dialog::backdrop{background:#000b}dialog h2{margin-bottom:12px}dialog p{color:#c9d2c3;margin:8px 0}dialog kbd{color:var(--amber);font:11px var(--mono);border:1px solid #554414;padding:2px 5px}.close{margin-top:12px;padding:7px 12px;background:transparent;border:1px solid var(--line);color:var(--ink)}[hidden]{display:none!important}@media(max-width:900px){.wrap{padding-left:18px;padding-right:18px}.mast{display:block}.lede{margin-top:18px}.layout{display:block}.rail{position:static;margin-bottom:30px}.rungs{display:flex;overflow:auto;border-left:0;border-bottom:1px solid var(--line)}.rung-step{flex:0 0 auto;border-left:0;border-bottom:2px solid transparent}.rung-step:hover,.rung-step.active{border-color:var(--amber);background:linear-gradient(0deg,#33270a66,transparent)}.rail-note{display:none}}@media(max-width:560px){.wrap{padding-left:12px;padding-right:12px}.mast{padding-top:35px}.toolbar{top:0}.filter{flex:1 1 110px;min-width:0}.count-result{width:100%;margin-left:0}.entry{grid-template-columns:12px minmax(0,1fr);gap:11px}.spine:before{left:6px}.pin{width:12px;height:12px;border-width:2px}.card{padding:15px}.card h3{font-size:20px}.card p{font-size:14px}.bottom{display:block}.sources{justify-content:start;margin-top:10px}.checkpoint h2{font-size:22px}.foot{display:block}.foot span{display:block;margin-top:8px}}
.game{color:var(--cyan);background:#0c2833}.label-model_only{color:var(--amber);background:#33270a;border-color:#554414}.label-fixture{color:var(--violet);background:#1d1029;border-color:#46285e}.history.corrects{color:var(--cyan);background:#0c2833;border-color:#2a4c5c}
</style></head><body><div class="wrap">
<header class="mast"><div><div class="kicker"><span class="lamp"></span><span class="eyebrow">FNAF2 / KNOWLEDGE SYSTEM</span></div><h1>The <em>Chronicle</em></h1><div class="stats"><div class="stat"><strong>${entries.length}</strong><span>findings</span></div><div class="stat"><strong>${Object.keys(pulseByDay).length}</strong><span>active days</span></div><div class="stat"><strong>${checkpoints.length}</strong><span>checkpoints</span></div></div></div><p class="lede">A map of what this project learned the hard way: decisions, measurements, wrong turns, small facts, and the evidence that changed the route.</p></header>
<div class="toolbar"><label class="search"><input id="query" type="search" placeholder="Search the record…" autocomplete="off" aria-label="Search the chronicle"><kbd>/</kbd></label><select class="filter" id="kind" aria-label="Kind"><option value="">All kinds</option>${options(KINDS)}</select><select class="filter" id="game" aria-label="Game"><option value="">All games</option>${options(games, games.map(gameTitle))}</select><select class="filter" id="label" aria-label="Evidence label"><option value="">All evidence</option>${options(LABELS_V2)}</select><select class="filter" id="rung" aria-label="Plan 12 rung"><option value="">All rungs</option>${options(RUNGS.map((_, index) => String(index)), RUNGS.map((rung, index) => `R${index} · ${rung}`))}</select><select class="filter" id="plan" aria-label="Plan"><option value="">All plans</option>${options(planValues, planValues.map((value) => `Plan ${value}`))}</select><select class="filter" id="night" aria-label="Night"><option value="">All nights</option>${options(nights, nights.map((night) => `Night ${night}`))}</select><select class="filter" id="route" aria-label="Route"><option value="">All routes</option>${options(ROUTES)}</select><select class="filter" id="tag" aria-label="Tag"><option value="">All tags</option>${options(tags)}</select><label class="toggle"><input id="history" type="checkbox" checked> keep history</label><button class="reset" id="reset" type="button">reset</button><span class="count-result" id="result" role="status"></span></div>
<section class="pulse-wrap"><div class="pulse-head"><span class="eyebrow">KNOWLEDGE PULSE / FINDINGS</span><span class="pulse-hint">click or drag a day to narrow the spine</span></div><div class="pulse" id="pulse" aria-label="Knowledge findings by day">${pulseMarkup(pulseByDay, entries)}</div></section>
<div class="layout"><aside class="rail"><span class="eyebrow">PROMOTION LADDER</span><p>Filter the record by the Plan 12 evidence climb.</p><div class="rungs">${rail}</div><div class="rail-note"><b>History is data.</b><br>Wrong turns stay visible because the route to a conclusion is part of the lesson.</div></aside><main>${periods}${outlookMarkup(outlook)}<div class="empty" id="empty">Nothing matches this view.<br><button class="reset" id="empty-reset" type="button">clear filters</button></div></main></div>
<footer class="foot"><span>Generated from <a href="../chronicle/README.md">docs/chronicle/entries/</a> · ${SCHEMAS.join(' · ')} · <a href="story.html">the story</a></span><span><kbd>j</kbd>/<kbd>k</kbd> move · <kbd>/</kbd> search · <kbd>?</kbd> help</span></footer></div><dialog id="help"><h2>Chronicle controls</h2><p><kbd>/</kbd> search · <kbd>j</kbd>/<kbd>k</kbd> move through visible findings · <kbd>?</kbd> help</p><p>The pulse is made from curated findings, not repository activity. Drag across it to inspect a stretch of learning. Every card keeps a trace back to a source record.</p><button class="close" id="close" type="button">close</button></dialog>
<script id="data" type="application/json">${jsonScript(data)}</script><script>
(() => {
  const state = { query:'', game:'', kind:'', label:'', rung:'', plan:'', night:'', route:'', tag:'', history:true, from:'', to:'' };
  const ids = ['query','game','kind','label','rung','plan','night','route','tag'];
  const cards = [...document.querySelectorAll('.entry')]; const sets = [...document.querySelectorAll('.checkpoint')];
  const put = (id, val) => { const node = document.getElementById(id); if (node.type === 'checkbox') node.checked = val; else node.value = val; };
  function hashRead() { const raw = decodeURIComponent(location.hash.slice(1)); if (!raw.startsWith('filter=')) return; const params = new URLSearchParams(raw.slice(7)); ids.forEach(id => { if (params.has(id)) { state[id] = params.get(id); put(id,state[id]); } }); state.history = params.get('history') !== '0'; put('history',state.history); state.from = params.get('from') || ''; state.to = params.get('to') || ''; }
  function hashWrite() { const params = new URLSearchParams(); ids.forEach(id => { if (state[id]) params.set(id,state[id]); }); if (!state.history) params.set('history','0'); if (state.from) params.set('from',state.from); if (state.to) params.set('to',state.to); history.replaceState(null,'',params.toString() ? '#filter=' + params.toString() : location.pathname + location.search); }
  function matches(card) { const hay = card.textContent.toLowerCase() + ' ' + card.dataset.tags + ' ' + card.dataset.route; if (state.query && !hay.includes(state.query.toLowerCase())) return false; for (const id of ['game','kind','label','rung','plan','night','route']) if (state[id] && card.dataset[id] !== state[id]) return false; if (state.tag && !card.dataset.tags.split('|').includes(state.tag)) return false; if (!state.history && card.dataset.status !== 'standing') return false; if (state.from && card.dataset.date < state.from) return false; if (state.to && card.dataset.date > state.to) return false; return true; }
  function render() { let visible=0; cards.forEach(card => { card.hidden=!matches(card); if (!card.hidden) visible++; }); sets.forEach(set => { set.hidden=! [...set.querySelectorAll('.entry')].some(card => !card.hidden); }); document.getElementById('empty').classList.toggle('show',visible===0); document.getElementById('result').textContent=visible+' / '+cards.length+' findings'; document.querySelectorAll('.pulse-day').forEach(day => day.classList.toggle('active',state.from && day.dataset.date>=state.from && day.dataset.date<=(state.to||state.from))); document.querySelectorAll('.rung-step').forEach(step => step.classList.toggle('active',step.dataset.rung===state.rung)); }
  ids.forEach(id => document.getElementById(id).addEventListener('input',event => { state[id]=event.target.value; hashWrite(); render(); })); document.getElementById('history').addEventListener('input',event => { state.history=event.target.checked; hashWrite(); render(); });
  function reset() { Object.assign(state,{query:'',game:'',kind:'',label:'',rung:'',plan:'',night:'',route:'',tag:'',history:true,from:'',to:''}); ids.forEach(id=>put(id,'')); put('history',true); hashWrite(); render(); }
  document.getElementById('reset').addEventListener('click',reset); document.getElementById('empty-reset').addEventListener('click',reset); document.querySelectorAll('.rung-step').forEach(step => step.addEventListener('click',() => { state.rung=state.rung===step.dataset.rung?'':step.dataset.rung; put('rung',state.rung); hashWrite(); render(); }));
  let start=''; let dragging=false; const range = date => { state.from=start<date?start:date; state.to=start<date?date:start; render(); }; document.querySelectorAll('.pulse-day').forEach(day => { day.addEventListener('pointerdown',event=>{ event.preventDefault(); start=day.dataset.date; dragging=true; day.setPointerCapture?.(event.pointerId); range(start); }); day.addEventListener('pointerenter',()=>{if(dragging)range(day.dataset.date);}); day.addEventListener('pointerup',()=>{if(dragging){dragging=false;hashWrite();render();}}); day.addEventListener('click',()=>{if(state.from===day.dataset.date&&state.to===day.dataset.date){state.from='';state.to='';}hashWrite();render();}); });
  const help=document.getElementById('help'); document.getElementById('close').addEventListener('click',()=>help.close()); let selected=-1; function move(delta){const visible=cards.filter(card=>!card.hidden);if(!visible.length)return;selected=Math.max(0,Math.min(visible.length-1,selected+delta));visible[selected].scrollIntoView({block:'center'});visible[selected].classList.add('selected');setTimeout(()=>visible[selected]?.classList.remove('selected'),500);}
  document.addEventListener('keydown',event=>{if(event.key==='/'&&document.activeElement.tagName!=='INPUT'){event.preventDefault();document.getElementById('query').focus();}else if(event.key==='?'&&document.activeElement.tagName!=='INPUT'){event.preventDefault();help.showModal();}else if(event.key==='j'&&document.activeElement.tagName!=='INPUT')move(1);else if(event.key==='k'&&document.activeElement.tagName!=='INPUT')move(-1);}); hashRead(); render(); const target=location.hash&&!location.hash.startsWith('#filter=')?document.getElementById(location.hash.slice(1)):null;if(target)setTimeout(()=>target.scrollIntoView({block:'center'}),40); window.addEventListener('hashchange',()=>{hashRead();render();});
})();
</script></body></html>\n`;
}

export async function generate({ write = true } = {}) {
  const corpus = await loadCorpus(); const output = renderChronicle(corpus);
  const story = await loadStory(corpus); const storyOutput = renderStory(corpus, story);
  if (write) {
    await mkdir(dirname(OUTPUT), { recursive: true });
    await writeFile(OUTPUT, output);
    await writeFile(STORY_OUTPUT, storyOutput);
  }
  return { ...corpus, output, story, storyOutput };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { const result = await generate(); console.log(`chronicle: ${result.entries.length} findings, ${Object.keys(result.pulseByDay).length} days, ${result.checkpoints.length} checkpoints; story: ${result.story.chapters.length} chapters`); }
  catch (error) { console.error((error as Error).message); process.exitCode = 1; }
}
