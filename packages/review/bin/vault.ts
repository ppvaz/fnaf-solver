#!/usr/bin/env node
// The vault's command line (packages/review/src/vault.ts holds the verbs): npm run vault -- <verb>.
// Exit status: 0 success, 1 refused/invalid, 2 usage or I/O error.
import { COMMANDS, KNOWN_FLAGS, Refused, usage } from '../src/vault.ts';

const command = process.argv[2];
if (!command || process.argv.includes('--help')) {
  console.error(usage);
  process.exit(process.argv.includes('--help') ? 0 : 2);
}
if (!Object.hasOwn(COMMANDS, command)) {
  console.error(`vault: unknown command ${command}`);
  process.exit(2);
}
const unknown = process.argv.slice(3).filter(value => value.startsWith('--') && !KNOWN_FLAGS.has(value));
if (unknown.length > 0) {
  console.error(`vault: unknown option ${unknown[0]}`);
  process.exit(2);
}

try {
  COMMANDS[command]();
} catch (error) {
  console.error(`vault: ${(error as Error).message}`);
  process.exit(error instanceof Refused ? 1 : 2);
}
