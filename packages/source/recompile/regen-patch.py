#!/usr/bin/env python3
"""Regenerate mmfparser-chowdren-mobile.patch from the anaconda tree in the committed file order.

Each section is `git diff HEAD -- <path>` in the tree (base 9b00bb4), in the order
the committed patch lists its files; paths named with --add (new to the patch)
are appended, and a --add path git does not track yet is marked intent-to-add
(`git add -N`) first so it diffs as a new file. Unchanged sections regenerate
byte for byte. Then it checks the new patch against a pristine copy of the base:
it must apply (`patch --dry-run`, then for real into a scratch copy) and the
patched copy must equal the tree, file for file (cmp).

  regen-patch.py --tree ANACONDA --pristine DIR [--patch FILE] [--add PATH ...] [--out FILE] [--check-only]

--pristine is an extracted `git archive 9b00bb4` of the base; it is copied,
never modified. Prints the changed and appended sections and the verdict.
"""
import argparse
import filecmp
import os
import re
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_PATCH = os.path.join(HERE, 'mmfparser-chowdren-mobile.patch')


def sections(text):
    out = []
    for part in re.split(r'(?m)^(?=diff --git )', text):
        if not part.startswith('diff --git '):
            continue
        m = re.match(r'diff --git a/(\S+) b/', part)
        out.append((m.group(1), part))
    return out


def git(tree, *args):
    return subprocess.run(['git', '-C', tree] + list(args), check=True, capture_output=True).stdout.decode('utf-8', 'surrogateescape')


def verify(patch_text, paths, pristine, tree):
    work = tempfile.mkdtemp(prefix='regen-patch-')
    try:
        copy = os.path.join(work, 'base')
        shutil.copytree(pristine, copy, symlinks=True)
        for args in (['--dry-run'], []):
            r = subprocess.run(['patch', '-p1', '-s', '-d', copy, '--no-backup-if-mismatch'] + args,
                               input=patch_text.encode('utf-8', 'surrogateescape'), capture_output=True)
            if r.returncode != 0:
                return False, 'patch %s failed: %s' % (' '.join(args) or 'apply', (r.stdout + r.stderr).decode()[:400])
        differ = [p for p in paths
                  if not (os.path.exists(os.path.join(copy, p)) and
                          filecmp.cmp(os.path.join(copy, p), os.path.join(tree, p), shallow=False))]
        if differ:
            return False, 'patched base differs from the tree in: %s' % ', '.join(differ)
        return True, 'applies to the pristine base and reproduces %d files of the tree' % len(paths)
    finally:
        shutil.rmtree(work, ignore_errors=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--tree', required=True)
    ap.add_argument('--pristine', required=True)
    ap.add_argument('--patch', default=DEFAULT_PATCH)
    ap.add_argument('--add', action='append', default=[])
    ap.add_argument('--out')
    ap.add_argument('--check-only', action='store_true', help='verify --patch as it stands and write nothing')
    opts = ap.parse_args()
    old_text = open(opts.patch, encoding='utf-8', errors='surrogateescape').read()
    old = sections(old_text)
    if opts.check_only:
        ok, why = verify(old_text, [p for p, _ in old], opts.pristine, opts.tree)
        print(('OK: ' if ok else 'FAIL: ') + why)
        sys.exit(0 if ok else 1)
    order = [p for p, _ in old] + [p for p in opts.add if p not in {q for q, _ in old}]
    tracked = set(git(opts.tree, 'ls-files', '--', *order).split())
    for p in order:
        if p not in tracked:
            git(opts.tree, 'add', '-N', '--', p)
    new_parts, changed = [], []
    old_map = dict(old)
    for p in order:
        part = git(opts.tree, 'diff', 'HEAD', '--', p)
        if not part:
            print('warning: %s no longer differs from the base; section dropped' % p)
            continue
        new_parts.append(part)
        if p not in old_map:
            changed.append('appended ' + p)
        elif old_map[p] != part:
            changed.append('changed ' + p)
    new_text = ''.join(new_parts)
    ok, why = verify(new_text, [p for p in order if p in {q for q, _ in sections(new_text)}], opts.pristine, opts.tree)
    for c in changed:
        print(c)
    print('%d sections (%d changed or appended)' % (len(new_parts), len(changed)))
    print(('OK: ' if ok else 'FAIL: ') + why)
    if not ok:
        sys.exit(1)
    with open(opts.out or opts.patch, 'w', encoding='utf-8', errors='surrogateescape') as f:
        f.write(new_text)


if __name__ == '__main__':
    main()
