import { projectConfigurationHealth } from "$lib/application/project-configuration/project-configuration-health-state.svelte";
import { invalidateLaunchCatalog } from "$lib/features/launches/state/launch-definitions.svelte";

/** A reloaded or reset file changes what the launch catalog should show. */
export function registerProjectConfigurationHealthEffects(): () => void {
  return projectConfigurationHealth.onApplied(
    (health) => void invalidateLaunchCatalog(health.projectId).catch(() => {}),
  );
}
