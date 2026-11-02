import type { SettingsNavGroup } from "$lib/presentation/settings";

/**
 * Settings pages that are catalogue or keyboard configuration rather than
 * day-to-day work. The phone shell leaves them out; their editors are built
 * for a pointer and a wide pane.
 */
const desktopOnlySettingsPages: ReadonlySet<string> = new Set([
  "agents",
  "sub-agents",
  "permission-rules",
  "models",
  "suggestions",
  "shortcuts",
]);

export function isDesktopOnlySettingsPage(pageId: string): boolean {
  return desktopOnlySettingsPages.has(pageId);
}

/** The settings nav without desktop-only pages or the groups they empty. */
export function mobileSettingsGroups(
  groups: readonly SettingsNavGroup[],
): SettingsNavGroup[] {
  return groups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => !isDesktopOnlySettingsPage(item.id)),
    }))
    .filter((group) => group.items.length > 0);
}
