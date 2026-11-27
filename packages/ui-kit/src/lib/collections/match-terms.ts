/** The whitespace-separated, lower-cased terms of a search query. */
export function searchTerms(query: string): string[] {
  return query.trim().toLowerCase().split(/\s+/).filter(Boolean);
}

/**
 * The one search-box rule: every whitespace-separated term of `query` must
 * appear, case-insensitively, in at least one of `fields` (terms do not span
 * fields). A blank query matches everything; missing fields are skipped.
 */
export function matchesTerms(
  query: string,
  ...fields: readonly (string | null | undefined)[]
): boolean {
  const terms = searchTerms(query);
  if (terms.length === 0) return true;
  const haystack = fields.filter(Boolean).join("\n").toLowerCase();
  return terms.every((term) => haystack.includes(term));
}
