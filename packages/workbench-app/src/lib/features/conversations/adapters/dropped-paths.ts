import { relativePathForDisplay } from "@nervekit/ui-kit/display/path-links";

export type NativeFilePathResolver = (file: File) => string;

export function formatDroppedPathMention(path: string): string {
  if (!/\s/.test(path)) return path;
  return `"${path.replaceAll('"', '\\"')}"`;
}

export function resolveDroppedPaths(
  files: readonly File[],
  projectDir: string,
  getPathForFile: NativeFilePathResolver,
): string[] {
  if (files.length === 0) return [];

  return files.map((file) => {
    const path = getPathForFile(file).trim();
    if (!path) {
      throw new Error(
        `Could not resolve the native path for ${file.name || "a dropped item"}.`,
      );
    }
    return formatDroppedPathMention(
      relativePathForDisplay(path, projectDir) ?? path,
    );
  });
}
