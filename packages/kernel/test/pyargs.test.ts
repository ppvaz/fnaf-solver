// pyArgs against Python 3.12's argparse: each command line below was parsed by an ArgumentParser with the same
// spec (prog 't'; trace, extra nargs='?'; --start-ns int, --json store_true, --only choices, --ref append,
// --out required), and each expected verdict and message is the one argparse gave.
import assert from 'node:assert/strict';
import { pyArgs, pyArgsError, pySubcommands } from '../src/pyargs.ts';

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
  // The value is named by its repr(): a quote inside picks the other quote, a backslash is doubled.
  [['a', '--out', 'o', "--start-ns=x'y"], 'argument --start-ns: invalid int value: "x\'y"'],
  [['a', '--out', 'o', '--only', 'a\\b'], "argument --only: invalid choice: 'a\\\\b' (choose from gif, all)"],
  [['a', '--out', 'o', "--json=it's"], 'argument --json: ignored explicit argument "it\'s"'],
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
// A choices positional and a rest (nargs='*'), against argparse 3.12.12: an empty rest before an option waits for
// the next run of values; one that took values is closed by the option after it.
const commands = (argv: string[]) => pyArgs(argv, 't', [{ name: '--dump' }, { name: '--xor', type: 'int' }],
  [{ name: 'command', choices: ['frames', 'objects', 'group'] }, { name: 'args', rest: true }]);
const parsed = (argv: string[]) => { const result = commands(argv); return 'exit' in result ? result.text.split('\n')[1] : result; };
assert.deepEqual(parsed(['group', '--dump', 'x', '3', '4']), { options: { '--dump': 'x' }, positionals: ['group', '3', '4'] });
assert.deepEqual(parsed(['group', '--', '3', '--', '4']), { options: {}, positionals: ['group', '3', '--', '4'] });
assert.deepEqual(parsed(['group', '3', '--']), { options: {}, positionals: ['group', '3'] });
assert.deepEqual(parsed(['group', '-3']), { options: {}, positionals: ['group', '-3'] });
assert.equal(parsed(['group', '3', '--xor', '0', '4']), 't: error: unrecognized arguments: 4');
assert.equal(parsed(["it's"]), 't: error: argument command: invalid choice: "it\'s" (choose from frames, objects, group)');
assert.equal(parsed([]), 't: error: the following arguments are required: command');
const usageLine = commands(['-h']);
assert.ok('exit' in usageLine && usageLine.text === 'usage: t [-h] [--dump DUMP] [--xor XOR] {frames,objects,group} [args ...]');

// add_subparsers(dest='cmd', required=True), against argparse 3.12.12: the main parser takes the command and what
// nobody recognised; a subcommand refuses its own requirements under its own prog and usage.
const subcommands = (argv: string[]) => {
  const result = pySubcommands(argv, 't', 'cmd', { record: { options: [{ name: '--game', required: true }, { name: '--run', append: true }] },
    check: { options: [], positionals: [{ name: 'records', rest: true, required: true }] } });
  return 'exit' in result ? result.text : result;
};
assert.deepEqual(subcommands(['check', 'a', 'b']), { command: 'check', args: { options: {}, positionals: ['a', 'b'] } });
assert.equal(subcommands(['check']), 'usage: t check [-h] records [records ...]\nt check: error: the following arguments are required: records');
assert.equal(subcommands(['rec', '--game', 'g']), "usage: t [-h] {record,check} ...\nt: error: argument cmd: invalid choice: 'rec' (choose from record, check)");
assert.equal(subcommands(['record', '--game', 'g', 'extra']), 'usage: t [-h] {record,check} ...\nt: error: unrecognized arguments: extra');

// parser.error after the parse prints the same usage line.
const spec = [{ name: '--rate', type: 'int', required: true }] as const;
assert.deepEqual(pyArgsError('t', spec, [{ name: 'trace' }], '--rate is out of bounds'),
  { exit: 2, text: 'usage: t [-h] --rate RATE trace\nt: error: --rate is out of bounds' });
const help = parse(['-h']);
assert.ok('exit' in help && help.exit === 0 && help.text.startsWith('usage: t [-h]'), '-h prints the usage and exits 0');

console.log(`pyargs: 2 command lines parse and ${refusals.length} refuse as argparse did, with its messages; -h exits 0`);
