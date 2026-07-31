export type GitStartupPolicy = {
  update(progressiveActive: boolean, projectId: string | undefined): void;
};

/** Admits automatic project refreshes only after progressive startup opens. */
export function createGitStartupPolicy(
  activate: (projectId: string | undefined) => void,
): GitStartupPolicy {
  let lastActivatedProjectId: string | undefined;
  let activated = false;
  return {
    update(progressiveActive, projectId) {
      if (!progressiveActive) return;
      if (activated && projectId === lastActivatedProjectId) return;
      activated = true;
      lastActivatedProjectId = projectId;
      activate(projectId);
    },
  };
}

export function shouldActivateGitPanel(input: {
  progressiveActive: boolean;
  enabled: boolean;
  projectId: string | undefined;
  lastProjectId: string | undefined;
}): boolean {
  return Boolean(
    input.progressiveActive &&
    input.enabled &&
    input.projectId &&
    input.projectId !== input.lastProjectId,
  );
}
