import type {
  ProjectConfigurationHealth,
  ProjectConfigurationIssue,
} from "@nervekit/contracts/projects";

/** Issues that make Nerve fall back; `migrated` is informational only. */
export function isFailingIssue(issue: ProjectConfigurationIssue): boolean {
  return issue.classification !== "migrated";
}

export function issueKey(
  issue: Pick<ProjectConfigurationIssue, "projectId" | "type">,
): string {
  return `${issue.projectId}\u0000${issue.type}`;
}

/** Identifies the set of failing files; the toast fires when it changes. */
export function failingSignature(
  byProject: Readonly<Record<string, readonly ProjectConfigurationIssue[]>>,
): string {
  return Object.values(byProject)
    .flat()
    .filter(isFailingIssue)
    .map((issue) => `${issueKey(issue)}:${issue.classification}`)
    .sort()
    .join(",");
}

export function failingToastTitle(
  byProject: Readonly<Record<string, readonly ProjectConfigurationIssue[]>>,
): string {
  const count = Object.values(byProject).flat().filter(isFailingIssue).length;
  return `Project configuration needs attention · ${count} ${count === 1 ? "file" : "files"}`;
}

export function withHealth(
  byProject: Readonly<Record<string, readonly ProjectConfigurationIssue[]>>,
  health: ProjectConfigurationHealth,
): Record<string, readonly ProjectConfigurationIssue[]> {
  const next = { ...byProject };
  if (health.issues.length) next[health.projectId] = health.issues;
  else delete next[health.projectId];
  return next;
}
