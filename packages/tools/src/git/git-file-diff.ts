import type { GitDiffArea, GitFileDiffResponse } from "@nervekit/contracts/git";
import type { GitReadBackend, GitReadSnapshot } from "./read/types.js";

export interface GitFileDiffContext {
  resolveRepoDir(projectId: string, relativePath: string): string;
  readSnapshot(repoDir: string): Promise<GitReadSnapshot>;
  readFileDiff: GitReadBackend["fileDiff"];
}

export async function readFileDiff(
  ctx: GitFileDiffContext,
  projectId: string,
  relativePath: string,
  path: string,
  area: GitDiffArea,
): Promise<GitFileDiffResponse> {
  const repoDir = ctx.resolveRepoDir(projectId, relativePath);
  const snapshot = await ctx.readSnapshot(repoDir);
  const file = snapshot.files.find(
    (candidate) => candidate.path === path || candidate.renamedFrom === path,
  );
  const resolvedPath = file?.path ?? path;
  const originalPath = file?.renamedFrom ?? resolvedPath;
  const originalMissing =
    area === "staged" ? file?.index === "A" : Boolean(file?.untracked);
  const modifiedMissing =
    area === "staged" ? file?.index === "D" : file?.worktree === "D";
  const documents = await ctx.readFileDiff(
    repoDir,
    originalMissing
      ? { kind: "empty", path: originalPath }
      : area === "staged"
        ? { kind: "revision", revision: "HEAD", path: originalPath }
        : { kind: "index", path: originalPath },
    modifiedMissing
      ? { kind: "empty", path: resolvedPath }
      : area === "staged"
        ? { kind: "index", path: resolvedPath }
        : { kind: "worktree", path: resolvedPath },
  );
  const metadata = {
    path: resolvedPath,
    ...(file?.renamedFrom ? { renamedFrom: file.renamedFrom } : {}),
    area,
  };
  if (documents.original.binary || documents.modified.binary) {
    return { ...metadata, binary: true };
  }
  return {
    ...metadata,
    binary: false,
    original: documents.original.content ?? "",
    modified: documents.modified.content ?? "",
  };
}
