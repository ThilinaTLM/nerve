import type {
  GitFileChange,
  GithubChecksSummary,
  GitRepoSummary,
} from "@nervekit/contracts/git";
import type { StatusTone } from "@nervekit/ui-kit/display/status";
import {
  repositoryLabels,
  type RepositoryLabelOptions,
} from "./repository-labels";

const REPO_LABEL_SHORTENING = [
  { minCount: 9, maxLength: 12 },
  { minCount: 5, maxLength: 16 },
  { minCount: 0, maxLength: 22 },
] as const;

export function repoPathLabel(repo: GitRepoSummary): string {
  return repo.relativePath === "." ? "project root" : repo.relativePath;
}

/** Compute once per repository list; keys are the unchanged relative paths. */
export function repoButtonLabels(
  repos: readonly GitRepoSummary[],
  options: RepositoryLabelOptions = {},
): Map<string, string> {
  const rule = REPO_LABEL_SHORTENING.find(
    (candidate) => repos.length >= candidate.minCount,
  );
  return new Map(
    [
      ...repositoryLabels(
        repos.map((repo) => ({
          id: repo.relativePath,
          name: repo.name,
          path: repo.absDir,
        })),
        { maxLength: options.maxLength ?? rule?.maxLength ?? 22 },
      ),
    ].map(([id, { label }]) => [id, label]),
  );
}

/** For individual chips; lists should use repoButtonLabels instead. */
export function repoButtonLabel(
  repo: GitRepoSummary,
  repos: readonly GitRepoSummary[],
  options: RepositoryLabelOptions = {},
): string {
  return (
    repoButtonLabels(repos, options).get(repo.relativePath) ??
    repoButtonLabels([repo], options).get(repo.relativePath)!
  );
}

export function fileTone(file: GitFileChange): string {
  if (file.untracked) return "text-muted-foreground";
  if (file.index === "A") return "text-success";
  if (file.index === "D" || file.worktree === "D") return "text-destructive";
  return "text-info";
}

export function statusLetter(
  file: GitFileChange,
  group: "staged" | "unstaged",
): string {
  if (file.untracked) return "?";
  const code = group === "staged" ? file.index : file.worktree;
  return code === " " ? (file.index !== " " ? file.index : "M") : code;
}

export function fileStatusLabel(
  file: GitFileChange,
  group: "staged" | "unstaged",
): string {
  const code = group === "staged" ? file.index : file.worktree;
  if (file.untracked) return "untracked";
  switch (code) {
    case "A":
      return "added";
    case "D":
      return "deleted";
    case "R":
      return "renamed";
    case "M":
      return "modified";
    case "U":
      return "conflict";
    default:
      return group;
  }
}

export function checksTone(checks: GithubChecksSummary): StatusTone {
  switch (checks.status) {
    case "passing":
      return "success";
    case "failing":
      return "destructive";
    case "pending":
      return "warning";
    default:
      return "neutral";
  }
}
