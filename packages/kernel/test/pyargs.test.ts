// pyArgs against Python 3.12's argparse: each command line below was parsed by an ArgumentParser with the same
// spec (prog 't'; trace, extra nargs='?'; --start-ns int, --json store_true, --only choices, --ref append,
// --out required), and each expected verdict and message is the one argparse gave.
import assert from 'node:assert/strict';
import { pyArgs } from '../src/pyargs.ts';

const parse = (argv: string[]) => pyArgs(argv, 't', [{ name: '--start-ns', type: 'int' }, { name: '--json', takes: 'flag' },
  { name: '--only', choices: ['gif', 'all'] }, { name: '--ref', append: true }, { name: '--out', required: true }],
[{ name: 'trace' }, { name: 'extra', optional: true }]);

assert.deepEqual(parse(['a', '--out', 'o']), { options: { '--out': 'o' }, positionals: ['a'] });
// A unique prefix, a negative number and a lone '-' as values, --name=value, and an appended option.
assert.deepEqual(parse(['a', 'b', '--st', '-5', '--js', '--out=o', '--ref', 'x', '--ref', '-']),
  { options: { '--start-ns': '-5', '--json': true, '--out': 'o', '--ref': ['x', '-'] }, positionals: ['a', 'b'] });

const refusals: [string[], string][] = [
  // After the first '--', a second is a positional; options are no longer read.
  [['--', '--', 'a', '--out', 'o'], 'the following arguments are required: --out'],
  // A '--' after the positionals were filled, with an option between, is unrecognized.
  [['a', 'b', '--out', 'o', '--'], 'unrecognized arguments: --'],
  [['a', 'b', '--', '--out', 'o'], 'the following arguments are required: --out'],
  [['a'], 'the following arguments are required: --out'],
  [['a', '--out', 'o', '--start-ns', 'x'], "argument --start-ns: invalid int value: 'x'"],
  [['a', '--out', 'o', '--only', 'mp4'], "argument --only: invalid choice: 'mp4' (choose from gif, all)"],
  [['a', '--out', 'o', '--json=1'], "argument --json: ignored explicit argument '1'"],
  [['a', '--o', 'x'], 'ambiguous option: --o could match --only, --out'],
  [['a', '--out', 'o', '-x'], 'unrecognized arguments: -x'],
  [['a', '--out'], 'argument --out: expected one argument'],
  [['a', '--out', '-x'], 'argument --out: expected one argument'],
];
for (const [argv, message] of refusals) {
  const result = parse(argv);
  assert.ok('exit' in result && result.exit === 2, `${argv.join(' ')} exits 2`);
  assert.equal(result.text.split('\n')[1], `t: error: ${message}`, argv.join(' '));
}
const help = parse(['-h']);
assert.ok('exit' in help && help.exit === 0 && help.text.startsWith('usage: t [-h]'), '-h prints the usage and exits 0');

console.log(`pyargs: 2 command lines parse and ${refusals.length} refuse as argparse did, with its messages; -h exits 0`);
