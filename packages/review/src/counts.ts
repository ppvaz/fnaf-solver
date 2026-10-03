// Counting what a query reads, by a key: the tallies Review's queries report.

/** How many of `items` share each key; a key is a property name, as indexing with it would make it. */
export const tally = <T>(items: readonly T[], key: (item: T) => unknown) => items.reduce((counts, item) => {
  const value = String(key(item));
  counts[value] = (counts[value] ?? 0) + 1;
  return counts;
}, ({} as Record<string, number>));

/** The same counts with their keys in order, so a record that prints them is stable. */
export const sortedCounts = (counts: Readonly<Record<string, number>>) =>
  Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
