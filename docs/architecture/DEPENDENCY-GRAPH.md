# Dependency direction

ADR 0002's rule, `kernel <- source <- play <- propose -> review -> source`, in
today's package names:

```text
kernel <-- source <-- play <-- propose (research: its shim)
              ^                                                   |
              |                                                   v
              +------------------------------------------- review (review)

trainer (teach) --> source            every package may import kernel
core: registered shims only, each re-exporting kernel, source, play or propose
an arrow points at what a package imports; review never imports play or propose
```

- **kernel** has no dependency and imports nothing in the repository: no
  workspace, no relative path out of itself, no Node built-in.
- **source** imports only itself and the kernel.
- **core** holds only compatibility shims (`/contracts`, `/mechanics`,
  `/control`, `/sensing`), each registered in `legacy-paths.json` with its
  removal gate. It imports only itself, source and the kernel, except that a
  shim registered as owned by `@sixam/propose` or `@sixam/play` may re-export
  its owner: `/control` re-exports propose, `/sensing` re-exports
  `@sixam/play/sim`.
- **play** (`@sixam/play`) imports only itself, the kernel, source and Node
  built-ins. It holds the phone's transports, clocks and night onset, and the
  deprecated FNaF 2 grid/luma rules; nothing in a package imports it but
  propose. It also holds the campaign: the
  executor, the state machine, the runner and its ports. **apps/desktop** is
  the composition root: its command line composes play with a resolved,
  immutable profile (`packages/play/profiles/fnaf2/moto-g56/`) that each run retains, and it
  serves the `fnaf-solver` MCP server. Applications may import any package.
- **propose** imports the kernel, source, play and review, and never the
  device shell (the applications, `tools/`, `child_process`, `net`, `dgram`).
  Nothing imports propose except the applications.
- **review** uses the kernel and source and never `packages/play`, an
  application or `packages/propose`. It holds the bench trace
  (`src/measure/`). The compiled winner hashes it needs come from the generated
  `winner-hashes.json`, not from compiling a winner (compiling is Propose's).
- **trainer** uses source and the kernel, and holds its own training records.

`tools/architecture-test.js` enforces every rule above over each module's
syntax tree (the pinned `typescript` parser), with planted violations -- a
dynamic `import()`, an aliased re-export, a `require()`, play or review
importing propose -- that must be caught before it reads the tree. The runtime package and the
`screencheck` facade this page used to show were retired on 2026-09-25
([archived routes](../ARCHIVED-ROUTES.md)); the root `src` compatibility imports
were removed after their equivalence gate.
