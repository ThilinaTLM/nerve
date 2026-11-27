import type { ConfigurationReviewItem } from "@nervekit/contracts/configuration";

/** One thing an item can do, before it is compared with what the user approved last time. */
export type ReviewLine = {
  text: string;
  /** At most 32 characters. */
  short: string;
  broad: boolean;
};

const SHORT_MAX = 32;

/** A sentence for a list row: no code quotes, cut at a colon, no "without asking" tail, clamped. */
export function shortOf(text: string): string {
  const plain = (text.split(": ")[0] ?? text)
    .replace(/`/g, "")
    .replace(/ without asking$/, "")
    .replace(/\.$/, "")
    .trim();
  return clamp(plain);
}

export function clamp(text: string, max = SHORT_MAX): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

/** A line whose short form is the sentence itself, shortened. */
export function line(text: string, broad = false, short?: string): ReviewLine {
  return { text, short: clamp(short ?? shortOf(text)), broad };
}

/** Quotes a name or command for the review text; `` ` `` cannot appear inside a code span. */
export function code(value: string): string {
  return `\`${value.replace(/`/g, "'")}\``;
}

export function codeList(values: readonly string[], limit = 4): string {
  const shown = values.slice(0, limit).map(code).join(", ");
  return values.length > limit
    ? `${shown} and ${values.length - limit} more`
    : shown;
}

/**
 * The lines as review items: the broad ones first, each marked `new` when the user's last
 * decision (its stored snapshot) did not contain it. With no snapshot nothing is new: there is
 * nothing to compare with.
 */
export function toItems(
  lines: readonly ReviewLine[],
  approved: readonly string[] | undefined,
): ConfigurationReviewItem[] {
  const known = approved ? new Set(approved) : undefined;
  const seen = new Set<string>();
  const unique = lines.filter((entry) => {
    if (seen.has(entry.text)) return false;
    seen.add(entry.text);
    return true;
  });
  return [
    ...unique.filter((entry) => entry.broad),
    ...unique.filter((entry) => !entry.broad),
  ].map((entry) => ({
    text: entry.text,
    short: entry.short,
    broad: entry.broad,
    new: known ? !known.has(entry.text) : false,
  }));
}
