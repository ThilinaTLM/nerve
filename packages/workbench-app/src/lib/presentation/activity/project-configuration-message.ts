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

export type ProjectConfigurationAction = {
  label: string;
  onSelect: () => void;
  disabled?: boolean;
};

/** Open file / Reload / Reset (or Dismiss for migrated) for one issue. */
export function projectConfigurationActions(
  issue: ProjectConfigurationIssue,
  pending: boolean,
  handlers: {
    onOpen: (issue: ProjectConfigurationIssue) => void;
    onReload: (issue: ProjectConfigurationIssue) => void;
    onReset: (issue: ProjectConfigurationIssue) => void;
  },
): ProjectConfigurationAction[] {
  const reload = {
    disabled: pending,
    onSelect: () => handlers.onReload(issue),
  };
  if (issue.classification === "migrated")
    return [{ label: "Dismiss", ...reload }];
  const actions: ProjectConfigurationAction[] = [
    {
      label: issue.classification === "legacy" ? "Open folder" : "Open file",
      onSelect: () => handlers.onOpen(issue),
    },
    { label: "Reload", ...reload },
  ];
  const reset =
    issue.classification === "legacy"
      ? "Remove old files"
      : issue.classification === "corrupted" && issue.resetOffered
        ? "Reset"
        : undefined;
  if (reset)
    actions.push({
      label: reset,
      disabled: pending,
      onSelect: () => handlers.onReset(issue),
    });
  return actions;
}
