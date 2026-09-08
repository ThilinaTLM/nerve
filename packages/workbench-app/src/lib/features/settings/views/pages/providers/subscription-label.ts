/**
 * Subscription rows show the provider name as the row title, so the account label
 * should not repeat it. "Anthropic" + "Anthropic (Claude Pro/Max)" reads as
 * "Anthropic — Claude Pro/Max" rather than saying "Anthropic" twice.
 */
export function subscriptionAccountLabel(
  displayName: string,
  oauthName: string | undefined,
): string | undefined {
  const account = oauthName?.trim();
  if (!account) return undefined;

  const title = displayName.trim().toLowerCase();
  if (account.toLowerCase() === title) return undefined;

  const parenthesised = /^(.*?)\s*\((.+)\)$/.exec(account);
  if (parenthesised) {
    const outside = parenthesised[1].trim().toLowerCase();
    const inside = parenthesised[2].trim();
    if (outside && (title.startsWith(outside) || outside.startsWith(title))) {
      return inside;
    }
  }

  return account;
}
