#!/usr/bin/env node
// Every workspace package a module imports is declared in the manifest of the workspace that holds it:
// packages/<name>/ and apps/<name>/ in their own package.json, everything else (tools/, root files) in
// the root's. An undeclared import resolves only because npm hoists every workspace into one
// node_modules: the desktop imported @sixam/propose, the wiki had no manifest at all and tools/ imported
// @sixam/review and @sixam/source, and none of that was written where a reader or a packer would see it.
//
//   node tools/test-workspace-deps.ts     exit 0 when every import is declared, 1 naming each that is not
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { isRecord, present } from '@sixam/kernel';
import { ROOT, repoFiles, report } from './gate-kit.ts';
import { moduleReferences, parse } from './module-refs.ts';

const SCOPE = '@sixam/';
const CODE = /\.(?:m?js|cjs|ts|mts)$/;

/** A workspace: its directory ('' for the root), its package name and what its manifest declares. */
interface Workspace { readonly dir: string, readonly name: string, readonly declared: ReadonlySet<string> }

function manifest(root: string, dir: string): Workspace {
  const record: unknown = JSON.parse(readFileSync(join(root, dir, 'package.json'), 'utf8'));
  if (!isRecord(record) || typeof record.name !== 'string') throw new Error(`${join(dir, 'package.json')} names no package`);
  const declared = new Set<string>();
  for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
    const table = record[field];
    if (isRecord(table)) for (const name of Object.keys(table)) declared.add(name);
  }
  return { dir, name: record.name, declared };
}

/** The root and every workspace under packages/ and apps/ that has a manifest. */
export function workspaces(root: string): Workspace[] {
  const found = [manifest(root, '')];
  for (const group of ['packages', 'apps'])
    for (const name of existsSync(join(root, group)) ? readdirSync(join(root, group)).sort() : [])
      if (existsSync(join(root, group, name, 'package.json'))) found.push(manifest(root, `${group}/${name}`));
  return found;
}

/** The workspace a file belongs to: the deepest one whose directory holds it, else the root. */
const ownerOf = (spaces: readonly Workspace[], path: string) =>
  spaces.filter(space => space.dir && path.startsWith(`${space.dir}/`)).sort((a, b) => b.dir.length - a.dir.length)[0]
  ?? present(spaces.find(space => space.dir === ''), 'root workspace');   // the root is always listed first

/** Every import of a workspace package its file's workspace does not declare, as `file -> package`. */
export function undeclared(root: string, files: readonly string[]) {
  const spaces = workspaces(root);
  const packages = new Set(spaces.filter(space => space.dir).map(space => space.name));
  const missing: string[] = [];
  for (const file of files) {
    if (!CODE.test(file) || file.endsWith('.d.ts')) continue;
    const owner = ownerOf(spaces, file);
    const seen = new Set<string>();
    for (const { specifier } of moduleReferences(parse(file, readFileSync(join(root, file), 'utf8')))) {
      if (!specifier?.startsWith(SCOPE)) continue;
      const name = specifier.split('/').slice(0, 2).join('/');
      if (!packages.has(name) || name === owner.name || owner.declared.has(name) || seen.has(name)) continue;
      seen.add(name);
      missing.push(`${file} -> ${name} (declare it in ${owner.dir ? `${owner.dir}/` : ''}package.json)`);
    }
  }
  return missing;
}

test('every @sixam/* import is declared by its workspace', async () => {
  // Planted: a package importing a sibling it does not declare, one that declares it, a self-import and a
  // root-held tool, over a throwaway tree.
  {
    const { mkdtempSync, mkdirSync, rmSync, writeFileSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const dir = mkdtempSync(join(tmpdir(), 'workspace-deps-'));
    try {
      const write = (path: string, text: string) => { mkdirSync(join(dir, path, '..'), { recursive: true }); writeFileSync(join(dir, path), text); };
      write('package.json', JSON.stringify({ name: 'root', workspaces: ['packages/*'], dependencies: { '@sixam/a': '*' } }));
      write('packages/a/package.json', JSON.stringify({ name: '@sixam/a' }));
      write('packages/b/package.json', JSON.stringify({ name: '@sixam/b', dependencies: { '@sixam/a': '*' } }));
      write('packages/c/package.json', JSON.stringify({ name: '@sixam/c' }));
      write('packages/a/src/x.ts', "import { y } from '@sixam/a/y';\nexport const x = y;\n");
      write('packages/b/src/x.ts', "export { a } from '@sixam/a';\n");
      write('packages/c/src/x.ts', "const a = await import('@sixam/a');\nimport type { B } from '@sixam/b';\n");
      write('tools/t.ts', "import { a } from '@sixam/a';\nimport { b } from '@sixam/b';\n");
      const files = ['packages/a/src/x.ts', 'packages/b/src/x.ts', 'packages/c/src/x.ts', 'tools/t.ts'];
      assert.deepEqual(undeclared(dir, files).map(line => line.split(' (')[0]),
        ['packages/c/src/x.ts -> @sixam/a', 'packages/c/src/x.ts -> @sixam/b', 'tools/t.ts -> @sixam/b'],
        'an undeclared dynamic import, an undeclared type import and an undeclared root import are refused; a declared one and a self-import pass');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  const files = repoFiles(ROOT).filter(file => CODE.test(file));
  report('workspace-deps', undeclared(ROOT, files),
    `${files.length} modules; every @sixam/* import is declared by the workspace that holds it (planted refusals fire)`);
});
