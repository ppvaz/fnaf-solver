#!/usr/bin/env node
// Every literal path a script builds from its own directory names something that exists.
//
// A move rewrites `import` specifiers and repo-rooted mentions, but a script also reaches its
// neighbours through its own location: `new URL('recipe.mjs', import.meta.url)`,
// `join(HERE, 'x')`, `HERE / "x"`, `"$HERE/x"`. None of those fail until the line runs. On
// 2026-09-30 d2585a30 had moved recipe.mjs to packages/propose/bin/plans and left windtrace.ts
// and deathchart.ts asking for it beside themselves; the ADR 0002 moves are not finished, so
// this is checked, not remembered.
//
// Scanned: every tracked file and every untracked file git does not ignore, with a .js, .mjs,
// .cjs, .ts, .py or .sh name, outside the frozen set. A reference counts only when it is anchored
// to the file's own location (`import.meta.url`, `__dirname`, a HERE bound to the file's directory,
// or a ROOT that climbs from it: `resolve(HERE, '../..')`, `Path(__file__).parents[2]`,
// `$(cd "$(dirname "$0")/../.." && pwd)`) and every segment is a literal; a glob in the last segment must match at least one
// file, since a loop over a glob that matches nothing runs zero times in silence (grade-run.sh's
// death-cause models, 2026-09-30). A target git ignores is a runtime output and is not required to
// exist. A path that is meant to be absent is listed in INTENTIONAL with its reason.
//
//   node tools/test-sibling-paths.ts     exit 0 clean, 1 with the references it refuses
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, normalize, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SELF = 'tools/test-sibling-paths.ts';
const FROZEN = /^(docs\/evidence\/|docs\/chronicle\/|plans\/archive\/|tools\/recompile\/results\/)/;
const CODE = /\.(m?js|cjs|ts|py|sh)$/;
const INTENTIONAL = new Map([
  ['apps/desktop/test/test-deathchart.ts -> apps/desktop/test/no-such-chrome-binary',
    'the planted missing browser the chart must refuse'],
]);

const literals = (text: string) => [...text.matchAll(/(['"])([^'"]*)\1/g)].map(match => match[2]);

const IDENT = /^[A-Za-z_$][\w$]*$/;
const climb = (n: number) => Array.from({ length: n }, () => '..').join('/');
const rel = (...parts: string[]) => { const out = posix.join(...parts.filter(Boolean)); return out === '.' ? '' : out; };

/** NAME's binding in TEXT: the right-hand side of its first assignment. */
function bindingOf(text: string, name: string, lang: string) {
  const escaped = name.replace(/\$/g, '\\$');
  const binding = lang === 'sh'
    ? new RegExp(`^\\s*(?:export\\s+|local\\s+)?${escaped}=(.*)$`, 'm')
    : new RegExp(`^\\s*(?:export\\s+)?(?:const|let|var)?\\s*${escaped}\\s*(?::[^=]+)?=\\s*(.*)$`, 'm');
  return text.match(binding)?.[1]?.trim().replace(/;$/, '');
}

/** Where a JS expression points, relative to its file's directory, or null when it is not built from that location. */
function jsAnchor(text: string, expr: string, depth: number): string | null {
  const e = expr.trim();
  if (/^(?:dirname\(\s*fileURLToPath\(\s*import\.meta\.url\s*\)\s*\)|__dirname)$/.test(e)) return '';
  let m = e.match(/^(?:fileURLToPath\(\s*)?new URL\(\s*(['"])([^'"]*)\1\s*,\s*import\.meta\.url\s*\)\s*\)?$/);
  if (m) return rel(m[2]);
  m = e.match(/^(?:resolve|join)\(\s*([^,]+?)\s*,((?:\s*(['"])[^'"]*\3\s*,?)+)\s*\)$/);
  if (m) {
    const base = jsAnchor(text, m[1], depth);
    return base === null ? null : rel(base, ...literals(m[2]));
  }
  return IDENT.test(e) ? anchor(text, e, 'js', depth + 1) : null;
}

/** Where a Python expression points: Path(__file__)'s parents, os.path.dirname of __file__, or a named anchor's. */
function pyAnchor(text: string, expr: string, depth: number): string | null {
  const e = expr.trim();
  let m = e.match(/^Path\(\s*__file__\s*\)(?:\.resolve\(\))?((?:\.parent)+)$/);
  if (m) return climb(m[1].split('.parent').length - 2);
  m = e.match(/^Path\(\s*__file__\s*\)(?:\.resolve\(\))?\.parents\[(\d+)\]$/);
  if (m) return climb(Number(m[1]));
  m = e.match(/^((?:os\.path\.dirname\(\s*)+)os\.path\.(?:abspath|realpath)\(\s*__file__\s*\)\s*(\)+)$/);
  if (m) return climb(m[1].split('dirname').length - 2);
  m = e.match(/^([A-Za-z_]\w*)((?:\.parent)+)$/);
  if (m) { const base = anchor(text, m[1], 'py', depth + 1); return base === null ? null : rel(base, climb(m[2].split('.parent').length - 1)); }
  m = e.match(/^([A-Za-z_]\w*)\.parents\[(\d+)\]$/);
  if (m) { const base = anchor(text, m[1], 'py', depth + 1); return base === null ? null : rel(base, climb(Number(m[2]) + 1)); }
  return /^[A-Za-z_]\w*$/.test(e) ? anchor(text, e, 'py', depth + 1) : null;
}

/** Where a shell value points: `$(dirname "$0")`, `$(cd "$(dirname "$0")/../.." && pwd)`, or a named anchor plus a climb. */
function shAnchor(text: string, value: string, depth: number): string | null {
  const own = /^"?\$\(\s*cd\s+"?\$\(dirname "\$(?:0|\{BASH_SOURCE\[0\]\})"\)([^"&]*)"?\s*&&\s*pwd\s*\)"?$/.exec(value.trim())
    ?? /^"?\$\(dirname "\$(?:0|\{BASH_SOURCE\[0\]\})"\)([^"]*)"?$/.exec(value.trim());
  if (own) return /[$`]/.test(own[1]) ? null : rel(own[1].replace(/^\//, ''));
  const named = /^"?\$\(\s*cd\s+"?\$\{?([A-Za-z_]\w*)\}?"?([^"&]*)"?\s*&&\s*pwd\s*\)"?$/.exec(value.trim());
  if (named && !/[$`]/.test(named[2])) {
    const base = anchor(text, named[1], 'sh', depth + 1);
    return base === null ? null : rel(base, named[2].replace(/^\//, ''));
  }
  return null;
}

/**
 * Where NAME points relative to the file's own directory ('' for the directory itself, '../..' for a
 * root two levels up), or null when its binding is not built from the file's location.
 */
function anchor(text: string, name: string, lang: string, depth = 0): string | null {
  if (depth > 4) return null;
  const rhs = bindingOf(text, name, lang);
  if (rhs === undefined) return null;
  return lang === 'sh' ? shAnchor(text, rhs, depth) : lang === 'py' ? pyAnchor(text, rhs, depth) : jsAnchor(text, rhs, depth);
}

/** Every literal path FILE builds from its own location (its directory, or a root it climbs to), as [line, relative path]. */
export function siblingReferences(file: string, text: string) {
  const lang = file.endsWith('.py') ? 'py' : file.endsWith('.sh') ? 'sh' : 'js';
  const found: [number, string][] = [];
  const add = (index: number, parts: string[]) => {
    const [base, ...rest] = parts;
    if (!rest.length || rest.some(part => /[${}<>|]/.test(part) || part === '')) return;
    const path = join(...[base, ...rest].filter(Boolean));
    // A glob is allowed only in the last segment, where it must match at least one file.
    if (path.split('/').slice(0, -1).some(part => part.includes('*'))) return;
    found.push([text.slice(0, index).split('\n').length, path]);
  };
  if (lang === 'js') {
    for (const match of text.matchAll(/new URL\(\s*(['"])([^'"]+)\1\s*,\s*import\.meta\.url\s*\)/g)) add(match.index, ['', match[2]]);
    // `new URL('x', here)`, where `here` is the file's own directory as a URL.
    for (const match of text.matchAll(/new URL\(\s*(['"])([^'"]+)\1\s*,\s*([A-Za-z_$][\w$]*)\s*\)/g)) {
      const base = match[3] === 'import' ? null : anchor(text, match[3], 'js');
      if (base !== null) add(match.index, [base, match[2]]);
    }
    for (const match of text.matchAll(/\b(?:join|resolve)\(\s*([A-Za-z_$][\w$]*)\s*,((?:\s*(['"])[^'"]*\3\s*,?)+)\s*\)/g)) {
      const base = match[1] === '__dirname' ? '' : anchor(text, match[1], 'js');
      if (base !== null) add(match.index, [base, ...literals(match[2])]);
    }
    // `${HERE}x`, where HERE is a directory with its trailing slash.
    // A Docker volume spec (`${ROOT}/x:/x:ro`) ends the host path at its colon.
    for (const match of text.matchAll(/`\$\{([A-Za-z_$][\w$]*)\}([^`$:]+)(?=[`:])/g)) {
      const base = anchor(text, match[1], 'js');
      if (base !== null) add(match.index, [base, match[2]]);
    }
  } else if (lang === 'py') {
    for (const match of text.matchAll(/\b([A-Za-z_]\w*)((?:\s*\/\s*(['"])[^'"]*\3)+)/g)) {
      const base = anchor(text, match[1], 'py');
      if (base !== null) add(match.index, [base, ...literals(match[2])]);
    }
    for (const match of text.matchAll(/os\.path\.join\(\s*([A-Za-z_]\w*)\s*,((?:\s*(['"])[^'"]*\3\s*,?)+)\s*\)/g)) {
      const base = anchor(text, match[1], 'py');
      if (base !== null) add(match.index, [base, ...literals(match[2])]);
    }
  } else {
    for (const match of text.matchAll(/"?\$\{?([A-Za-z_]\w*)\}?"?\/([^\s"'`;)|&<>]+)/g)) {
      const base = anchor(text, match[1], 'sh');
      if (base !== null) add(match.index, [base, match[2]]);
    }
    for (const match of text.matchAll(/\$\(dirname "\$(?:0|\{BASH_SOURCE\[0\]\})"\)\/([^\s"'`;)|&<>]+)/g)) add(match.index, ['', match[1]]);
  }
  return found;
}

function candidates() {
  const listed = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
    { cwd: ROOT, maxBuffer: 1 << 28 }).toString().split('\0');
  // This file is left out: its header and planted fixtures name paths that are absent on purpose.
  return listed.filter(file => file && CODE.test(file) && !FROZEN.test(file) && file !== SELF && existsSync(join(ROOT, file)));
}

function ignored(paths: string[]) {
  if (!paths.length) return new Set<string>();
  try {
    return new Set(execFileSync('git', ['check-ignore', '--no-index', '--stdin'], { cwd: ROOT, input: paths.join('\n') })
      .toString().split('\n').filter(Boolean));
  } catch (error) {
    // check-ignore exits 1 when nothing is ignored.
    if ((error as { status?: number }).status === 1) return new Set<string>();
    throw error;
  }
}

/** A path exists, or a glob in its last segment matches at least one entry: a glob that
 *  matches nothing runs its loop zero times and says nothing. */
function exists(root: string, target: string) {
  if (!target.includes('*')) return existsSync(join(root, target));
  const dir = join(root, dirname(target));
  // Splitting yields at least one part.
  const pattern = new RegExp(`^${(target.split('/').pop() as string).replace(/[.+?^()[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`);
  return existsSync(dir) && readdirSync(dir).some(name => pattern.test(name));
}

/** The refusals for FILES under ROOT: references whose target is absent, not ignored and not listed. */
export function refusals(root: string, files: readonly string[]) {
  const missing: { file: string, line: number, target: string, outside?: boolean }[] = [];
  for (const file of files) {
    const text = readFileSync(join(root, file), 'utf8');
    for (const [line, rel] of siblingReferences(file, text)) {
      const target = normalize(join(dirname(file), rel));
      // A script's own directory is inside the tree, so a path out of it has miscounted its climb.
      if (target.startsWith('..')) { missing.push({ file, line, target, outside: true }); continue; }
      if (exists(root, target)) continue;
      if (INTENTIONAL.has(`${file} -> ${target}`)) continue;
      missing.push({ file, line, target });
    }
  }
  // A directory pattern (`build/`) matches only a path git is told is a directory, so each target
  // is asked both ways.
  const skip = root === ROOT ? ignored(missing.flatMap(item => [item.target, `${item.target}/`])) : new Set<string>();
  return missing.filter(item => item.outside || (!skip.has(item.target) && !skip.has(`${item.target}/`)));
}

// Planted: each idiom pointing at a sibling that is not there must be refused, and the same
// idiom pointing at one that is must pass. A gate that never fires proves nothing.
function planted() {
  const dir = mkdtempSync(join(tmpdir(), 'sibling-paths-'));
  try {
    mkdirSync(join(dir, 'a'));
    writeFileSync(join(dir, 'a/there.mjs'), '');
    const files = {
      'a/url.mjs': "new URL('gone.mjs', import.meta.url); new URL('there.mjs', import.meta.url);",
      'a/urlvar.mjs': "  const here = new URL('.', import.meta.url);\n  import(new URL('gone-plan.mjs', here).href); new URL('there.mjs', here);",
      'a/join.js': "const HERE = dirname(fileURLToPath(import.meta.url));\njoin(HERE, 'gone.json'); join(HERE, 'there.mjs');",
      'a/tpl.js': "const HERE = fileURLToPath(new URL('.', import.meta.url));\nconst A = `${HERE}gone.js`; const B = `${HERE}there.mjs`;",
      'a/root.js': "const HERE = resolve(dirname(fileURLToPath(import.meta.url)), '..');\njoin(HERE, 'not-a-sibling.json');",
      'a/p.py': 'HERE = Path(__file__).resolve().parent\nHERE / "gone.py"\nHERE / "there.mjs"\n',
      'a/q.py': 'HERE = os.path.dirname(os.path.abspath(__file__))\nos.path.join(HERE, "gone.txt")\n',
      'a/s.sh': 'HERE="$(cd "$(dirname "$0")" && pwd)"\npython3 "$HERE/gone.py"\nnode "$HERE/there.mjs"\nfor m in "$HERE"/th*.mjs; do :; done\nfor m in "$HERE"/none-*.json; do :; done\n',
      'a/t.sh': 'X_HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"\nsource "$X_HERE/gone.sh"\n',
      'a/up.sh': 'HERE="$(cd "$(dirname "$0")" && pwd)"\nnode "$HERE/../../../out.mjs"\n',
      // A root the file climbs to is an anchor too (mistake register 14: pilot/replay.ts read a
      // fixtures directory through ROOT long after it moved).
      'a/rootok.js': "const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');\njoin(ROOT, 'a', 'there.mjs');",
      'a/chain.js': "const HERE = dirname(fileURLToPath(import.meta.url));\nconst ROOT = resolve(HERE, '..');\njoin(ROOT, 'gone-chain.json');",
      'a/r.py': 'ROOT = Path(__file__).resolve().parents[1]\nROOT / "gone-root.json"\nROOT / "a" / "there.mjs"\n',
      'a/r.sh': 'ROOT="$(cd "$(dirname "$0")/.." && pwd)"\ncat "$ROOT/gone-root.txt"\nnode "$ROOT/a/there.mjs"\n',
    };
    for (const [file, text] of Object.entries(files)) writeFileSync(join(dir, file), text);
    const got = refusals(dir, Object.keys(files)).map(item => `${item.file} -> ${item.target}`).sort();
    const want = ['a/chain.js -> gone-chain.json', 'a/join.js -> a/gone.json', 'a/p.py -> a/gone.py', 'a/q.py -> a/gone.txt',
      'a/r.py -> gone-root.json', 'a/r.sh -> gone-root.txt', 'a/root.js -> not-a-sibling.json',
      'a/s.sh -> a/gone.py', 'a/s.sh -> a/none-*.json', 'a/t.sh -> a/gone.sh', 'a/tpl.js -> a/gone.js', 'a/up.sh -> ../../out.mjs', 'a/url.mjs -> a/gone.mjs', 'a/urlvar.mjs -> a/gone-plan.mjs'];
    return JSON.stringify(got) === JSON.stringify(want) ? [] : [`planted: expected ${want.join(', ')}; got ${got.join(', ') || 'nothing'}`];
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const failures = planted();
  const files = candidates();
  for (const { file, line, target, outside } of refusals(ROOT, files))
    failures.push(`${file}:${line} names ${target}, ${outside ? 'outside the repository' : 'which does not exist'}`);
  for (const key of INTENTIONAL.keys()) {
    const [file, target] = key.split(' -> ');
    if (!existsSync(join(ROOT, file)) || existsSync(join(ROOT, target)))
      failures.push(`INTENTIONAL entry is stale: ${key}`);
  }
  if (failures.length) {
    for (const line of failures) console.error(`FAIL ${line}`);
    process.exit(1);
  }
  console.log(`sibling paths: every literal path built from a script's own directory resolves (${files.length} files; planted refusals fire)`);
}
