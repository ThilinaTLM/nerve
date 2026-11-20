export interface PageResult<T> {
  items: T[];
  /** Whether the service reports more results after this page. */
  more: boolean;
}

/**
 * Collects up to `limit` items from a paged API. `fetchPage` receives how many
 * items to ask for and how many were collected so far. `more` on the result is
 * true when results beyond `limit` exist, as reported by the service.
 */
export async function collectPages<T>(options: {
  limit: number;
  pageSize: number;
  fetchPage(request: {
    count: number;
    collected: number;
  }): Promise<PageResult<T>>;
}): Promise<{ items: T[]; more: boolean }> {
  const items: T[] = [];
  let more = false;
  while (items.length < options.limit) {
    const page = await options.fetchPage({
      count: Math.min(options.pageSize, options.limit - items.length),
      collected: items.length,
    });
    const room = options.limit - items.length;
    items.push(...page.items.slice(0, room));
    more = page.more || page.items.length > room;
    if (!page.more || page.items.length === 0) break;
  }
  return { items, more: more && items.length >= options.limit };
}

/** Footer note for a result cut off at `limit`; identical text for identical calls. */
export function limitNote(
  method: string,
  limit: number,
  max: number,
  noun: string,
  narrow: string,
): string {
  return `${method} stopped at limit ${limit}; more ${noun} match. Raise limit (max ${max}) or narrow ${narrow}.`;
}
