# Dependency direction

ADR 0002's rule, `kernel <- source <- play <- propose -> review -> source`, in
today's package names:

```text
kernel <-- source <-- play, core, apps/device (play) <-- propose (research: its shim)
              ^                                                   |
              |                                                   v
              +------------------------------------------- review (review)

trainer (teach) --> core, source      every package may import kernel
an arrow points at what a package imports; review never imports play or propose
```

- **kernel** has no dependency and imports nothing in the repository: no
  workspace, no relative path out of itself, no Node built-in.
- **source** imports only itself and the kernel.
- **core** imports only itself, source and the kernel: no application, adapter,
  propose, research, review, tools module, host or browser API, network,
  filesystem or wall clock. What it still holds is Play's host-free half
  (sensing, estimation, the phase clock), the bench trace and training. Its
  `/control` subpath is a compatibility shim that re-exports propose, the one
  re-export of propose a package may carry (it is registered in
  `legacy-paths.json`, owned by `@sixam/propose`).
- **play** (`@sixam/play`) imports only itself, the kernel, source and Node
  built-ins. It holds the phone's transports, clocks and night onset, and the
  deprecated FNaF 2 grid/luma rules; nothing in a package imports it but
  propose and a compatibility path registered as owned by `@sixam/play`
  (`packages/adapters` keeps one link). **apps/device** composes it with a
  resolved, immutable profile that each run retains.
- **propose** imports the kernel, source, play, core's Play modules and review,
  and never the device shell (the applications, `tools/`,
  `child_process`, `net`, `dgram`). Nothing imports propose except the
  applications and the registered shims. **research** is an empty
  compatibility shim: its two registered modules only re-export propose, for
  the engine-source files a bundle hashes.
- **review** uses the kernel, source and core and never `packages/play`, an
  application, `packages/adapters`, `packages/propose` or `packages/research`. One edge is
  still open: it compiles a committed winner through `tools/device/bundle.mjs`
  (and so, transitively, the research seed helpers and propose's controllers)
  to learn the hash a bundle records; it closes when `tools/device` is sorted by
  context (migration M9).
- **trainer** uses core, source and the kernel.

`tools/architecture-test.js` enforces every rule above over each module's
syntax tree (the pinned `typescript` parser), with planted violations -- a
dynamic `import()`, an aliased re-export, a `require()`, a core module
importing propose, a registered shim importing rather than re-exporting it --
that must be caught before it reads the tree. The runtime package and the
`screencheck` facade this page used to show were retired on 2026-09-25
([archived routes](../ARCHIVED-ROUTES.md)); the root `src` compatibility imports
were removed after their equivalence gate.
