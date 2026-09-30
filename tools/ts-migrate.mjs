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
//      a constructor or method assigns (`this.x = ...`) is declared with the
//      type the JavaScript checker already gave it. A JSDoc type is copied as
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
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 26 });
const [dirArg, ...flags] = process.argv.slice(2);
if (!dirArg) { console.error('usage: node tools/ts-migrate.mjs DIR [--dry]'); process.exit(2); }
const DRY = flags.includes('--dry');
const DIR = relative(ROOT, resolve(dirArg));
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
        edits.push({ start: at, end: node.getEnd(), text: `(${innerText} as ${typeText})` });
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
    // Fields a class assigns and never declares.
    if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) {
      const declared = new Set(node.members.map(member => member.name?.getText()).filter(Boolean));
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
      if (assigned.length) {
        const instance = checker.getDeclaredTypeOfSymbol(node.name ? checker.getSymbolAtLocation(node.name) : node.symbol);
        const first = node.members[0];
        const indent = first ? (text.slice(text.lastIndexOf('\n', first.getStart()) + 1, first.getStart()).match(/^\s*/)[0]) : '  ';
        const lines = assigned.map(name => {
          const prop = instance.getProperty(name);
          const typeText = prop ? checkerText(checker.getTypeOfSymbolAtLocation(prop, node), path, `field ${name}`) : 'any';
          return `${indent}${name}: ${typeText};\n`;
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
let rewritten = 0;
for (const path of scripts) {
  if (!existsSync(join(ROOT, path))) continue;
  const text = read(path);
  const next = text.replace(SPEC, (match, head, spec, tail) => {
    if (!movedAbs.has(resolve(ROOT, dirname(path), spec))) return match;
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
  const next = text.replace(/"(\.\/[^"]+)\.js"/g, (match, stem) =>
    movedAbs.has(join(ROOT, dirname(manifest), `${stem}.js`)) ? `"${stem}.ts"` : match);
  if (next !== text) { write(manifest, next); console.log(`  ${manifest}: exports name the .ts modules`); }
}
console.log(`  ${rewritten} relative specifiers now name a .ts module`);

// ---- what a person has to look at ------------------------------------------------------
for (const note of notes) console.log(`  note: ${note}`);
const mentions = git('grep', '-l', '-F', ...moving.flatMap(name => ['-e', name]), '--', '.', ':!docs/evidence', ':!*.md')
  .split('\n').filter(Boolean);
if (mentions.length) {
  console.log('  still naming an old path (a string, not an import; change it by hand, or leave a frozen record as it is):');
  for (const path of mentions) console.log(`    ${path}`);
}
