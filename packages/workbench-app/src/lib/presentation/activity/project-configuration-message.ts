import type { ProjectConfigurationIssue } from "@nervekit/contracts/projects";

/** What the user sees on an issue, by classification. */
export function issueMessage(issue: ProjectConfigurationIssue): string {
  if (issue.classification === "incompatible")
    return "Written by a newer Nerve. Upgrade Nerve to use it; the file is left untouched.";
  return issue.message;
}

/** Project-relative path for display; the full path stays in tooltips. */
export function displayPath(path: string): string {
  const normalized = path.replaceAll("\\", "/");
  const at = normalized.lastIndexOf("/.nerve/");
  return at === -1 ? path : normalized.slice(at + 1);
}
