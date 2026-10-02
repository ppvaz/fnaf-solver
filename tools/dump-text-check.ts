#!/usr/bin/env node
// Refuse decompiled event-sheet text in a commit message (ADR 0002, decision 12).
//
// Pedro, 2026-09-29: "Cite, never quote: tracked or pushed text may cite
// `g###`, a file and a line, and paraphrase, but never copy dump lines."
// The dump is game content (plans/ROADMAP.md, Boundaries). A message that
// pastes a condition or action line publishes it the moment it is pushed,
// and a pushed message cannot be taken back without rewriting history.
//
// The signature is the dump's own syntax, never its vocabulary. An object
// name ("mask", "viewing") or an arrow ("v0 2 -> 3") is ordinary prose here;
// what no prose writes is the dumper's field grammar: `OT n NUM n OI n`,
// `[0]ot=..,num=..,oi=..`, `22:ExpressionParameter:cmp=`, the CTFAK-rendered
// `IF  obj -> CompareCounter (COMPARISON{= Long[7]})`, and the header and row
// shapes readdump.py prints. The three forms are those of
// packages/source/decompile/EventTextDumper.cs (tabular), the older rendered
// `03-04-Office.txt` (packages/source/decompile/aimap.py), and packages/source/decompile/readdump.py.
//
// Measured 2026-09-29, locally against the FNaF 2 dump (which stays outside
// the repo): every line of each form is caught -- 15232 tabular C/A rows (also
// with tabs turned to spaces), their 10616 PARAMS bodies alone, 6162
// GROUP/OBJECT/instance records, 5083 rendered IF/DO lines and 1332 group
// headers of 03-04-Office.txt, and 6374 lines readdump.py prints for frame 3.
// No signature fires on any of the 1060 commit messages in the history
// (`--log 1060`). Over the 2302 tracked text files it fires in six: the
// synthetic fixtures of three packages/source/decompile/test-*.py, two grammar notes with
// placeholders, and one `IF Once` inside a paraphrased block.
//
//   node tools/dump-text-check.ts MSGFILE     exit 1 when the message copies dump text
//   node tools/dump-text-check.ts --log N     report hits over the last N commit messages
//
// .githooks/commit-msg runs the first form before any other rule, so PEDRO-OK
// (which waives the consequence lock) does not waive this.
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

// A line may sit in a Markdown quote, list item or code span.
const LEAD = String.raw`(?:^|[\s\x60>*+-])`;

// Parameter loaders as the tabular dump names them (`22:ExpressionParameter:`).
const LOADERS = [
  'ExpressionParameter', 'AlterableValue', 'Group', 'GroupPointer', 'Short',
  'ParamObject', 'GlobalValue', 'Position', 'Time', 'IntParam', 'Create',
  'Sample', 'KeyParameter', 'Click', 'Colour', 'MultipleVariables',
];
// Parameter blocks as the CTFAK-rendered sheet prints them (`COMPARISON{`).
const RENDERED = [
  'EXPRESSION', 'COMPARISON', 'AlterableValue', 'OBJECT', 'SHORT', 'POSITION',
  'TIME', 'GROUP', 'CREATE', 'SAMPLE', 'EXPSTRING', 'GlobalValue', 'GROUPOINTER',
  'Click', 'SAMLOOP', 'FRAME', 'KEY', 'ALTSTRING', 'VMKEY', 'NEWDIRECTION', 'MVT',
  'CNDSAMPLE',
];

export const SIGNATURES = [
  {
    id: 'tabular-event-row',
    what: 'a condition or action row of the tabular dump (C/A, OT, NUM, OI)',
    re: new RegExp(String.raw`${LEAD}[CA]\s+OT\s+-?\d+\s+NUM\s+-?\d+\s+OI\s+-?\d+(?!\d)`),
  },
  {
    id: 'tabular-record',
    what: 'a GROUP, OBJECT or placed-instance record of the tabular dump',
    re: /^[\s>*+-]*(?:GROUP\s+\d+\s+FLAGS\s+-?\d+\s+RESTRICT\b|OBJECT\s+\d+\s+TYPE\s+-?\d+\s+NAME\s|I\s+INST\s+\d+\s+OI\s+-?\d+\s+NAME\s)/,
  },
  {
    id: 'tabular-parameter',
    what: 'a tabular parameter (NN:Loader:...)',
    re: new RegExp(String.raw`(?<![\w./-])\d{1,2}:(?:${LOADERS.join('|')}):(?:cmp=|\S)`),
  },
  {
    id: 'expression-item',
    what: 'a flattened expression item ([i]ot=..,num=..,oi=..,oil=..)',
    re: /\[\d+\]ot=-?\d+,num=-?\d+,oi=-?\d+,oil=/,
  },
  {
    id: 'rendered-event',
    what: 'an IF/DO line of the CTFAK-rendered sheet',
    // `IF   [NOT ][object -> ]Name` then a parameter block, an unparsed
    // `(param69?)`, or the end of the line: a line that is nothing but IF/DO
    // and a PascalCase condition or action name is not a sentence.
    re: new RegExp(String.raw`${LEAD}(?:IF|DO) +(?:NOT +)?(?:\S[^\n]*? -> )?(?:[A-Z][A-Za-z0-9]*|Ext(?:Condition|Action|Expression)#-?\d+)(?: \((?:${RENDERED.join('|')})\{| \(param\d+\?\)|\s*(?:\x60|$))`),
  },
  {
    id: 'rendered-parameter',
    what: 'a rendered parameter block (COMPARISON{= Long[n]}, {isExpression=...})',
    re: /\b(?:COMPARISON|EXPRESSION)\{[=<>!]{1,2} \S|\{[^{}]*\bisExpression=(?:True|False)\b/,
  },
  {
    id: 'group-header',
    what: 'a group or frame header as the rendered sheet or readdump.py prints it',
    re: /^[\s>]*--- group \d+ ---|\bFRAME \d+ GROUP \d+ +flags=|^[\s>]*FRAME \d+: .*\(\d+ event groups\)/,
  },
  {
    id: 'readdump-row',
    what: 'a condition or action row as readdump.py prints it (C ot= num= oi= [name])',
    re: new RegExp(String.raw`${LEAD}!?[CA] ot=-?\d+ num=-?\d+ oi=-?\d+ \[`),
  },
];

// What git would commit: comment lines go, and so does everything below the
// scissors line `git commit -v` adds (the staged diff, whose fixtures may be
// dump-shaped on purpose).
export function commitMessageBody(text: string, commentChar = '#') {
  const out = [];
  for (const line of text.split('\n')) {
    if (line.startsWith(`${commentChar} `) && / -+ >8 -+$/.test(line)) break;
    if (line.startsWith(commentChar)) { out.push(''); continue; }
    out.push(line);
  }
  return out.join('\n');
}

// Every line that carries a dump signature: [{ line, id, what, text }].
/** A message line that carries a dump signature. */
interface Hit { readonly line: number, readonly id: string, readonly what: string, readonly text: string }

export function findDumpText(text: string) {
  const hits: Hit[] = [];
  text.split('\n').forEach((line, i) => {
    for (const { id, what, re } of SIGNATURES) {
      if (re.test(line)) { hits.push({ line: i + 1, id, what, text: line }); break; }
    }
  });
  return hits;
}

const clip = (s: string, n = 110) => (s.length > n ? `${s.slice(0, n - 3)}...` : s);

export function refusal(hits: readonly Hit[]) {
  const lines = [
    'dump-text check: refused -- the message copies decompiled event-sheet text',
    '(ADR 0002, decision 12: cite, never quote). Matched:',
  ];
  for (const hit of hits) {
    lines.push(`  line ${hit.line} [${hit.id}] ${hit.what}:`);
    lines.push(`    ${clip(hit.text.replace(/\t/g, ' '))}`);
  }
  lines.push(
    'Cite instead, and paraphrase:',
    '  - the group id: "g673", or a range "g618-g619";',
    '  - the dump file and line: "03-04-Office.txt:1234", or a packages/source/decompile/readdump.py',
    '    command a reader with the dump can run ("readdump.py group 3 673");',
    '  - what the group does, in your own words: "g673 zeroes every AI unless the',
    '    night is 7", not the IF/DO or C/A lines that say it.',
    'Rewrite the message and commit again; PEDRO-OK does not waive this check.',
  );
  return lines.join('\n');
}

function commentCharOf() {
  try {
    const value = execFileSync('git', ['config', 'core.commentChar'], { encoding: 'utf8' }).trim();
    return value && value !== 'auto' ? value[0] : '#';
  } catch { return '#'; }
}

function main(argv: string[]) {
  if (argv[0] === '--log') {
    const count = Number(argv[1] || 300);
    const raw = execFileSync('git', ['log', `-${count}`, '--format=%x1e%h%x1f%B'],
      { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
    let refused = 0;
    let total = 0;
    for (const record of raw.split('\x1e').slice(1)) {
      const [hash, body] = record.split('\x1f');
      total += 1;
      const hits = findDumpText(body);
      if (!hits.length) continue;
      refused += 1;
      for (const hit of hits) console.log(`${hash} line ${hit.line} [${hit.id}]: ${clip(hit.text)}`);
    }
    console.log(`dump-text check: ${refused} of ${total} commit messages would be refused`);
    return 0;
  }
  if (argv.length !== 1) {
    console.error('usage: dump-text-check.ts MSGFILE | --log N');
    return 2;
  }
  const hits = findDumpText(commitMessageBody(readFileSync(argv[0], 'utf8'), commentCharOf()));
  if (!hits.length) return 0;
  console.error(refusal(hits));
  return 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  process.exitCode = main(process.argv.slice(2));
}
