// What is killing a night, as one picture.
//
// `human-gate.ts` already counts the deaths -- it prints its top four on a
// refusal and throws the rest away. But the top four is the wrong cut: on
// Night 2 the two Foxy rows are 1st and 2nd and the three Toy office entries
// are 3rd, 4th and 5th, so the printed list says "Foxy, mostly" when Foxy is
// 58% and the office is 42%. The shape of the census is the finding, and a
// truncated list hides it.
//
// So this charts the whole census by the engine's own `reason` families --
// the six strings `kill()` is called with, never a taxonomy invented here.
// The repository has mis-attributed a route action to one animatronic four
// separate times (elegance.py's SERVES table); this instrument does not add a
// fifth by deciding that, say, `golden-freddy-hall` is "really" Foxy.
//
//   deathchart.ts --night=2 [--runs=1200] [--out=FILE.png]
//   deathchart.ts --night=2,3,4,5,6,7 [--cols=2]     # one panel per night
//
// Writes a PNG by default and keeps the SVG beside it as the source. Pass
// --out=FILE.svg for the vector alone. The PNG is rendered by the same
// headless Chrome the --browser checks use ($CHROME overrides); if that is
// not on this machine the tool says so and exits 3 rather than quietly
// leaving a PNG that was never written.
//
// This is a SIMULATOR census: the gate's engine replay under +/-60 ms modeled
// human slack. It prices no screencap, no dropped contact and no desync, so
// it says what the MODEL kills the plan with. Say "in the gate" when quoting it.
import { execFileSync, spawnSync } from 'node:child_process';
import { writeFileSync, existsSync } from 'node:fs';
import { chromeBinary, chromeAvailable } from '../../../tools/chrome.ts';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { modelGate, GATE_RUNS, HUMAN_SLACK_MS } from '../../../packages/propose/bin/plans/human-gate.ts';
import { formatRate } from '@sixam/review/stat';
import * as C from '@sixam/source/fnaf2';

const arg = <T>(name: string, def: T) => {
  const v = (process.argv.find(a => a.startsWith(`--${name}=`)) || '').split('=')[1];
  return v === undefined ? def : v;
};

// Colour follows the character, not the slice's rank, so Foxy is the same blue
// on every panel and two nights can be read side by side. Fixed order also
// fixes which slices touch, which is what the palette was validated on.
// Slots 1-6 of the dataviz reference categorical palette; the six adjacent
// pairs and the ring's wrap pair all clear the CVD and normal-vision floors in
// both modes. Three light-mode fills sit under 3:1 on white, so the relief
// rule applies and every slice is labelled in the legend -- there is no
// colour-only identity here.
export const REASON_ORDER = ['foxy', 'inside-office', 'puppet', 'golden-freddy',
                             'golden-freddy-hall', 'blackout'];
const FILL: Readonly<Record<string, string>> = {
  'foxy':               '#2a78d6',
  'inside-office':      '#eb6834',
  'puppet':             '#1baf7a',
  'golden-freddy':      '#eda100',
  'golden-freddy-hall': '#e87ba4',
  'blackout':           '#008300',
};

/** Death times in seconds; a replay that does not time its deaths leaves them undefined. */
type DeathTimes = readonly (number | undefined)[];
/** One death reason: its count, its detail rows with their median times, and its own times and median. */
export interface ReasonRow {
  reason: string; n: number; details: { detail: string; n: number; t: number | undefined | null }[];
  ts: (number | undefined)[]; t?: number | undefined | null;
}
/** A gate's census as the chart reads it: the night, survival against its bar, the deaths and their times. */
export interface GateCensus {
  readonly night: number; readonly survived: number; readonly runs: number; readonly minSurvival: number;
  readonly ok: boolean; readonly deaths: Iterable<readonly [string, number]>;
  readonly deathTimes?: ReadonlyMap<string, DeathTimes>;
}

// `reason: detail` rows -> counts per reason, plus the detail rows under each.
export function census(deaths: Iterable<readonly [string, number]>, deathTimes: ReadonlyMap<string, DeathTimes> = new Map()) {
  const byReason = new Map<string, ReasonRow>();
  for (const [key, n] of deaths) {
    const i = key.indexOf(': ');
    const reason = i < 0 ? key : key.slice(0, i);
    const detail = i < 0 ? '' : key.slice(i + 2);
    if (!REASON_ORDER.includes(reason))
      throw new Error(`death reason "${reason}" has no slice; add it to REASON_ORDER and re-validate the palette`);
    const ts = deathTimes.get(key) || [];
    const r = byReason.get(reason) || { reason, n: 0, details: [], ts: [] };
    r.n += n;
    r.ts.push(...ts);
    r.details.push({ detail, n, t: median(ts) });
    byReason.set(reason, r);
  }
  for (const r of byReason.values()) {
    r.details.sort((a, b) => b.n - a.n);
    r.t = median(r.ts);
  }
  return REASON_ORDER.filter(r => byReason.has(r)).map(r => byReason.get(r) as ReasonRow); // the reasons it has
}

// sort() places undefined last without comparing it.
export const median = (a: DeathTimes) =>
  a.length ? [...a].sort((x, y) => (x as number) - (y as number))[a.length >> 1] : null;

// Seconds of engine time -> the clock the player sees. A night is 420 s over
// six in-game hours (HOUR_FRAMES), so 214 s is 3 AM -- which is the form that
// can be compared against the AI table's hour rows and against a device run.
// `null` when nobody died of this cause: an absent time is not 12 AM.
// Number(): an untimed death (undefined) renders as NaN, as it did.
export const clock = (t: number | undefined | null) => t === null ? '' :
  `${Math.round(Number(t))} s \u00b7 ${(Math.floor(Number(t) / (C.HOUR_FRAMES / C.FPS)) || 12)} AM`;

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// Panel geometry. The pie sits BELOW the three header lines, not across them,
// and both number columns stay inside W -- a percentage that overflowed by
// 32 px printed itself on top of the next night's panel.
const W = 660, PIE_CX = 112, PIE_CY = 190, R = 82;
// The rightmost column must end well short of W. At a 6 px gutter the time
// column sat against the next panel's swatches and read as that night's
// numbers -- a caption that lies about which night it belongs to is worse
// than no caption.
const COL_N = W - 250, COL_PCT = W - 180, COL_T = W - 85, LEGEND_TOP = 310;
// The count column is a fixed x, so a long detail string runs into it and
// prints "...at a 5s check)99". SVG has no text metrics, so the label is cut
// to what the column leaves at ~5.45 px per character at 11 px. The console
// output carries every string in full; this backstop only protects the image.
const ROW_GAP = 34, COLS_DEFAULT = 2;
const MAX_DETAIL = Math.floor((COL_N - 19 - 10) / 5.45);
const clip = (s: string) => s.length <= MAX_DETAIL ? s : s.slice(0, MAX_DETAIL - 1) + '\u2026';

function slices(rows: readonly ReasonRow[], total: number) {
  if (!total) return '';
  // One reason taking every death is a full circle: an arc of exactly 360
  // degrees draws nothing at all.
  if (rows.length === 1)
    return `<circle cx="${PIE_CX}" cy="${PIE_CY}" r="${R}" fill="${FILL[rows[0].reason]}"><title>${esc(rows[0].reason)} ${rows[0].n}</title></circle>`;
  let a = -Math.PI / 2, out = '';
  for (const r of rows) {
    const b = a + 2 * Math.PI * r.n / total;
    const [x0, y0] = [PIE_CX + R * Math.cos(a), PIE_CY + R * Math.sin(a)];
    const [x1, y1] = [PIE_CX + R * Math.cos(b), PIE_CY + R * Math.sin(b)];
    const big = b - a > Math.PI ? 1 : 0;
    // A 2px surface gap between fills, per the mark spec: the stroke is the
    // page, so adjacent slices never touch.
    out += `<path d="M${PIE_CX} ${PIE_CY}L${x0.toFixed(2)} ${y0.toFixed(2)}` +
           `A${R} ${R} 0 ${big} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}Z" fill="${FILL[r.reason]}"` +
           ` stroke="var(--surface)" stroke-width="2">` +
           `<title>${esc(r.reason)} ${r.n} (${(100 * r.n / total).toFixed(1)}%)</title></path>`;
    a = b;
  }
  return out;
}

function panel(g: GateCensus) {
  const rows = census(g.deaths, g.deathTimes);
  const total = rows.reduce((s, r) => s + r.n, 0);
  let y = LEGEND_TOP, body = '';
  // A night with no deaths is a result, not an empty panel. Say so where the
  // pie would have been, or the reader cannot tell it from a failed render.
  if (!total)
    body += `<text class="m" x="0" y="${PIE_CY}">no deaths in ${g.runs} runs</text>`;
  for (const r of rows) {
    body += `<rect x="0" y="${y - 9}" width="11" height="11" rx="2" fill="${FILL[r.reason]}"/>` +
            `<text class="k" x="19" y="${y}">${esc(r.reason)}</text>` +
            `<text class="k n" x="${COL_N}" y="${y}">${r.n}</text>` +
            `<text class="m n" x="${COL_PCT}" y="${y}">${(100 * r.n / total).toFixed(1)}%</text>` +
            `<text class="m n" x="${COL_T}" y="${y}">${clock(r.t)}</text>`;
    y += 19;
    for (const d of r.details) {
      body += `<text class="m" x="19" y="${y}"><title>${esc(d.detail)}</title>${esc(clip(d.detail))}</text>` +
              `<text class="m n" x="${COL_N}" y="${y}">${d.n}</text>` +
              `<text class="m n" x="${COL_T}" y="${y}">${clock(d.t)}</text>`;
      y += 16;
    }
    y += 6;
  }
  return { h: y + 10, svg:
    `<text class="h" x="0" y="28">Night ${g.night}</text>` +
    `<text class="s" x="0" y="52">${g.survived}/${g.runs} survived &#183; ${esc(formatRate(g.survived, g.runs, { label: 'survival' }))} &#183; ${total} deaths</text>` +
    `<text class="m" x="0" y="72">bar ${(100 * g.minSurvival).toFixed(0)}% &#8212; ${g.ok ? 'accepted' : 'REFUSED'}${
      total ? ` &#183; a lost run dies at a median ${clock(median(rows.flatMap(r => r.ts)))}` : ''}</text>` +
    (total ? `<text class="m n" x="${COL_T}" y="${LEGEND_TOP - 20}">median time of death</text>` : '') +
    slices(rows, total) + body };
}

// The renderer, kept honest about its own failure. The SVG is always written;
// this only says whether the raster beside it exists.
export function renderPng(svgPath: string, pngPath: string, size: { w: number; h: number }) {
  if (!chromeAvailable())
    return { ok: false, why: `UNKNOWN(no chrome on this machine; set $CHROME)` };
  const r = spawnSync(chromeBinary(), ['--headless', '--disable-gpu',
    '--hide-scrollbars', '--force-device-scale-factor=2',
    `--window-size=${size.w},${size.h}`, `--screenshot=${pngPath}`,
    pathToFileURL(svgPath).href], { encoding: 'utf8' });
  if (!existsSync(pngPath))
    return { ok: false, why: `UNKNOWN(chrome wrote no file: ${(r.stderr || '').trim().split('\n').pop() || `status ${r.status}`})` };
  return { ok: true };
}

export function chart(gates: readonly GateCensus[], build: string, cols = COLS_DEFAULT) {
  // Six nights in one row is 3082 px, which nobody reads. Wrap into rows of
  // `cols`, each row as tall as its tallest panel -- the legend length varies
  // with how many characters actually reached the office that night.
  const across = Math.min(cols, gates.length);
  const panels = gates.map(panel);
  let y = 0;
  const placed: string[] = [];
  for (let i = 0; i < panels.length; i += across) {
    const row = panels.slice(i, i + across);
    row.forEach((p, j) => placed.push(`<g transform="translate(${j * W},${y})">${p.svg}</g>`));
    y += Math.max(...row.map(p => p.h)) + ROW_GAP;
  }
  const h = y - ROW_GAP + 40;
  const w = W * across - (W - COL_T - 20);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" font-family="-apple-system, ui-sans-serif, Helvetica, sans-serif">
<style>
  svg { --surface:#fcfcfb; --ink:#0b0b0b; --ink2:#52514e; --mute:#7a7973; background:var(--surface) }
  @media (prefers-color-scheme: dark) {
    svg { --surface:#1a1a19; --ink:#fff; --ink2:#c3c2b7; --mute:#8f8e85 }
  }
  text { font-size:12px; fill:var(--ink2) }
  .h { font-size:17px; font-weight:600; fill:var(--ink) }
  .s { font-size:13px; fill:var(--ink) }
  .k { font-size:12.5px; fill:var(--ink) }
  .m { font-size:11px; fill:var(--mute) }
  .n { text-anchor:end }
  .f { font-size:11px; fill:var(--mute) }
</style>
<rect width="100%" height="100%" fill="var(--surface)"/>
${placed.join('\n')}
<text class="f" x="0" y="${h - 14}">Model gate: engine replay under &#177;${HUMAN_SLACK_MS} ms modeled human slack. A simulator census &#8212; it prices no screencap, dropped contact or desync. Build ${esc(build)}.</text>
</svg>
`;
}

function main() {
  const nights = String(arg('night', '2')).split(',').map(Number);
  const runs = +arg('runs', GATE_RUNS);
  const out = arg('out', `deathchart-n${nights.join('-')}.png`);
  const cols = +arg('cols', COLS_DEFAULT);
  // Which build produced these numbers. A census an agent cannot place is a
  // census it has to re-measure, and `-dirty` is the difference between a
  // figure that can be reproduced from a commit and one that cannot.
  let build: string;
  try { build = execFileSync('git', ['rev-parse', '--short', 'HEAD']).toString().trim(); }
  catch { build = 'UNKNOWN(not a git checkout)'; }
  try { if (execFileSync('git', ['status', '--porcelain', '--', ':(top)packages/source', ':(top)packages/propose']).toString().trim()) build += '-dirty'; }
  catch { /* build already carries its own UNKNOWN */ }

  const gates = nights.map(night => {
    const text = execFileSync(process.execPath,
      [fileURLToPath(new URL('../../../packages/propose/bin/plans/recipe.ts', import.meta.url)), '--device-plan', `--night=${night}`]).toString();
    const g = modelGate(text, { runs });
    const rows = census(g.deaths, g.deathTimes);
    const total = rows.reduce((s, r) => s + r.n, 0);
    console.log(`night ${night}: ${g.survived}/${g.runs} survived ` +
                `(${formatRate(g.survived, g.runs, { label: 'survival' })}, bar ${(100 * g.minSurvival).toFixed(0)}%) -- ${total} deaths, ` +
                `median time of death ${clock(median(rows.flatMap(r => r.ts))) || 'n/a'}`);
    for (const r of rows) {
      console.log(`  ${String(r.n).padStart(5)}  ${(100 * r.n / total).toFixed(1).padStart(5)}%  ${clock(r.t).padStart(12)}  ${r.reason}`);
      for (const d of r.details)
        console.log(`  ${String(d.n).padStart(5)}          ${clock(d.t).padStart(12)}  ${d.detail}`);
    }
    return g;
  });
  const svgPath = out.replace(/\.png$/, '.svg');
  const svg = chart(gates, build, cols);
  writeFileSync(svgPath, svg);
  if (svgPath === out) { console.log(`wrote ${out} (${build})`); return; }

  const m = svg.match(/width="(\d+)" height="(\d+)"/) as RegExpMatchArray; // chart() writes both
  const png = renderPng(svgPath, out, { w: +m[1], h: +m[2] });
  console.log(`wrote ${svgPath} (${build})`);
  if (!png.ok) {
    console.error(`no PNG: ${png.why} -- the SVG above is complete; open it or set $CHROME`);
    process.exit(3);
  }
  console.log(`wrote ${out}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
