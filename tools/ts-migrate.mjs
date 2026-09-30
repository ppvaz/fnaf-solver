#!/usr/bin/env node
// Moves a directory's JavaScript sources to TypeScript that Node runs by type
// stripping (Pedro, 2026-09-30: "runtime .ts", package by package, leaves
// first). It adds types and renames specifiers, never runtime code, so each
// migration commit reads as a rename plus type syntax:
//
//   1. while the files are still JavaScript, where TypeScript parses JSDoc as
//      types, every JSDoc type moves onto its declaration: a parameter's
//      @param, a function's @returns and @template, a variable's or a class
//      property's @type, a cast `/** @type {T} */ (e)` as `(e as T)`, a
//      @typedef (with its @property tags) as an exported `type`, and each field
//      a constructor or method assigns (`this.x = ...`), or the module installs
//      on the prototype, is declared (`declare`, so no runtime field appears)
//      with the type the JavaScript checker already gave it. A JSDoc type is copied as
//      written unless it uses syntax TypeScript does not accept (`*`, `?T`,
//      `T=`, `Array.<T>`, `Object`, `function(...)`, nested `opts.x` tags), in
//      which case the checker's own reading of it is written instead;
//   2. `git mv` renames each .js to .ts, so history follows the file;
//   3. an import type -- a JSDoc alias `@typedef {import('m').N} N`, or
//      `import('m').N` left in an annotation -- becomes `import type { N }
//      from 'm'` (a relative .js specifier naming its .ts);
//   4. the JSDoc keeps its prose and loses what moved: `@param {T} x d`
//      becomes `@param x d`, a tag with nothing left goes, and so does a
//      comment with nothing left;
//   5. every relative specifier in the repository that named a moved module
//      names its .ts, and so do the package manifest's `exports`.
//
// TypeScript's own codefix `annotateWithTypeFromJSDoc` was the first plan; on
// the kernel (2026-09-30) it wrote a one-parameter arrow's parameter type as
// its return type (`why => ...` became `(why: string): string`) and a
// predicate as a parameter type, so this reads the JSDoc itself.
//
// Paths other tools build as strings (an import map, a Python script, a
// README) are listed at the end for a person to change: this tool never
// guesses at text it cannot parse as an import. Type strings the checker
// could only print with an absolute `import("...")` fall back to `any` and
// are listed too.
//
//   node tools/ts-migrate.mjs DIR        migrate every tracked .js under DIR
//   node tools/ts-migrate.mjs DIR --dry  print what would move and change nothing
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

// TS_MIGRATE_ROOT points the tool at another repository (tools/test-ts-migrate.mjs's fixture).
const ROOT = process.env.TS_MIGRATE_ROOT ? resolve(process.env.TS_MIGRATE_ROOT)
  : resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 26 });
const ARITY_ONLY = process.argv.includes('--arity');
const RELAX_ONLY = process.argv.includes('--relax');
const [dirArg, ...flags] = process.argv.slice(2).filter(arg => arg !== '--arity' && arg !== '--relax');
if (!dirArg) { console.error('usage: node tools/ts-migrate.mjs DIR [--dry | --arity | --relax]'); process.exit(2); }
const DRY = flags.includes('--dry');
const DIR = relative(ROOT, resolve(dirArg));

/**
 * In a .js file every parameter is optional to a caller; in a .ts file one
 * without `?` or a default is required. So a call that passed fewer arguments
 * than its callee declares -- legal as JavaScript -- is TS2554 once both are
 * TypeScript. This marks exactly those callees' missing parameters optional
 * (`?`, erased like any type), from TypeScript's own diagnostics over the
 * migrated files under the checked options, until none is left.
 * @param {string[]} paths repository-relative .ts files
 */
function relaxArity(paths) {
  const parsedJs = ts.getParsedCommandLineOfConfigFile(join(ROOT, 'tsconfig.js.json'), {},
    { ...ts.sys, onUnRecoverableConfigFileDiagnostic: d => { throw new Error(ts.flattenDiagnosticMessageText(d.messageText, '\n')); } });
  const absolute = new Set(paths.map(path => join(ROOT, path)));
  let marked = 0;
  for (let round = 0; round < 12; round += 1) {
    const program = ts.createProgram([...absolute], { ...parsedJs.options, noEmit: true });
    const checker = program.getTypeChecker();
    const edits = new Map(); // file -> Set of insert positions
    for (const name of absolute) {
      const sf = program.getSourceFile(name);
      for (const diagnostic of program.getSemanticDiagnostics(sf)) {
        if (diagnostic.code !== 2554 && diagnostic.code !== 2555) continue;
        let call = null;
        const find = node => {
          if (call) return;
          if ((ts.isCallExpression(node) || ts.isNewExpression(node)) && node.getStart() <= diagnostic.start &&
              diagnostic.start < node.getEnd()) {
            call = node;
            ts.forEachChild(node, find);
            return;
          }
          if (node.getStart() <= diagnostic.start && diagnostic.start < node.getEnd()) ts.forEachChild(node, find);
        };
        ts.forEachChild(sf, find);
        // The innermost call spanning the diagnostic.
        const innermost = node => {
          let best = node;
          const walk = n => {
            if ((ts.isCallExpression(n) || ts.isNewExpression(n)) && n.getStart() <= diagnostic.start && diagnostic.start < n.getEnd())
              best = n;
            if (n.getStart() <= diagnostic.start && diagnostic.start < n.getEnd()) ts.forEachChild(n, walk);
          };
          ts.forEachChild(node, walk);
          return best;
        };
        if (!call) continue;
        call = innermost(call);
        const declaration = checker.getResolvedSignature(call)?.declaration;
        if (!declaration || !declaration.parameters || !absolute.has(declaration.getSourceFile().fileName)) continue;
        const given = call.arguments?.length ?? 0;
        declaration.parameters.forEach((param, index) => {
          if (index < given || param.questionToken || param.initializer || param.dotDotDotToken) return;
          if (param.name.getText() === 'this') return;
          const file = declaration.getSourceFile().fileName;
          if (!edits.has(file)) edits.set(file, new Set());
          edits.get(file).add(param.name.getEnd());
        });
      }
    }
    if (!edits.size) break;
    for (const [file, positions] of edits) {
      let text = readFileSync(file, 'utf8');
      for (const at of [...positions].sort((a, b) => b - a)) { text = text.slice(0, at) + '?' + text.slice(at); marked += 1; }
      writeFileSync(file, text);
    }
  }
  return marked;
}

/**
 * In a .js file an object literal's type is open: reading a property it does
 * not name is `any`, and `new Promise(...)` resolves to `any`. In a .ts file
 * the literal is closed and the promise resolves to `unknown`, so code that
 * checked as JavaScript fails with TS2339. Keeping the strictness the file had
 * (Pedro, 2026-09-30: tighten later), this writes `new Promise<any>` where no
 * type argument was given, and for each refused property types the local
 * variable or parameter it was read from `any` (or, for any other object,
 * casts it `as any` where it is read), from TypeScript's own diagnostics,
 * until none is left. Every such `any` is the debt the tightening pays.
 * @param {string[]} paths repository-relative .ts files
 */
function relaxOpenLiterals(paths) {
  const parsedJs = ts.getParsedCommandLineOfConfigFile(join(ROOT, 'tsconfig.js.json'), {},
    { ...ts.sys, onUnRecoverableConfigFileDiagnostic: d => { throw new Error(ts.flattenDiagnosticMessageText(d.messageText, '\n')); } });
  const absolute = new Set(paths.map(path => join(ROOT, path)));
  let promises = 0, typed = 0, cast = 0;
  // new Promise(...) -> new Promise<any>(...)
  for (const name of absolute) {
    const text = readFileSync(name, 'utf8');
    const sf = ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const at = [];
    const visit = node => {
      if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'Promise' && !node.typeArguments)
        at.push(node.expression.getEnd());
      ts.forEachChild(node, visit);
    };
    visit(sf);
    if (!at.length) continue;
    let next = text;
    for (const pos of at.sort((a, b) => b - a)) next = next.slice(0, pos) + '<any>' + next.slice(pos);
    writeFileSync(name, next);
    promises += at.length;
  }
  for (let round = 0; round < 12; round += 1) {
    const program = ts.createProgram([...absolute], { ...parsedJs.options, noEmit: true });
    const checker = program.getTypeChecker();
    const edits = new Map(); // file -> Map(position -> text)
    const add = (file, pos, textToInsert) => {
      if (!edits.has(file)) edits.set(file, new Map());
      if (!edits.get(file).has(pos)) edits.get(file).set(pos, textToInsert);
    };
    for (const name of absolute) {
      const sf = program.getSourceFile(name);
      for (const diagnostic of program.getSemanticDiagnostics(sf)) {
        // `resolve()` with no value under Promise<any> (TS2794): the promise resolves to nothing.
        if (diagnostic.code === 2794) {
          let promise = null;
          const findPromise = node => {
            if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'Promise' &&
                node.getStart() <= diagnostic.start && diagnostic.start < node.getEnd()) promise = node;
            if (node.getStart() <= diagnostic.start && diagnostic.start < node.getEnd()) ts.forEachChild(node, findPromise);
          };
          ts.forEachChild(sf, findPromise);
          const arg = promise?.typeArguments?.[0];
          if (arg && arg.getText() === 'any') add(name, arg.getStart(), `void\u0000${arg.getText().length}`);
          continue;
        }
        if (diagnostic.code !== 2339 && diagnostic.code !== 2551) continue;
        let access = null;
        const find = node => {
          if (access) return;
          if ((ts.isPropertyAccessExpression(node)) && node.name.getStart() === diagnostic.start) { access = node; return; }
          if (node.getStart() <= diagnostic.start && diagnostic.start < node.getEnd()) ts.forEachChild(node, find);
        };
        ts.forEachChild(sf, find);
        // A destructuring `const { a } = obj` reports on the binding name; type the source object instead.
        if (!access) {
          let binding = null;
          const findBinding = node => {
            if (binding) return;
            if (ts.isBindingElement(node) && (node.propertyName ?? node.name).getStart() === diagnostic.start) { binding = node; return; }
            if (node.getStart() <= diagnostic.start && diagnostic.start < node.getEnd()) ts.forEachChild(node, findBinding);
          };
          ts.forEachChild(sf, findBinding);
          const holder = binding?.parent?.parent;
          if (holder && (ts.isParameter(holder) || ts.isVariableDeclaration(holder)) && !holder.type) {
            const initializerObject = ts.isVariableDeclaration(holder) && holder.initializer;
            if (ts.isParameter(holder)) add(name, holder.name.getEnd() + (holder.questionToken ? 1 : 0), ': any');
            else if (initializerObject) {
              add(name, initializerObject.getStart(), '(');
              add(name, initializerObject.getEnd(), ' as any)');
            }
          }
          continue;
        }
        const object = access.expression;
        const symbol = ts.isIdentifier(object) ? checker.getSymbolAtLocation(object) : null;
        const declaration = symbol?.valueDeclaration;
        if (declaration && (ts.isParameter(declaration) || ts.isVariableDeclaration(declaration)) && !declaration.type &&
            ts.isIdentifier(declaration.name) && absolute.has(declaration.getSourceFile().fileName) &&
            !(ts.isVariableDeclaration(declaration) && ts.isForOfStatement(declaration.parent?.parent))) {
          const file = declaration.getSourceFile().fileName;
          // A lone arrow parameter without parentheses gains them: `x => ...` is `(x: any) => ...`.
          const bare = ts.isParameter(declaration) && ts.isArrowFunction(declaration.parent) &&
            declaration.getSourceFile().text.slice(declaration.parent.getStart(), declaration.getStart()).trim() === '';
          if (bare) add(file, declaration.getStart(), '(');
          add(file, declaration.name.getEnd() + (declaration.questionToken ? 1 : 0), bare ? ': any)' : ': any');
          typed += 1;
        } else {
          add(name, object.getStart(), '(');
          add(name, object.getEnd(), ' as any)');
          cast += 1;
        }
      }
    }
    if (!edits.size) break;
    for (const [file, positions] of edits) {
      let text = readFileSync(file, 'utf8');
      for (const [at, insert] of [...positions].sort((a, b) => b[0] - a[0])) {
        // A replacement is written as its text plus a NUL and the length it replaces.
        const [value, replaced] = insert.includes('\u0000') ? insert.split('\u0000') : [insert, '0'];
        text = text.slice(0, at) + value + text.slice(at + Number(replaced));
      }
      writeFileSync(file, text);
    }
  }
  return { promises, typed, cast };
}

if (RELAX_ONLY) {
  const paths = git('ls-files', '-z', '--', `${DIR}/**/*.ts`, `${DIR}/*.ts`).split('\0').filter(Boolean)
    .filter(path => !path.endsWith('.d.ts'));
  const done = relaxOpenLiterals(paths);
  console.log(`ts-migrate --relax: ${done.promises} promises typed <any>, ${done.typed} declarations typed any, ${done.cast} reads cast as any under ${DIR}`);
  process.exit(0);
}

if (ARITY_ONLY) {
  const paths = git('ls-files', '-z', '--', `${DIR}/**/*.ts`, `${DIR}/*.ts`).split('\0').filter(Boolean)
    .filter(path => !path.endsWith('.d.ts'));
  console.log(`ts-migrate --arity: ${relaxArity(paths)} parameters marked optional under ${DIR}`);
  process.exit(0);
}
const moving = git('ls-files', '-z', '--', `${DIR}/**/*.js`, `${DIR}/*.js`).split('\0').filter(Boolean).sort();
if (!moving.length) { console.error(`ts-migrate: no tracked .js under ${DIR}`); process.exit(1); }
console.log(`ts-migrate: ${moving.length} modules under ${DIR}`);
if (DRY) { for (const path of moving) console.log(`  ${path} -> ${path.replace(/\.js$/, '.ts')}`); process.exit(0); }
const read = path => readFileSync(join(ROOT, path), 'utf8');
const write = (path, text) => writeFileSync(join(ROOT, path), text);
const notes = [];

/** Apply text edits {start, end, text}, the later ones first. Edits at one position keep their order. */
function applyEdits(text, edits) {
  const ordered = edits.map((edit, index) => ({ ...edit, index }))
    .sort((a, b) => b.start - a.start || b.end - a.end || b.index - a.index);
  for (const { start, end, text: insert } of ordered) text = text.slice(0, start) + insert + text.slice(end);
  return text;
}

// ---- 1. JSDoc types onto declarations, while the files are JavaScript ----------------
const parsed = ts.getParsedCommandLineOfConfigFile(join(ROOT, 'tsconfig.js.json'), {},
  { ...ts.sys, onUnRecoverableConfigFileDiagnostic: d => { throw new Error(ts.flattenDiagnosticMessageText(d.messageText, '\n')); } });
const program = ts.createProgram(moving.map(path => join(ROOT, path)), { ...parsed.options, noEmit: true });
const checker = program.getTypeChecker();
const K = ts.SyntaxKind;
const JSDOC_ONLY = new Set([K.JSDocAllType, K.JSDocUnknownType, K.JSDocNullableType, K.JSDocNonNullableType,
  K.JSDocOptionalType, K.JSDocFunctionType, K.JSDocVariadicType, K.JSDocTypeLiteral, K.JSDocSignature, K.JSDocNamepathType]);
/** Whether a JSDoc type uses syntax TypeScript would read differently or not at all. */
function jsdocOnly(node) {
  let found = false;
  const visit = n => {
    if (found) return;
    if (JSDOC_ONLY.has(n.kind)) { found = true; return; }
    if (ts.isTypeReferenceNode(n)) {
      const name = n.typeName.getText();
      if ((name === 'Object' || name === 'object') && !n.typeArguments) { found = true; return; }
      if (/\.</.test(n.getText())) { found = true; return; } // Array.<T>, Object.<K, V>
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return found;
}
/** A JSDoc type's text as one line: a multi-line type keeps its words, not its ` * ` prefixes. */
const clean = text => text.includes('\n')
  ? text.split('\n').map(line => line.replace(/^\s*\*(?!\/)\s?/, '')).join(' ').replace(/\s+/g, ' ').trim()
  : text.trim();
function checkerText(type, file, where) {
  const text = checker.typeToString(type, undefined, ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.UseAliasDefinedOutsideCurrentScope);
  if (/import\(/.test(text)) {
    notes.push(`${file}: ${where} typed any (the checker printed ${text.slice(0, 80)})`);
    return 'any';
  }
  return text;
}
/** Position just after the `)` closing a function's parameter list. */
function afterParams(fn, text) {
  let i = fn.parameters.end;
  for (;;) {
    if (text.startsWith('/*', i)) { i = text.indexOf('*/', i) + 2; continue; }
    if (text.startsWith('//', i)) { i = text.indexOf('\n', i) + 1; continue; }
    if (/\s|,/.test(text[i])) { i += 1; continue; } // a trailing comma after the last parameter
    if (text[i] === ')') return i + 1;
    throw new Error(`no ) after the parameters at ${i}`);
  }
}
const typedefImports = new Map(); // module path -> [{spec, name, alias}]
const typeLiteral = (tags, file) => {
  const lines = tags.map(tag => {
    const name = tag.name.getText();
    let type = tag.typeExpression ? tag.typeExpression.type : null;
    let optional = tag.isBracketed;
    if (type?.kind === K.JSDocOptionalType) { optional = true; type = type.type; }
    const typeText = !type ? 'any' : jsdocOnly(type) ? checkerText(checker.getTypeFromTypeNode(type), file, `@property ${name}`) : clean(type.getText());
    const doc = typeof tag.comment === 'string' ? tag.comment.trim() : ts.getTextOfJSDocComment(tag.comment)?.trim();
    return `${doc ? `/** ${doc} */ ` : ''}${name}${optional ? '?' : ''}: ${typeText};`;
  });
  return `{ ${lines.join(' ')} }`;
};
for (const path of moving) {
  const file = program.getSourceFile(join(ROOT, path));
  const text = file.text;
  const edits = [];
  const insert = (at, value) => edits.push({ start: at, end: at, text: value });
  // `Object.defineProperty(C.prototype, 'name', { value: v, ... })` and
  // `C.prototype.name = v` for a class C of this file: the member name and v.
  const installed = new Map();
  for (const statement of file.statements) {
    if (!ts.isExpressionStatement(statement)) continue;
    const e = statement.expression;
    let owner = null, name = null, value = null;
    if (ts.isCallExpression(e) && e.expression.getText() === 'Object.defineProperty' && e.arguments.length === 3 &&
        ts.isPropertyAccessExpression(e.arguments[0]) && e.arguments[0].name.text === 'prototype' &&
        ts.isStringLiteral(e.arguments[1]) && ts.isObjectLiteralExpression(e.arguments[2])) {
      const valueProp = e.arguments[2].properties.find(p => ts.isPropertyAssignment(p) && p.name.getText() === 'value');
      if (valueProp && (ts.isIdentifier(valueProp.initializer) || ts.isPropertyAccessExpression(valueProp.initializer))) {
        owner = e.arguments[0].expression.getText(); name = e.arguments[1].text; value = valueProp.initializer.getText();
      }
    } else if (ts.isBinaryExpression(e) && e.operatorToken.kind === K.EqualsToken && ts.isPropertyAccessExpression(e.left) &&
        ts.isPropertyAccessExpression(e.left.expression) && e.left.expression.name.text === 'prototype' &&
        (ts.isIdentifier(e.right) || ts.isPropertyAccessExpression(e.right))) {
      owner = e.left.expression.expression.getText(); name = e.left.name.text; value = e.right.getText();
    }
    if (owner && name && value) {
      if (!installed.has(owner)) installed.set(owner, []);
      installed.get(owner).push({ name, value });
    }
  }
  const functionLike = node => ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node) || ts.isConstructorDeclaration(node) || ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node);
  const visit = node => {
    // A cast: `/** @type {T} */ (e)`.
    if (ts.isParenthesizedExpression(node)) {
      const tag = ts.getJSDocTags(node).find(ts.isJSDocTypeTag);
      if (tag) {
        const comment = node.getFullText().slice(0, node.getStart() - node.getFullStart());
        const at = node.getFullStart() + comment.lastIndexOf('/**');
        const type = tag.typeExpression.type;
        const typeText = jsdocOnly(type) ? checkerText(checker.getTypeFromTypeNode(type), path, 'a cast') : clean(type.getText());
        // The cast's inner expression is visited for its own edits first.
        const inner = { start: node.expression.getStart(), end: node.expression.getEnd() };
        const innerEdits = [];
        const collect = edits.length;
        ts.forEachChild(node.expression, visit);
        innerEdits.push(...edits.splice(collect));
        const innerText = applyEdits(text.slice(inner.start, inner.end),
          innerEdits.map(e => ({ start: e.start - inner.start, end: e.end - inner.start, text: e.text })));
        // `as` binds tighter than an arrow, a conditional, an assignment or a
        // comma, so such an operand keeps parentheses of its own:
        // `/** @type {F} */ (() => {})` is `((() => {}) as F)`.
        const tight = ts.isIdentifier(node.expression) || ts.isPropertyAccessExpression(node.expression) ||
          ts.isElementAccessExpression(node.expression) || ts.isCallExpression(node.expression) ||
          ts.isNewExpression(node.expression) || ts.isLiteralExpression(node.expression) ||
          ts.isParenthesizedExpression(node.expression) || ts.isArrayLiteralExpression(node.expression) ||
          ts.isObjectLiteralExpression(node.expression) || node.expression.kind === K.ThisKeyword;
        edits.push({ start: at, end: node.getEnd(), text: `(${tight ? innerText : `(${innerText})`} as ${typeText})` });
        return;
      }
    }
    if (functionLike(node)) {
      const single = ts.isArrowFunction(node) && node.parameters.length === 1 &&
        text.slice(node.getStart(), node.parameters[0].getStart()).trim() === (node.modifiers ? node.modifiers.map(m => m.getText()).join(' ') : '');
      const templates = ts.getJSDocTags(node).filter(ts.isJSDocTemplateTag);
      if (templates.length && !ts.isConstructorDeclaration(node)) {
        const params = templates.flatMap(tag => tag.typeParameters.map(p =>
          tag.constraint ? `${p.name.getText()} extends ${clean(tag.constraint.type.getText())}` : p.name.getText()));
        const open = single ? node.parameters[0].getStart() : text.lastIndexOf('(', node.parameters.pos);
        insert(open, `<${params.join(', ')}${ts.isArrowFunction(node) && params.length === 1 ? ',' : ''}>`);
      }
      // `@this {T}` is TypeScript's `this: T` parameter, erased like any type.
      const thisTag = ts.getJSDocTags(node).find(ts.isJSDocThisTag);
      if (thisTag?.typeExpression && !ts.isArrowFunction(node) && node.parameters[0]?.name.getText() !== 'this')
        insert(node.parameters.pos, `this: ${clean(thisTag.typeExpression.type.getText())}${node.parameters.length ? ', ' : ''}`);
      const paramTags = ts.getJSDocTags(node).filter(ts.isJSDocParameterTag);
      const returns = ts.getJSDocReturnType(node);
      const typedReturn = returns && !node.type && !ts.isConstructorDeclaration(node) && !ts.isSetAccessorDeclaration(node);
      node.parameters.forEach((param, index) => {
        if (param.type) return;
        const tag = ts.getJSDocParameterTags(param)[0] ??
          (ts.isIdentifier(param.name) ? undefined : paramTags.filter(t => !ts.isQualifiedName(t.name))[index]);
        const name = param.name.getText();
        let annotation = null;
        if (tag?.typeExpression) {
          let type = tag.typeExpression.type;
          let optional = tag.isBracketed;
          if (type.kind === K.JSDocOptionalType) { optional = true; type = type.type; }
          const nested = paramTags.some(t => ts.isQualifiedName(t.name) && t.name.left.getText() === (ts.isIdentifier(param.name) ? name : tag.name.getText()));
          let typeText;
          if (type.kind === K.JSDocVariadicType) typeText = `${clean(type.type.getText())}[]`;
          else if (nested || jsdocOnly(type)) typeText = checkerText(checker.getTypeAtLocation(param), path, `parameter ${name}`);
          else typeText = clean(type.getText());
          annotation = `${optional && !param.initializer && !param.dotDotDotToken ? '?' : ''}: ${typeText}`;
        }
        if (single && (annotation || typedReturn || templates.length)) {
          insert(param.getStart(), '(');
          insert(param.name.getEnd(), `${annotation ?? ''})`);
        } else if (annotation) insert(param.name.getEnd(), annotation);
      });
      if (typedReturn) {
        const typeText = jsdocOnly(returns)
          ? checkerText(checker.getReturnTypeOfSignature(checker.getSignatureFromDeclaration(node)), path, 'a return')
          : clean(returns.getText());
        const at = single ? node.parameters[0].getEnd() : afterParams(node, text);
        // After the `)` this pass adds to a one-parameter arrow, so the edit order matters: added last.
        insert(single ? node.parameters[0].name.getEnd() : at, `: ${typeText}`);
      }
    }
    // A variable, or a class property, with a @type.
    if ((ts.isVariableDeclaration(node) || ts.isPropertyDeclaration(node)) && !node.type) {
      const tag = ts.getJSDocTypeTag(node);
      if (tag) {
        const type = tag.typeExpression.type;
        const typeText = jsdocOnly(type) ? checkerText(checker.getTypeAtLocation(node.name), path, `${node.name.getText()}`) : clean(type.getText());
        insert(node.name.getEnd(), `: ${typeText}`);
      }
    }
    // Fields a class assigns and never declares, and members the module
    // installs on its prototype (declared, since TypeScript infers neither).
    if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) {
      const declared = new Set(node.members.map(member => member.name?.getText()).filter(Boolean));
      const installedHere = (node.name && installed.get(node.name.text) || []).filter(item => !declared.has(item.name));
      const assigned = [];
      const scan = n => {
        if (ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) || ts.isClassLike(n)) return;
        if (ts.isBinaryExpression(n) && n.operatorToken.kind === K.EqualsToken && ts.isPropertyAccessExpression(n.left) &&
            n.left.expression.kind === K.ThisKeyword && !ts.isPrivateIdentifier(n.left.name)) {
          const name = n.left.name.getText();
          if (!declared.has(name) && !assigned.includes(name)) assigned.push(name);
        }
        ts.forEachChild(n, scan);
      };
      for (const member of node.members) {
        if ((ts.isConstructorDeclaration(member) || ts.isMethodDeclaration(member) || ts.isGetAccessorDeclaration(member) ||
             ts.isSetAccessorDeclaration(member)) && !member.modifiers?.some(m => m.kind === K.StaticKeyword) && member.body)
          ts.forEachChild(member.body, scan);
      }
      if (assigned.length || installedHere.length) {
        const instance = checker.getDeclaredTypeOfSymbol(node.name ? checker.getSymbolAtLocation(node.name) : node.symbol);
        const first = node.members[0];
        const indent = first ? (text.slice(text.lastIndexOf('\n', first.getStart()) + 1, first.getStart()).match(/^\s*/)[0]) : '  ';
        const lines = installedHere.map(({ name, value }) => `${indent}declare ${name}: typeof ${value};\n`).join('') +
          assigned.filter(name => !installedHere.some(item => item.name === name)).map(name => {
          const prop = instance.getProperty(name);
          const typeText = prop ? checkerText(checker.getTypeOfSymbolAtLocation(prop, node), path, `field ${name}`) : 'any';
          // `declare`: a class field without it is a runtime field under ES2022 -- an own property set to
          // undefined before the constructor runs, which shadows a prototype accessor (the model-options
          // setter on Sim.prototype.opts) -- and this pass adds types, never fields.
          return `${indent}declare ${name}: ${typeText};\n`;
        }).join('');
        insert(first ? text.lastIndexOf('\n', first.getStart()) + 1 : node.members.pos, first ? lines : `\n${lines}`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  // Typedefs: an import alias becomes a type import after the rename; anything else an exported type.
  for (const statement of [...file.statements, file.endOfFileToken]) {
    for (const doc of statement.jsDoc ?? []) {
      for (const tag of doc.tags ?? []) {
        if (ts.isJSDocTypedefTag(tag)) {
          const name = tag.name?.getText() ?? tag.fullName?.getText();
          const type = tag.typeExpression;
          if (type && !ts.isJSDocTypeLiteral(type) && ts.isImportTypeNode(type.type) && ts.isIdentifier(type.type.qualifier ?? {})) {
            const list = typedefImports.get(path) ?? [];
            list.push({ spec: type.type.argument.literal.text, name: type.type.qualifier.getText(), alias: name });
            typedefImports.set(path, list);
            continue;
          }
          const body = !type ? 'any' : ts.isJSDocTypeLiteral(type) ? typeLiteral(type.jsDocPropertyTags ?? [], path)
            : jsdocOnly(type.type) ? checkerText(checker.getTypeFromTypeNode(type.type), path, `typedef ${name}`) : clean(type.type.getText());
          insert(doc.getEnd(), `\nexport type ${name} = ${body};`);
        } else if (ts.isJSDocCallbackTag(tag)) {
          notes.push(`${path}: @callback ${tag.name?.getText()} left as JSDoc; write it as a type by hand`);
        }
      }
    }
  }
  if (edits.length) write(path, applyEdits(text, edits));
}

// ---- 2. the renames --------------------------------------------------------------------
const renamed = new Map(moving.map(path => [path, path.replace(/\.js$/, '.ts')]));
for (const [from, to] of renamed) git('mv', from, to);
const targets = [...renamed.values()];

// ---- 3. import types become type imports ------------------------------------------------
const tsSpecifier = spec => spec.startsWith('.') ? spec.replace(/\.js$/, '.ts') : spec;
for (const [from, to] of renamed) {
  let text = read(to);
  const wanted = new Map(); // specifier -> Set of "Name" or "Name as Alias"
  const want = (spec, name, alias = name) => {
    const key = tsSpecifier(spec);
    if (!wanted.has(key)) wanted.set(key, new Set());
    wanted.get(key).add(alias === name ? name : `${name} as ${alias}`);
  };
  for (const { spec, name, alias } of typedefImports.get(from) ?? []) want(spec, name, alias);
  const file = ts.createSourceFile(to, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const edits = [];
  const visit = node => {
    if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && node.qualifier && !node.isTypeOf) {
      const head = ts.isIdentifier(node.qualifier) ? node.qualifier.text : node.qualifier.getText().split('.')[0];
      want(node.argument.literal.text, head);
      edits.push({ start: node.getStart(), end: node.getEnd(), text: node.getText().slice(node.qualifier.getStart() - node.getStart()) });
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  text = applyEdits(text, edits);
  if (wanted.size) {
    const lines = [...wanted].map(([spec, names]) => `import type { ${[...names].sort().join(', ')} } from '${spec}';\n`).join('');
    const again = ts.createSourceFile(to, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const imports = again.statements.filter(ts.isImportDeclaration);
    if (imports.length) {
      const at = imports.at(-1).getEnd() + 1;
      text = text.slice(0, at) + lines + text.slice(at);
    } else {
      // After the file's header comment, never between a statement and its own JSDoc.
      const header = ts.getLeadingCommentRanges(text, 0)?.[0];
      const at = header ? text.indexOf('\n', header.end) + 1 : 0;
      text = text.slice(0, at) + lines + '\n' + text.slice(at);
    }
  }
  write(to, text);
}

// ---- 4. the JSDoc keeps its prose -------------------------------------------------------
const MOVED_TAGS = 'param|arg|argument|returns|return|type|this|satisfies|typedef|property|prop|template';
const TAG_START = new RegExp(`(?<=^|[\\s*])@(${MOVED_TAGS}|callback|see|example|deprecated|throws|default|link|todo|since|override|private|public|readonly|internal|file|module|description)\\b`, 'g');
/** The text after a tag with its {type} removed (braces matched). */
function withoutType(segment) {
  const m = /^@(\w+)\s*/.exec(segment);
  let i = m[0].length;
  if (segment[i] !== '{') return { tag: m[1], rest: segment.slice(i) };
  for (let depth = 0; i < segment.length; i += 1) {
    if (segment[i] === '{') depth += 1;
    else if (segment[i] === '}' && --depth === 0) break;
  }
  return { tag: m[1], rest: segment.slice(i + 1).replace(/^[ \t]+/, '') };
}
function tidy(comment) {
  const body = comment.slice(3, -2);
  const starts = [...body.matchAll(TAG_START)].map(m => m.index);
  if (!starts.length) return comment;
  const pieces = [body.slice(0, starts[0])];
  starts.forEach((start, n) => {
    const segment = body.slice(start, starts[n + 1] ?? body.length);
    const { tag, rest } = withoutType(segment);
    if (!new RegExp(`^(${MOVED_TAGS})$`).test(tag)) { pieces.push(segment); return; }
    // What the segment says in words, without the ` * ` line prefixes that end it.
    const words = rest.replace(/\n[ \t]*\*?[ \t]*$/, '').replace(/\n[ \t]*\*[ \t]?/g, '\n');
    if (/^(typedef|property|prop|template|type|this|satisfies)$/.test(tag)) {
      const trailing = rest.match(/\n[ \t]*\*?[ \t]*$/)?.[0] ?? '';
      if (/^(type|this|satisfies)$/.test(tag) && words.trim()) pieces.push(words.trimEnd() + trailing);
      else pieces.push(trailing.replace(/^\n[ \t]*\*?[ \t]*$/, trailing));
      return;
    }
    if (/^(returns?)$/.test(tag)) {
      if (words.trim()) pieces.push(`@returns ${rest}`);
      else pieces.push(rest.match(/\n[ \t]*\*?[ \t]*$/)?.[0] ?? '');
      return;
    }
    // @param: the name (maybe [bracketed=default]), then its description.
    const named = /^(\[[^\]]*\]|[\w$.]+)[ \t]*-?[ \t]*/.exec(rest);
    const description = named ? rest.slice(named[0].length) : rest;
    if (description.replace(/\n[ \t]*\*?[ \t]*$/, '').trim()) pieces.push(`@${tag === 'arg' || tag === 'argument' ? 'param' : tag} ${named ? named[1].replace(/^\[([\w$.]+).*\]$/, '$1') : ''} ${description}`.replace(/ {2,}/g, ' '));
    else pieces.push(rest.match(/\n[ \t]*\*?[ \t]*$/)?.[0] ?? '');
  });
  let result = pieces.join('');
  // Lines left holding only a ` * `, at the end or doubled, go.
  result = result.replace(/(\n[ \t]*\*[ \t]*)+(\n[ \t]*)$/, '$2').replace(/(\n[ \t]*\*[ \t]*){2,}\n/g, '\n *\n');
  if (!result.replace(/[\s*]/g, '')) return null;
  return `/**${result}*/`;
}
for (const path of targets) {
  const text = read(path);
  let next = text.replace(/\/\*\*[\s\S]*?\*\//g, comment => {
    if (!new RegExp(`@(${MOVED_TAGS})\\b`).test(comment)) return comment;
    return tidy(comment) ?? '\u0000';
  });
  // A comment that vanished takes its own line with it, and the blank lines
  // around it close up to at most one.
  next = next.replace(/^[ \t]*\u0000[ \t]*\n/gm, '\u0001')
    .replace(/(\n*)\u0001+(\n*)/g, (m, before, after) => '\n'.repeat(Math.min(Math.max(before.length + after.length, 1), 2)))
    .replace(/\u0000[ \t]*/g, '');
  if (next !== text) write(path, next);
}

// ---- 5. specifiers that named a moved module ------------------------------------------
const movedAbs = new Map([...renamed].map(([from, to]) => [join(ROOT, from), join(ROOT, to)]));
const scripts = git('ls-files', '-z', '--', '*.js', '*.mjs', '*.cjs', '*.ts', '*.mts').split('\0').filter(Boolean);
const SPEC = /((?:\bfrom|\bimport)\s*\(?\s*['"])(\.{1,2}\/[^'"\n]+\.js)(['"])/g;
// A workspace specifier that names a file through a wildcard export
// (`@sixam/source/games/fnaf2/mechanics.js` through "./games/*") names the
// .ts after the move; an exact export follows the manifest instead.
const BARE = /((?:\bfrom|\bimport)\s*\(?\s*['"])(@[\w-]+\/[\w-]+\/[^'"\n]+\.js)(['"])/g;
const workspaces = new Map();
for (const group of ['packages', 'apps']) {
  if (!existsSync(join(ROOT, group))) continue;
  for (const dir of readdirSync(join(ROOT, group))) {
    const manifestPath = join(ROOT, group, dir, 'package.json');
    if (!existsSync(manifestPath)) continue;
    const manifestJson = JSON.parse(readFileSync(manifestPath, 'utf8'));
    workspaces.set(manifestJson.name, { dir: join(ROOT, group, dir), exports: manifestJson.exports ?? {} });
  }
}
const wildcardTarget = spec => {
  const [scope, name, ...rest] = spec.split('/');
  const workspace = workspaces.get(`${scope}/${name}`);
  if (!workspace || typeof workspace.exports !== 'object') return null;
  const subpath = `./${rest.join('/')}`;
  for (const [key, value] of Object.entries(workspace.exports)) {
    if (!key.endsWith('*') || typeof value !== 'string' || !subpath.startsWith(key.slice(0, -1))) continue;
    return join(workspace.dir, value.replace('*', subpath.slice(key.length - 1)));
  }
  return null;
};
let rewritten = 0;
for (const path of scripts) {
  if (!existsSync(join(ROOT, path))) continue;
  const text = read(path);
  const next = text.replace(SPEC, (match, head, spec, tail) => {
    if (!movedAbs.has(resolve(ROOT, dirname(path), spec))) return match;
    rewritten += 1;
    return `${head}${spec.replace(/\.js$/, '.ts')}${tail}`;
  }).replace(BARE, (match, head, spec, tail) => {
    const target = wildcardTarget(spec);
    if (!target || !movedAbs.has(target)) return match;
    rewritten += 1;
    return `${head}${spec.replace(/\.js$/, '.ts')}${tail}`;
  });
  if (next !== text) write(path, next);
}
const manifest = (() => {
  for (let dir = DIR; dir && dir !== '.'; dir = dirname(dir)) if (existsSync(join(ROOT, dir, 'package.json'))) return join(dir, 'package.json');
  return null;
})();
if (manifest) {
  const text = read(manifest);
  const next = text.replace(/"(\.\/[^"]+)\.js"/g, (match, stem) => {
    if (movedAbs.has(join(ROOT, dirname(manifest), `${stem}.js`))) return `"${stem}.ts"`;
    // A wildcard target (`./src/campaign/*.js`, `./src/strategies/*/index.js`) names the .ts
    // once every file it matches is a .ts and none a .js.
    if (stem.includes('*')) {
      const [before, after] = stem.split('*');
      const directory = join(ROOT, dirname(manifest), before);
      if (existsSync(directory)) {
        const hits = readdirSync(directory).map(entry => join(directory, `${entry}${after}`));
        if (hits.some(hit => existsSync(`${hit}.ts`)) && !hits.some(hit => existsSync(`${hit}.js`))) return `"${stem}.ts"`;
      }
    }
    return match;
  });
  if (next !== text) { write(manifest, next); console.log(`  ${manifest}: exports name the .ts modules`); }
}
console.log(`  ${rewritten} relative specifiers now name a .ts module`);

// ---- 6. parameters JavaScript left optional, and literals JavaScript left open --------
console.log(`  ${relaxArity(targets)} parameters marked optional where a call passed fewer arguments`);
{
  const done = relaxOpenLiterals(targets);
  console.log(`  ${done.promises} promises typed <any>, ${done.typed} declarations typed any and ${done.cast} reads cast as any ` +
    'where JavaScript read an open literal');
}

// ---- what a person has to look at ------------------------------------------------------
for (const note of notes) console.log(`  note: ${note}`);
let mentions = [];
try {
  mentions = git('grep', '-l', '-F', ...moving.flatMap(name => ['-e', name]), '--', '.', ':!docs/evidence', ':!*.md')
    .split('\n').filter(Boolean);
} catch (error) {
  if (error.status !== 1) throw error; // 1: nothing names an old path
}
if (mentions.length) {
  console.log('  still naming an old path (a string, not an import; change it by hand, or leave a frozen record as it is):');
  for (const path of mentions) console.log(`    ${path}`);
}
