/**
 * `@sixam/propose`, ADR 0002's Decision context: the policy language, FNaF 2's
 * controllers and cycle machinery. Each game's policies are subpaths
 * (`@sixam/propose/games/policy-fnaf1.js`), because every one of them exports
 * its own `POLICIES`.
 */
export * from './policy/index.ts';
export * from './games/fnaf2/index.ts';
