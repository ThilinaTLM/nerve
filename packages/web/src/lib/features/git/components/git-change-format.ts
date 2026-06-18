import type {
  GitFileChange,
  GithubChecksSummary,
  GitRepoSummary,
} from "$lib/api";
import type { BadgeTone } from "$lib/components/ui/badge";

const MAX_CHANGE_PATH_LENGTH = 48;

export function repoPathLabel(repo: GitRepoSummary): string {
  return repo.relativePath === "." ? "project root" : repo.relativePath;
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

export function shortenPath(path: string): string {
  if (path.length <= MAX_CHANGE_PATH_LENGTH) return path;

  const segments = path.split("/");
  if (segments.length <= 2) {
    const available = Math.max(8, MAX_CHANGE_PATH_LENGTH - 3);
    const headLength = Math.ceil(available / 2);
    const tailLength = Math.floor(available / 2);
    return `${path.slice(0, headLength)}...${path.slice(-tailLength)}`;
  }

  const prefix = segments[0];
  const suffixParts = [segments.at(-1) ?? ""];
  for (let index = segments.length - 2; index > 0; index -= 1) {
    const candidateParts = [segments[index], ...suffixParts];
    const candidate = `${prefix}/.../${candidateParts.join("/")}`;
    if (candidate.length > MAX_CHANGE_PATH_LENGTH && suffixParts.length > 1)
      break;
    suffixParts.unshift(segments[index]);
    if (candidate.length >= MAX_CHANGE_PATH_LENGTH) break;
  }

  return `${prefix}/.../${suffixParts.join("/")}`;
}

export function splitPath(path: string): { dir: string; base: string } {
  const index = path.lastIndexOf("/");
  if (index === -1) return { dir: "", base: path };
  return { dir: path.slice(0, index + 1), base: path.slice(index + 1) };
}

export function checksTone(checks: GithubChecksSummary): BadgeTone {
  switch (checks.status) {
    case "passing":
      return "good";
    case "failing":
      return "danger";
    case "pending":
      return "warn";
    default:
      return "neutral";
  }
}
