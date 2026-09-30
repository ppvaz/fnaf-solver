#!/usr/bin/env node
// Every literal path a script builds from its own directory names something that exists.
//
// A move rewrites `import` specifiers and repo-rooted mentions, but a script also reaches its
// neighbours through its own location: `new URL('recipe.mjs', import.meta.url)`,
// `join(HERE, 'x')`, `HERE / "x"`, `"$HERE/x"`. None of those fail until the line runs. On
// 2026-09-30 d2585a30 had moved recipe.mjs to packages/propose/bin/plans and left windtrace.mjs
// and deathchart.mjs asking for it beside themselves; the ADR 0002 moves are not finished, so
// this is checked, not remembered.
//
// Scanned: every tracked file and every untracked file git does not ignore, with a .js, .mjs,
// .cjs, .ts, .py or .sh name, outside the frozen set. A reference counts only when it is anchored
// to the file's own directory (`import.meta.url`, `__dirname`, or a HERE bound to the file's
// directory) and every segment is a literal; a glob in the last segment must match at least one
// file, since a loop over a glob that matches nothing runs zero times in silence (grade-run.sh's
// death-cause models, 2026-09-30). A target git ignores is a runtime output and is not required to
// exist. A path that is meant to be absent is listed in INTENTIONAL with its reason.
//
//   node tools/test-sibling-paths.js     exit 0 clean, 1 with the references it refuses
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SELF = 'tools/test-sibling-paths.js';
const FROZEN = /^(docs\/evidence\/|docs\/chronicle\/|plans\/archive\/|tools\/recompile\/results\/)/;
const CODE = /\.(m?js|cjs|ts|py|sh)$/;
const INTENTIONAL = new Map([
  ['tools/device/test-deathchart.mjs -> tools/device/no-such-chrome-binary',
    'the planted missing browser the chart must refuse'],
]);

const literals = text => [...text.matchAll(/(['"])([^'"]*)\1/g)].map(match => match[2]);

// A binding of NAME to the file's own directory: the right-hand side reads the file's location
// and climbs nowhere.
function ownDir(text, name, lang) {
  const escaped = name.replace(/\$/g, '\\$');
  const binding = lang === 'sh'
    ? new RegExp(`^\\s*(?:export\\s+|local\\s+)?${escaped}=(.*)$`, 'm')
    : new RegExp(`^\\s*(?:export\\s+)?(?:const|let|var)?\\s*${escaped}\\s*(?::[^=]+)?=\\s*(.*)$`, 'm');
  const rhs = text.match(binding)?.[1];
  if (!rhs) return false;
  if (/\.\.|parents\[|\.parent\s*\.parent|dirname\(\s*(?:os\.path\.)?dirname/.test(rhs)) return false;
  return lang === 'sh' ? /dirname\s+"?\$(?:0|\{BASH_SOURCE\[0\]\})/.test(rhs)
    : lang === 'py' ? /__file__/.test(rhs)
      : /import\.meta\.url|__dirname/.test(rhs);
}

/** Every literal path FILE builds from its own directory, as [line, relative path]. */
export function siblingReferences(file, text) {
  const lang = file.endsWith('.py') ? 'py' : file.endsWith('.sh') ? 'sh' : 'js';
  const found = [];
  const add = (index, parts) => {
    if (!parts.length || parts.some(part => /[${}<>|]/.test(part) || part === '')) return;
    // A glob is allowed only in the last segment, where it must match at least one file.
    if (join(...parts).split('/').slice(0, -1).some(part => part.includes('*'))) return;
    found.push([text.slice(0, index).split('\n').length, join(...parts)]);
  };
  if (lang === 'js') {
    for (const match of text.matchAll(/new URL\(\s*(['"])([^'"]+)\1\s*,\s*import\.meta\.url\s*\)/g)) add(match.index, [match[2]]);
    for (const match of text.matchAll(/\b(?:join|resolve)\(\s*([A-Za-z_$][\w$]*)\s*,((?:\s*(['"])[^'"]*\3\s*,?)+)\s*\)/g))
      if (match[1] === '__dirname' || ownDir(text, match[1], 'js')) add(match.index, literals(match[2]));
    // `${HERE}x`, where HERE is the directory with its trailing slash.
    for (const match of text.matchAll(/`\$\{([A-Za-z_$][\w$]*)\}([^`$]+)`/g))
      if (ownDir(text, match[1], 'js')) add(match.index, [match[2]]);
  } else if (lang === 'py') {
    for (const match of text.matchAll(/\b([A-Za-z_]\w*)((?:\s*\/\s*(['"])[^'"]*\3)+)/g))
      if (ownDir(text, match[1], 'py')) add(match.index, literals(match[2]));
    for (const match of text.matchAll(/os\.path\.join\(\s*([A-Za-z_]\w*)\s*,((?:\s*(['"])[^'"]*\3\s*,?)+)\s*\)/g))
      if (ownDir(text, match[1], 'py')) add(match.index, literals(match[2]));
  } else {
    for (const match of text.matchAll(/"?\$\{?([A-Za-z_]\w*)\}?"?\/([^\s"'`;)|&<>]+)/g))
      if (ownDir(text, match[1], 'sh')) add(match.index, [match[2]]);
    for (const match of text.matchAll(/\$\(dirname "\$(?:0|\{BASH_SOURCE\[0\]\})"\)\/([^\s"'`;)|&<>]+)/g)) add(match.index, [match[1]]);
  }
  return found;
}

function candidates() {
  const listed = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
    { cwd: ROOT, maxBuffer: 1 << 28 }).toString().split('\0');
  // This file is left out: its header and planted fixtures name paths that are absent on purpose.
  return listed.filter(file => file && CODE.test(file) && !FROZEN.test(file) && file !== SELF && existsSync(join(ROOT, file)));
}

function ignored(paths) {
  if (!paths.length) return new Set();
  try {
    return new Set(execFileSync('git', ['check-ignore', '--no-index', '--stdin'], { cwd: ROOT, input: paths.join('\n') })
      .toString().split('\n').filter(Boolean));
  } catch (error) {
    // check-ignore exits 1 when nothing is ignored.
    if (error.status === 1) return new Set();
    throw error;
  }
}

/** A path exists, or a glob in its last segment matches at least one entry: a glob that
 *  matches nothing runs its loop zero times and says nothing. */
function exists(root, target) {
  if (!target.includes('*')) return existsSync(join(root, target));
  const dir = join(root, dirname(target));
  const pattern = new RegExp(`^${target.split('/').pop().replace(/[.+?^()[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`);
  return existsSync(dir) && readdirSync(dir).some(name => pattern.test(name));
}

/** The refusals for FILES under ROOT: references whose target is absent, not ignored and not listed. */
export function refusals(root, files) {
  const missing = [];
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
  const skip = root === ROOT ? ignored(missing.flatMap(item => [item.target, `${item.target}/`])) : new Set();
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
      'a/join.js': "const HERE = dirname(fileURLToPath(import.meta.url));\njoin(HERE, 'gone.json'); join(HERE, 'there.mjs');",
      'a/tpl.js': "const HERE = fileURLToPath(new URL('.', import.meta.url));\nconst A = `${HERE}gone.js`; const B = `${HERE}there.mjs`;",
      'a/root.js': "const HERE = resolve(dirname(fileURLToPath(import.meta.url)), '..');\njoin(HERE, 'not-a-sibling.json');",
      'a/p.py': 'HERE = Path(__file__).resolve().parent\nHERE / "gone.py"\nHERE / "there.mjs"\n',
      'a/q.py': 'HERE = os.path.dirname(os.path.abspath(__file__))\nos.path.join(HERE, "gone.txt")\n',
      'a/s.sh': 'HERE="$(cd "$(dirname "$0")" && pwd)"\npython3 "$HERE/gone.py"\nnode "$HERE/there.mjs"\nfor m in "$HERE"/th*.mjs; do :; done\nfor m in "$HERE"/none-*.json; do :; done\n',
      'a/t.sh': 'X_HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"\nsource "$X_HERE/gone.sh"\n',
      'a/up.sh': 'HERE="$(cd "$(dirname "$0")" && pwd)"\nnode "$HERE/../../../out.mjs"\n',
    };
    for (const [file, text] of Object.entries(files)) writeFileSync(join(dir, file), text);
    const got = refusals(dir, Object.keys(files)).map(item => `${item.file} -> ${item.target}`).sort();
    const want = ['a/join.js -> a/gone.json', 'a/p.py -> a/gone.py', 'a/q.py -> a/gone.txt',
      'a/s.sh -> a/gone.py', 'a/s.sh -> a/none-*.json', 'a/t.sh -> a/gone.sh', 'a/tpl.js -> a/gone.js', 'a/up.sh -> ../../out.mjs', 'a/url.mjs -> a/gone.mjs'];
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
