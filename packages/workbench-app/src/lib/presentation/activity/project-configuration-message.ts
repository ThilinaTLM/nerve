import type { ProjectConfigurationIssue } from "@nervekit/contracts/projects";

/** What the user sees on an issue, by classification. */
export function issueMessage(issue: ProjectConfigurationIssue): string {
  if (issue.classification === "incompatible")
    return "Written by a newer Nerve. Upgrade Nerve to use it; the file is left untouched.";
  return issue.message;
}
