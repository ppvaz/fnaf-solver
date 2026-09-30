# Dependency direction

```text
                         @sixam/core
                         /       |       \
             runtime / adapters  research  trainer
                         ^          ^        ^
                         |          |        |
                    apps/device composition root
```

Core has no application, adapter, shell, DOM, process, network, filesystem, or
wall-clock dependency. Adapters implement ports and report measured
limitations. Device profile resolution is immutable and retained in each run.
The root `src` compatibility imports have been removed after the equivalence
gate. Explicitly named legacy device and screencheck facades remain only for
characterization and are not package dependencies.
