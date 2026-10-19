import { resolveDroppedPaths } from "$lib/features/conversations/adapters/dropped-paths";

export type DroppedFilesDeps = {
  /** Desktop only: native path of a dropped file. */
  getPathForFile?: (file: File) => string;
  projectDir?: string;
  /** Browser/remote: stores the file and returns its path. */
  upload: (file: File) => Promise<string>;
  notifyError: (title: string, description?: string) => void;
  notifyInfo: (message: string) => void;
};

/** A dropped folder arrives as a File whose bytes cannot be read. */
async function isReadableFile(file: File): Promise<boolean> {
  try {
    await file.slice(0, 1).arrayBuffer();
    return true;
  } catch {
    return false;
  }
}

/**
 * Turns dropped files into paths for `@path` chips. Desktop windows use native
 * paths; browsers upload each file (folders cannot be uploaded and are
 * skipped with one notice). File contents are never inserted as text.
 */
export async function resolveDroppedFiles(
  files: readonly File[],
  deps: DroppedFilesDeps,
): Promise<string[]> {
  if (deps.getPathForFile) {
    if (!deps.projectDir) {
      throw new Error("Native file paths are unavailable in this window.");
    }
    return resolveDroppedPaths(files, deps.projectDir, deps.getPathForFile);
  }

  let skippedFolders = 0;
  const paths = await Promise.all(
    files.map(async (file) => {
      if (!(await isReadableFile(file))) {
        skippedFolders += 1;
        return undefined;
      }
      try {
        return await deps.upload(file);
      } catch (caught) {
        deps.notifyError(
          `Could not attach ${file.name || "file"}`,
          caught instanceof Error ? caught.message : String(caught),
        );
        return undefined;
      }
    }),
  );
  if (skippedFolders > 0) {
    deps.notifyInfo("Folders can only be dropped in the desktop app");
  }
  return paths.filter((path): path is string => Boolean(path));
}
