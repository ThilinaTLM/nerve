import type { StatusTone } from "@nervekit/ui-kit/display/status";
import type { GitProjectFileStatus } from "@nervekit/contracts/git";

export type FileGitDecoration = {
  label: string;
  title: string;
  class: string;
  tone: StatusTone;
  /** Ignored paths recede in the tree. */
  ignored?: boolean;
};

const conflictCodes = new Set(["U"]);

/** Parent of a project-relative path; "" for top-level entries. */
export function parentDirectory(path: string): string {
  const separator = path.lastIndexOf("/");
  return separator < 0 ? "" : path.slice(0, separator);
}

export function indexProjectFileStatuses(
  files: readonly GitProjectFileStatus[],
): ReadonlyMap<string, GitProjectFileStatus> {
  return new Map(files.map((file) => [file.path, file]));
}

const tonePriority: Record<StatusTone, number> = {
  destructive: 4,
  warning: 3,
  success: 2,
  info: 1,
  neutral: 0,
  brand: 0,
};

export function indexFileTreeGitDecorations(
  files: readonly GitProjectFileStatus[],
): ReadonlyMap<string, FileGitDecoration> {
  const decorations = new Map<string, FileGitDecoration>();
  for (const file of files) {
    const decoration = fileGitDecoration(file);
    if (!decoration) continue;
    // Collapsed untracked/ignored directories may be reported with a trailing slash.
    const path = file.path.replace(/\/+$/, "");
    decorations.set(path, decoration);
    // An ignored path says nothing about its ancestors (`.nerve/*` is ignored
    // while `.nerve/skills` is tracked), so only status tones propagate up.
    let directory = decoration.tone === "neutral" ? "" : parentDirectory(path);
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
      directory = parentDirectory(directory);
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
      tone: "neutral",
      ignored: true,
    };
  // Only an ignored ancestor passes its state down to its contents.
  let directory = parentDirectory(path);
  while (directory) {
    const inherited = decorations.get(directory);
    if (inherited?.ignored) return inherited;
    directory = parentDirectory(directory);
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
      tone: "neutral",
      ignored: true,
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

/**
 * Whether the tree dims an entry. The listing's `ignored` flag (native ignore
 * rules) is authoritative; the Git decoration only fills in when the listing
 * could not evaluate ignore rules.
 */
export function isFileEntryDimmed(
  entry: { ignored?: boolean },
  decoration: FileGitDecoration | undefined,
): boolean {
  return entry.ignored ?? decoration?.ignored === true;
}
