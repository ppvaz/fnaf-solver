# `@sixam/kernel`

The shared kernel of [ADR 0002](../../docs/decisions/0002-kernel-contexts-vocabulary.md),
holding only the types that have a consumer today. Every context shares them,
and they change only by a later ADR.

| Type | What it is | Consumer today |
|---|---|---|
| `Unknown` | `UNKNOWN(reason)`: a value with a reason, never a default (principle 2) | every other type; the pack lift |
| `Interval` | `{lo, hi}`, a value known only to lie between two bounds | `Outcome`'s `Death.at` (Ms from the night's origin) |
| `ClaimLevel` | `MODEL_ONLY \| FIXTURE \| DEVICE_MEASURED`, closed | the promotions query (promoted claims, MODEL_ONLY winners) |
| `SourceLabel` | `SOURCED \| CALIBRATED \| MEASURED \| INFERRED \| MODEL \| UNKNOWN(reason)`, closed | the `UNKNOWN(reason)` value the lift writes |
| `Outcome` | `SixAM \| Death{by, how, rule, at} \| Timeout \| Aborted(why) \| Invalid(why) \| UNKNOWN`, plus `wouldDie[]` | `GameRun.reportedOutcome` |
| `Seed` | provenance `natural \| pinned(bracket) \| identified` and belief `known \| candidates(set) \| unknown` (`src/seed.ts`; not "origin", which is a night's time zero) | the experiment-spec-v2 seed set: which kind of night a census population stands for |
| `GameRun` | one night played once: spec, venue, runMode, clocks, before/night/after events, reported outcome, witnesses, custody `{class: complete \| recovered, lost[]}` | `packages/review` lifts every committed run pack into one |
| `VenueIdentity` (`venue-identity-v1`) | the world under a phone venue, read at preflight: game package, `versionName`/`versionCode`, first-install and last-update time, build fingerprint, security patch, `handsetHash` (never the serial), Companion version, time zone; an unread field is null with its reason. v1 does not yet carry the ADR's runtime, placement and instrumentation | the adb bridge's preflight, `venue-binding-v1`, `qualification-v2` and the campaign result's venue check |
| `Annotation` | `{subject, instrument@version, class \| measure \| tag, value, inputs, by, status: standing \| superseded \| retracted}`, with a wide subject | the promotions query writes one per `PROMOTED_BY` edge |
| `ClaimEnvelope` (`claim-envelope-v1`) | an answer: `{claim, label, target, cite[], status, supersededBy, notMeasured[], reproducer}`, or a refusal `{refused: true, rule, because, cite[], remedy}`. `label` is a `ClaimLevel`, a named `SourceLabel` or `UNKNOWN(reason)`, never missing or bare; a claim holding any UNKNOWN value must name what it does not measure. v1 under ADR 0002 ("the claim envelope until Plan 28 lands"), registered in `contracts/register.json` | the fnaf-solver MCP verbs and resources, `npm run review`, and `npm run evidence -- show\|promotions --envelope` |

The two label enums never promote one another. `GameRun.spec` and `clocks`
carry the source record's own fields, or `UNKNOWN(reason)`, until RunSpec and
ClockTrace enter the kernel; `GameRun.venue` carries the preflight's
`venue-check-v1`, whose `observed` is a `VenueIdentity`, or `UNKNOWN(reason)`.

The sources are TypeScript that Node runs by type stripping (Pedro,
2026-09-30: "runtime .ts"; the kernel moved first, on that day). Shapes other
contexts read are in `src/types.ts` and `src/contracts/types.ts`, checked by the
strict `typecheck` lane, as the modules are;
the frozen enums, constructors (`unknown`, `interval`, `sixAm`, `death`,
`timeout`, `aborted`, `invalid`) and validators (`validateClaimLevel`,
`validateSourceLabel`, `validateInterval`, `validateOutcome`,
`validateGameRun`, `validateAnnotation`), and the claim envelope's constructors and validator
(`claimEnvelope`, `refusalEnvelope`, `validateClaimEnvelope`, `unknownsIn`, `src/claim-envelope.ts`) are
in `src/index.ts`.

## Contracts and Time (from `@sixam/core`, ADR 0002 migration D1)

| Path | What it is |
|---|---|
| `src/contracts/` (`@sixam/kernel/contracts`) | the runtime validators of the versioned plain-data contracts every context shares: clock refs, profiles, qualification v1/v2, venue identity, check and binding, the campaign result and save proof, telemetry, session manifest, artifact refs, experiment spec and result v1 and v2 (`experiment.ts`: competing explanations, seed sets with their derivation and provenance, a named held-out block, rates with an `Interval` and their method), `canonicalJson` and `stableHash`; compile-time shapes in `src/contracts/types.ts` |
| `contracts/register.json` | the contract register: every contract id, its owner, kind and validator ([`contracts/README.md`](contracts/README.md)) |
| `src/time/` (`@sixam/kernel/time`) | `Interval`, the declared clock of every campaign timestamp (`event-clocks.ts`), the bounded fact link (`fact-link.ts`, `fact-message-v1`) and the clock port (`ports.ts`) |
| `src/py.ts` | `@sixam/kernel/py`: the entry for `pyfmt`, `pyargs`, `pyjson`, `pystats` and `pywave`, the helpers the scripts ported from Python use; kept out of `src/index.ts`, which the trainer bundles for the browser, where none of it runs |
| `src/pyfmt.ts` | Python's printing and reading, for the scripts ported from Python, whose output keeps its bytes: `pyFixed` (`format(x, '.Nf')`, exact ties to even), `pyRepr` (`repr` of a float), `pyPath` (`str(Path(text))`), and `pyDumps` (`json.dumps`, with `indent`), where `PyFloat` marks a whole float that Python wrote as `1.0`; `pySplit`, `pySplitLines`, `pyFloat`, `pyInt` and `pyRound` (`str.split()`, `str.splitlines()`, `float()`, `int()` in base 10 or 16 and `round()`, null where Python raised); `pyDumps` also takes `sortKeys`, `separators` and `ensureAscii` (json.dumps's `sort_keys`, `separators` and `ensure_ascii`) and prints a bigint as the int it was; `pyAlign` (`format(text, '<N')`, `'>N'`, `'^N'`, padded by code points); `pyRegExp` (a Python `re` pattern as a JavaScript one: Unicode `\d`, `\s`, `\w` and `\b`, `.` short of a newline, `$` also before a final newline, `(?P<name>`), built on the exported `PY_SPACE`, `PY_NOT_SPACE` and `PY_WORD` classes; `pyCompare` (Python's code-point ordering of str, as a sort comparator) |
| `src/pyargs.ts` | `pyArgs`: a command line as Python's argparse read it (unique prefixes, `--name=value`, negative numbers and `-` as values, `--`, append, required, choices, int and float types, a positional with choices and a last one taking the rest as `nargs='*'` or `'+'` does; `known` returns what `parse_known_args` left over); `pySubcommands`: `add_subparsers(dest, required=True)`, the main parser taking the command and what nobody recognised, refused with argparse's messages and exit 2, and `pyArgsError` for a script's own `parser.error` after the parse, for the scripts ported from Python |
| `src/pyjson.ts` | `pyLoads` and `pyLoadsBytes`: JSON as Python's `json.loads` read it (an int stays an int at any size, a float a `PyFloat`, an object a `Map` in key order, NaN and the infinities, a body's encoding detected and decoded with `surrogatepass`), refused with the `JSONDecodeError` or codec message CPython gives; `pyReprOf` and `pyStrRepr`: `repr()` of those values; `pyStr`, `pyTruthy` and `pyEquals`: `str()`, `bool()` and `==` over them (`True == 1 == 1.0`), with `pyIsList` and `pyIsDict` to narrow them; `pyDecodeUtf8`: `bytes.decode('utf-8')` with `strict`, `surrogatepass` or `replace`, and `pyReadText`: what `open(path).read()` returns (decoded, universal newlines); `pyGet`, `pyItem` (with `PyKeyError`), `pyLen` and `pySum`: `dict.get`, `dict[key]`, `len()` and `sum()` over them, and `pyCompareNumbers`: Python's exact ordering of bools, ints and floats |
| `src/pystats.ts` | `pyCsvRows` and `pyCsvDicts`: a CSV as Python's `csv.reader` and `csv.DictReader` read it (excel dialect, `_csv.c`'s state machine, refusals as `PyCsvError`); `pyMedian` and `pyPstdev`: `statistics.median` (an int stays an int) and `statistics.pstdev` (exact over rationals, then correctly rounded) |
| `src/pywave.ts` | `pyWave`: a WAV file as Python 3.12's `wave` module reads it (RIFF/WAVE, chunks skipped to the first `data`, PCM or WAVE_FORMAT_EXTENSIBLE PCM), refused with its `wave.Error` (`PyWaveError`) or `EOFError` (`PyEOFError`) messages |

The validators generated from the per-game control catalogs
(`validateControlCommand`, `deviceProfileGame`, `resolveDeviceProfile`) stay
beside the catalogs, outside the kernel, because the kernel imports nothing.
The `@sixam/core` subpaths that re-exported all of this were removed on
2026-09-30, when nothing imported them any more.

Public API: the package root, `./contracts` and `./time`. Dependencies: none,
and it imports nothing in the repository -- no workspace, no relative path out
of itself, no Node built-in; every package may import it
(`tools/architecture-test.ts`). Tests: `test/kernel.test.js` in `test:unit`;
`test/claim-envelope.test.js`, the claim envelope's contract test,
`test/venue-identity.test.js`, and `test/experiment-v2.test.js`, the contract test
of experiment spec and result v2 and of the Seed, in `test:contracts`.

## Scripts

Entry points and checks that lived in `tools/` until the ADR 0002 layout
moved them here, with the description their tool index gave them.

| Script | Kind | What it does |
|---|---|---|
| `packages/kernel/test/contract-vectors.py` | check | Dependency-free cross-language reader for the shared valid/invalid semantic-control and measurement JSONL vectors. |
| `packages/kernel/test/factlinktest.ts` | check | Phone-free Plan 20 package 6 foundation: bounded newline-delimited fact messages preserve event/transport timestamps, ordered receipt surfaces sequence loss and staleness, and `SafeCycleHandoff` drains only an already-approved bounded cycle after link loss or stops at expiry. It does not claim USB-CDC timing, MCU firmware, or external-HID acceptance. |
