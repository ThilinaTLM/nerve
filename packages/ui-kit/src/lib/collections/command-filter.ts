import { matchesTerms } from "./match-terms.js";

/** One row of a command-style popover list: a quick filter over a flat list
 * split into labelled groups (e.g. "Tools", "Anthropic"). */
export type CommandItem = {
  key: string;
  label: string;
  /** Section the row is listed under; typing it matches the whole section. */
  group: string;
  /** Extra search terms that are not shown, e.g. ids, providers, capabilities. */
  keywords?: readonly string[];
};

export type CommandGroup<Item> = { group: string; items: Item[] };

/** Filters rows by every whitespace-separated term of `query`, each matched
 * case-insensitively against the label, the group name, or a keyword. So
 * "tools" lists every tool, "jira" finds the Jira tool, and "openai vision"
 * narrows a provider to its vision models. Groups keep first-appearance order
 * and empty groups are dropped. */
export function filterCommandItems<Item extends CommandItem>(
  items: readonly Item[],
  query: string,
): CommandGroup<Item>[] {
  const groups = new Map<string, Item[]>();
  for (const item of items) {
    if (!matchesTerms(query, item.label, item.group, ...(item.keywords ?? [])))
      continue;
    const rows = groups.get(item.group);
    if (rows) rows.push(item);
    else groups.set(item.group, [item]);
  }
  return [...groups].map(([group, rows]) => ({ group, items: rows }));
}
