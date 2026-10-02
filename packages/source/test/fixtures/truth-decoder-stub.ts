// A stand-in for the CTFAK CLI in the truth decode tests: run as `node truth-decoder-stub.ts <the
// CTFAK CLI's arguments>`, the way decode runs `dotnet CTFAK.Cli.dll <arguments>`. It checks it was
// asked for the event-text dumper on a CCN, and writes the synthetic dump (never a game's) to the
// file CTFAK_EVENT_DUMP names, as EventTextDumper.cs does.
import { readFileSync, writeFileSync } from 'node:fs';
import { syntheticDump } from './truth-dump.ts';

const args = process.argv.slice(2);
const value = (flag: string) => args[args.indexOf(flag) + 1];
if (value('-tool') !== 'Event Text Dumper' || value('-forcetype') !== 'ccn' || !args.includes('-closeonfinish')) {
  console.error(`stub: unexpected arguments ${JSON.stringify(args)}`);
  process.exit(3);
}
if (readFileSync(value('-path')).subarray(0, 4).toString('latin1') !== 'PAMU') {
  console.error('stub: -path is not a CCN');
  process.exit(4);
}
writeFileSync(process.env.CTFAK_EVENT_DUMP as string, syntheticDump());   // decode sets it for the dumper
