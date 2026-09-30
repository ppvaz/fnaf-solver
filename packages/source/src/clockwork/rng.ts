/**
 * The Fusion 16-bit RNG every game's Sim draws from, as the cross-game
 * clockwork names it. The implementation is `../games/fnaf2/rng.js`, beside
 * FNaF 2's `plant-model.js`, which imports it as `./rng.js`: the three model
 * sources (`plant-model.js`, `config.js`, `rng.js`) moved out of core byte for
 * byte, so they stay in one directory until migration step D2 splits
 * `plant-model.js`; then `rng.js` moves here.
 */
export * from '../games/fnaf2/rng.ts';
