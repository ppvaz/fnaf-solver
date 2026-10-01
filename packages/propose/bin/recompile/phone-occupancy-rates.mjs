#!/usr/bin/env node
// How often the model puts each occupant in a phone night's mask windows, over a fixed stride of office start states,
// against the phone's own eyehole reads (ROADMAP S2, diagnostic). A rate the model shares with the phone says a
// window that most strong states miss can be rarity, not mechanics.
//
//   node packages/propose/bin/recompile/phone-occupancy-rates.mjs --night full-06 [--states 1000] [--windows 38] [--out FILE.json]
//
// States are s_i = (i * 21841 + 7) mod 65536, i < --states (a fixed stride, not chosen by outcome). Windows past
// --windows are left out because the end of the night is where every state dies before the phone's 6 AM. MODEL_ONLY
// rates against DEVICE_MEASURED reads.
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { inputs, playState } from './phone-stream-census.mjs';

export const SCHEMA = 'phone-occupancy-rates-v1';
export const stateAt = (i) => (i * 21841 + 7) % 65536;

/** Occupant counts over the first `windows` read windows of each code string, and the phone's own. */
export function tally(codeStrings, phone, windows) {
  const model = {}; let played = 0;
  for (const codes of codeStrings) for (const c of codes.slice(0, windows)) { if (c === '?') continue; model[c] = (model[c] ?? 0) + 1; played += 1; }
  const own = {}; for (const c of phone.slice(0, windows)) if (c !== '?') own[c] = (own[c] ?? 0) + 1;
  return { model, played, phone: own, phoneRead: Object.values(own).reduce((a, b) => a + b, 0) };
}

/** Pearson's chi-square of the phone's counts against the model's rates, over the occupants either side shows. */
export function chiSquare(t) {
  const keys = [...new Set([...Object.keys(t.model), ...Object.keys(t.phone)])].sort();
  let chi = 0;
  for (const k of keys) { const expected = ((t.model[k] ?? 0) / t.played) * t.phoneRead; if (expected > 0) chi += ((t.phone[k] ?? 0) - expected) ** 2 / expected; }
  return { chi: Number(chi.toFixed(4)), df: keys.length - 1, keys };
}

/** Per window: how many of the given code strings disagree with the phone there, and how many independence predicts. */
export function missExpectation(codeStrings, phone, rates, played) {
  return [...phone].map((p, k) => {
    if (p === '?') return null;
    const observed = codeStrings.filter((c) => c[k] !== '?' && c[k] !== undefined && c[k] !== p).length;
    return { window: k, phone: p, observed, expected: Number((codeStrings.length * (1 - (rates[p] ?? 0) / played)).toFixed(2)) };
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = { states: '1000', windows: '38' };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i += 2) {
    if (!['--night', '--states', '--windows', '--out'].includes(argv[i]) || !argv[i + 1]) throw new Error('see usage at top of file');
    args[argv[i].slice(2)] = argv[i + 1];
  }
  const inp = inputs(args.night);
  const n = Number(args.states); const windows = Number(args.windows);
  const rows = Array.from({ length: n }, (_, i) => { const r = playState(inp, stateAt(i)); return { state: r.state, codes: r.codes }; });
  const t = tally(rows.map((r) => r.codes), inp.phone, windows);
  const result = { schema: SCHEMA, claimLevel: 'MODEL_ONLY rates against DEVICE_MEASURED reads', night: args.night, states: n, windows,
    stateRule: '(i * 21841 + 7) mod 65536', inputs: inp.hashes, phoneWindows: inp.phone, ...t, chiSquare: chiSquare(t),
    rates: Object.fromEntries(Object.entries(t.model).map(([k, v]) => [k, Number((v / t.played).toFixed(4))])), codes: rows.map((r) => r.codes).join(' ') };
  if (args.out) writeFileSync(args.out, `${JSON.stringify(result, null, 1)}\n`);
  console.log(`${args.night}: ${n} states x ${windows} windows; model rates ${JSON.stringify(result.rates)}; phone ${JSON.stringify(t.phone)}; chi-square ${result.chiSquare.chi} on ${result.chiSquare.df} df`);
}
