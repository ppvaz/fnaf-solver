#!/usr/bin/env node
// The model verdicts on the committed FNaF 2 winners: packages/propose/bindings/fnaf2/gates.json.
//
// A winner's identity is its plan; its replay under the Sim is a verdict under one model
// (FNAF2_MODEL, packages/source/src/games/fnaf2/plant-options.ts). The register holds one section per
// model, in the order the models were introduced, and compileBundle checks a committed winner's replay
// against its section for the model the Sim runs. A change that moves a replay takes a new model id and
// measures every winner under it here, in the same diff; a section is never re-measured in place, since
// that would turn the gate into whatever the code now does.
//
//   node packages/propose/bindings/gates.ts                                  each custody winner against the register
//   node packages/propose/bindings/gates.ts --measure --description TEXT     add the current model's section
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FNAF2_MODEL } from '@sixam/source/fnaf2';
import { custodyWinnerFiles } from '@sixam/review/evidence-pack';
import { GATES_FILE, GATES_SCHEMA, WINNER_SCHEMA, measureWinner, readGateRegister } from '../bin/plans/bundle.ts';
import type { GateRegister } from '../bin/plans/bundle.ts';

const ROOT = resolve(join(fileURLToPath(new URL('.', import.meta.url)), '../../..'));

/** Every committed FNaF 2 winner-v1, active and retired: custody reads both. */
export function gatedWinnerFiles(root = ROOT) {
  return custodyWinnerFiles(root).filter(file => file.includes('/fnaf2/') &&
    JSON.parse(readFileSync(join(root, file), 'utf8')).schema === WINNER_SCHEMA);
}

/** The current model's section, measured from the Sim as it runs now. */
export function measureSection(register: GateRegister, description: string, root = ROOT) {
  if (register.models.some(section => section.model === FNAF2_MODEL))
    throw new Error(`gates: model ${FNAF2_MODEL} is already measured; a change that moves a replay takes a new FNAF2_MODEL`);
  const gates = gatedWinnerFiles(root).map(file => ({ file, ...measureWinner(JSON.parse(readFileSync(join(root, file), 'utf8')), register) }));
  return { model: FNAF2_MODEL, description, gates };
}

function main(argv: readonly string[]) {
  if (argv.includes('--measure')) {
    const at = argv.indexOf('--description');
    const description = at >= 0 ? argv[at + 1] : undefined;
    if (!description) throw new Error('gates: --measure needs --description TEXT naming what the model is');
    let register: GateRegister;
    try { register = readGateRegister(); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      register = { schema: GATES_SCHEMA, models: [] };
    }
    const section = measureSection(register, description);
    writeFileSync(GATES_FILE, `${JSON.stringify({ ...register, models: [...register.models, section] }, null, 2)}\n`);
    console.log(`gates: measured ${section.gates.length} winners under ${FNAF2_MODEL}`);
    return 0;
  }
  const register = readGateRegister();
  let failed = 0;
  for (const file of gatedWinnerFiles()) {
    const measured = measureWinner(JSON.parse(readFileSync(join(ROOT, file), 'utf8')), register);
    const current = register.models.find(section => section.model === FNAF2_MODEL)?.gates
      .find(gate => gate.winnerHash === measured.winnerHash);
    const status = !current ? `MISSING under ${FNAF2_MODEL}`
      : current.replayHash !== measured.replayHash ? `DRIFT ${current.replayHash} -> ${measured.replayHash}`
        : current.compiledWinnerHash !== measured.compiledWinnerHash ? `IDENTITY ${current.compiledWinnerHash} -> ${measured.compiledWinnerHash}`
          : 'ok';
    if (status !== 'ok') failed = 1;
    console.log(`${basename(file).replace(/-winner\.json$/, '').padEnd(34)} ${measured.replayHash} ${status}`);
  }
  return failed;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) process.exit(main(process.argv.slice(2)));
