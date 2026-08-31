import { workspaceFeaturePorts } from "./workspace-feature-ports.svelte";
import { workspaceState } from "./workspace-state.svelte";

/** Keep feature-specific tab projections aligned with the canonical center-tab list. */
export function syncCenterTabMirrors(): void {
  workspaceFeaturePorts().conversations.commands.setOpenConversationTabIds(
    idsForKind("conversation"),
  );
  workspaceFeaturePorts().tasks.commands.setOpenTaskTabIds(idsForKind("task"));
  workspaceFeaturePorts().filesystem.commands.setOpenFileTabIds(
    idsForKind("file"),
  );
  workspaceFeaturePorts().git.commands.setOpenPrTabIds(idsForKind("pr"));
  workspaceFeaturePorts().git.commands.setOpenDiffTabIds(idsForKind("diff"));
  workspaceFeaturePorts().settings.commands.setTabOpen(hasKind("settings"));
  workspaceFeaturePorts().logs.commands.setTabOpen(hasKind("logs"));
}

function idsForKind(
  kind: (typeof workspaceState.openCenterTabs)[number]["kind"],
): string[] {
  return workspaceState.openCenterTabs
    .filter((tab) => tab.kind === kind)
    .map((tab) => tab.id);
}

function hasKind(
  kind: (typeof workspaceState.openCenterTabs)[number]["kind"],
): boolean {
  return workspaceState.openCenterTabs.some((tab) => tab.kind === kind);
}
