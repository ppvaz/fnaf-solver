#!/usr/bin/env node
// Makes a directory's TypeScript pass the compiler's strict mode without changing what it does at
// run time (Pedro, 2026-10-01: "Typescript strict mode"). Every module came from JavaScript, where a
// parameter or variable with no JSDoc type was already `any` to the checker; strict mode refuses
// that silence. This pass writes it down instead, and only in erasable syntax Node strips:
//
//   - an implicit `any` (a parameter, a destructured parameter, a rest parameter, a variable, a
//     function's return, `this`) becomes an explicit `: any` -- the type the code already had;
//   - a value strict null checks call possibly null or undefined gets a `!`, the assumption the
//     code already ran on;
//   - a read of an `unknown`, a property a type does not declare, and an argument, value or index
//     a declared type refuses become `(x as any)`.
//
// Each is debt the tightening pays: tools/test-type-debt.ts counts them and holds the count to
// tools/quality-baseline.json, so it only shrinks. A diagnostic of another kind is left for a hand
// fix and listed.
//
//   node tools/ts-strict.ts DIR [--dry]    edit DIR's .ts until strict mode has nothing left it can write
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const ROOT = realpathSync(process.env.TS_STRICT_ROOT ? resolve(process.env.TS_STRICT_ROOT)
  : resolve(fileURLToPath(new URL('.', import.meta.url)), '..'));
const [dirArg, ...flags] = process.argv.slice(2);
if (!dirArg) { console.error('usage: node tools/ts-strict.ts DIR [--dry]'); process.exit(2); }
const DRY = flags.includes('--dry');
const DIR = relative(ROOT, realpathSync(resolve(dirArg)));
const git = (...args: string[]) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 26 });

const IMPLICIT_PARAMETER = new Set([7006, 7019, 7031]);
const IMPLICIT_VARIABLE = new Set([7005, 7034, 7022]);
const IMPLICIT_RETURN = new Set([7023, 7024, 7010]);
const POSSIBLY_EMPTY = new Set([18047, 18048, 18049, 2531, 2532, 2533]);
const CAST = new Set([18046, 2345, 2322, 2769, 2739, 2740, 2741, 2353, 2367, 2362, 2363, 2365, 2349, 2351, 2559, 2678]);

type Edit = { at: number, text: string };

/** The innermost node whose span is exactly [start, end). */
function nodeAt(file: ts.SourceFile, start: number, end: number): ts.Node | null {
  let found: ts.Node | null = null;
  const visit = (node: ts.Node) => {
    if (node.getStart(file) <= start && end <= node.getEnd()) {
      if (node.getStart(file) === start && node.getEnd() === end) found = node;
      node.forEachChild(visit);
    }
  };
  file.forEachChild(visit);
  return found;
}

const ancestor = <T extends ts.Node>(node: ts.Node, test: (n: ts.Node) => n is T): T | null => {
  for (let at: ts.Node | undefined = node; at; at = at.parent) if (test(at)) return at;
  return null;
};

/** `(x as any)` around an expression, as two inserts. */
const castAround = (node: ts.Node, file: ts.SourceFile): Edit[] =>
  [{ at: node.getStart(file), text: '(' }, { at: node.getEnd(), text: ' as any)' }];

/** The edits that write one diagnostic's implicit type down, or null when it needs a hand. */
function editsFor(diagnostic: ts.Diagnostic, file: ts.SourceFile, checker: ts.TypeChecker): Edit[] | null {
  const start = diagnostic.start ?? 0;
  const node = nodeAt(file, start, start + (diagnostic.length ?? 0));
  if (!node) return null;
  const code = diagnostic.code;
  if (IMPLICIT_PARAMETER.has(code)) {
    const parameter = ancestor(node, ts.isParameter);
    if (!parameter || parameter.type) return null;
    const fn = parameter.parent;
    const rest = parameter.dotDotDotToken ? ': any[]' : ': any';
    const bare = ts.isArrowFunction(fn) && !fn.getChildren(file).some(child => child.kind === ts.SyntaxKind.OpenParenToken);
    const after = parameter.questionToken ? parameter.questionToken.getEnd() : parameter.name.getEnd();
    return bare ? [{ at: parameter.getStart(file), text: '(' }, { at: after, text: `${rest})` }] : [{ at: after, text: rest }];
  }
  if (IMPLICIT_VARIABLE.has(code)) {
    const symbol = ts.isIdentifier(node) ? checker.getSymbolAtLocation(node) : undefined;
    const declaration = symbol?.valueDeclaration ?? ancestor(node, ts.isVariableDeclaration);
    if (!declaration || !ts.isVariableDeclaration(declaration) || declaration.type || !ts.isIdentifier(declaration.name)) return null;
    if (declaration.getSourceFile() !== file) return null;
    const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ');
    return [{ at: declaration.name.getEnd(), text: /'any\[\]'/.test(message) ? ': any[]' : ': any' }];
  }
  if (IMPLICIT_RETURN.has(code)) {
    // A recursive arrow is named by its variable: the function is the initializer.
    const named = ts.isIdentifier(node) && node.parent && ts.isVariableDeclaration(node.parent) && node.parent.initializer &&
      ts.isFunctionLike(node.parent.initializer) ? node.parent.initializer : node;
    const fn = ancestor(named, (n): n is ts.SignatureDeclaration => ts.isFunctionLike(n));
    if (!fn || fn.type) return null;
    const close = fn.getChildren(file).find(child => child.kind === ts.SyntaxKind.CloseParenToken);
    return close ? [{ at: close.getEnd(), text: ': any' }] : null;
  }
  if (code === 2683) {
    const fn = ancestor(node, (n): n is ts.FunctionDeclaration | ts.FunctionExpression => ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n));
    const open = fn?.getChildren(file).find(child => child.kind === ts.SyntaxKind.OpenParenToken);
    if (!fn || !open || fn.parameters.some(p => ts.isIdentifier(p.name) && p.name.text === 'this')) return null;
    return [{ at: open.getEnd(), text: fn.parameters.length ? 'this: any, ' : 'this: any' }];
  }
  if (code === 7053) {
    const access = ancestor(node, ts.isElementAccessExpression);
    return access ? castAround(access.expression, file) : null;
  }
  if (code === 2339) {
    const access = node.parent && ts.isPropertyAccessExpression(node.parent) && node.parent.name === node ? node.parent : null;
    return access ? castAround(access.expression, file) : null;
  }
  if (POSSIBLY_EMPTY.has(code)) {
    if (!ts.isExpression(node)) return null;
    return [{ at: node.getEnd(), text: '!' }];
  }
  if (code === 2454 || code === 2564) {
    const declaration = ancestor(node, (n): n is ts.VariableDeclaration | ts.PropertyDeclaration => ts.isVariableDeclaration(n) || ts.isPropertyDeclaration(n));
    if (!declaration || !ts.isIdentifier(declaration.name)) return null;
    return declaration.type ? [{ at: declaration.name.getEnd(), text: '!' }] : [{ at: declaration.name.getEnd(), text: ': any' }];
  }
  if (code === 2322 && ts.isPropertyAccessExpression(node) && node.expression.kind === ts.SyntaxKind.ThisKeyword &&
      node.parent && ts.isBinaryExpression(node.parent) && node.parent.left === node &&
      (node.parent.right.kind === ts.SyntaxKind.NullKeyword || (ts.isIdentifier(node.parent.right) && node.parent.right.text === 'undefined'))) {
    // A field set to null (or undefined) where it is declared without it: the declaration was too narrow.
    const declaration = checker.getSymbolAtLocation(node.name)?.valueDeclaration;
    if (!declaration || !ts.isPropertyDeclaration(declaration) || !declaration.type || declaration.getSourceFile() !== file) return null;
    const empty = node.parent.right.kind === ts.SyntaxKind.NullKeyword ? 'null' : 'undefined';
    return [{ at: declaration.type.getEnd(), text: ` | ${empty}` }];
  }
  if (CAST.has(code)) {
    let target: ts.Node = node;
    // A refused value is named by its declaration or its property name: cast the value itself.
    if (ts.isIdentifier(node) && node.parent && (ts.isVariableDeclaration(node.parent) || ts.isPropertyAssignment(node.parent) ||
        ts.isPropertyDeclaration(node.parent)) && node.parent.name === node) {
      const value = node.parent.initializer;
      if (!value) return null;
      target = value;
    }
    if (!ts.isExpression(target) || ts.isOmittedExpression(target)) return null;
    // A spread's argument, a shorthand property and an assignment's target cannot carry a cast.
    if (target.parent && (ts.isShorthandPropertyAssignment(target.parent) ||
        (ts.isBinaryExpression(target.parent) && target.parent.left === target && target.parent.operatorToken.kind === ts.SyntaxKind.EqualsToken)))
      return null;
    return castAround(target, file);
  }
  return null;
}

const parsed = ts.getParsedCommandLineOfConfigFile(join(ROOT, 'tsconfig.json'), {},
  { ...ts.sys, onUnRecoverableConfigFileDiagnostic: (d: ts.Diagnostic) => { throw new Error(ts.flattenDiagnosticMessageText(d.messageText, '\n')); } });
if (!parsed) throw new Error('tsconfig.json did not parse');
const options: ts.CompilerOptions = { ...parsed.options, strict: true, noEmit: true };
const targets = git('ls-files', '-z', '--', `${DIR}/**/*.ts`, `${DIR}/*.ts`).split('\0').filter(f => f && !f.endsWith('.d.ts'))
  .map(f => join(ROOT, f));
const texts = new Map<string, string>();
const versions = new Map<string, number>();
const roots = [...new Set([...parsed.fileNames, ...targets])];
const host: ts.LanguageServiceHost = {
  getScriptFileNames: () => roots,
  getScriptVersion: f => String(versions.get(f) ?? 0),
  getScriptSnapshot: f => {
    const text = texts.get(f) ?? (existsSync(f) ? readFileSync(f, 'utf8') : undefined);
    return text === undefined ? undefined : ts.ScriptSnapshot.fromString(text);
  },
  getCurrentDirectory: () => ROOT,
  getCompilationSettings: () => options,
  getDefaultLibFileName: o => ts.getDefaultLibFilePath(o),
  fileExists: ts.sys.fileExists, readFile: ts.sys.readFile, readDirectory: ts.sys.readDirectory,
  directoryExists: ts.sys.directoryExists, getDirectories: ts.sys.getDirectories,
};
const service = ts.createLanguageService(host, ts.createDocumentRegistry());

let written = 0;
for (let round = 0; round < 12; round += 1) {
  let progress = 0;
  for (const path of targets) {
    const program = service.getProgram();
    const file = program?.getSourceFile(path);
    if (!program || !file) continue;
    const checker = program.getTypeChecker();
    const edits = new Map<number, string>();
    const claimed: [number, number][] = [];
    for (const diagnostic of program.getSemanticDiagnostics(file)) {
      const found = editsFor(diagnostic, file, checker);
      if (!found) continue;
      // One edit per region a round: nested casts are written over successive rounds.
      const lo = Math.min(...found.map(e => e.at)), hi = Math.max(...found.map(e => e.at));
      if (claimed.some(([a, b]) => lo <= b && a <= hi)) continue;
      claimed.push([lo, hi]);
      for (const edit of found) edits.set(edit.at, (edits.get(edit.at) ?? '') + edit.text);
    }
    if (!edits.size) continue;
    let text = file.getFullText();
    for (const at of [...edits.keys()].sort((a, b) => b - a)) text = text.slice(0, at) + edits.get(at) + text.slice(at);
    texts.set(path, text);
    versions.set(path, (versions.get(path) ?? 0) + 1);
    progress += edits.size;
  }
  written += progress;
  if (!progress) break;
}

const program = service.getProgram();
const left = targets.flatMap(path => {
  const file = program?.getSourceFile(path);
  return file && program ? [...program.getSyntacticDiagnostics(file), ...program.getSemanticDiagnostics(file)] : [];
});
if (!DRY) for (const [path, text] of texts) writeFileSync(path, text);
console.log(`ts-strict: ${written} edits in ${texts.size} of ${targets.length} files under ${DIR}${DRY ? ' (dry run)' : ''}; ` +
  `${left.length} strict diagnostic(s) left for a hand fix`);
for (const d of left.slice(0, 40)) {
  const where = d.file && d.start !== undefined ? d.file.getLineAndCharacterOfPosition(d.start) : null;
  console.log(`  ${d.file ? relative(ROOT, d.file.fileName) : '?'}:${where ? where.line + 1 : '?'} TS${d.code} ${ts.flattenDiagnosticMessageText(d.messageText, ' ').slice(0, 140)}`);
}
