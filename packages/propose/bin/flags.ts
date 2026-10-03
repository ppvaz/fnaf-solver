/**
 * Refuse a flag a command does not read.
 *
 * The plan tools look their flags up by name (`argv.indexOf('--count')`,
 * `--name=value`), so anything else on the line was silently ignored: a
 * mistyped or wrong-tool flag ran the default instead -- `--seeds 3000` on a
 * tool that reads `--count` ran its default cohort and reported it as asked.
 * Every `--name` and `--name=value` token must name a flag the command knows.
 *
 * @param argv the command's arguments, without node and the script
 * @param known every flag name the command reads, without the leading dashes
 * @returns nothing; throws naming each unknown flag and the known ones
 */
export function refuseUnknownFlags(argv: readonly string[], known: readonly string[]) {
  const unknown = argv.filter(token => token.startsWith('--'))
    .map(token => token.slice(2).split('=')[0])
    .filter(name => !known.includes(name));
  if (unknown.length)
    throw new Error(`unknown flag${unknown.length > 1 ? 's' : ''} ${unknown.map(n => `--${n}`).join(', ')}; ` +
      `this command reads ${known.map(n => `--${n}`).join(', ')}`);
}
