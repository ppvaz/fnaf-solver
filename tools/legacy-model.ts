// Preload (`node --import tools/legacy-model.ts SCRIPT`): every Sim the process builds runs the legacy model,
// fnaf2-legacy (every sourced* switch off), the Sim's default before 2026-10-02. tools/test.ts starts the
// engine checks that encode that model's facts through it, until the legacy branches are deleted and those
// checks are re-derived on the sourced model or archived. It imports only the injection and Source: a
// heavier graph reaches the very scripts it preloads for, and their main guards would run before the
// injection is in place.
import { LEGACY_SIM_OPTIONS } from '@sixam/source/fnaf2';
import { useModelOptions } from '@sixam/propose/model-options';

useModelOptions({ ...LEGACY_SIM_OPTIONS });
