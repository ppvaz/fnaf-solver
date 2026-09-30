# Dependency direction

ADR 0002's rule, `kernel <- source <- play <- propose -> review -> source`, in
today's package names:

```text
kernel <-- core (source) <-- adapters, apps/device (play) <-- research (propose)
              ^                                                   |
              |                                                   v
              +------------------------------------------- review (review)

trainer (teach) --> core          every package may import kernel
an arrow points at what a package imports; review never imports play or propose
```

- **kernel** has no dependency and imports nothing in the repository: no
  workspace, no relative path out of itself, no Node built-in.
- **core** imports only itself and the kernel: no application, adapter,
  research, review, tools module, host or browser API, network, filesystem or
  wall clock. It becomes `packages/source` in migration M6.
- **adapters** depend on core and report measured limitations; **apps/device**
  composes them with a resolved, immutable profile that each run retains.
- **research** uses core and explicit simulation models, never the device
  shell (`apps/device`, `tools/device`, `child_process`, `net`, `dgram`).
- **review** uses core and the kernel and never `apps/device`,
  `packages/adapters` or `packages/research`. One edge is still open: it compiles
  a committed winner through `tools/device/bundle.mjs` (and so, transitively,
  the research seed helpers) to learn the hash a bundle records; it closes when
  `tools/device` is sorted by context (migration M9).
- **trainer** uses core only.

`tools/architecture-test.js` enforces every rule above over each module's
syntax tree (the pinned `typescript` parser), with planted violations -- a
dynamic `import()`, an aliased re-export, a `require()` -- that must be caught
before it reads the tree. The runtime package and the `screencheck` facade this
page used to show were retired on 2026-09-25
([archived routes](../ARCHIVED-ROUTES.md)); the root `src` compatibility imports
were removed after their equivalence gate.
