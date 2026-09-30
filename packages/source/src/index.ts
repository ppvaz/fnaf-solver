/**
 * @sixam/source: Truth (ADR 0002). The package root is the cross-game
 * clockwork -- the nights registry and night model, the Fusion RNG, the
 * control catalogs with their vocabulary, and the contract validators
 * generated from them. Each game's Rulebook data, Sim and controls are its
 * own subpath: `@sixam/source/fnaf1` .. `/fnaf4`, and any of their files
 * under `@sixam/source/games/<game>/`. Source imports only the kernel
 * (tools/architecture-test.js).
 */
export * from './clockwork/index.ts';
