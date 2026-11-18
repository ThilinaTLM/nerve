import type { ExtensionUiContributions } from "@nervekit/contracts/extensions";

export type ExtensionPreview = ExtensionUiContributions["previews"][number];

/** The choice that selects Nerve's own view of a file. */
export const defaultPreviewChoice = "default";

/** Identifies a preview across extensions; also what the file-viewer preferences remember. */
export function previewKey(preview: {
  extensionId: string;
  id: string;
}): string {
  return `${preview.extensionId}/${preview.id}`;
}

/** The last extension of a file name with its dot, lower case (`.csv`); `""` when it has none. */
export function fileExtensionOf(path: string): string {
  const name = path.split(/[\\/]/).pop() ?? "";
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot).toLowerCase() : "";
}

/** Previews whose `match.extensions` fit the file name, in contribution order. */
export function matchingPreviews(
  previews: readonly ExtensionPreview[],
  path: string,
): ExtensionPreview[] {
  const name = (path.split(/[\\/]/).pop() ?? "").toLowerCase();
  return previews.filter((preview) =>
    preview.match.extensions.some(
      (extension) => name.length > extension.length && name.endsWith(extension),
    ),
  );
}

/**
 * The preview a file tab shows: the tab's own choice, else the one remembered for the file's
 * extension. `default`, or a choice that no longer matches, selects Nerve's own view.
 */
export function selectPreview(input: {
  matches: readonly ExtensionPreview[];
  tabChoice?: string;
  remembered?: string;
}): ExtensionPreview | undefined {
  const choice = input.tabChoice ?? input.remembered;
  if (!choice || choice === defaultPreviewChoice) return undefined;
  return input.matches.find((preview) => previewKey(preview) === choice);
}
