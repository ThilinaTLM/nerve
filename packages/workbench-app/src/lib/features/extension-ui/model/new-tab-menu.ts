import type { ExtensionUiContributions } from "@nervekit/contracts/extensions";

type Page = ExtensionUiContributions["pages"][number];

export type NewTabMenuGroup = {
  extensionId: string;
  /** Heading shown only when pages come from more than one extension. */
  heading?: string;
  pages: Page[];
};

/** Pages listed in the new-tab menu, grouped by extension (in first-seen order). */
export function newTabMenuGroups(pages: readonly Page[]): NewTabMenuGroup[] {
  const groups = new Map<string, NewTabMenuGroup>();
  for (const page of pages) {
    if (!page.newMenu) continue;
    const group = groups.get(page.extensionId) ?? {
      extensionId: page.extensionId,
      pages: [],
    };
    group.pages.push(page);
    groups.set(page.extensionId, group);
  }
  const result = [...groups.values()];
  if (result.length > 1)
    for (const group of result)
      group.heading = group.pages[0]?.extensionName ?? group.extensionId;
  return result;
}
