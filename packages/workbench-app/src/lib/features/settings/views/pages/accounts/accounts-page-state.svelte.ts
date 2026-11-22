/**
 * The Accounts page's search. It outlives the page's visits so that a link from an extension
 * page (`showAccounts`) can prefill it before the page opens.
 */
export const accountsSearch = $state({ query: "" });

/** Opens the page narrowed to what the text names: an extension, a platform. */
export function showAccounts(query: string): void {
  accountsSearch.query = query;
}
