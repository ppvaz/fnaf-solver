/**
 * A command line read as Python's argparse read it, for the scripts ported from Python (Pedro, 2026-10-02):
 * a ported tool accepts and refuses the same command lines, with the same exit codes. Long options take any
 * unique prefix, a value as `--name value` or `--name=value`; a value that starts with '-' is taken only when
 * it is '-' or looks like a negative number; `--` ends the options, and is dropped where a positional slot is
 * still open or it follows the argument that filled the last one (else argparse called it unrecognized); a
 * repeated option keeps its last value, or every value when it appends. A refusal exits 2 with argparse's message after a one-line usage; -h and --help
 * print the usage and exit 0 (argparse's help listed every option; this prints the usage line only).
 */
import { pyFloat, pyInt } from './pyfmt.ts';

/** One long option: a flag (store_true), or one that takes a value. */
export interface PyOption {
  readonly name: string, readonly takes?: 'flag' | 'value', readonly required?: boolean,
  readonly type?: 'int' | 'float', readonly choices?: readonly string[], readonly append?: boolean, readonly metavar?: string,
}
/** The positionals in order; an optional one (nargs='?') may be absent. */
export interface PyPositional { readonly name: string, readonly optional?: boolean }

export interface PyArgs {
  /** Each option given: true for a flag, its value, or every value when it appends. */
  readonly options: Readonly<Record<string, string | boolean | readonly string[]>>,
  readonly positionals: readonly string[],
}

const NEGATIVE = /^-\d+$|^-\d*\.\d+$/;

function usage(prog: string, options: readonly PyOption[], positionals: readonly PyPositional[]) {
  const parts = ['[-h]'];
  for (const option of options) {
    const metavar = option.choices ? `{${option.choices.join(',')}}` : option.metavar ?? option.name.slice(2).toUpperCase().replaceAll('-', '_');
    const text = option.takes === 'flag' ? option.name : `${option.name} ${metavar}`;
    parts.push(option.required ? text : `[${text}]`);
  }
  for (const positional of positionals) parts.push(positional.optional ? `[${positional.name}]` : positional.name);
  return `usage: ${prog} ${parts.join(' ')}`;
}

/** The parsed command line, or the exit code and the text argparse printed (to stdout for help, else stderr). */
export function pyArgs(argv: readonly string[], prog: string, options: readonly PyOption[], positionals: readonly PyPositional[] = []):
  PyArgs | { readonly exit: 0 | 2, readonly text: string } {
  const line = usage(prog, options, positionals);
  const refuse = (message: string) => ({ exit: 2 as const, text: `${line}\n${prog}: error: ${message}` });
  const names = ['--help', ...options.map(option => option.name)];
  const given: Record<string, string | boolean | string[]> = {};
  const loose: string[] = [];
  const extra: string[] = [];
  let filledLast = false;   // the previous token filled a positional slot
  const positional = (token: string) => {
    filledLast = loose.length < positionals.length;
    if (filledLast) loose.push(token); else extra.push(token);
  };
  for (let k = 0; k < argv.length; k += 1) {
    const token = argv[k];
    if (token === '--') {
      if (!(loose.length < positionals.length || filledLast)) extra.push(token);
      for (const rest of argv.slice(k + 1)) positional(rest);
      break;
    }
    if (!token.startsWith('-') || token === '-' || NEGATIVE.test(token)) { positional(token); continue; }
    filledLast = false;
    if (token === '-h') return { exit: 0, text: line };
    if (!token.startsWith('--')) { extra.push(token); continue; }
    const equals = token.indexOf('=');
    let flag = equals > 0 ? token.slice(0, equals) : token;
    let inline = equals > 0 ? token.slice(equals + 1) : undefined;
    if (!names.includes(flag)) {
      const matches = names.filter(name => name.startsWith(flag));
      if (matches.length > 1) return refuse(`ambiguous option: ${flag} could match ${matches.join(', ')}`);
      if (!matches.length) { extra.push(token); continue; }
      flag = matches[0];
    }
    if (flag === '--help') return { exit: 0, text: line };
    const option = options.find(item => item.name === flag);
    if (!option) continue;
    if (option.takes === 'flag') {
      if (inline !== undefined) return refuse(`argument ${flag}: ignored explicit argument '${inline}'`);
      given[flag] = true;
      continue;
    }
    if (inline === undefined) {
      inline = argv[k + 1];
      if (inline === undefined || (inline.startsWith('-') && inline !== '-' && !NEGATIVE.test(inline))) return refuse(`argument ${flag}: expected one argument`);
      k += 1;
    }
    if (option.type === 'int' && pyInt(inline) === null) return refuse(`argument ${flag}: invalid int value: '${inline}'`);
    if (option.type === 'float' && pyFloat(inline) === null) return refuse(`argument ${flag}: invalid float value: '${inline}'`);
    if (option.choices && !option.choices.includes(inline))
      return refuse(`argument ${flag}: invalid choice: '${inline}' (choose from ${option.choices.join(', ')})`);
    if (option.append) {
      const values = given[flag];
      given[flag] = [...(Array.isArray(values) ? values : []), inline];
    } else given[flag] = inline;
  }
  const missing = [...positionals.filter((positional, k) => !positional.optional && k >= loose.length).map(positional => positional.name),
    ...options.filter(option => option.required && given[option.name] === undefined).map(option => option.name)];
  if (missing.length) return refuse(`the following arguments are required: ${missing.join(', ')}`);
  if (extra.length) return refuse(`unrecognized arguments: ${extra.join(' ')}`);
  return { options: given, positionals: loose };
}
