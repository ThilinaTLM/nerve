import { projectConfigurationHealth } from "$lib/application/project-configuration/project-configuration-health-state.svelte";

/** The launch definitions file is corrupted or incompatible; nothing can be shown or written. */
export function launchConfigurationBlocked(
  projectId: string | undefined,
): boolean {
  return projectConfigurationHealth
    .issuesFor(projectId)
    .some(
      (issue) =>
        issue.type === "launch-definitions" &&
        issue.classification !== "migrated",
    );
}
