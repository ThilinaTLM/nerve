import type { GitProjectFileStatus } from "@nervekit/contracts";

export type FileGitTone =
  | "destructive"
  | "warning"
  | "success"
  | "info"
  | "muted";

export type FileGitDecoration = {
  label: string;
  title: string;
  class: string;
  tone: FileGitTone;
};

const conflictCodes = new Set(["U"]);

export function indexProjectFileStatuses(
  files: readonly GitProjectFileStatus[],
): ReadonlyMap<string, GitProjectFileStatus> {
  return new Map(files.map((file) => [file.path, file]));
}

const tonePriority: Record<FileGitTone, number> = {
  destructive: 4,
  warning: 3,
  success: 2,
  info: 1,
  muted: 0,
};

export function indexFileTreeGitDecorations(
  files: readonly GitProjectFileStatus[],
): ReadonlyMap<string, FileGitDecoration> {
  const decorations = new Map<string, FileGitDecoration>();
  for (const file of files) {
    const decoration = fileGitDecoration(file);
    if (!decoration) continue;
    decorations.set(file.path, decoration);
    let directory = file.path.slice(0, file.path.lastIndexOf("/"));
    while (directory) {
      const current = decorations.get(directory);
      if (
        !current ||
        tonePriority[decoration.tone] > tonePriority[current.tone]
      ) {
        decorations.set(directory, {
          ...decoration,
          title: `Contains ${decoration.title.toLocaleLowerCase()} files`,
        });
      }
      directory = directory.slice(0, directory.lastIndexOf("/"));
    }
  }
  return decorations;
}

export function fileTreeGitDecoration(
  decorations: ReadonlyMap<string, FileGitDecoration>,
  path: string,
): FileGitDecoration | undefined {
  const exact = decorations.get(path);
  if (exact) return exact;
  if (path === ".git" || path.startsWith(".git/"))
    return {
      label: "",
      title: "Git metadata",
      class: "text-muted-foreground",
      tone: "muted",
    };
  let directory = path.slice(0, path.lastIndexOf("/"));
  while (directory) {
    const inherited = decorations.get(directory);
    if (inherited?.tone === "muted") return inherited;
    directory = directory.slice(0, directory.lastIndexOf("/"));
  }
  return undefined;
}

export function fileGitDecoration(
  file: GitProjectFileStatus | undefined,
): FileGitDecoration | undefined {
  if (!file) return undefined;
  const { index, worktree } = file;
  if (index === "!" || worktree === "!")
    return {
      label: "",
      title: "Ignored by Git",
      class: "text-muted-foreground",
      tone: "muted",
    };
  const conflicted =
    conflictCodes.has(index) ||
    conflictCodes.has(worktree) ||
    (index === "A" && worktree === "A") ||
    (index === "D" && worktree !== " ") ||
    (worktree === "D" && index !== " ");
  if (conflicted)
    return {
      label: "!",
      title: "Git conflict",
      class: "text-destructive",
      tone: "destructive",
    };
  if (index === "D" || worktree === "D")
    return {
      label: "D",
      title: "Deleted",
      class: "text-destructive",
      tone: "destructive",
    };
  if (file.untracked)
    return {
      label: "U",
      title: "Untracked",
      class: "text-success",
      tone: "success",
    };
  if (index === "A" || worktree === "A")
    return {
      label: "A",
      title: "Added",
      class: "text-success",
      tone: "success",
    };
  if (index === "R" || worktree === "R" || index === "C" || worktree === "C")
    return {
      label: "R",
      title: "Renamed",
      class: "text-info",
      tone: "info",
    };
  if (index === "M" || worktree === "M")
    return {
      label: "M",
      title: "Modified",
      class: "text-warning",
      tone: "warning",
    };
  return undefined;
}
