import { noAccountFilters, type AccountFilters } from "./accounts-view";

/**
 * The Accounts page's filters. They outlive the page's visits so that a link from an extension
 * page (`showAccountsOf`) can set them before the page opens.
 */
export const accountsPageFilters = $state<AccountFilters>({
  ...noAccountFilters,
});

export function clearAccountFilters(): void {
  Object.assign(accountsPageFilters, noAccountFilters);
}

/** Narrows the page to one extension's accounts. */
export function showAccountsOf(extensionId: string): void {
  Object.assign(accountsPageFilters, noAccountFilters, {
    extension: extensionId,
  });
}
