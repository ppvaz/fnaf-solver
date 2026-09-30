# Generated architecture catalogs

Run `npm run catalog` to regenerate these checked-in inventories from package
manifests, source paths, the contract register, and the command surface. They
are migration maps, not a second manually edited authority. Review generated
diffs with their source changes. Contract specifications are generated for every
register entry and include purpose, non-purpose, clock/unit, unknown/error,
compatibility, runtime-validator, and fixture fields.
Catalog generation fails when a registered contract has no conformance fixture
or when a listed fixture path is absent, so a green catalog cannot silently
fall back to a generic test.

`reverse-links.json` is the generated reverse view for stable contract, ADR,
claim, and evidence references, including contract-to-fixture links. Run
`npm run test:retrieval` to execute the newcomer retrieval benchmark; it guards
the top-level routes without introducing a separately edited wiki or mandatory
search service.

`legacy-paths.json` is the generated compatibility/removal map. Each entry
names the lifecycle, canonical replacement owner, and evidence gate required
before a path can be deleted. It is intentionally generated from the registry
in `tools/generate-catalog.js`, not edited independently.

`control-catalog.json` is the per-game control catalog (LEG-007): for each
registered game, every semantic control with its aliases, allowed artifact
action kinds, touch binding, state preconditions and the fact that observes
it, plus the game's cameras and, for FNaF 2, the artifact action table the
device executor enforces. It is serialized from
`packages/core/src/control/catalog/`, the same objects `semantic-control-v1`,
the profile resolver and the executor generate their checks from.
