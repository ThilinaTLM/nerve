import type { CenterTabIdentity } from "./workspace-state.svelte";

type WorkspaceCommands = {
  reload: () => Promise<unknown>;
  selectProject: (
    projectId: string,
    options?: { deferTabActivation?: boolean },
  ) => Promise<CenterTabIdentity | undefined>;
};

let commands: WorkspaceCommands | undefined;

/** Installed once by the workspace application module at composition time. */
export function registerWorkspaceCommands(next: WorkspaceCommands): void {
  commands = next;
}

export async function reloadWorkspace(): Promise<void> {
  if (!commands) throw new Error("Workspace commands are not registered.");
  await commands.reload();
}

export async function selectWorkspaceProject(
  projectId: string,
  options?: { deferTabActivation?: boolean },
): Promise<CenterTabIdentity | undefined> {
  if (!commands) throw new Error("Workspace commands are not registered.");
  return commands.selectProject(projectId, options);
}
