import type { SettingsNavGroup } from "$lib/presentation/settings";

/**
 * The settings pages a phone offers: managing devices and how Nerve gets your
 * attention. Everything else is configuration done at a computer.
 */
const phoneSettingsPages: ReadonlySet<string> = new Set([
  "devices",
  "notifications",
]);

export function isPhoneSettingsPage(pageId: string): boolean {
  return phoneSettingsPages.has(pageId);
}

/** The phone's settings pages, in desktop nav order. */
export function phoneSettingsItems(
  groups: readonly SettingsNavGroup[],
): SettingsNavGroup["items"] {
  return groups.flatMap((group) =>
    group.items.filter((item) => isPhoneSettingsPage(item.id)),
  );
}
