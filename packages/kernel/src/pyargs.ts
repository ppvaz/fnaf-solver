/**
 * A command line read as Python's argparse read it, for the scripts ported from Python (Pedro, 2026-10-02):
 * a ported tool accepts and refuses the same command lines, with the same exit codes. Long options take any
 * unique prefix, a value as `--name value` or `--name=value`; a value that starts with '-' is taken only when
 * it is '-' or looks like a negative number; `--` ends the options, and is dropped where a positional slot is
 * still open or it follows the argument that filled the last one (else argparse called it unrecognized); a
 * repeated option keeps its last value, or every value when it appends. A last positional may take the rest
 * (nargs='*'): as argparse 3.12 consumes positionals a run at a time between options, one that took values in a
 * run is closed by the option after it, and one that took none stays open for the next run. A positional with
 * choices is checked as it is filled. A refusal exits 2 with argparse's message after a one-line usage; -h and
 * --help print the usage and exit 0 (argparse's help listed every option; this prints the usage line only).
 */
import { pyFloat, pyInt } from './pyfmt.ts';
import { pyStrRepr } from './pyjson.ts';

/** One long option: a flag (store_true), or one that takes a value. */
export interface PyOption {
  readonly name: string, readonly takes?: 'flag' | 'value', readonly required?: boolean,
  readonly type?: 'int' | 'float', readonly choices?: readonly string[], readonly append?: boolean, readonly metavar?: string,
}
/** The positionals in order; an optional one (nargs='?') may be absent, and the last may take the rest (nargs='*', or
 *  nargs='+' when it is also required). */
export interface PyPositional {
  readonly name: string, readonly optional?: boolean, readonly rest?: boolean, readonly required?: boolean, readonly choices?: readonly string[],
}

export interface PyArgs {
  /** Each option given: true for a flag, its value, or every value when it appends. */
  readonly options: Readonly<Record<string, string | boolean | readonly string[]>>,
  readonly positionals: readonly string[],
  /** With known, what parse_known_args left over instead of refusing it. */
  readonly extras?: readonly string[],
}

const NEGATIVE = /^-\d+$|^-\d*\.\d+$/;

function usage(prog: string, options: readonly PyOption[], positionals: readonly PyPositional[]) {
  const parts = ['[-h]'];
  for (const option of options) {
    const metavar = option.choices ? `{${option.choices.join(',')}}` : option.metavar ?? option.name.slice(2).toUpperCase().replaceAll('-', '_');
    const text = option.takes === 'flag' ? option.name : `${option.name} ${metavar}`;
    parts.push(option.required ? text : `[${text}]`);
  }
  for (const positional of positionals) {
    const name = positional.choices ? `{${positional.choices.join(',')}}` : positional.name;
    parts.push(positional.rest ? (positional.required ? `${name} [${name} ...]` : `[${name} ...]`) : positional.optional ? `[${name}]` : name);
  }
  return `usage: ${prog} ${parts.join(' ')}`;
}

/** parser.error(message), for a check the script makes after parsing: the usage line and the message, exit 2. */
export function pyArgsError(prog: string, options: readonly PyOption[], positionals: readonly PyPositional[], message: string) {
  return { exit: 2 as const, text: `${usage(prog, options, positionals)}\n${prog}: error: ${message}` };
}

/** The parsed command line, or the exit code and the text argparse printed (to stdout for help, else stderr). */
export function pyArgs(argv: readonly string[], prog: string, options: readonly PyOption[], positionals: readonly PyPositional[] = [],
  { known = false } = {}): PyArgs | { readonly exit: 0 | 2, readonly text: string } {
  const line = usage(prog, options, positionals);
  const refuse = (message: string) => pyArgsError(prog, options, positionals, message);
  const names = ['--help', ...options.map(option => option.name)];
  const given: Record<string, string | boolean | string[]> = {};
  const fixed = positionals.filter(item => !item.rest);
  const takesRest = positionals.length > fixed.length;
  const loose: string[] = [];
  const rest: string[] = [];
  const extra: string[] = [];
  let filledLast = false;   // the previous token filled a positional slot
  let restOpen = takesRest, restTaken = false;
  const open = () => loose.length < fixed.length || restOpen;
  const positional = (token: string) => {
    filledLast = open();
    if (loose.length < fixed.length) {
      const choices = fixed[loose.length].choices;
      if (choices && !choices.includes(token))
        return refuse(`argument ${fixed[loose.length].name}: invalid choice: ${pyStrRepr(token)} (choose from ${choices.join(', ')})`);
      loose.push(token);
    } else if (restOpen) {
      rest.push(token);
      restTaken = true;
    } else extra.push(token);
    return null;
  };
  for (let k = 0; k < argv.length; k += 1) {
    const token = argv[k];
    if (token === '--') {
      if (!(open() || filledLast)) extra.push(token);
      for (const after of argv.slice(k + 1)) {
        const refused = positional(after);
        if (refused) return refused;
      }
      break;
    }
    if (!token.startsWith('-') || token === '-' || NEGATIVE.test(token)) {
      const refused = positional(token);
      if (refused) return refused;
      continue;
    }
    filledLast = false;
    // An option ends a run of positionals: a rest that took values in it is consumed.
    if (restTaken) restOpen = false;
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
      if (inline !== undefined) return refuse(`argument ${flag}: ignored explicit argument ${pyStrRepr(inline)}`);
      given[flag] = true;
      continue;
    }
    if (inline === undefined) {
      inline = argv[k + 1];
      if (inline === undefined || (inline.startsWith('-') && inline !== '-' && !NEGATIVE.test(inline))) return refuse(`argument ${flag}: expected one argument`);
      k += 1;
    }
    if (option.type === 'int' && pyInt(inline) === null) return refuse(`argument ${flag}: invalid int value: ${pyStrRepr(inline)}`);
    if (option.type === 'float' && pyFloat(inline) === null) return refuse(`argument ${flag}: invalid float value: ${pyStrRepr(inline)}`);
    if (option.choices && !option.choices.includes(inline))
      return refuse(`argument ${flag}: invalid choice: ${pyStrRepr(inline)} (choose from ${option.choices.join(', ')})`);
    if (option.append) {
      const values = given[flag];
      given[flag] = [...(Array.isArray(values) ? values : []), inline];
    } else given[flag] = inline;
  }
  const missing = [...fixed.filter((positional, k) => !positional.optional && k >= loose.length).map(positional => positional.name),
    ...positionals.filter(positional => positional.rest && positional.required && !rest.length).map(positional => positional.name),
    ...options.filter(option => option.required && given[option.name] === undefined).map(option => option.name)];
  if (missing.length) return refuse(`the following arguments are required: ${missing.join(', ')}`);
  if (known) return { options: given, positionals: [...loose, ...rest], extras: extra };
  if (extra.length) return refuse(`unrecognized arguments: ${extra.join(' ')}`);
  return { options: given, positionals: [...loose, ...rest] };
}

/** One subcommand's options and positionals, as add_subparsers().add_parser(name) declared them. */
export interface PySubcommand { readonly options: readonly PyOption[], readonly positionals?: readonly PyPositional[] }

/** A command line with add_subparsers(dest=dest, required=True): the main parser takes the command and -h, and
 *  refuses what neither it nor the subcommand recognised; the subcommand's own refusals carry `PROG name` and its
 *  usage. */
export function pySubcommands(argv: readonly string[], prog: string, dest: string, commands: Readonly<Record<string, PySubcommand>>):
  { readonly command: string, readonly args: PyArgs } | { readonly exit: 0 | 2, readonly text: string } {
  const names = Object.keys(commands);
  const line = `usage: ${prog} [-h] {${names.join(',')}} ...`;
  const refuse = (message: string) => ({ exit: 2 as const, text: `${line}\n${prog}: error: ${message}` });
  const extras: string[] = [];
  for (let k = 0; k < argv.length; k += 1) {
    let token = argv[k];
    if (token === '--') {
      if (k + 1 >= argv.length) break;
      k += 1;
      token = argv[k];
    } else if (token.startsWith('-') && token !== '-' && !NEGATIVE.test(token)) {
      const flag = token.includes('=') ? token.slice(0, token.indexOf('=')) : token;
      if (token === '-h' || (flag.startsWith('--') && flag.length > 2 && '--help'.startsWith(flag))) return { exit: 0, text: line };
      extras.push(token);
      continue;
    }
    const command = commands[token];
    if (command === undefined || !Object.hasOwn(commands, token)) return refuse(`argument ${dest}: invalid choice: ${pyStrRepr(token)} (choose from ${names.join(', ')})`);
    const parsed = pyArgs(argv.slice(k + 1), `${prog} ${token}`, command.options, command.positionals ?? [], { known: true });
    if ('exit' in parsed) return parsed;
    const left = [...extras, ...(parsed.extras ?? [])];
    if (left.length) return refuse(`unrecognized arguments: ${left.join(' ')}`);
    return { command: token, args: { options: parsed.options, positionals: parsed.positionals } };
  }
  return refuse(`the following arguments are required: ${dest}`);
}

/** A parsed option's value, or null where it was not given (or is a flag). */
export const pyOptionText = (args: PyArgs, name: string): string | null => {
  const value = args.options[name];
  return typeof value === 'string' ? value : null;
};

/** An appended option's values, or null where it was never given (argparse's default). */
export const pyOptionList = (args: PyArgs, name: string): readonly string[] | null => {
  const value = args.options[name];
  return Array.isArray(value) ? value : null;
};
