// The modules a source file loads or re-exports, read from its syntax tree: the one reader the
// architecture gate and the workspace-manifest gate share, so a form one counts the other counts too.
import ts from 'typescript';

/** A source file's syntax tree, as JavaScript or TypeScript by its name. */
export function parse(path: string, source: string) {
  return ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true,
    path.endsWith('.ts') ? ts.ScriptKind.TS : ts.ScriptKind.JS);
}

/**
 * Every module the file loads or re-exports. `specifier` is null when the
 * parser cannot know it (a computed dynamic import or require).
 */
export function moduleReferences(file: ts.SourceFile): {specifier: string | null, form: string}[] {
  const found: {specifier: string | null, form: string}[] = [];
  const literal = (node: ts.Node | undefined) => node && ts.isStringLiteralLike(node) ? node.text : null;
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) found.push({ specifier: literal(node.moduleSpecifier), form: 'import' });
    else if (ts.isExportDeclaration(node) && node.moduleSpecifier)
      found.push({ specifier: literal(node.moduleSpecifier), form: 're-export' });
    else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference))
      found.push({ specifier: literal(node.moduleReference.expression), form: 'import-equals' });
    else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument))
      found.push({ specifier: literal(node.argument.literal), form: 'import-type' });
    else if (ts.isCallExpression(node)) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword)
        found.push({ specifier: literal(node.arguments[0]), form: 'dynamic-import' });
      else if (ts.isIdentifier(node.expression) && node.expression.text === 'require')
        found.push({ specifier: literal(node.arguments[0]), form: 'require' });
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}
