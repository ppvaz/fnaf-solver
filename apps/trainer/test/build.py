#!/usr/bin/env python3
"""Inline the ES modules and CSS into one self-contained dist/index.html.

The trainer has no dependencies and no build step for development (just serve
the folder). This exists so the page can be opened from a phone or published as
a single file.
"""
import base64, json, re, pathlib, sys

ROOT = pathlib.Path(__file__).resolve().parents[3]
SRC = ROOT / 'apps' / 'trainer' / 'src'
ENTRY = 'apps/trainer/src/main.js'

IMPORT_NS = re.compile(r"^import \* as (\w+) from ['\"]([^'\"]+)['\"];\s*$", re.M)
IMPORT_NAMED = re.compile(r"^import \{([^}]*)\} from ['\"]([^'\"]+)['\"];\s*$", re.M)
EXPORT_STAR = re.compile(r"^export \* from ['\"]([^'\"]+)['\"];\s*$", re.M)
# `export { a, b as c } from './x.js';` -- a named re-export. The kernel's and
# core's barrels use it; before 2026-09-29 this bundler stripped only the
# `export ` keyword from it and left `{ ... } from '...';` in the bundle, a
# syntax error that blanked the built trainer.
EXPORT_FROM = re.compile(r"^export \{([^}]*)\} from ['\"]([^'\"]+)['\"];\s*$", re.M)
EXPORT_DECL = re.compile(r"^export\s+(async\s+function|function|class|const|let)\s+(\w+)", re.M)
EXPORT_LIST = re.compile(r"^export \{([^}]*)\};\s*$", re.M)


def _workspaces():
    """Every workspace package by name: its directory and its `exports` map."""
    found = {}
    for group in ('packages', 'apps'):
        for directory in sorted((ROOT / group).iterdir()):
            manifest = directory / 'package.json'
            if manifest.is_file():
                data = json.loads(manifest.read_text())
                found[data['name']] = (directory, data.get('exports', {}))
    return found


WORKSPACES = _workspaces()


def workspace_target(spec):
    """Resolve a workspace specifier through its package.json `exports`, the way
    Node does for the two forms this repository writes: an exact subpath and a
    trailing-`*` subpath pattern. A subpath the package does not export fails."""
    parts = spec.split('/')
    name = '/'.join(parts[:2]) if spec.startswith('@') else parts[0]
    if name not in WORKSPACES:
        return None
    directory, exports = WORKSPACES[name]
    if isinstance(exports, str):
        exports = {'.': exports}
    subpath = '.' + spec[len(name):]
    if subpath in exports:
        return directory / exports[subpath]
    for key, value in exports.items():
        if key.endswith('*') and subpath.startswith(key[:-1]):
            return directory / value.replace('*', subpath[len(key) - 1:])
    raise RuntimeError(f"{name} does not export {subpath!r} (asked for {spec!r})")


def resolve_path(path, spec):
    """Resolve an ESM edge: a relative path, or a workspace package's export."""
    if spec.startswith('.'):
        target = (path.parent / spec).resolve()
    else:
        target = workspace_target(spec)
        if target is None:
            raise RuntimeError(f"trainer bundle cannot resolve bare import {spec!r} from {path}")
    if target.suffix != '.js':
        target = target.with_suffix('.js')
    if not target.exists():
        raise RuntimeError(f"{path.relative_to(ROOT)} imports missing {spec}")
    return target.resolve()


def canonical_path(path, seen=None):
    """Collapse a compatibility `export *` shim to its core implementation."""
    seen = set() if seen is None else seen
    path = path.resolve()
    if path in seen:
        raise RuntimeError(f"compatibility export cycle at {path}")
    seen.add(path)
    source = path.read_text()
    matches = EXPORT_STAR.findall(source)
    if len(matches) == 1 and not re.search(r"^export\s+(?:async\s+function|function|class|const|let|\{)", source, re.M):
        return canonical_path(resolve_path(path, matches[0]), seen)
    return path


def module_name(path):
    return path.relative_to(ROOT).as_posix()


def transform(name, path, code):
    def ns(match):
        dep = module_name(canonical_path(resolve_path(path, match.group(2))))
        return f"const {match.group(1)} = __req('{dep}');"

    def named(match):
        dep = module_name(canonical_path(resolve_path(path, match.group(2))))
        # `import { a as b }` destructures as `{ a: b }`.
        names = ', '.join(part.strip().replace(' as ', ': ') for part in match.group(1).split(',') if part.strip())
        return f"const {{ {names} }} = __req('{dep}');"

    def reexport(match):
        dep = module_name(canonical_path(resolve_path(path, match.group(2))))
        pairs = []
        for part in match.group(1).split(','):
            local, _, exported = part.strip().partition(' as ')
            if local:
                pairs.append(f"{(exported or local).strip()}: __t.{local.strip()}")
        return f"{{ const __t = __req('{dep}'); Object.assign(__x, {{ {', '.join(pairs)} }}); }}"

    code = IMPORT_NS.sub(ns, code)
    code = IMPORT_NAMED.sub(named, code)
    code = EXPORT_FROM.sub(reexport, code)
    # A core barrel can be included by a future trainer module. Preserve its
    # explicit re-export semantics in the tiny bundle runtime.
    def star(match):
        dep = module_name(canonical_path(resolve_path(path, match.group(1))))
        return f"Object.assign(__x, __req('{dep}'));"

    code = EXPORT_STAR.sub(star, code)
    names = [m.group(2) for m in EXPORT_DECL.finditer(code)]
    for m in EXPORT_LIST.finditer(code):
        names += [n.strip() for n in m.group(1).split(',') if n.strip()]
    code = EXPORT_LIST.sub('', code)
    code = re.sub(r"^export\s+", '', code, flags=re.M)
    names = sorted(set(names))
    tail = f"\nObject.assign(__x, {{ {', '.join(names)} }});\n" if names else ''
    return f"__def('{name}', function(__x, __req) {{\n{code}\n{tail}}});\n"


def resolve(entry=ENTRY):
    """Depth-first module order derived from the imports themselves, so adding a
    new module never needs a hand-maintained list."""
    order, seen, stack = [], set(), set()

    def visit(path):
        path = canonical_path(path)
        name = module_name(path)
        if name in order:
            return
        if name in stack:
            raise RuntimeError(f'import cycle involving {name}')
        stack.add(name)
        source = path.read_text()
        for spec in IMPORT_NS.findall(source) + IMPORT_NAMED.findall(source):
            visit(resolve_path(path, spec[1]))
        for spec in EXPORT_STAR.findall(source):
            visit(resolve_path(path, spec))
        for spec in EXPORT_FROM.findall(source):
            visit(resolve_path(path, spec[1]))
        stack.discard(name)
        seen.add(name)
        order.append(name)

    visit((ROOT / entry).resolve())
    stray = {module_name(p) for p in SRC.glob('*.js')} - seen
    if stray:
        print(f'note: not bundled (nothing imports them): {sorted(stray)}', file=sys.stderr)
    return order


FONT_URL = re.compile(r"url\(([^)]+\.woff2)\)")


def inline_fonts(css, css_source):
    """Turn the @font-face file references into data URIs.

    The dev page loads the woff2 files straight off disk; dist/index.html has to
    be one file, so the bytes come along inside the CSS."""
    def sub(m):
        data = base64.b64encode((css_source.parent / m.group(1)).resolve().read_bytes()).decode()
        return f"url(data:font/woff2;base64,{data})"
    return FONT_URL.sub(sub, css)


def main():
    html = (ROOT / 'index.html').read_text()
    css = inline_fonts((SRC / 'fonts.css').read_text(), SRC / 'fonts.css') + '\n' + (SRC / 'style.css').read_text()

    shim = ("const __m={};const __def=(n,f)=>__m[n]={f,x:null};"
            "const __req=(n)=>{const m=__m[n];"
            "if(!m)throw new Error('module not bundled: '+n);"
            "if(!m.x){m.x={};m.f(m.x,__req);}return m.x;};\n")
    order = resolve()
    bundle = shim + ''.join(transform(n, ROOT / n, (ROOT / n).read_text()) for n in order) + f"__req('{module_name(canonical_path((ROOT / ENTRY).resolve()))}');\n"

    html = html.replace('<link rel="stylesheet" href="apps/trainer/src/fonts.css">\n', '')
    html = html.replace('<link rel="stylesheet" href="apps/trainer/src/style.css">', f'<style>\n{css}\n</style>')
    html = html.replace('<script type="module" src="apps/trainer/src/main.js"></script>', f'<script>\n{bundle}\n</script>')

    out = ROOT / 'dist'
    out.mkdir(exist_ok=True)
    (out / 'index.html').write_text(html)
    kb = len(html.encode()) / 1024
    print(f'dist/index.html  {kb:.0f} KB  ({len(order)} modules)')
    # data: URIs are self-contained -- they are the point of inlining, not a
    # dangling reference.
    leftover = re.findall(r'(?:src|href)="(?!https?:|data:|#)[^"]*"', html)
    if leftover:
        print(f'WARNING: unresolved local reference(s): {leftover}', file=sys.stderr)


main()
