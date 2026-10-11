export type LaunchDefinitionRevalidation = {
  projectId: string;
  generation: number;
};

export type LaunchDefinitionRevalidationGate = {
  enter: (
    projectId: string | undefined,
  ) => LaunchDefinitionRevalidation | undefined;
  isCurrent: (revalidation: LaunchDefinitionRevalidation) => boolean;
};

/**
 * Limits background definition revalidation to panel mount/project changes.
 * A generation also prevents an older project's completion from mutating the
 * loading state for the currently active project.
 */
export function createLaunchDefinitionRevalidationGate(): LaunchDefinitionRevalidationGate {
  let currentProjectId: string | undefined;
  let generation = 0;

  return {
    enter(projectId) {
      if (!projectId) {
        currentProjectId = undefined;
        generation += 1;
        return undefined;
      }
      if (projectId === currentProjectId) return undefined;
      currentProjectId = projectId;
      generation += 1;
      return { projectId, generation };
    },
    isCurrent(revalidation) {
      return (
        revalidation.projectId === currentProjectId &&
        revalidation.generation === generation
      );
    },
  };
}
